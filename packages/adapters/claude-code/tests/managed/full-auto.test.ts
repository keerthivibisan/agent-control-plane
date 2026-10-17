import type {
  AgentRoleKind,
  ManagedAgentEvent,
  ManagedAgentSpec,
  ManagedCallbacks,
} from '@acp/core';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyStartupError,
  createManagedClaudeCode,
  EDITING_BASE_TOOLS,
  fullAutoDenyRules,
  READ_ONLY_DISALLOWED_TOOLS,
} from '../../src/managed/index.js';
import { fakeQuery, idle, init, result, SESSION_ID } from './fake-query.js';

/**
 * Full auto (ADR-0022) through a fake `query` (synthetic; the real Agent SDK never runs): helpers
 * and the tester get auto mode plus the OS sandbox; everyone else is unchanged; an agent whose
 * protections are unavailable ends with a failure code before any tool runs.
 */

const realQuery = vi.hoisted(() => ({
  fn: (): never => {
    throw new Error('the real Agent SDK query() was called');
  },
}));
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const original = await importOriginal<typeof Sdk>();
  return { ...original, query: realQuery.fn };
});

const HOME = '/home/owner';
const DATA = `${HOME}/.agent-control-plane`;
const CWD = `${DATA}/worktrees/run-1/agent-1`;
const TMP = `${DATA}/sandbox-tmp/run-1`;
const DENY_READ = [
  `${HOME}/.ssh`,
  `${HOME}/.aws`,
  `${HOME}/.gnupg`,
  `${HOME}/.config/gh`,
  `${HOME}/.netrc`,
  `${HOME}/.docker`,
  `${HOME}/.kube`,
  DATA,
  `${HOME}/.claude`,
];
const ENV = { PATH: '/usr/bin', HOME };

function spec(kind: AgentRoleKind, extra: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return {
    agentRunId: `agent-${kind}`,
    kind,
    cwd: CWD,
    prompt: 'Do the step',
    model: null,
    fullAuto: { tempDir: TMP, denyRead: DENY_READ },
    ...(kind === 'lead' || kind === 'planner' || kind === 'reviewer'
      ? { leadTools: () => Promise.resolve('ok') }
      : {}),
    ...extra,
  };
}

const callbacks: ManagedCallbacks = {
  requestPermission: () => Promise.resolve({ allow: false, message: 'no' }),
};

async function collect(events: AsyncIterable<ManagedAgentEvent>): Promise<ManagedAgentEvent[]> {
  const out: ManagedAgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function initIn(permissionMode: string | undefined): unknown {
  const base = init() as Record<string, unknown>;
  return permissionMode === undefined ? base : { ...base, permissionMode };
}

/** Runs one agent whose script reads the first message, then yields `messages`. */
async function run(s: ManagedAgentSpec, messages: unknown[], env: Record<string, string> = ENV) {
  const { query, calls } = fakeQuery(async function* (ctx) {
    await ctx.nextInput();
    yield* messages;
    await idle(ctx);
  });
  const events = await collect(createManagedClaudeCode({ query, env }).start(s, callbacks).events);
  return { events, call: calls[0] };
}

const EXPECTED_SANDBOX = {
  enabled: true,
  failIfUnavailable: true,
  allowUnsandboxedCommands: false,
  autoAllowBashIfSandboxed: false,
  filesystem: {
    allowWrite: [CWD, TMP],
    denyWrite: [`${CWD}/.git`, `${CWD}/.claude`],
    denyRead: DENY_READ,
    allowRead: [CWD, TMP],
  },
};

/** Every deny-read path except the data folder (it holds the worktree), then `.git`, `.claude`. */
const EXPECTED_DENY_RULES = [
  ...DENY_READ.filter((p) => p !== DATA).flatMap((p) => [`Read(/${p}/**)`, `Edit(/${p}/**)`]),
  `Edit(/${CWD}/.git)`,
  `Edit(/${CWD}/.git/**)`,
  `Edit(/${CWD}/.claude)`,
  `Edit(/${CWD}/.claude/**)`,
];

describe('SDK options of a Full auto helper or tester (ADR-0022)', () => {
  for (const kind of ['worker', 'tester'] as const) {
    it(`${kind}: auto mode, the sandbox, deny rules and TMPDIR; nothing else changes`, async () => {
      const { call } = await run(spec(kind), [initIn('auto'), result()]);
      const o = call?.options;
      expect(o?.permissionMode).toBe('auto');
      expect(o?.sandbox).toEqual(EXPECTED_SANDBOX);
      expect(o?.sandbox).not.toHaveProperty('network');
      expect(o?.disallowedTools).toEqual(EXPECTED_DENY_RULES);
      expect(o?.env).toEqual({ ...ENV, TMPDIR: TMP });
      expect(o?.tools).toEqual(EDITING_BASE_TOOLS);
      expect(o?.tools).not.toContain('Agent');
      expect(o?.tools).not.toContain('Task');
      expect(typeof o?.canUseTool).toBe('function');
      expect(o?.settingSources).toEqual([]);
      expect(o?.strictMcpConfig).toBe(true);
      expect(o?.allowedTools).toBeUndefined();
      expect(o?.allowDangerouslySkipPermissions).toBeUndefined();
    });
  }

  it('a rework turn keeps Full auto and resumes its session', async () => {
    const { call } = await run(spec('worker', { rework: { resumeSessionId: SESSION_ID } }), [
      initIn('auto'),
      result(),
    ]);
    expect(call?.options.permissionMode).toBe('auto');
    expect(call?.options.resume).toBe(SESSION_ID);
    expect(call?.options.sandbox).toEqual(EXPECTED_SANDBOX);
  });

  for (const kind of ['lead', 'planner', 'reviewer'] as const) {
    it(`${kind}: ignores fullAuto and keeps the default mode and its read-only set`, async () => {
      // The lead and the planner keep their input open: read the options, then stop the agent.
      const { query, calls } = fakeQuery(async function* (ctx) {
        await idle(ctx);
        yield* [];
      });
      const handle = createManagedClaudeCode({ query, env: ENV }).start(spec(kind), callbacks);
      handle.abort();
      await collect(handle.events);
      const o = calls[0]?.options;
      expect(o?.permissionMode).toBe('default');
      expect(o).not.toHaveProperty('sandbox');
      expect(o?.env).toEqual(ENV);
      expect(o?.tools).toEqual(['Read', 'Grep', 'Glob']);
      if (kind === 'lead') expect(o).not.toHaveProperty('disallowedTools');
      else expect(o?.disallowedTools).toEqual(READ_ONLY_DISALLOWED_TOOLS);
    });
  }

  it('a helper without fullAuto is unchanged', async () => {
    const { fullAuto: _omit, ...plain } = spec('worker');
    const { call } = await run(plain, [init(), result()]);
    expect(call?.options.permissionMode).toBe('default');
    expect(call?.options).not.toHaveProperty('sandbox');
    expect(call?.options).not.toHaveProperty('disallowedTools');
  });

  it('without an injected environment, TMPDIR is added to the inherited one', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield initIn('auto');
      yield result();
    });
    await collect(createManagedClaudeCode({ query }).start(spec('worker'), callbacks).events);
    expect(calls[0]?.options.env?.['TMPDIR']).toBe(TMP);
    expect(calls[0]?.options.env?.['PATH']).toBe(process.env['PATH']);
  });
});

describe('Full auto fails closed (ADR-0022)', () => {
  it('a session that reports auto mode starts and runs normally', async () => {
    const { events } = await run(spec('worker'), [initIn('auto'), result()]);
    expect(events.map((e) => e.type)).toEqual(['started', 'finished']);
    expect(events.at(-1)).toEqual({ type: 'finished', outcome: 'success', reportedCostUsd: 0.25 });
  });

  for (const mode of ['default', 'acceptEdits', undefined]) {
    it(`a session in ${mode ?? 'an unreported'} mode ends at once: auto-mode-unavailable`, async () => {
      const { events, call } = await run(spec('worker'), [initIn(mode), result()]);
      expect(events).toEqual([
        {
          type: 'finished',
          outcome: 'error',
          reportedCostUsd: null,
          failure: 'auto-mode-unavailable',
        },
      ]);
      expect(call?.closed).toBe(true);
      expect(call?.options.abortController?.signal.aborted).toBe(true);
    });
  }

  it('an error result about the sandbox: sandbox-unavailable (the text is not kept)', async () => {
    const errorResult = {
      ...(result({
        subtype: 'error_during_execution',
        is_error: true,
        total_cost_usd: 0,
      }) as object),
      errors: ['Sandbox dependencies are missing: install bubblewrap and socat'],
    };
    const { events } = await run(spec('tester'), [errorResult]);
    expect(events).toEqual([
      { type: 'finished', outcome: 'error', reportedCostUsd: null, failure: 'sandbox-unavailable' },
    ]);
    expect(JSON.stringify(events)).not.toContain('bubblewrap');
  });

  it('a thrown sandbox startup error: sandbox-unavailable', async () => {
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield* [];
      throw new Error('sandbox could not start on this platform');
    });
    const events = await collect(
      createManagedClaudeCode({ query, env: ENV }).start(spec('worker'), callbacks).events,
    );
    expect(events).toEqual([
      { type: 'finished', outcome: 'error', reportedCostUsd: null, failure: 'sandbox-unavailable' },
    ]);
  });

  it('an ordinary error has no failure code; nor does a non-Full-auto agent', async () => {
    const plainError = result({ subtype: 'error_during_execution', is_error: true });
    const a = await run(spec('worker'), [initIn('auto'), plainError]);
    expect(a.events.at(-1)).toEqual({ type: 'finished', outcome: 'error', reportedCostUsd: 0.25 });
    const { fullAuto: _omit, ...plain } = spec('worker');
    const sandboxText = { ...(plainError as object), errors: ['sandbox missing'] };
    const b = await run(plain, [init(), sandboxText]);
    expect(b.events.at(-1)).not.toHaveProperty('failure');
  });
});

describe('Full auto helpers', () => {
  it('deny rules skip a deny-read path that holds the agent’s own folders', () => {
    const rules = fullAutoDenyRules(CWD, { tempDir: TMP, denyRead: [DATA, `${HOME}/.ssh`] });
    expect(rules.some((r) => r.includes('.agent-control-plane/**'))).toBe(false);
    expect(rules).toContain(`Read(/${HOME}/.ssh/**)`);
    expect(rules[0]?.startsWith('Read(//home/owner/')).toBe(true);
  });

  it('classifies startup errors by kind only', () => {
    expect(classifyStartupError(['Seatbelt profile failed'])).toBe('sandbox-unavailable');
    expect(classifyStartupError(['auto mode is not available for this model'])).toBe(
      'auto-mode-unavailable',
    );
    expect(classifyStartupError(['rate limited'])).toBeNull();
    expect(classifyStartupError([])).toBeNull();
  });
});
