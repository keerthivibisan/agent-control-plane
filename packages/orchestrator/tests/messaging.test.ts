import { MAX_OPEN_QUESTIONS } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  cancelRun,
  changeMergeBlocked,
  controlToolsFor,
  recoverAfterRestart,
  decidePlan,
  leadToolCall,
  stopAgent,
} from '../src/index.js';
import type { EngineEffect, RunLimits, RunState } from '../src/index.js';
import {
  LEAD,
  REGISTERED,
  agentOf,
  event,
  makeCtx,
  ok,
  planningRun,
  refused,
  runningRun,
  startWorker,
  submitPlanFor,
} from './helpers.js';
import {
  A,
  RA,
  changeOf,
  effectsOf,
  finishTurn,
  helper,
  inDecision,
  leadMessages,
  leadTool,
  loopRunning,
  readyForReview,
} from './loop-helpers.js';

/**
 * ADR-0033 in the engine: `ask_lead`, the open-question limit, `message_agent` answers, finish
 * notices, `get_review_findings` and the merge timeout's reply. Delivery states, holding and the
 * outbox are the server's (packages/server/tests/control/messaging.test.ts).
 */

const call = (state: RunState, name: string, input: unknown, caller = LEAD, prefix = 'n') =>
  leadToolCall(
    state,
    { callerAgentRunId: caller, name, input, registeredProjectIds: REGISTERED },
    makeCtx(5000, prefix),
  );

const sends = (effects: readonly EngineEffect[]) => effectsOf(effects, 'send-to-agent');

function depthTwo(): { s: RunState; parent: string; child: string } {
  const limits: RunLimits = { maxConcurrentHelpers: 5, maxDepth: 2 };
  const { state, planId } = submitPlanFor(planningRun(limits));
  let s = ok(decidePlan(state, planId, 'approve', makeCtx(2000))).state;
  s = ok(call(s, 'start_agent', { role: 'Parent', task: 't' }, LEAD, 'ph')).state;
  s = ok(event(s, 'ph-1', { type: 'started', providerSessionId: 'sp', model: null })).state;
  s = ok(call(s, 'start_agent', { role: 'Child', task: 't' }, 'ph-1', 'ch')).state;
  s = ok(event(s, 'ch-1', { type: 'started', providerSessionId: 'sc', model: null })).state;
  return { s, parent: 'ph-1', child: 'ch-1' };
}

describe('ask_lead (ADR-0033 §3)', () => {
  it('sends the question to the lead, prefixed with the role, and keeps the asker working', () => {
    const { state, id } = startWorker(runningRun(), 'Frontend', 'w');
    const r = ok(call(state, 'ask_lead', { question: 'Which colour token?' }, id));
    expect(r.value).toBe('Question for the lead.');
    expect(sends(r.effects)).toEqual([
      {
        type: 'send-to-agent',
        agentRunId: LEAD,
        text: expect.stringMatching(
          /^Frontend \(agentId w-1\) asks: Which colour token\?/,
        ) as unknown,
        message: { from: id, kind: 'question' },
      },
    ]);
    expect(agentOf(r.state, id).status).toBe('RUNNING');
    expect(agentOf(r.state, id).openQuestions).toBe(1);
    // The question is sent, never kept in the state.
    expect(JSON.stringify(r.state)).not.toContain('Which colour token');
  });

  it('a helper of a helper asks its parent helper, not the lead', () => {
    const { s, parent, child } = depthTwo();
    const r = ok(call(s, 'ask_lead', { question: 'Split the file?' }, child));
    expect(r.value).toBe('Question for Parent.');
    expect(sends(r.effects)[0]?.agentRunId).toBe(parent);
  });

  it('a change reviewer asks the lead, and the lead answers it with message_agent', () => {
    const s = readyForReview(helper(loopRunning(), 'API builder', 'wa'), A);
    const asked = ok(leadTool(s, 'ask_lead', { question: 'Is the API public?' }, 'q', RA));
    expect(sends(asked.effects)[0]).toMatchObject({ agentRunId: LEAD });
    expect(agentOf(asked.state, RA).openQuestions).toBe(1);
    const answered = ok(leadTool(asked.state, 'message_agent', { agentId: RA, text: 'No.' }, 'a'));
    expect(sends(answered.effects)).toEqual([
      {
        type: 'send-to-agent',
        agentRunId: RA,
        text: 'No.',
        message: { from: LEAD, kind: 'message' },
      },
    ]);
    expect(agentOf(answered.state, RA).openQuestions).toBeUndefined();
    // Without an open question the lead cannot message a reviewer.
    expect(refused(leadTool(answered.state, 'message_agent', { agentId: RA, text: 'x' }))).toBe(
      'unknown-agent',
    );
  });

  it(`refuses a flood: at most ${MAX_OPEN_QUESTIONS} open questions, until the parent answers`, () => {
    const { state, id } = startWorker(runningRun(), 'Frontend', 'w');
    let s = state;
    for (let i = 0; i < MAX_OPEN_QUESTIONS; i++) {
      s = ok(call(s, 'ask_lead', { question: `Question ${i}` }, id, `q${i}`)).state;
    }
    const flood = call(s, 'ask_lead', { question: 'One more' }, id);
    expect(refused(flood)).toBe('too-many-questions');
    if (!flood.ok) expect(flood.refusal.message).toContain('Wait for an answer');
    // A refusal changes nothing; the lead's message answers them all.
    s = ok(call(s, 'message_agent', { agentId: id, text: 'Use the blue one.' })).state;
    expect(agentOf(s, id).openQuestions).toBeUndefined();
    expect(call(s, 'ask_lead', { question: 'Next' }, id).ok).toBe(true);
  });

  it('validates the question and refuses the lead and the planner', () => {
    const { state, id } = startWorker(runningRun(), 'Frontend', 'w');
    expect(refused(call(state, 'ask_lead', { question: '' }, id))).toBe('invalid-input');
    expect(refused(call(state, 'ask_lead', { question: 'x'.repeat(2001) }, id))).toBe(
      'invalid-input',
    );
    expect(call(state, 'ask_lead', { question: 'x'.repeat(2000) }, id).ok).toBe(true);
    expect(refused(call(state, 'ask_lead', { question: 'q' }))).toBe('not-lead');
    expect(controlToolsFor(state, LEAD)).not.toContain('ask_lead');
    expect(controlToolsFor(state, id)).toContain('ask_lead');
  });

  it('refuses an agent whose turn is over', () => {
    const { state, id } = startWorker(runningRun(), 'Frontend', 'w');
    const done = ok(
      event(state, id, { type: 'finished', outcome: 'success', reportedCostUsd: null }),
    ).state;
    expect(refused(call(done, 'ask_lead', { question: 'q' }, id))).toBe('agent-not-live');
  });
});

describe('finish notices (ADR-0033 §4)', () => {
  const notice = (effects: readonly EngineEffect[]) =>
    sends(effects).filter((e) => e.message?.kind === 'notice');

  it('tells the lead once when a helper succeeds, fails or is stopped, with no agent text', () => {
    const run = startWorker(runningRun(), 'Frontend', 'w');
    const success = ok(
      event(run.state, run.id, { type: 'finished', outcome: 'success', reportedCostUsd: null }),
    );
    expect(notice(success.effects)).toEqual([
      {
        type: 'send-to-agent',
        agentRunId: LEAD,
        text: "Frontend (agentId w-1) finished: its change waits for the owner's review.",
        message: { from: 'engine', kind: 'notice' },
      },
    ]);
    const failed = ok(
      event(run.state, run.id, { type: 'finished', outcome: 'error', reportedCostUsd: null }),
    );
    expect(notice(failed.effects).map((e) => e.text)).toEqual([
      "Frontend (agentId w-1) failed: its change waits for the owner's review.",
    ]);
    const stopped = ok(stopAgent(run.state, run.id, makeCtx(5000)));
    expect(notice(stopped.effects).map((e) => e.text)).toEqual([
      "Frontend (agentId w-1) was stopped: its change waits for the owner's review.",
    ]);
    // A later event for the ended agent changes nothing and sends nothing again.
    const again = event(success.state, run.id, { type: 'activity', summary: 'x' });
    expect(again.ok ? notice(again.effects) : []).toEqual([]);
  });

  it('the lead that stopped a helper itself gets no notice (its tool reply says so)', () => {
    const run = startWorker(runningRun(), 'Frontend', 'w');
    const r = ok(call(run.state, 'stop_agent', { agentId: run.id }));
    expect(notice(r.effects)).toEqual([]);
  });

  it('a parent helper hears of its child; a stopped tree tells only the lead', () => {
    const { s, parent, child } = depthTwo();
    const r = ok(
      event(s, child, { type: 'finished', outcome: 'success', reportedCostUsd: null }, 4000),
    );
    expect(notice(r.effects).map((e) => e.agentRunId)).toEqual([parent]);
    const tree = ok(stopAgent(s, parent, makeCtx(5000)));
    expect(notice(tree.effects).map((e) => e.agentRunId)).toEqual([LEAD]);
  });

  it('in a review-loop run the loop’s own notices are not doubled', () => {
    const s = helper(loopRunning({ reviewer: 'lead' }), 'API builder', 'wa');
    const r = ok(finishTurn(s, A));
    // The helper's change enters the loop; the lead hears of it once it is sealed.
    expect(notice(r.effects)).toEqual([]);
    const reviewer = inDecision();
    const ended = ok(finishTurn(reviewer, RA, 'success', 5500));
    expect(notice(ended.effects)).toEqual([]);
  });

  it('a restart and Stop all send none', () => {
    const run = startWorker(runningRun(), 'Frontend', 'w');
    expect(notice(ok(cancelRun(run.state, makeCtx(5000))).effects)).toEqual([]);
    expect(notice(ok(recoverAfterRestart(run.state, makeCtx(5000))).effects)).toEqual([]);
  });
});

describe('message_agent delivery (ADR-0033 §1)', () => {
  it('a message to an ended helper is handed to the server, which reports it dropped', () => {
    const run = startWorker(runningRun(), 'Frontend', 'w');
    const ended = ok(
      event(run.state, run.id, { type: 'finished', outcome: 'success', reportedCostUsd: null }),
    ).state;
    const r = ok(call(ended, 'message_agent', { agentId: run.id, text: 'late' }));
    expect(r.value).toBe('Message for Frontend.');
    expect(sends(r.effects)).toHaveLength(1);
  });
});

describe('get_review_findings (ADR-0033 §5)', () => {
  it('is a lead tool of review-loop runs only, for a change that exists', () => {
    const s = inDecision();
    const r = ok(leadTool(s, 'get_review_findings', { agentId: A }, 'g'));
    expect(r.value).toBe("API builder's change (agentId wa-1).");
    expect(r.effects).toEqual([]);
    expect(controlToolsFor(s, LEAD)).toContain('get_review_findings');
    expect(refused(leadTool(s, 'get_review_findings', { agentId: 'ghost' }))).toBe(
      'change-not-found',
    );
    expect(refused(leadTool(s, 'get_review_findings', { agentId: A }, 'g', RA))).toBe('not-lead');
    const legacy = runningRun();
    expect(controlToolsFor(legacy, LEAD)).not.toContain('get_review_findings');
    expect(refused(call(legacy, 'get_review_findings', { agentId: 'w-1' }))).toBe('run-not-active');
  });
});

describe('bounded merge (ADR-0033 §6)', () => {
  it('a timed-out merge is a failure the lead can act on; the change is unchanged', () => {
    let s = inDecision();
    s = ok(leadTool(s, 'merge_change', { agentId: A }, 'm')).state;
    expect(changeOf(s, A).merging).toBe(true);
    const before = changeOf(s, A);
    const r = ok(changeMergeBlocked(s, A, { reason: 'timeout', minutes: 10 }, makeCtx(7000)));
    expect(r.value).toContain('timed out after 10 minutes');
    expect(r.value).toContain('Nothing was merged');
    const after = changeOf(r.state, A);
    expect(after).toMatchObject({
      merging: false,
      state: before.state,
      headCommit: before.headCommit,
    });
    expect(after.failedMerges).toBeUndefined();
    expect(leadMessages(r.effects)).toEqual([]);
    // It may be tried again.
    expect(leadTool(r.state, 'merge_change', { agentId: A }, 'm2').ok).toBe(true);
  });
});
