import type {
  ManagedAgentEvent,
  ManagedAgentSpec,
  ManagedCallbacks,
  PermissionRequest,
} from '@acp/core';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createManagedClaudeCode, ManagedFollowUpSendError } from '../../src/index.js';
import {
  DENY_FOLLOW_UP,
  FOLLOW_UP_DISALLOWED_TOOLS,
  READ_ONLY_DISALLOWED_TOOLS,
} from '../../src/managed/permissions.js';
import { SESSION_ID, assistant, fakeQuery, idle, init, result } from './fake-query.js';

/**
 * Follow-up turns of an ended lead (ADR-0020, docs/research/sdk-session-resume-2026-10-16.md)
 * through a fake `query` (synthetic; the real Agent SDK never runs): the saved session is resumed,
 * never forked, answers-only, for one turn.
 */

const realQuery = vi.hoisted(() => ({
  fn: (): never => {
    throw new Error('the real Agent SDK query() was called');
  },
}));
const servers = vi.hoisted(() => ({ toolNames: [] as string[][] }));
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const original = await importOriginal<typeof Sdk>();
  return {
    ...original,
    query: realQuery.fn,
    createSdkMcpServer: (options: Parameters<typeof Sdk.createSdkMcpServer>[0]) => {
      servers.toolNames.push((options.tools ?? []).map((t) => t.name));
      return original.createSdkMcpServer(options);
    },
  };
});

const ROOT = '/work/projects/web-app';
const RESUME = SESSION_ID;

function spec(extra: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return {
    agentRunId: 'lead-1',
    kind: 'lead',
    cwd: ROOT,
    prompt: 'Preface\n\nThe owner question',
    model: null,
    followUp: { resumeSessionId: RESUME },
    ...extra,
  };
}

function callbacks(): ManagedCallbacks & { requests: PermissionRequest[] } {
  const requests: PermissionRequest[] = [];
  return {
    requests,
    requestPermission(r) {
      requests.push(r);
      return Promise.resolve({ allow: true });
    },
  };
}

function optionsFor(s: ManagedAgentSpec, cb: ManagedCallbacks = callbacks()): Sdk.Options {
  servers.toolNames.length = 0;
  const { query, calls } = fakeQuery(async function* (ctx) {
    await idle(ctx);
    yield* [];
  });
  createManagedClaudeCode({ query }).start(s, cb).abort();
  const options = calls[0]?.options;
  if (options === undefined) throw new Error('query was not called');
  return options;
}

type CanUseToolOptions = Parameters<Sdk.CanUseTool>[2];
const toolOpts = (extra: Partial<CanUseToolOptions> = {}): CanUseToolOptions => ({
  signal: new AbortController().signal,
  toolUseID: 'toolu_1',
  requestId: 'req_1',
  ...extra,
});

function canUseTool(options: Sdk.Options): Sdk.CanUseTool {
  const fn = options.canUseTool;
  if (fn === undefined) throw new Error('no canUseTool');
  return fn;
}

async function collect(events: AsyncIterable<ManagedAgentEvent>): Promise<ManagedAgentEvent[]> {
  const out: ManagedAgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe('follow-up options (ADR-0020 §2, §4)', () => {
  it('resumes the saved session in the same folder, never forked', () => {
    const options = optionsFor(spec());
    expect(options.resume).toBe(RESUME);
    expect(options.forkSession).toBe(false);
    expect(options.cwd).toBe(ROOT);
  });

  it('is answers-only: read-only tools, no control-plane tools, no MCP server, no skills', () => {
    const options = optionsFor(
      spec({
        // Even with lead tools and a skills plugin handed over, none reach a follow-up turn.
        leadTools: () => Promise.resolve('ok'),
        skillPlugin: { path: '/data/runs/run-1/skills-plugin', skills: ['acp-skills:x'] },
      }),
    );
    expect(options.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(options.disallowedTools).toEqual([...FOLLOW_UP_DISALLOWED_TOOLS]);
    expect(options.disallowedTools).toEqual(
      expect.arrayContaining([...READ_ONLY_DISALLOWED_TOOLS, 'Agent', 'Task']),
    );
    expect(options.mcpServers).toEqual({});
    expect(servers.toolNames).toEqual([]);
    expect(options.plugins).toBeUndefined();
    expect(options.skills).toBeUndefined();
  });

  it('keeps the safety settings of every managed agent and never sets allowedTools', () => {
    const options = optionsFor(spec({ model: 'claude-x' }));
    expect(options.permissionMode).toBe('default');
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.allowedTools).toBeUndefined();
    expect(options.model).toBe('claude-x');
    expect(options).not.toHaveProperty('allowedTools');
  });

  it("narrows further with the lead stage's agent file, never widens", () => {
    const profile = { name: 'lead-a', instructions: 'Be brief.', tools: ['Read', 'Bash', 'Edit'] };
    const options = optionsFor(spec({ profile }));
    expect(options.tools).toEqual(['Read']);
    expect(optionsFor(spec({ profile: { ...profile, tools: null } })).tools).toEqual([
      'Read',
      'Grep',
      'Glob',
    ]);
  });

  it('leaves a normal lead exactly as before (no resume, lead tools)', () => {
    const { followUp: _none, ...lead } = spec({ leadTools: () => Promise.resolve('') });
    const options = optionsFor(lead);
    expect(options.resume).toBeUndefined();
    expect(options.forkSession).toBeUndefined();
    // The lead's own base set (ADR-0019 §7): the same read-only tools, plus its control tools.
    expect(options.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(options).not.toHaveProperty('disallowedTools');
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['acp']);
  });
});

describe('follow-up gate', () => {
  it('allows reads inside the project and denies everything else without asking', async () => {
    const cb = callbacks();
    const use = canUseTool(optionsFor(spec(), cb));
    const opts = toolOpts();
    await expect(use('Read', { file_path: `${ROOT}/src/a.ts` }, opts)).resolves.toMatchObject({
      behavior: 'allow',
    });
    await expect(use('Grep', { pattern: 'x', path: 'src' }, opts)).resolves.toMatchObject({
      behavior: 'allow',
    });
    await expect(use('Glob', { pattern: '**/*.ts' }, opts)).resolves.toMatchObject({
      behavior: 'allow',
    });
    for (const [tool, input] of [
      ['Read', { file_path: '/etc/hosts' }],
      ['Bash', { command: 'ls' }],
      ['Edit', { file_path: `${ROOT}/a.ts` }],
      ['Write', { file_path: `${ROOT}/a.ts` }],
      ['Agent', { prompt: 'x' }],
      ['WebFetch', { url: 'https://example.com' }],
      ['mcp__acp__start_agent', { role: 'x', task: 'y' }],
      ['mcp__acp__submit_plan', {}],
    ] as const) {
      const decision = await use(
        tool,
        input,
        toolOpts({ mcpServer: { name: 'acp', source: 'sdk' } }),
      );
      expect(decision, tool).toMatchObject({ behavior: 'deny', message: DENY_FOLLOW_UP });
    }
    // A read Claude Code flags as blocked is denied too.
    await expect(
      use('Read', { file_path: `${ROOT}/a.ts` }, toolOpts({ blockedPath: `${ROOT}/a.ts` })),
    ).resolves.toMatchObject({ behavior: 'deny' });
    expect(cb.requests).toEqual([]);
  });
});

describe('one turn', () => {
  it('sends the one message, reports the reply, and closes the input after the turn', async () => {
    let afterTurn: string | null = 'waiting';
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield init();
      yield assistant('msg-f1', [{ type: 'text', text: 'Because it persists.' }]);
      yield result({ total_cost_usd: 3.5 });
      afterTurn = await Promise.race([
        ctx.nextInput(),
        new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 50)),
      ]);
    });
    const handle = createManagedClaudeCode({ query }).start(spec(), callbacks());
    await expect(handle.send('a second message')).rejects.toBeInstanceOf(ManagedFollowUpSendError);
    const events = await collect(handle.events);
    expect(calls[0]?.inputs).toEqual(['Preface\n\nThe owner question']);
    expect(afterTurn).toBeNull();
    expect(events).toEqual([
      { type: 'started', providerSessionId: SESSION_ID, model: 'claude-test-model' },
      { type: 'lead-text', text: 'Because it persists.' },
      {
        type: 'usage',
        messageId: 'msg-f1',
        tokens: { input: 10, output: 5, cacheCreation: null, cacheRead: null },
      },
      { type: 'finished', outcome: 'success', reportedCostUsd: 3.5 },
    ]);
  });

  it('ends with an error when the resume fails with an error result (session not found)', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield result({ subtype: 'error_during_execution', is_error: true, total_cost_usd: 0 });
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec(), callbacks()).events,
    );
    expect(events).toEqual([{ type: 'finished', outcome: 'error', reportedCostUsd: null }]);
  });

  it('ends with an error when the SDK throws', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield* [];
      throw new Error('No conversation found with session ID');
    });
    const events = await collect(
      createManagedClaudeCode({ query }).start(spec(), callbacks()).events,
    );
    expect(events).toEqual([{ type: 'finished', outcome: 'error', reportedCostUsd: null }]);
  });
});
