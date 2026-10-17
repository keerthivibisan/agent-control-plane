import { CONTROL_TOOL_LABELS, LEAD_TOOL_NAMES } from '@acp/core';
import type { ManagedAgentEvent, ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createManagedClaudeCode } from '../../src/index.js';
import {
  CHANGE_REVIEWER_ROLE_TOOL_NAMES,
  DENY_CHANGE_REVIEWER_TOOL,
  DENY_NOT_IN_ROLE,
  DENY_READ_ONLY,
  managedToolNames,
  READ_ONLY_DISALLOWED_TOOLS,
  REVIEWER_TOOL_NAMES,
} from '../../src/managed/permissions.js';
import { activitySummary } from '../../src/managed/summary.js';
import { SESSION_ID, assistant, fakeQuery, idle, init, result } from './fake-query.js';

/**
 * The review loop in the adapter (ADR-0021 §3, RL-B), through a fake `query` (synthetic; the real
 * Agent SDK never runs): the change reviewer's one tool, the rework turn's resume, and readable
 * "Latest" lines for control-plane tools.
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

const CWD = '/data/review-checkouts/run-1/rev-1';

function spec(extra: Partial<ManagedAgentSpec>): ManagedAgentSpec {
  return {
    agentRunId: 'agent-1',
    kind: 'reviewer',
    cwd: CWD,
    prompt: 'Synthetic brief',
    model: null,
    leadTools: () => Promise.resolve('ok'),
    ...extra,
  };
}

const allow: ManagedCallbacks = { requestPermission: () => Promise.resolve({ allow: true }) };

function optionsFor(s: ManagedAgentSpec): Sdk.Options {
  servers.toolNames.length = 0;
  const { query, calls } = fakeQuery(async function* (ctx) {
    await idle(ctx);
    yield* [];
  });
  createManagedClaudeCode({ query }).start(s, allow).abort();
  const options = calls[0]?.options;
  if (options === undefined) throw new Error('query was not called');
  return options;
}

const toolOpts = (extra: Partial<Parameters<Sdk.CanUseTool>[2]> = {}) => ({
  signal: new AbortController().signal,
  toolUseID: 'toolu_1',
  requestId: 'req_1',
  ...extra,
});

describe('change reviewer (reviewScope: change)', () => {
  it('gets submit_review only, read-only base tools, and the final reviewer post_review only', () => {
    expect(managedToolNames(spec({ reviewScope: 'change' }))).toEqual(['submit_review']);
    expect(CHANGE_REVIEWER_ROLE_TOOL_NAMES).toEqual(['submit_review']);
    expect(managedToolNames(spec({ reviewScope: 'final' }))).toEqual(REVIEWER_TOOL_NAMES);
    expect(managedToolNames(spec({}))).toEqual(['post_review']);

    const options = optionsFor(spec({ reviewScope: 'change' }));
    expect(servers.toolNames).toEqual([['submit_review']]);
    expect(options.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(options.disallowedTools).toEqual([...READ_ONLY_DISALLOWED_TOOLS]);
  });

  it('denies every other control tool and any edit without asking', async () => {
    const asked: string[] = [];
    const { query, calls } = fakeQuery(async function* (ctx) {
      await idle(ctx);
      yield* [];
    });
    const handle = createManagedClaudeCode({ query }).start(spec({ reviewScope: 'change' }), {
      requestPermission: (r) => {
        asked.push(r.toolName);
        return Promise.resolve({ allow: true });
      },
    });
    const gate = calls[0]?.options.canUseTool;
    if (gate === undefined) throw new Error('no gate');
    const ours = toolOpts({ mcpServer: { name: 'acp', source: 'sdk' } });
    await expect(gate('mcp__acp__submit_review', {}, ours)).resolves.toMatchObject({
      behavior: 'allow',
    });
    for (const name of LEAD_TOOL_NAMES.filter((n) => n !== 'submit_review')) {
      await expect(gate(`mcp__acp__${name}`, {}, ours)).resolves.toEqual({
        behavior: 'deny',
        message: DENY_CHANGE_REVIEWER_TOOL,
        toolUseID: 'toolu_1',
      });
    }
    await expect(gate('Edit', { file_path: 'a.ts' }, toolOpts())).resolves.toMatchObject({
      behavior: 'deny',
      message: DENY_READ_ONLY,
    });
    await expect(gate('Bash', { command: 'npm test' }, toolOpts())).resolves.toMatchObject({
      behavior: 'deny',
    });
    await expect(gate('WebFetch', { url: 'https://x.test' }, toolOpts())).resolves.toMatchObject({
      behavior: 'deny',
      message: DENY_NOT_IN_ROLE,
    });
    expect(asked).toEqual([]);
    handle.abort();
  });
});

describe('rework turn (ManagedAgentSpec.rework)', () => {
  const worker = (extra: Partial<ManagedAgentSpec>): ManagedAgentSpec => ({
    agentRunId: 'agent-1',
    kind: 'worker',
    cwd: '/data/worktrees/run-1/agent-1',
    prompt: 'Synthetic rework comments',
    model: null,
    ...extra,
  });

  it("resumes the helper's own session in its worktree, never forked, with the same tools", () => {
    const fresh = optionsFor(worker({}));
    const options = optionsFor(worker({ rework: { resumeSessionId: SESSION_ID } }));
    expect(options.resume).toBe(SESSION_ID);
    expect(options.forkSession).toBe(false);
    expect(options.cwd).toBe('/data/worktrees/run-1/agent-1');
    expect(options.tools).toEqual(fresh.tools);
    expect(options.tools).toEqual(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash']);
    expect(options.mcpServers).toEqual({});
    expect(options.permissionMode).toBe('default');
    expect(options.allowedTools).toBeUndefined();
  });

  it('starts fresh without a session to resume', () => {
    const options = optionsFor(worker({ rework: { resumeSessionId: null } }));
    expect(options.resume).toBeUndefined();
    expect(options.forkSession).toBeUndefined();
  });

  it('closes its input after the turn, so the agent finishes', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      yield init();
      yield assistant('m1', [{ type: 'text', text: 'Fixed it.' }]);
      yield result();
      await idle(ctx);
    });
    const handle = createManagedClaudeCode({ query }).start(
      worker({ rework: { resumeSessionId: SESSION_ID } }),
      allow,
    );
    const events: ManagedAgentEvent[] = [];
    for await (const e of handle.events) events.push(e);
    expect(events.at(-1)).toMatchObject({ type: 'finished', outcome: 'success' });
  });
});

describe('"Latest" labels for control-plane tools (ADR-0021)', () => {
  it('maps mcp__acp__<name> to its plain label, never the raw name or its input', () => {
    for (const [name, label] of Object.entries(CONTROL_TOOL_LABELS)) {
      expect(activitySummary(`mcp__acp__${name}`, { agentId: 'x', comments: 'SECRET' }, CWD)).toBe(
        label,
      );
    }
    expect(activitySummary('mcp__acp__merge_change', {}, CWD)).toBe("Merged a helper's change");
    // Unknown names and other tools keep the plain summary.
    expect(activitySummary('mcp__acp__nope', {}, CWD)).toBe('mcp__acp__nope');
    expect(activitySummary('Edit', { file_path: `${CWD}/src/a.ts` }, CWD)).toBe('Edit src/a.ts');
  });

  it("the lead's activity event uses the label", async () => {
    const { query } = fakeQuery(async function* (ctx) {
      yield init();
      yield assistant('m1', [
        { type: 'tool_use', id: 't1', name: 'mcp__acp__agent_status', input: { agentId: 'a' } },
      ]);
      yield result();
      await idle(ctx);
    });
    const handle = createManagedClaudeCode({ query }).start(
      spec({ kind: 'lead', cwd: '/work/project' }),
      allow,
    );
    const events: ManagedAgentEvent[] = [];
    const reader = (async () => {
      for await (const e of handle.events) {
        events.push(e);
        if (e.type === 'activity') handle.abort();
      }
    })();
    await reader;
    expect(events.find((e) => e.type === 'activity')).toEqual({
      type: 'activity',
      summary: "Checked a helper's status",
    });
  });
});
