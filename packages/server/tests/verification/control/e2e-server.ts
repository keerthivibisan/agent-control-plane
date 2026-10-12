import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LeadToolName, ManagedAgentEvent } from '@acp/core';
import { createLogger } from '../../../src/logger.js';
import { createFakeManagedAdapter, type FakeAgent } from '../../control/fake-adapter.js';
import { boot, makeRepo, makeTempDir, registerProject, showFile } from './harness.js';

/*
 * P3-F e2e server (test-only; run by packages/web/e2e/playwright.config.ts). It starts the real
 * server in DEMO mode with a temp data dir, the built web UI, a throwaway git repo registered as
 * the project "e2e-app", and the scripted fake managed adapter, so neither the Agent SDK nor the
 * `claude` binary ever runs.
 *
 * The fake agents are driven by the Playwright spec through a second, test-only HTTP listener on
 * 127.0.0.1 (ACP_E2E_DRIVER_PORT). It exists only in this process; the product has no such route.
 *
 *   GET  /agents                       every fake agent: id, kind, prompt, sent, ended, answers
 *   POST /agents/:id/:action           started | usage | activity | lead-text | finish | ask |
 *                                      call-lead | write (body: JSON, see `act`)
 *   GET  /repo/show?ref=&path=         a file on a ref of the throwaway repo ({ content | null })
 *   GET  /logs                         the server's log lines (to assert no chat text is logged)
 */

const PORT = Number(process.env['ACP_PORT'] ?? '7441');
const DRIVER_PORT = Number(process.env['ACP_E2E_DRIVER_PORT'] ?? String(PORT + 1));
const DATA_DIR = process.env['ACP_DATA_DIR'] ?? makeTempDir('acp-e2e-control-');
const STATIC_DIR = fileURLToPath(new URL('../../../../web/dist', import.meta.url));
const LOG_FILE = join(DATA_DIR, 'server.log');

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(LOG_FILE, '');
const logger = createLogger((line) => appendFileSync(LOG_FILE, `${line}\n`));
const repo = makeRepo({ 'README.md': 'hello\n', 'src/app.ts': 'export {};\n' });
const fake = createFakeManagedAdapter();
/** Each agent's permission answers, in order (`ask` does not wait for the owner). */
const answers = new Map<string, { tool: string; allow: boolean | null }[]>();

const booted = await boot({
  mode: 'demo',
  dataDir: DATA_DIR,
  port: PORT,
  adapter: fake.adapter,
  logger,
  staticDir: STATIC_DIR,
});
await registerProject(booted, 'e2e-app', repo);

function agentView(a: FakeAgent) {
  return {
    id: a.id,
    kind: a.spec.kind,
    prompt: a.spec.prompt,
    sent: a.sent,
    ended: a.ended,
    aborted: a.aborted,
    interrupts: a.interrupts,
    answers: answers.get(a.id) ?? [],
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
      agent.started();
      return {};
    case 'usage':
      agent.usage(
        str(b, 'messageId'),
        b['tokens'] as Extract<ManagedAgentEvent, { type: 'usage' }>['tokens'],
      );
      return {};
    case 'activity':
      agent.emit({ type: 'activity', summary: str(b, 'summary') });
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
    case 'ask': {
      const tool = str(b, 'toolName');
      const list = answers.get(agent.id) ?? [];
      answers.set(agent.id, list);
      const entry: { tool: string; allow: boolean | null } = { tool, allow: null };
      list.push(entry);
      void agent.ask(tool, str(b, 'summary')).then((d) => (entry.allow = d.allow));
      return {};
    }
    case 'call-lead':
      try {
        return { ok: true, text: await agent.callLead(str(b, 'name') as LeadToolName, b['input']) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'unknown' };
      }
    case 'write': {
      // Only inside the agent's own directory (its worktree for a worker).
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
      if (req.method === 'GET' && url.pathname === '/agents') {
        return send(res, 200, fake.agents.map(agentView));
      }
      if (req.method === 'GET' && url.pathname === '/repo/show') {
        const content = showFile(
          repo,
          url.searchParams.get('ref') ?? 'main',
          url.searchParams.get('path') ?? '',
        );
        return send(res, 200, { content });
      }
      if (req.method === 'GET' && url.pathname === '/logs') {
        return send(res, 200, { text: readFileSync(LOG_FILE, 'utf8') });
      }
      if (req.method === 'POST' && parts[0] === 'agents' && parts.length === 3) {
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
