import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LeadToolName, ManagedAgentEvent } from '@acp/core';
import { createLogger } from '../../../src/logger.js';
import { createFakeManagedAdapter, type FakeAgent } from '../../control/fake-adapter.js';
import { boot, makeTempDir, showFile } from '../control/harness.js';

/*
 * R-V workspace e2e server (test-only; run by packages/web/e2e/playwright.config.ts, project
 * `workspace`). The real server in LIVE mode over an empty temp Claude dir (never the real
 * ~/.claude), a temp data dir, the built web UI, and the scripted fake managed adapter, so neither
 * the Agent SDK nor `claude` ever runs. Unlike the P3-F server no project is registered: the spec
 * creates one through the New project wizard, inside the temp parent folder this server makes.
 *
 * The fake agents are driven by the spec through a second, test-only HTTP listener on 127.0.0.1
 * (ACP_E2E_DRIVER_PORT). It exists only in this process; the product has no such route.
 *
 *   GET  /parent                       { parentDir }: the temp folder the wizard creates repos in
 *   GET  /agents                       every fake agent: id, kind, followUp, profile, skills, …
 *   POST /agents/:id/:action           started | usage | lead-text | finish | call-lead | write
 *   GET  /repo/show?root=&ref=&path=   a file on a ref of a repo under the parent folder
 *   GET  /logs                         the server's log lines (to assert no chat text is logged)
 */

const PORT = Number(process.env['ACP_PORT'] ?? '7871');
const DRIVER_PORT = Number(process.env['ACP_E2E_DRIVER_PORT'] ?? String(PORT + 1));
const DATA_DIR = process.env['ACP_DATA_DIR'] ?? makeTempDir('acp-e2e-workspace-');
const STATIC_DIR = fileURLToPath(new URL('../../../../web/dist', import.meta.url));
const LOG_FILE = join(DATA_DIR, 'server.log');

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(LOG_FILE, '');
const logger = createLogger((line) => appendFileSync(LOG_FILE, `${line}\n`));
const parentDir = makeTempDir('acp-e2e-workspace-parent-');
// Live mode reads only this empty folder: no sessions, nothing of the owner's.
const claudeDir = makeTempDir('acp-e2e-workspace-claude-');
const fake = createFakeManagedAdapter();

const booted = await boot({
  mode: 'live',
  dataDir: DATA_DIR,
  claudeDir,
  port: PORT,
  adapter: fake.adapter,
  logger,
  staticDir: STATIC_DIR,
  // workspace.spec.ts drives the flow of ticket runs started before ADR-0021 (the owner merges
  // each change into main; the stages after it), which such runs keep. The review loop needs its
  // own browser flow (RL-D/RL-V); set ACP_E2E_REVIEW_LOOP=1 to serve loop runs instead.
  board: { legacyTicketRuns: process.env['ACP_E2E_REVIEW_LOOP'] !== '1' },
});

function agentView(a: FakeAgent) {
  return {
    id: a.id,
    kind: a.spec.kind,
    followUp: a.spec.followUp !== undefined,
    resumeSessionId: a.spec.followUp?.resumeSessionId ?? null,
    profile: a.spec.profile?.name ?? null,
    skills: a.spec.skillPlugin?.skills ?? [],
    model: a.spec.model,
    prompt: a.spec.prompt,
    sent: a.sent,
    ended: a.ended,
    aborted: a.aborted,
  };
}

type Body = Record<string, unknown>;
const str = (b: Body, k: string): string => {
  const v = b[k];
  if (typeof v !== 'string') throw new Error(`${k} must be a string`);
  return v;
};

async function act(agent: FakeAgent, action: string, b: Body): Promise<unknown> {
  switch (action) {
    case 'started':
      agent.started(typeof b['sessionId'] === 'string' ? b['sessionId'] : undefined);
      return {};
    case 'usage':
      agent.usage(
        str(b, 'messageId'),
        b['tokens'] as Extract<ManagedAgentEvent, { type: 'usage' }>['tokens'],
      );
      return {};
    case 'lead-text':
      agent.emit({ type: 'lead-text', text: str(b, 'text') });
      return {};
    case 'finish':
      agent.finish(
        (b['outcome'] as 'success' | 'error' | 'cancelled' | undefined) ?? 'success',
        typeof b['cost'] === 'number' ? b['cost'] : null,
      );
      return {};
    case 'call-lead':
      try {
        return { ok: true, text: await agent.callLead(str(b, 'name') as LeadToolName, b['input']) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'unknown' };
      }
    case 'write': {
      // Only inside the agent's own directory (its worktree for a helper or the tester).
      const root = resolve(agent.spec.cwd);
      const target = resolve(root, str(b, 'path'));
      if (!target.startsWith(root + sep)) throw new Error('path outside the agent directory');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, str(b, 'content'));
      return {};
    }
    default:
      throw new Error(`unknown action ${action}`);
  }
}

async function readBody(req: IncomingMessage): Promise<Body> {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  return raw === '' ? {} : (JSON.parse(raw) as Body);
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

const driver = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${DRIVER_PORT}`);
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (req.method === 'GET' && url.pathname === '/parent') {
        return send(res, 200, { parentDir });
      }
      if (req.method === 'GET' && url.pathname === '/agents') {
        return send(res, 200, fake.agents.map(agentView));
      }
      if (req.method === 'GET' && url.pathname === '/repo/show') {
        // Only repositories the wizard made inside the temp parent folder.
        const root = resolve(url.searchParams.get('root') ?? '');
        if (!root.startsWith(parentDir + sep)) throw new Error('not a test repository');
        const content = showFile(
          root,
          url.searchParams.get('ref') ?? 'main',
          url.searchParams.get('path') ?? '',
        );
        return send(res, 200, { content });
      }
      if (req.method === 'GET' && url.pathname === '/logs') {
        return send(res, 200, { text: readFileSync(LOG_FILE, 'utf8') });
      }
      if (req.method === 'POST' && parts[0] === 'agents' && parts.length === 3) {
        // The latest start of that agent run: a follow-up turn reuses the ended lead's id.
        const agent = fake.byId(parts[1] ?? '');
        return send(res, 200, await act(agent, parts[2] ?? '', await readBody(req)));
      }
      send(res, 404, { error: 'not found' });
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : 'unknown' });
    }
  })();
});
driver.listen(DRIVER_PORT, '127.0.0.1');

const shutdown = () => {
  driver.close();
  void booted.server.close().finally(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
