import type { ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { createManagedClaudeCode } from '../../src/index.js';
import { buildOptions } from '../../src/managed/adapter.js';
import { fakeQuery, result } from './fake-query.js';

/**
 * ADR-0024 §1 (v0.3.0 S-A): the session title the server builds reaches the SDK's `query()` as
 * the `title` option when a session starts; a resumed session (a follow-up, or a rework turn that
 * resumes the helper's session) keeps its own title, so none is passed. The fake query only
 * records its options; the real SDK never runs. Synthetic data only.
 */

const TITLE = 'WEB-12 · Frontend helper';

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

describe('session titles at launch (ADR-0024 §1)', () => {
  it('passes the title to query() for a new session', async () => {
    const options = await optionsOf(spec({ title: TITLE }));
    expect(options?.title).toBe(TITLE);
    expect(options?.resume).toBeUndefined();
  });

  it('passes it for every role', async () => {
    for (const kind of ['lead', 'planner', 'reviewer', 'tester', 'worker'] as const) {
      const s = spec({
        kind,
        title: `WEB-12 · ${kind}`,
        ...(kind === 'lead' || kind === 'planner' || kind === 'reviewer'
          ? { leadTools: () => Promise.resolve('ok') }
          : {}),
      });
      expect((await optionsOf(s))?.title).toBe(`WEB-12 · ${kind}`);
    }
  });

  it('passes no title without one, so Claude Code titles the session as before', async () => {
    const options = await optionsOf(spec());
    expect(options).not.toHaveProperty('title');
    expect(await optionsOf(spec({ title: '   ' }))).not.toHaveProperty('title');
  });

  it('passes no title on a follow-up, which resumes the lead session', async () => {
    const options = await optionsOf(
      spec({
        kind: 'lead',
        title: TITLE,
        followUp: { resumeSessionId: 'sess-lead' },
      }),
    );
    expect(options?.resume).toBe('sess-lead');
    expect(options).not.toHaveProperty('title');
  });

  it('passes no title on a rework turn that resumes, but does on a fresh one', () => {
    const controller = new AbortController();
    const resumed = buildOptions(
      spec({ title: TITLE, rework: { resumeSessionId: 'sess-helper' } }),
      callbacks,
      controller,
    );
    expect(resumed.resume).toBe('sess-helper');
    expect(resumed).not.toHaveProperty('title');
    const fresh = buildOptions(
      spec({ title: TITLE, rework: { resumeSessionId: null } }),
      callbacks,
      controller,
    );
    expect(fresh.title).toBe(TITLE);
  });
});
