import { describe, expect, it } from 'vitest';
import {
  REWORK_NEW_SESSION_ACTIVITY,
  agentEvent,
  isRunOverdue,
  recordChangeDecision,
  runWorkingMs,
  timeOutRun,
  waitsOnlyForOwner,
} from '../src/index.js';
import type { RunState } from '../src/index.js';
import { LEAD, T0, agentOf, makeCtx, ok, statusOf } from './helpers.js';
import {
  A,
  changeOf,
  effectsOf,
  helper,
  leadMessages,
  leadTool,
  loopRunning,
  readyForReview,
  sealed,
} from './loop-helpers.js';

/**
 * P-D (v0.3.1): the run timeout (ADR-0013 §3) does not count the time a loop run waits only for
 * the owner's decision on a change, and it can always stop a run, even with a change waiting for
 * review. Synthetic data only; the clock is injected (`makeCtx` offsets from T0).
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const TIMEOUT = 2 * HOUR;
const at = (ms: number) => new Date(T0 + ms);

/** Helper A's change is with the lead (route "lead"), which asks the owner at `askAt`. */
function askedOwner(askAt: number): RunState {
  const s = readyForReview(helper(loopRunning({ reviewer: 'lead' }), 'API builder', 'wa'), A);
  return ok(leadTool(s, 'ask_owner', { agentId: A, question: 'Keep it?' }, 'ao', LEAD, askAt))
    .state;
}

describe('the run clock while the owner decides (P-D)', () => {
  it('stops while only the owner is awaited and goes on from there after the decision', () => {
    const askAt = 90 * MIN;
    let s = askedOwner(askAt);
    expect(changeOf(s, A).state).toBe('needs-owner');
    expect(waitsOnlyForOwner(s)).toBe(true);
    expect(s.ownerWait).toEqual({ since: at(askAt).toISOString(), totalMs: 0 });

    // Three hours later the run has still used only its 90 minutes before the question.
    const late = askAt + 3 * HOUR;
    expect(runWorkingMs(s, at(late))).toBe(askAt);
    expect(isRunOverdue(s, at(late), TIMEOUT)).toBe(false);

    // The owner sends it back (the helper's rework turn starts): the wait is over.
    const r = ok(
      recordChangeDecision(
        s,
        A,
        { decision: 'rework', by: 'owner', comments: 'Rename it.' },
        makeCtx(late, 'od'),
      ),
    );
    s = r.state;
    expect(effectsOf(r.effects, 'start-agent')).toMatchObject([
      { agentRunId: A, rework: { resumeSessionId: `sess-${A}` } },
    ]);
    expect(waitsOnlyForOwner(s)).toBe(false);
    expect(s.ownerWait).toEqual({ since: null, totalMs: 3 * HOUR });
    expect(isRunOverdue(s, at(late + 20 * MIN), TIMEOUT)).toBe(false);
    // The clock runs again: 30 more minutes of work reach the 2 hours.
    expect(isRunOverdue(s, at(late + 30 * MIN - 1), TIMEOUT)).toBe(false);
    expect(isRunOverdue(s, at(late + 30 * MIN), TIMEOUT)).toBe(true);
  });

  it('keeps running while another helper works, even with a change at the owner', () => {
    let s = askedOwner(10 * MIN);
    s = ok(
      leadTool(s, 'start_agent', { role: 'Tester', task: 'Test it' }, 'wb', LEAD, 20 * MIN),
    ).state;
    expect(statusOf(s, 'wb-1')).toBe('STARTING');
    expect(waitsOnlyForOwner(s)).toBe(false);
    // The wait from 10 to 20 minutes is not counted; the rest is.
    expect(s.ownerWait).toEqual({ since: null, totalMs: 10 * MIN });
    expect(runWorkingMs(s, at(TIMEOUT + 10 * MIN))).toBe(TIMEOUT);
    expect(isRunOverdue(s, at(TIMEOUT + 10 * MIN), TIMEOUT)).toBe(true);
  });

  it('is the plain deadline for runs that never waited for the owner', () => {
    const s = readyForReview(helper(loopRunning({ reviewer: 'lead' }), 'API builder', 'wa'), A);
    expect(s.ownerWait).toBeUndefined();
    expect(isRunOverdue(s, at(TIMEOUT - 1), TIMEOUT)).toBe(false);
    expect(isRunOverdue(s, at(TIMEOUT), TIMEOUT)).toBe(true);
  });
});

describe('a rework turn that could not continue its session (P-D)', () => {
  /** The owner sent A's change back late; its rework turn starts (A is STARTING). */
  function reworking(): RunState {
    const s = askedOwner(10 * MIN);
    return ok(
      recordChangeDecision(
        s,
        A,
        { decision: 'rework', by: 'owner', comments: 'Rename it.' },
        makeCtx(5 * HOUR, 'od'),
      ),
    ).state;
  }

  it('keeps the new session for the next rework and tells the lead in plain words', () => {
    const r = ok(
      agentEvent(
        reworking(),
        A,
        { type: 'started', providerSessionId: 'sess-new', model: null },
        makeCtx(5 * HOUR + 1000),
      ),
    );
    const s = r.state;
    expect(agentOf(s, A).sessionId).toBe('sess-new');
    expect(statusOf(s, A)).toBe('RUNNING');
    expect(agentOf(s, A).latestActivity).toBe(REWORK_NEW_SESSION_ACTIVITY);
    expect(effectsOf(r.effects, 'diagnostic')).toEqual([
      { type: 'diagnostic', code: 'rework-session-replaced', agentRunId: A },
    ]);
    expect(leadMessages(r.effects)).toEqual([
      expect.stringContaining('could not continue its earlier conversation'),
    ]);
    // The session is linked as for any start (the server records a second one as a retry).
    expect(effectsOf(r.effects, 'link-session')).toEqual([
      { type: 'link-session', agentRunId: A, providerSessionId: 'sess-new' },
    ]);

    // Its change comes back; the lead's next rework resumes the new session.
    let next = ok(
      agentEvent(
        s,
        A,
        { type: 'finished', outcome: 'success', reportedCostUsd: null },
        makeCtx(5 * HOUR + 2000),
      ),
    ).state;
    next = ok(sealed(next, A, 'rv', true, 'def5678', 5 * HOUR + 3000)).state;
    const again = ok(
      leadTool(
        next,
        'request_rework',
        { agentId: A, comments: 'Once more.' },
        'rw',
        LEAD,
        5 * HOUR + 4000,
      ),
    );
    expect(effectsOf(again.effects, 'start-agent')).toMatchObject([
      { agentRunId: A, rework: { resumeSessionId: 'sess-new' } },
    ]);
  });

  it('keeps the session when the resume worked (the same id)', () => {
    const r = ok(
      agentEvent(
        reworking(),
        A,
        { type: 'started', providerSessionId: `sess-${A}`, model: null },
        makeCtx(5 * HOUR + 1000),
      ),
    );
    expect(agentOf(r.state, A).sessionId).toBe(`sess-${A}`);
    expect(effectsOf(r.effects, 'diagnostic')).toEqual([]);
    expect(leadMessages(r.effects)).toEqual([]);
  });
});

describe('the run timeout with a change waiting for review (P-D)', () => {
  it('stops the run; the waiting helper ends CANCELLED as with Stop all', () => {
    const s = askedOwner(10 * MIN);
    expect(statusOf(s, A)).toBe('AWAITING_REVIEW');
    // Before P-D this was refused (AWAITING_REVIEW → TIMED_OUT is no transition), so the timeout
    // hit only once no change waited: right after the owner's decision.
    const r = ok(timeOutRun(s, makeCtx(3 * HOUR, 'to')));
    expect(r.state.run.status).toBe('CANCELLING');
    expect(statusOf(r.state, A)).toBe('CANCELLED');
    expect(statusOf(r.state, LEAD)).toBe('TIMED_OUT');
    // No process to abort for the waiting helper; the lead's is aborted.
    expect(effectsOf(r.effects, 'abort-agent').map((e) => e.agentRunId)).toEqual([LEAD]);
  });
});
