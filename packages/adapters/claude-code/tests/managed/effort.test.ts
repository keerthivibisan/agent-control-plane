import type { ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { createManagedClaudeCode } from '../../src/index.js';
import { buildOptions } from '../../src/managed/adapter.js';
import { fakeQuery, result } from './fake-query.js';

/**
 * ADR-0028 §1 (v0.3.1 P-A): an agent block's reasoning effort reaches the SDK's `query()` as the
 * `effort` option (`Options.effort`, Agent SDK 0.3.296), for every role, a rework turn and a
 * follow-up; without one the option is absent, so the model's default applies as before. The
 * fake query only records its options; the real SDK never runs. Synthetic data only.
 */

function spec(extra: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return {
    agentRunId: 'agent-1',
    kind: 'worker',
    cwd: '/work/acp/worktrees/run-1/agent-1',
    prompt: 'First task',
    model: null,
    ...extra,
  };
}

const callbacks: ManagedCallbacks = {
  requestPermission: () => Promise.resolve({ allow: true }),
};

async function optionsOf(s: ManagedAgentSpec) {
  const { query, calls } = fakeQuery(async function* (ctx) {
    await ctx.nextInput();
    yield result();
  });
  const handle = createManagedClaudeCode({ query }).start(s, callbacks);
  for await (const _ of handle.events) {
    // drain
  }
  return calls[0]?.options;
}

describe('effort at launch (ADR-0028 §1)', () => {
  it('passes the block’s effort to query()', async () => {
    for (const effort of ['low', 'medium', 'high'] as const) {
      expect((await optionsOf(spec({ effort })))?.effort).toBe(effort);
    }
  });

  it('passes no effort without one, so the model’s default applies', async () => {
    expect(await optionsOf(spec())).not.toHaveProperty('effort');
  });

  it('every role, a rework turn and a follow-up keep it', () => {
    const controller = new AbortController();
    for (const kind of ['lead', 'planner', 'worker', 'reviewer', 'tester'] as const) {
      expect(buildOptions(spec({ kind, effort: 'high' }), callbacks, controller).effort).toBe(
        'high',
      );
    }
    const rework = buildOptions(
      spec({ effort: 'low', rework: { resumeSessionId: 'sess-helper' } }),
      callbacks,
      controller,
    );
    expect(rework).toMatchObject({ resume: 'sess-helper', effort: 'low' });
    const followUp = buildOptions(
      spec({ kind: 'lead', effort: 'medium', followUp: { resumeSessionId: 'sess-lead' } }),
      callbacks,
      controller,
    );
    expect(followUp).toMatchObject({ resume: 'sess-lead', effort: 'medium' });
  });
});
