import type { ManagedAgentEvent, ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createManagedClaudeCode, REWORK_NEW_SESSION_NOTE } from '../../src/managed/index.js';
import { SESSION_ID, assistant, fakeQuery, idle, init, result } from './fake-query.js';
import type { Script } from './fake-query.js';

/**
 * P-D (v0.3.1): a rework turn whose saved session cannot be resumed starts again in a new session
 * in the same worktree, once, instead of failing the helper's turn every time it is sent back.
 * Through a fake `query` (synthetic; the real Agent SDK never runs).
 */

const realQuery = vi.hoisted(() => ({
  fn: (): never => {
    throw new Error('the real Agent SDK query() was called');
  },
}));
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  query: realQuery.fn,
}));

const CWD = '/data/worktrees/run-1/agent-1';
const NEW_SESSION = 'c0ffee00-0000-4000-8000-0000000000bb';
const allow: ManagedCallbacks = { requestPermission: () => Promise.resolve({ allow: true }) };

/** A rework turn resuming SESSION_ID; `rework: null` leaves the field out (a first turn). */
function worker(
  extra: Partial<ManagedAgentSpec> = {},
  rework: ManagedAgentSpec['rework'] | null = { resumeSessionId: SESSION_ID },
): ManagedAgentSpec {
  return {
    agentRunId: 'agent-1',
    kind: 'worker',
    cwd: CWD,
    prompt: 'The lead asks for rework. Synthetic comments.',
    model: null,
    ...(rework !== null && rework !== undefined && { rework }),
    ...extra,
  };
}

/** What Claude Code answers to a resume of a session it cannot find: an error result, no reply. */
const notFound = () =>
  result({ subtype: 'error_during_execution', is_error: true, total_cost_usd: 0 });

const newSessionInit = () => ({ ...(init() as object), session_id: NEW_SESSION });

async function eventsOf(spec: ManagedAgentSpec, script: Script) {
  const { query, calls } = fakeQuery(script);
  const handle = createManagedClaudeCode({ query }).start(spec, allow);
  const events: ManagedAgentEvent[] = [];
  for await (const e of handle.events) events.push(e);
  return { events, calls };
}

/** Resumes fail with `fail`; a new session works and finishes. */
const resumeFailsThenWorks = (fail: 'result' | 'throw'): Script =>
  async function* (ctx) {
    if (ctx.options.resume !== undefined) {
      if (fail === 'throw') throw new Error('No conversation found with session ID: x');
      yield notFound();
      await idle(ctx);
      return;
    }
    yield newSessionInit();
    yield assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]);
    yield result();
    await idle(ctx);
  };

describe('a rework turn whose session cannot be resumed (P-D)', () => {
  it('does not create a fresh lead session when its saved session is gone', async () => {
    const { events, calls } = await eventsOf(
      worker({ kind: 'lead', resumeLeadSessionId: SESSION_ID }, null),
      resumeFailsThenWorks('result'),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toMatchObject({ resume: SESSION_ID, forkSession: false });
    expect(events.at(-1)).toMatchObject({ type: 'finished', outcome: 'error' });
  });
  for (const fail of ['result', 'throw'] as const) {
    it(`starts once more in a new session in the same worktree (resume ${fail})`, async () => {
      const { events, calls } = await eventsOf(worker(), resumeFailsThenWorks(fail));
      expect(calls).toHaveLength(2);
      expect(calls[0]?.options).toMatchObject({ resume: SESSION_ID, forkSession: false, cwd: CWD });
      const fresh = calls[1]?.options;
      expect(fresh?.resume).toBeUndefined();
      expect(fresh?.forkSession).toBeUndefined();
      expect(fresh?.cwd).toBe(CWD);
      // Same tools and gate as the resumed turn.
      expect(fresh?.tools).toEqual(calls[0]?.options.tools);
      expect(fresh?.permissionMode).toBe('default');
      expect(fresh?.allowedTools).toBeUndefined();
      // The new session is told why, then gets the same rework comments.
      expect(calls[1]?.inputs[0]).toBe(
        `${REWORK_NEW_SESSION_NOTE}\n\nThe lead asks for rework. Synthetic comments.`,
      );
      // The engine sees one turn: the new session's id, its work, one `finished`.
      expect(events.filter((e) => e.type === 'started')).toEqual([
        { type: 'started', providerSessionId: NEW_SESSION, model: 'claude-test-model' },
      ]);
      expect(events.filter((e) => e.type === 'finished')).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: 'finished', outcome: 'success' });
      expect(calls[0]?.closed).toBe(true);
    });
  }

  it('reports the resumed session when its init came before the error', async () => {
    const { events, calls } = await eventsOf(worker(), async function* (ctx) {
      if (ctx.options.resume !== undefined) {
        yield init();
        yield notFound();
        await idle(ctx);
        return;
      }
      yield newSessionInit();
      yield result();
      await idle(ctx);
    });
    expect(calls).toHaveLength(2);
    expect(events.filter((e) => e.type === 'started').map((e) => e.providerSessionId)).toEqual([
      SESSION_ID,
      NEW_SESSION,
    ]);
  });

  it('tries a new session only once: a second failure ends the turn with an error', async () => {
    const { events, calls } = await eventsOf(worker(), async function* (ctx) {
      yield notFound();
      await idle(ctx);
    });
    expect(calls).toHaveLength(2);
    expect(events).toEqual([{ type: 'finished', outcome: 'error', reportedCostUsd: null }]);
  });

  it('keeps an error after the session answered: the resume worked', async () => {
    const { events, calls } = await eventsOf(worker(), async function* (ctx) {
      yield init();
      yield assistant('m1', [{ type: 'text', text: 'Working.' }]);
      yield result({ subtype: 'error_during_execution', is_error: true });
      await idle(ctx);
    });
    expect(calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'finished', outcome: 'error' });
  });

  it("never for a first turn, a fresh rework, or the lead's follow-up turn", async () => {
    const failing: Script = async function* (ctx) {
      yield notFound();
      await idle(ctx);
    };
    for (const spec of [
      worker({}, null),
      worker({}, { resumeSessionId: null }),
      worker({ kind: 'lead', followUp: { resumeSessionId: SESSION_ID } }, null),
    ]) {
      const { events, calls } = await eventsOf(spec, failing);
      expect(calls).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: 'finished', outcome: 'error' });
    }
  });

  it('never after a stop: an aborted resume ends cancelled', async () => {
    const { query, calls } = fakeQuery(async function* (ctx) {
      await idle(ctx);
      yield* [];
    });
    const handle = createManagedClaudeCode({ query }).start(worker(), allow);
    handle.abort();
    const events: ManagedAgentEvent[] = [];
    for await (const e of handle.events) events.push(e);
    expect(calls).toHaveLength(1);
    expect(events).toEqual([{ type: 'finished', outcome: 'cancelled', reportedCostUsd: null }]);
  });

  it('never when Full auto could not run protected (a new session would fail the same way)', async () => {
    const { events, calls } = await eventsOf(
      worker({ fullAuto: { tempDir: '/data/sandbox/run-1', denyRead: [] } }),
      async function* (ctx) {
        yield {
          ...(notFound() as object),
          errors: ['Sandbox is not available on this system'],
        };
        await idle(ctx);
      },
    );
    expect(calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: 'finished',
      outcome: 'error',
      failure: 'sandbox-unavailable',
    });
  });
});
