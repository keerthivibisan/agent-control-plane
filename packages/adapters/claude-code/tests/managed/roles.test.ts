import type {
  AgentRoleKind,
  ManagedAgentEvent,
  ManagedAgentSpec,
  ManagedCallbacks,
  PermissionRequest,
} from '@acp/core';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { GIT_DENY_RULES } from '../../src/managed/branch-guard.js';
import { createManagedClaudeCode } from '../../src/index.js';
import { DENY_READ_ONLY, READ_ONLY_DISALLOWED_TOOLS } from '../../src/managed/permissions.js';
import { assistant, fakeQuery, idle, init, result } from './fake-query.js';

/**
 * Each role's toolset (ADR-0019, decisions B and E), through a fake `query` (synthetic; the real
 * Agent SDK never runs).
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

const CWD = '/work/acp/checkouts/run-1/agent-1';

function spec(kind: AgentRoleKind, extra: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return {
    agentRunId: `agent-${kind}`,
    kind,
    cwd: CWD,
    prompt: 'First task',
    model: null,
    leadTools: () => Promise.resolve('ok'),
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

/** One turn with some text, then a result; reports whether the input was still open after it. */
async function oneTurn(kind: AgentRoleKind) {
  let stillOpen: boolean | null = null;
  const { query } = fakeQuery(async function* (ctx) {
    await ctx.nextInput();
    yield init();
    yield assistant('msg-1', [{ type: 'text', text: 'Some text' }]);
    yield result();
    // A closed input ends at once; an open one waits for the next message (none comes).
    const next = await Promise.race([
      ctx.nextInput(),
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 20)),
    ]);
    stillOpen = next !== null;
  });
  const handle = createManagedClaudeCode({ query }).start(spec(kind), callbacks());
  const events: ManagedAgentEvent[] = [];
  const reading = (async () => {
    for await (const e of handle.events) events.push(e);
  })();
  await new Promise((resolve) => setTimeout(resolve, 40));
  handle.abort();
  await reading;
  return { events, stillOpen };
}

describe('planner (ADR-0019): read-only with submit_plan, input kept open', () => {
  it('gets only submit_plan and no edit or shell tools', () => {
    const options = optionsFor(spec('planner'));
    expect(servers.toolNames).toEqual([['submit_plan']]);
    expect(options.disallowedTools).toEqual([...READ_ONLY_DISALLOWED_TOOLS]);
    expect(options.disallowedTools).toEqual(
      expect.arrayContaining(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']),
    );
    expect(options.permissionMode).toBe('default');
    expect(options.settingSources).toEqual([]);
  });

  it('allows submit_plan and in-folder reads; denies other tools without asking', async () => {
    const cb = callbacks();
    const use = canUseTool(optionsFor(spec('planner'), cb));
    const ours = toolOpts({ mcpServer: { name: 'acp', source: 'sdk' } });
    await expect(use('mcp__acp__submit_plan', {}, ours)).resolves.toMatchObject({
      behavior: 'allow',
    });
    await expect(use('mcp__acp__start_agent', {}, ours)).resolves.toMatchObject({
      behavior: 'deny',
    });
    await expect(use('Read', { file_path: `${CWD}/a.ts` }, toolOpts())).resolves.toMatchObject({
      behavior: 'allow',
    });
    await expect(use('Edit', { file_path: `${CWD}/a.ts` }, toolOpts())).resolves.toEqual({
      behavior: 'deny',
      message: DENY_READ_ONLY,
      toolUseID: 'toolu_1',
    });
    await expect(use('Read', { file_path: '/etc/hosts' }, toolOpts())).resolves.toMatchObject({
      behavior: 'deny',
    });
    expect(cb.requests).toEqual([]);
  });

  it("keeps its input open for the owner's comments and publishes its text", async () => {
    const { events, stillOpen } = await oneTurn('planner');
    expect(stillOpen).toBe(true);
    expect(events).toContainEqual({ type: 'lead-text', text: 'Some text' });
  });
});

describe('reviewer (ADR-0019): read-only with post_review, ends after its turn', () => {
  it('gets only post_review and no edit or shell tools', () => {
    const options = optionsFor(spec('reviewer'));
    expect(servers.toolNames).toEqual([['post_review']]);
    expect(options.disallowedTools).toEqual([...READ_ONLY_DISALLOWED_TOOLS]);
  });

  it('allows post_review; denies the lead tools, edits and Bash without asking', async () => {
    const cb = callbacks();
    const use = canUseTool(optionsFor(spec('reviewer'), cb));
    const ours = toolOpts({ mcpServer: { name: 'acp', source: 'sdk' } });
    await expect(use('mcp__acp__post_review', {}, ours)).resolves.toMatchObject({
      behavior: 'allow',
    });
    for (const name of ['submit_plan', 'start_agent', 'request_review']) {
      await expect(use(`mcp__acp__${name}`, {}, ours)).resolves.toMatchObject({
        behavior: 'deny',
      });
    }
    await expect(use('Bash', { command: 'ls' }, toolOpts())).resolves.toMatchObject({
      behavior: 'deny',
      message: DENY_READ_ONLY,
    });
    expect(cb.requests).toEqual([]);
  });

  it('closes its input after the turn and never publishes its text', async () => {
    const { events, stillOpen } = await oneTurn('reviewer');
    expect(stillOpen).toBe(false);
    expect(events.some((e) => e.type === 'lead-text')).toBe(false);
  });
});

describe('tester (ADR-0019): a normal worker', () => {
  it('gets only its note tool and keeps the built-in tools, which ask the owner', async () => {
    const cb = callbacks();
    const options = optionsFor(spec('tester'), cb);
    // ADR-0026 §3: report_work is the tester's one control-plane tool.
    expect(servers.toolNames).toEqual([['report_work']]);
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['acp']);
    expect(options.disallowedTools).toEqual([...GIT_DENY_RULES]);
    const use = canUseTool(options);
    await expect(
      use('mcp__acp__start_agent', {}, toolOpts({ mcpServer: { name: 'acp', source: 'sdk' } })),
    ).resolves.toMatchObject({ behavior: 'deny' });
    await expect(use('Edit', { file_path: `${CWD}/a.test.ts` }, toolOpts())).resolves.toMatchObject(
      { behavior: 'allow' },
    );
    expect(cb.requests.map((r) => r.toolName)).toEqual(['Edit']);
  });

  it('ignores canStartHelpers: a tester never starts helpers', () => {
    optionsFor(spec('tester', { canStartHelpers: true }));
    expect(servers.toolNames).toEqual([['report_work']]);
  });

  it('closes its input after the turn, like a worker', async () => {
    const { events, stillOpen } = await oneTurn('tester');
    expect(stillOpen).toBe(false);
    expect(events.some((e) => e.type === 'lead-text')).toBe(false);
  });
});

describe('lead and worker keep their Phase 4 options', () => {
  it('no disallowed tools for the lead; only the branch deny rules (F-1) for a worker', () => {
    expect(optionsFor(spec('lead'))).not.toHaveProperty('disallowedTools');
    expect(optionsFor(spec('worker')).disallowedTools).toEqual([...GIT_DENY_RULES]);
  });
});

describe('skills plugin (ADR-0019 §4, decision E)', () => {
  const plugin = {
    path: '/data/runs/run-1/skills-plugin',
    skills: ['acp-skills:code-review', 'acp-skills:unit-tests'],
  };

  it('passes a local plugin and the skills allowlist; filesystem settings stay off', () => {
    for (const kind of ['lead', 'planner', 'worker', 'reviewer', 'tester'] as const) {
      const options = optionsFor(spec(kind, { skillPlugin: plugin }));
      expect(options.plugins).toEqual([{ type: 'local', path: plugin.path }]);
      expect(options.skills).toEqual(plugin.skills);
      expect(options.settingSources).toEqual([]);
      expect(options.permissionMode).toBe('default');
    }
  });

  it('passes a copy of the skills list', () => {
    const skills = ['acp-skills:a'];
    const options = optionsFor(spec('worker', { skillPlugin: { path: '/p', skills } }));
    skills.push('acp-skills:b');
    expect(options.skills).toEqual(['acp-skills:a']);
  });

  it('sets neither plugins nor skills without a skills plugin', () => {
    const options = optionsFor(spec('worker'));
    expect(options).not.toHaveProperty('plugins');
    expect(options).not.toHaveProperty('skills');
  });

  it('runs a whole turn with the plugin set', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield init();
      yield result();
    });
    const handle = createManagedClaudeCode({ query }).start(
      spec('worker', { skillPlugin: plugin }),
      callbacks(),
    );
    const events = await collect(handle.events);
    expect(events.at(-1)).toMatchObject({ type: 'finished', outcome: 'success' });
    expect(calls[0]?.options.plugins).toEqual([{ type: 'local', path: plugin.path }]);
  });
});
