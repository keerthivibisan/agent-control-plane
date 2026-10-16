import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_PREFACE,
  cancelRun,
  followUpBudgetTokens,
  followUpChat,
  followUpEvent,
  followUpView,
  leadHasEnded,
  ownerChat,
  recoverAfterRestart,
  stopFollowUp,
} from '../src/index.js';
import type { EngineEffect, FollowUpFacts, RunState } from '../src/index.js';
import {
  LEAD,
  agentOf,
  event,
  makeCtx,
  ok,
  refused,
  runningRun,
  startWorker,
  statusOf,
  tokens,
} from './helpers.js';
import { merged, workflow } from './workflow-helpers.js';

/** Follow-up turns of an ended lead (ADR-0020). Synthetic data only. */

const FACTS: FollowUpFacts = {
  managed: true,
  leadSessionId: 'sess-lead',
  leadProcessActive: false,
};

const types = (effects: readonly EngineEffect[]) => effects.map((e) => e.type);

function startOf(effects: readonly EngineEffect[]) {
  const e = effects.find((x) => x.type === 'start-follow-up');
  if (e?.type !== 'start-follow-up') throw new Error('no start-follow-up effect');
  return e;
}

/** A ticket run that completed: the helper's change was merged, the lead was stopped. */
function completed(): RunState {
  const s = ok(merged(workflow())).state;
  expect(s.run.status).toBe('COMPLETED');
  expect(statusOf(s, LEAD)).toBe('CANCELLED');
  return s;
}

function ask(state: RunState, text = 'Why did you pick a store?', facts = FACTS) {
  return followUpChat(state, text, makeCtx(20_000), facts);
}

function fu(state: RunState, e: Parameters<typeof followUpEvent>[1], offsetMs = 21_000) {
  return followUpEvent(state, e, makeCtx(offsetMs));
}

/** Status of the run and of every agent, which a follow-up must never change. */
const statuses = (s: RunState) => ({
  run: s.run.status,
  endedAt: s.run.endedAt,
  agents: s.agents.map((a) => [a.id, a.status, a.endedAt, a.budgetTokensUsed]),
});

describe('follow-up view (RunDetailDto.followUp)', () => {
  it('is absent while the lead is live, so chat goes to the lead as before', () => {
    const s = runningRun();
    expect(leadHasEnded(s)).toBe(false);
    expect(followUpView(s, FACTS)).toBeUndefined();
    expect(refused(ask(s))).toBe('follow-up-unavailable');
    // ownerChat still goes to the live lead.
    expect(types(ok(ownerChat(s, 'hello', makeCtx(500))).effects)).toEqual([
      'chat-message',
      'send-to-agent',
    ]);
  });

  it('is available once the lead ended and has a linked session', () => {
    const s = completed();
    expect(leadHasEnded(s)).toBe(true);
    expect(followUpView(s, FACTS)).toEqual({ state: 'available', reason: null });
  });

  it('says why the chat cannot go on: managed off, no session', () => {
    const s = completed();
    expect(followUpView(s, { ...FACTS, managed: false })).toEqual({
      state: 'unavailable',
      reason: 'managed-off',
    });
    expect(followUpView(s, { ...FACTS, leadSessionId: null })).toEqual({
      state: 'unavailable',
      reason: 'no-session',
    });
    expect(refused(ask(s, 'hi', { ...FACTS, leadSessionId: null }))).toBe('follow-up-unavailable');
    expect(refused(ask(s, 'hi', { ...FACTS, managed: false }))).toBe('follow-up-unavailable');
  });

  it('waits while the ended lead process is still winding down (one session, one process)', () => {
    const s = completed();
    const facts = { ...FACTS, leadProcessActive: true };
    expect(followUpView(s, facts)).toEqual({ state: 'running', reason: null });
    expect(refused(ask(s, 'hi', facts))).toBe('follow-up-running');
  });
});

describe('a follow-up turn', () => {
  it('stores the message and resumes the lead session with the preface; no status changes', () => {
    const s = completed();
    const r = ok(ask(s, '  Why did you pick a store?  '));
    expect(types(r.effects)).toEqual(['chat-message', 'start-follow-up']);
    expect(r.effects[0]).toEqual({
      type: 'chat-message',
      role: 'owner',
      text: 'Why did you pick a store?',
    });
    const start = startOf(r.effects);
    expect(start).toMatchObject({ agentRunId: LEAD, resumeSessionId: 'sess-lead' });
    expect(start.prompt.startsWith(FOLLOW_UP_PREFACE)).toBe(true);
    expect(start.prompt).toContain('new run with a plan they approve');
    expect(start.prompt.endsWith('Why did you pick a store?')).toBe(true);
    // Default workflow: no stage model or agent file, and never skills (answers only).
    expect(start).not.toHaveProperty('model');
    expect(start).not.toHaveProperty('agent');
    expect(start).not.toHaveProperty('skills');
    expect(statuses(r.state)).toEqual(statuses(s));
    expect(r.state.agents).toHaveLength(s.agents.length);
    expect(followUpView(r.state, FACTS)).toEqual({ state: 'running', reason: null });
  });

  it("carries the lead stage's model and agent file", () => {
    const wf = workflow({ models: { orchestrate: 'claude-x' }, agents: { orchestrate: 'lead-a' } });
    const s = ok(merged(wf)).state;
    const start = startOf(ok(ask(s)).effects);
    expect(start.model).toBe('claude-x');
    expect(start.agent).toBe('lead-a');
  });

  it('refuses a second message while a turn runs, and an empty one', () => {
    const s = ok(ask(completed())).state;
    expect(refused(ask(s, 'and another thing'))).toBe('follow-up-running');
    expect(refused(ask(completed(), '   '))).toBe('invalid-input');
  });

  it('stores the lead reply as chat and ends the turn on finished; status unchanged', () => {
    const base = completed();
    let s = ok(ask(base)).state;
    s = ok(fu(s, { type: 'started', providerSessionId: 'sess-lead', model: null })).state;
    s = ok(fu(s, { type: 'activity', summary: 'Read src/theme.ts' })).state;
    const reply = ok(fu(s, { type: 'lead-text', text: 'Because it persists the theme.' }));
    expect(reply.effects).toEqual([
      { type: 'chat-message', role: 'lead', text: 'Because it persists the theme.' },
    ]);
    const end = ok(
      fu(reply.state, { type: 'finished', outcome: 'success', reportedCostUsd: 12.5 }, 22_000),
    );
    expect(end.effects).toEqual([]);
    expect(end.state.followUp).toEqual({ sessionGone: false, turn: null });
    expect(followUpView(end.state, FACTS)).toEqual({ state: 'available', reason: null });
    // The cumulative session cost of a resumed query is never recorded.
    expect(agentOf(end.state, LEAD).reportedCostUsd).toBe(agentOf(base, LEAD).reportedCostUsd);
    expect(statuses(end.state)).toEqual(statuses(base));
    // The next message starts a new turn.
    expect(types(ok(ask(end.state, 'One more question')).effects)).toContain('start-follow-up');
  });

  it('flags a session id that differs from the resumed one (never expected: no fork)', () => {
    const s = ok(ask(completed())).state;
    const r = ok(fu(s, { type: 'started', providerSessionId: 'sess-other', model: null }));
    expect(r.effects).toEqual([
      { type: 'diagnostic', code: 'follow-up-session-changed', agentRunId: LEAD },
    ]);
  });

  it('refuses events when no turn is under way', () => {
    expect(refused(fu(completed(), { type: 'lead-text', text: 'late' }))).toBe('agent-not-live');
  });
});

describe('follow-up usage and budget', () => {
  it("counts usage against the turn only, deduplicated by message id; the lead's budget stays", () => {
    const base = completed();
    const leadUsed = agentOf(base, LEAD).budgetTokensUsed;
    let s = ok(ask(base)).state;
    // Streamed frames of one message: the observation with max output is kept, never summed.
    s = ok(fu(s, { type: 'usage', messageId: 'msg-f1', tokens: tokens(5, 10, 0) })).state;
    s = ok(fu(s, { type: 'usage', messageId: 'msg-f1', tokens: tokens(40, 10, 0) })).state;
    s = ok(fu(s, { type: 'usage', messageId: 'msg-f2', tokens: tokens(20, 10, 0) })).state;
    expect(s.followUp?.turn?.budgetTokensUsed).toBe(50 + 30);
    expect(agentOf(s, LEAD).budgetTokensUsed).toBe(leadUsed);
    expect(s.ledger).toBe(base.ledger);
  });

  it('never counts a message the run already counted for the lead (a replayed message)', () => {
    let s = runningRun();
    s = ok(event(s, LEAD, { type: 'usage', messageId: 'msg-old', tokens: tokens(100) })).state;
    s = ok(event(s, LEAD, { type: 'finished', outcome: 'success', reportedCostUsd: null })).state;
    expect(leadHasEnded(s)).toBe(true);
    s = ok(ask(s)).state;
    s = ok(fu(s, { type: 'usage', messageId: 'msg-old', tokens: tokens(100) })).state;
    expect(s.followUp?.turn?.budgetTokensUsed).toBe(0);
    expect(agentOf(s, LEAD).budgetTokensUsed).toBe(110);
  });

  it('aborts the turn once its budget is reached (the run budget, from the project limits)', () => {
    let s = ok(ask(completed())).state;
    expect(s.followUp?.turn?.budgetLimit).toBe(1000);
    const r = ok(fu(s, { type: 'usage', messageId: 'msg-big', tokens: tokens(995, 10, 0) }));
    expect(types(r.effects)).toEqual(['budget-overshoot', 'diagnostic', 'abort-follow-up']);
    expect(r.effects[2]).toEqual({ type: 'abort-follow-up', agentRunId: LEAD });
    s = r.state;
    // Asked once only; the turn ends with the adapter's `finished` (cancelled): not a gone session.
    const again = ok(fu(s, { type: 'usage', messageId: 'msg-big2', tokens: tokens(5) }));
    expect(types(again.effects)).toEqual([]);
    s = ok(
      fu(again.state, { type: 'finished', outcome: 'cancelled', reportedCostUsd: null }),
    ).state;
    expect(followUpView(s, FACTS)).toEqual({ state: 'available', reason: null });
  });

  it('rejects invalid usage with a diagnostic', () => {
    const s = ok(ask(completed())).state;
    const r = ok(fu(s, { type: 'usage', messageId: '', tokens: tokens(1) }));
    expect(r.effects).toEqual([{ type: 'diagnostic', code: 'invalid-usage', agentRunId: LEAD }]);
  });

  it('falls back to the default agent budget for an unusable value', () => {
    expect(followUpBudgetTokens({ maxTokensPerAgent: 1234, softCostUsdPerRun: null })).toBe(1234);
    expect(followUpBudgetTokens({ maxTokensPerAgent: 0, softCostUsdPerRun: null })).toBe(500_000);
  });
});

describe('a failed resume (ADR-0020 §5)', () => {
  it('remembers the session as gone after an error before the session answered', () => {
    let s = ok(ask(completed())).state;
    s = ok(fu(s, { type: 'finished', outcome: 'error', reportedCostUsd: null })).state;
    expect(s.followUp).toEqual({ sessionGone: true, turn: null });
    expect(followUpView(s, FACTS)).toEqual({ state: 'unavailable', reason: 'session-gone' });
    expect(refused(ask(s))).toBe('follow-up-unavailable');
  });

  it('counts an error after the session answered as an ended turn, not a gone session', () => {
    let s = ok(ask(completed())).state;
    s = ok(fu(s, { type: 'lead-text', text: 'Partly answered' })).state;
    s = ok(fu(s, { type: 'finished', outcome: 'error', reportedCostUsd: null })).state;
    expect(followUpView(s, FACTS)).toEqual({ state: 'available', reason: null });
  });
});

describe('stopping and restarts', () => {
  it("the owner's Stop ends the turn once", () => {
    const s = ok(ask(completed())).state;
    const r = ok(stopFollowUp(s, makeCtx(21_000)));
    expect(r.effects).toEqual([{ type: 'abort-follow-up', agentRunId: LEAD }]);
    expect(ok(stopFollowUp(r.state, makeCtx(21_500))).effects).toEqual([]);
    expect(refused(stopFollowUp(completed(), makeCtx(21_000)))).toBe('agent-not-live');
  });

  it('Stop all ends a follow-up turn on a run that is still working', () => {
    // The lead failed while a helper still works: the run is RUNNING with the lead ended.
    const w = startWorker(runningRun());
    let s = ok(
      event(w.state, LEAD, { type: 'finished', outcome: 'error', reportedCostUsd: null }, 4000),
    ).state;
    expect(s.run.status).toBe('RUNNING');
    s = ok(ask(s)).state;
    expect(s.run.status).toBe('RUNNING');
    const stop = ok(cancelRun(s, makeCtx(30_000)));
    expect(types(stop.effects)).toContain('abort-follow-up');
    expect(stop.effects.find((e) => e.type === 'abort-follow-up')).toEqual({
      type: 'abort-follow-up',
      agentRunId: LEAD,
    });
  });

  it('a restart ends an interrupted turn and relaunches nothing', () => {
    const s = ok(merged(workflow({ codeReview: true }))).state;
    expect(s.run.status).toBe('REVIEW');
    const asked = ok(ask(s)).state;
    expect(asked.run.status).toBe('REVIEW');
    const r = ok(recoverAfterRestart(asked, makeCtx(40_000)));
    // Only the interrupted reviewer's checkout goes; nothing starts.
    expect(types(r.effects)).toEqual(['remove-review-checkout']);
    expect(r.state.followUp?.turn).toBeNull();
  });

  it('works after a restart (NEEDS_REVIEW): the status still does not change', () => {
    const recovered = ok(recoverAfterRestart(runningRun(), makeCtx(40_000))).state;
    expect(recovered.run.status).toBe('NEEDS_REVIEW');
    expect(statusOf(recovered, LEAD)).toBe('NEEDS_REVIEW');
    const r = ok(ask(recovered));
    expect(types(r.effects)).toEqual(['chat-message', 'start-follow-up']);
    expect(statuses(r.state)).toEqual(statuses(recovered));
  });
});
