import type {
  AgentRoleKind,
  ManagedAgentEvent,
  ManagedAgentSpec,
  ManagedCallbacks,
} from '@acp/core';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { GIT_DENY_RULES } from '../../src/managed/branch-guard.js';
import { buildOptions } from '../../src/managed/adapter.js';
import {
  createManagedClaudeCode,
  fullAutoDenyRules,
  fullAutoSandbox,
  launchProtectionOf,
  type LaunchProtection,
} from '../../src/managed/index.js';
import { fakeQuery, idle, init, result } from './fake-query.js';

/**
 * Launch per agent (ADR-0023 §5, WG-C) through a fake `query` (synthetic; the real Agent SDK never
 * runs): in one run, each helper or tester gets its own node's launch (auto mode plus the sandbox,
 * the sandbox alone in `default`, or neither); the lead, planner and reviewers always keep
 * `default` with no sandbox; nothing ever gets `allowedTools` or `bypassPermissions`.
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
const TMP = `${DATA}/sandbox-tmp/run-1`;
const DENY_READ = [`${HOME}/.ssh`, `${HOME}/.aws`, DATA, `${HOME}/.claude`];
const PATHS = { tempDir: TMP, denyRead: DENY_READ };
const ENV = { PATH: '/usr/bin', HOME };
const cwdOf = (id: string) => `${DATA}/worktrees/run-1/${id}`;

const callbacks: ManagedCallbacks = {
  requestPermission: () => Promise.resolve({ allow: false, message: 'no' }),
};

function spec(
  id: string,
  kind: AgentRoleKind,
  extra: Partial<ManagedAgentSpec> = {},
): ManagedAgentSpec {
  return {
    agentRunId: id,
    kind,
    cwd: cwdOf(id),
    prompt: 'Do the step',
    model: null,
    ...(kind === 'lead' || kind === 'planner' || kind === 'reviewer'
      ? { leadTools: () => Promise.resolve('ok') }
      : {}),
    ...extra,
  };
}

async function collect(events: AsyncIterable<ManagedAgentEvent>): Promise<ManagedAgentEvent[]> {
  const out: ManagedAgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function noSecrets(options: object | undefined) {
  expect(options).not.toHaveProperty('allowedTools');
  expect(options).not.toHaveProperty('allowDangerouslySkipPermissions');
  expect((options as { permissionMode?: string }).permissionMode).not.toBe('bypassPermissions');
}

describe('a mixed-mode run: each agent gets its own launch (ADR-0023 §5)', () => {
  it('Manual named helper, Full auto pool, Auto edits tester, and the read-only roles', async () => {
    // The server sends `fullAuto` only for an agent whose node runs Full auto in the run; here
    // it is (wrongly) on the lead and the reviewer too, which the adapter must ignore.
    const specs = [
      spec('frontend-1', 'worker'),
      spec('pool-1', 'worker', { fullAuto: PATHS }),
      spec('tester-1', 'tester'),
      spec('lead-1', 'lead', { fullAuto: PATHS }),
      spec('planner-1', 'planner'),
      spec('reviewer-1', 'reviewer', { fullAuto: PATHS, reviewScope: 'change' }),
    ];
    const { query, calls } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield ctx.options.permissionMode === 'auto'
        ? { ...(init() as object), permissionMode: 'auto' }
        : init();
      yield result();
      await idle(ctx);
    });
    const adapter = createManagedClaudeCode({ query, env: ENV });
    const handles = specs.map((s) => adapter.start(s, callbacks));
    for (const h of handles.slice(3)) h.abort();
    await Promise.all(handles.map((h) => collect(h.events)));

    const byId = new Map(specs.map((s, i) => [s.agentRunId, calls[i]?.options]));
    const mode = (id: string) => byId.get(id)?.permissionMode;
    expect(
      ['frontend-1', 'pool-1', 'tester-1', 'lead-1', 'planner-1', 'reviewer-1'].map(mode),
    ).toEqual(['default', 'auto', 'default', 'default', 'default', 'default']);
    expect(byId.get('pool-1')?.sandbox).toEqual(fullAutoSandbox(cwdOf('pool-1'), PATHS));
    expect(byId.get('pool-1')?.env).toEqual({ ...ENV, TMPDIR: TMP });
    for (const id of ['frontend-1', 'tester-1', 'lead-1', 'planner-1', 'reviewer-1']) {
      expect(byId.get(id), id).not.toHaveProperty('sandbox');
      expect(byId.get(id)?.env, id).toEqual(ENV);
    }
    for (const options of byId.values()) noSecrets(options);
  });
});

describe('a Full auto node tightened by a ticket keeps the sandbox in default mode', () => {
  const tightened: LaunchProtection = { autoMode: false, paths: PATHS };

  for (const kind of ['worker', 'tester'] as const) {
    it(`${kind} with spec.sandbox through the adapter: the OS sandbox, permissionMode default`, async () => {
      const s = spec(`${kind}-1`, kind, { sandbox: PATHS });
      const { query, calls } = fakeQuery(async function* (ctx) {
        await ctx.nextInput();
        yield init();
        yield result();
        await idle(ctx);
      });
      const events = await collect(
        createManagedClaudeCode({ query, env: ENV }).start(s, callbacks).events,
      );
      const o = calls[0]?.options;
      expect(o?.permissionMode).toBe('default');
      expect(o?.sandbox).toEqual(fullAutoSandbox(s.cwd, PATHS));
      expect(o?.disallowedTools).toEqual([...GIT_DENY_RULES, ...fullAutoDenyRules(s.cwd, PATHS)]);
      expect(o?.env).toEqual({ ...ENV, TMPDIR: TMP });
      noSecrets(o);
      // A default-mode session is what it asked for: it runs (no auto-mode check applies).
      expect(events.map((e) => e.type)).toEqual(['started', 'finished']);
    });
  }

  it('a sandbox that cannot start fails it closed with sandbox-unavailable', async () => {
    const errorResult = {
      ...(result({
        subtype: 'error_during_execution',
        is_error: true,
        total_cost_usd: 0,
      }) as object),
      errors: ['Sandbox dependencies are missing: install bubblewrap'],
    };
    const { query } = fakeQuery(async function* (ctx) {
      await ctx.nextInput();
      yield errorResult;
      await idle(ctx);
    });
    const s = spec('worker-1', 'worker', { sandbox: PATHS });
    const events = await collect(
      createManagedClaudeCode({ query, env: ENV }).start(s, callbacks).events,
    );
    expect(events.at(-1)).toEqual({
      type: 'finished',
      outcome: 'error',
      reportedCostUsd: null,
      failure: 'sandbox-unavailable',
    });
  });

  for (const kind of ['worker', 'tester'] as const) {
    it(`${kind}: the same sandbox, deny rules and TMPDIR, with permissionMode default`, () => {
      const s = spec(`${kind}-1`, kind);
      const o = buildOptions(s, callbacks, new AbortController(), ENV, tightened);
      expect(o.permissionMode).toBe('default');
      expect(o.sandbox).toEqual({
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        autoAllowBashIfSandboxed: false,
        filesystem: {
          allowWrite: [s.cwd, TMP],
          denyWrite: [`${s.cwd}/.git`, `${s.cwd}/.claude`],
          denyRead: DENY_READ,
          allowRead: [s.cwd, TMP],
        },
      });
      expect(o.disallowedTools).toEqual([...GIT_DENY_RULES, ...fullAutoDenyRules(s.cwd, PATHS)]);
      expect(o.env).toEqual({ ...ENV, TMPDIR: TMP });
      // Our gate still decides each request: `canUseTool` stays.
      expect(typeof o.canUseTool).toBe('function');
      noSecrets(o);
    });
  }

  it('a rework turn keeps it, resuming its session', () => {
    const s = spec('worker-1', 'worker', { rework: { resumeSessionId: 'sess-1' } });
    const o = buildOptions(s, callbacks, new AbortController(), ENV, tightened);
    expect(o.permissionMode).toBe('default');
    expect(o.resume).toBe('sess-1');
    expect(o.sandbox).toEqual(fullAutoSandbox(s.cwd, PATHS));
  });
});

describe('the lead, the planner and reviewers never get auto mode or the sandbox', () => {
  for (const kind of ['lead', 'planner', 'reviewer'] as const) {
    it(`${kind}: default and no sandbox, whatever protection is asked for`, () => {
      for (const protection of [
        { autoMode: true, paths: PATHS },
        { autoMode: false, paths: PATHS },
      ]) {
        const o = buildOptions(
          spec(`${kind}-1`, kind),
          callbacks,
          new AbortController(),
          ENV,
          protection,
        );
        expect(o.permissionMode).toBe('default');
        expect(o).not.toHaveProperty('sandbox');
        expect(o.env).toEqual(ENV);
        noSecrets(o);
      }
    });
  }

  it('a follow-up turn of an ended lead keeps default too', () => {
    const s = spec('lead-1', 'lead', { followUp: { resumeSessionId: 'sess-lead' } });
    const o = buildOptions(s, callbacks, new AbortController(), ENV, {
      autoMode: true,
      paths: PATHS,
    });
    expect(o.permissionMode).toBe('default');
    expect(o).not.toHaveProperty('sandbox');
  });

  it('the spec asks through fullAuto or sandbox, for a worker or the tester only', () => {
    expect(launchProtectionOf(spec('w', 'worker', { fullAuto: PATHS }))).toEqual({
      autoMode: true,
      paths: PATHS,
    });
    expect(launchProtectionOf(spec('t', 'tester', { sandbox: PATHS }))).toEqual({
      autoMode: false,
      paths: PATHS,
    });
    // Never sent together; if they were, the stricter launch (no auto mode) wins.
    expect(launchProtectionOf(spec('w', 'worker', { fullAuto: PATHS, sandbox: PATHS }))).toEqual({
      autoMode: false,
      paths: PATHS,
    });
    expect(launchProtectionOf(spec('w', 'worker'))).toBeNull();
    for (const kind of ['lead', 'planner', 'reviewer'] as const) {
      expect(launchProtectionOf(spec(kind, kind, { fullAuto: PATHS }))).toBeNull();
      expect(launchProtectionOf(spec(kind, kind, { sandbox: PATHS }))).toBeNull();
    }
    expect(
      launchProtectionOf(
        spec('w', 'worker', { sandbox: PATHS, followUp: { resumeSessionId: 's' } }),
      ),
    ).toBeNull();
  });

  for (const kind of ['lead', 'planner', 'reviewer'] as const) {
    it(`${kind}: a sandbox in its spec is ignored through the adapter (default, no sandbox)`, async () => {
      const { query, calls } = fakeQuery(async function* (ctx) {
        await idle(ctx);
        yield* [];
      });
      const handle = createManagedClaudeCode({ query, env: ENV }).start(
        spec(`${kind}-1`, kind, { sandbox: PATHS }),
        callbacks,
      );
      handle.abort();
      await collect(handle.events);
      expect(calls[0]?.options.permissionMode).toBe('default');
      expect(calls[0]?.options).not.toHaveProperty('sandbox');
    });
  }
});
