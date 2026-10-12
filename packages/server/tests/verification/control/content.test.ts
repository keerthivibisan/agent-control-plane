import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createManagedClaudeCode,
  type ManagedQuery,
  type ManagedQueryFn,
} from '@acp/adapter-claude-code';
import type { ManagedAgentSpec, ManagedExecutionAdapter } from '@acp/core';
import { RunDetailDtoSchema } from '@acp/core/api';
import { createLogger } from '../../../src/logger.js';
import {
  boot,
  dumpDatabase,
  makeRepo,
  makeTempDir,
  registerProject,
  showFile,
  waitFor,
  waitForRun,
} from './harness.js';

/*
 * P3-F: content minimization end to end (ADR-0009, ADR-0015). Unlike P3-D's service-level test,
 * this drives the REAL managed adapter (`createManagedClaudeCode`) with a scripted stand-in for the
 * SDK's `query()` (synthetic messages; the Agent SDK and `claude` never run) through the whole
 * server. The worker's script says, thinks, and passes tool input/output containing markers; after
 * a full run (approval, merge) every table of the database and every log line is searched for them.
 * The owner's chat, the lead's replies and the worker's task are allowed to be stored (ADR-0015) but
 * must never be logged.
 */

const SECRET = {
  text: 'WORKER-SECRET-TEXT',
  thinking: 'WORKER-SECRET-THINKING',
  toolInput: 'WORKER-SECRET-TOOL-INPUT',
  toolOutput: 'WORKER-SECRET-TOOL-OUTPUT',
  result: 'WORKER-SECRET-RESULT',
  ownerToWorker: 'WORKER-SECRET-FROM-OWNER',
} as const;
const OWNER_CHAT = 'OWNER-CHAT spin up one agent';
const LEAD_REPLY = 'LEAD-REPLY on it';
const WORKER_TASK = 'WORKER-TASK add a greeting file';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Options = Parameters<ManagedQueryFn>[0]['options'];
type Input = Parameters<ManagedQueryFn>[0]['prompt'];

/** A minimal SDK `query()` stand-in: the script yields SDK-shaped messages. */
function scripted(
  script: (options: Options, next: () => Promise<string | null>) => AsyncGenerator<unknown>,
): ManagedQueryFn {
  return ({ prompt, options }: { prompt: Input; options: Options }): ManagedQuery => {
    const input = prompt[Symbol.asyncIterator]();
    const next = async () => {
      const r = await input.next();
      if (r.done === true) return null;
      const c = r.value.message.content;
      return typeof c === 'string' ? c : JSON.stringify(c);
    };
    const gen = script(options, next);
    return {
      async *[Symbol.asyncIterator]() {
        for await (const m of gen) {
          if (options.abortController?.signal.aborted === true) throw new Error('aborted');
          yield m;
        }
      },
      interrupt: () => Promise.resolve(undefined),
    };
  };
}

const assistant = (sessionId: string, id: string, content: unknown[]) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  session_id: sessionId,
  uuid: `u-${id}`,
  message: {
    id,
    role: 'assistant',
    model: 'claude-test-model',
    content,
    usage: { input_tokens: 10, output_tokens: 5 },
  },
});
const init = (sessionId: string) => ({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  model: 'claude-test-model',
  cwd: '/x',
  tools: [],
});
const result = (sessionId: string, text: string) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  total_cost_usd: 0.01,
  result: text,
  session_id: sessionId,
  queued_turn_count: 0,
});

describe('P3-F content minimization through the real managed adapter', () => {
  it('stores and logs no worker text, thinking, tool input or output; logs no chat or task text', async () => {
    const dataDir = makeTempDir('acp-p3f-data-');
    const claudeDir = makeTempDir('acp-p3f-claude-');
    const repo = makeRepo();
    dirs.push(dataDir, claudeDir, repo);
    const logs: string[] = [];
    const logger = createLogger((line) => logs.push(line));

    const permissionAnswers: string[] = [];
    const query = scripted(async function* (options, next) {
      const cwd = options.cwd ?? '';
      // The lead: the only agent with our MCP server.
      if (options.mcpServers?.['acp'] !== undefined) {
        const sid = 'lead-session';
        yield init(sid);
        let turn = 0;
        while ((await next()) !== null) {
          yield assistant(sid, `lead-${turn}`, [{ type: 'text', text: LEAD_REPLY }]);
          yield result(sid, LEAD_REPLY);
          turn++;
        }
        return;
      }
      const sid = 'worker-session';
      await next();
      yield init(sid);
      const toolInput = { file_path: join(cwd, 'greeting.txt'), content: SECRET.toolInput };
      yield assistant(sid, 'w-1', [
        { type: 'thinking', thinking: SECRET.thinking, signature: 'x' },
        { type: 'text', text: SECRET.text },
        { type: 'tool_use', id: 'tu-1', name: 'Write', input: toolInput },
      ]);
      const canUseTool = options.canUseTool;
      if (canUseTool === undefined) throw new Error('no canUseTool');
      const decision = await canUseTool('Write', toolInput, {
        signal: new AbortController().signal,
        suggestions: [],
        toolUseID: 'tu-1',
        requestId: 'req-1',
      });
      permissionAnswers.push(decision?.behavior ?? 'none');
      if (decision?.behavior === 'allow') writeFileSync(toolInput.file_path, 'hello\n');
      yield {
        type: 'user',
        parent_tool_use_id: null,
        session_id: sid,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: SECRET.toolOutput }],
        },
      };
      yield assistant(sid, 'w-2', [{ type: 'text', text: SECRET.text }]);
      yield result(sid, SECRET.result);
      while ((await next()) !== null) {
        // The adapter closes a worker's input after its last turn.
      }
    });

    // Tests call the lead's tools the way its in-process MCP server does: through spec.leadTools.
    const real = createManagedClaudeCode({ query, env: {} });
    let leadTools: ManagedAgentSpec['leadTools'];
    const adapter: ManagedExecutionAdapter = {
      provider: 'claude-code',
      start(spec, callbacks) {
        if (spec.kind === 'lead') leadTools = spec.leadTools;
        return real.start(spec, callbacks);
      },
    };

    const b = await boot({ mode: 'live', dataDir, claudeDir, adapter, logger });
    try {
      const project = await registerProject(b, 'app', repo);
      const runId = RunDetailDtoSchema.parse(
        (await b.post('/api/runs', { projectId: project.id })).body,
      ).id;
      await b.post(`/api/runs/${runId}/chat`, { text: OWNER_CHAT });
      await waitForRun(
        b,
        runId,
        (r) => r.messages.some((m) => m.role === 'lead'),
        'the lead reply',
      );
      const call = await waitFor(() => leadTools, 'lead tools');
      await call('start_agent', { role: 'Builder', task: WORKER_TASK });
      const asked = await waitForRun(
        b,
        runId,
        (r) => r.approvals.some((a) => a.status === 'pending'),
        'the approval',
      );
      const approval = asked.approvals[0];
      const worker = asked.agents.find((a) => a.kind === 'worker');
      if (approval === undefined || worker === undefined) throw new Error('missing approval');
      // The approval shows the tool and its target only, never the content to be written.
      expect(approval.summary).toContain('greeting.txt');
      expect(approval.summary).not.toContain(SECRET.toolInput);
      // The owner messages the worker while it waits (sent to it, never stored).
      await b.post(`/api/runs/${runId}/agents/${worker.id}/message`, {
        text: SECRET.ownerToWorker,
      });
      await b.post(`/api/approvals/${approval.id}`, { decision: 'approve' });
      await waitForRun(
        b,
        runId,
        (r) => r.agents.some((a) => a.kind === 'worker' && a.status === 'SUCCEEDED'),
        'the worker finished',
      );
      expect(permissionAnswers).toEqual(['allow']);
      await call('request_review', {});
      const merged = await b.post(`/api/runs/${runId}/review`, {
        agentRunId: worker.id,
        action: 'merge',
      });
      expect(merged.status).toBe(200);
      await waitForRun(b, runId, (r) => r.status === 'COMPLETED', 'the run completed');
      expect(showFile(repo, 'main', 'greeting.txt')).toBe('hello\n');
    } finally {
      await b.server.close();
    }

    const dump = dumpDatabase(join(dataDir, 'acp.sqlite'));
    for (const secret of Object.values(SECRET)) expect(dump).not.toContain(secret);
    // What ADR-0015 allows is stored (so the dump really covers these tables).
    for (const kept of [OWNER_CHAT, LEAD_REPLY, WORKER_TASK]) expect(dump).toContain(kept);

    const logText = logs.join('\n');
    expect(logs.length).toBeGreaterThan(10);
    for (const banned of [...Object.values(SECRET), OWNER_CHAT, LEAD_REPLY, WORKER_TASK]) {
      expect(logText).not.toContain(banned);
    }
    // Nothing written next to the database holds it either (artifacts, worktrees are gone).
    expect(readFileSync(join(dataDir, 'acp.sqlite')).includes(SECRET.text)).toBe(false);
  });
});
