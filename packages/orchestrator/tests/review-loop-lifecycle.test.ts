import { AgentRunStatusSchema } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  agentEvent,
  beginChangeMerge,
  cancelRun,
  changeMergeBlocked,
  checkChangeAction,
  checkTicketBranchAction,
  checksFinished,
  completeCancellation,
  controlToolsFor,
  decideApproval,
  deriveRunWorkflow,
  isActiveAgentStatus,
  isLiveAgentStatus,
  recordChangeDecision,
  recordTicketBranchDecision,
  recoverAfterRestart,
  requestPermission,
  requestTicketChanges,
} from '../src/index.js';
import type { RunState } from '../src/index.js';
import { LEAD, agentOf, event, makeCtx, ok, refused, statusOf, tokens } from './helpers.js';
import {
  A,
  BRANCH,
  COMMIT,
  RA,
  changeOf,
  effectsOf,
  finishTurn,
  helper,
  inDecision,
  leadMessages,
  leadTool,
  loopRunning,
  mergedA,
  readyForReview,
  sealed,
  types,
} from './loop-helpers.js';
import { workflow } from './workflow-helpers.js';

/**
 * The review loop's handover, final stages, owner's final merge, Stop all, restart, depth 2 and
 * budgets (ADR-0021 §3–5, docs/review-loop/README.md §5). Synthetic data only.
 */

const B = 'wb-1';
const STAGES = workflow({ codeReview: true, unitTests: true });

function refusalOf<T>(r: { ok: true } | { ok: false; refusal: T }): T {
  if (r.ok) throw new Error('expected a refusal');
  return r.refusal;
}

const finished = { type: 'finished', outcome: 'success', reportedCostUsd: null } as const;

describe('isActiveAgentStatus', () => {
  it('is live minus AWAITING_REVIEW', () => {
    for (const s of AgentRunStatusSchema.options) {
      expect(isActiveAgentStatus(s)).toBe(s !== 'AWAITING_REVIEW' && isLiveAgentStatus(s));
    }
    expect(isLiveAgentStatus('AWAITING_REVIEW')).toBe(true);
  });
});

describe('the handover (request_review)', () => {
  it('is refused while a helper works or a change is undecided', () => {
    const working = helper(loopRunning(), 'API builder', 'wa');
    expect(refused(leadTool(working, 'request_review', {}))).toBe('workers-still-running');
    const reviewerDone = ok(agentEvent(inDecision(), RA, finished, makeCtx(5500))).state;
    const undecided = refusalOf(leadTool(reviewerDone, 'request_review', {}));
    expect(undecided).toMatchObject({ code: 'changes-undecided' });
    expect(undecided.message).toContain('API builder (agentId wa-1): waits for a decision');
  });

  it('with no final stage: REVIEW for the owner’s merge; the lead stays live', () => {
    const r = ok(leadTool(mergedA(), 'request_review', {}, 'h'));
    expect(r.value).toContain('Handed over');
    expect(r.state.integration?.handedOver).toBe(true);
    expect(r.state.run.status).toBe('REVIEW');
    expect(statusOf(r.state, LEAD)).toBe('RUNNING');
    // ADR-0024 §3: the server writes the run summary; no note was given.
    expect(r.effects).toEqual([{ type: 'handover-summary', note: null }]);
    expect(refused(leadTool(r.state, 'request_review', {}))).toBe('run-not-active');
    expect(deriveRunWorkflow(r.state).stages.find((x) => x.stage === 'orchestrate')?.state).toBe(
      'done',
    );
  });

  it('runs the final review and the tests on the ticket branch, then hands to the owner', () => {
    let s = mergedA({ workflow: STAGES });
    const h = ok(leadTool(s, 'request_review', {}, 'h'));
    s = h.state;
    expect(s.run.status).toBe('RUNNING');
    expect(statusOf(s, LEAD)).toBe('RUNNING');
    expect(agentOf(s, 'h-1')).toMatchObject({ kind: 'reviewer', stage: 'code-review' });
    expect(types(h.effects)).toEqual(['handover-summary', 'create-review-checkout', 'start-agent']);
    expect(h.effects[1]).toEqual({
      type: 'create-review-checkout',
      agentRunId: 'h-1',
      ticketBranch: BRANCH,
    });
    const start = effectsOf(h.effects, 'start-agent')[0];
    expect(start).toMatchObject({ kind: 'reviewer', reviewScope: 'final' });
    expect(start?.prompt).toContain(`ticket branch ${BRANCH}`);
    expect(controlToolsFor(s, 'h-1')).toEqual(['post_review']);
    // No new helper after the handover.
    expect(refusalOf(leadTool(s, 'start_agent', { role: 'X', task: 'x' }))).toMatchObject({
      code: 'handed-over',
    });
    expect(refusalOf(leadTool(s, 'request_review', {}))).toMatchObject({ code: 'handed-over' });

    // The final reviewer's findings go to the ticket and to the lead.
    const post = ok(leadTool(s, 'post_review', { text: 'Rename the flag.' }, 'pr', 'h-1'));
    expect(types(post.effects)).toEqual(['review-comment', 'send-to-agent']);
    expect(leadMessages(post.effects)[0]).toContain('Rename the flag.');
    s = post.state;

    // Then the tester starts from the ticket branch tip.
    const t = ok(agentEvent(s, 'h-1', finished, makeCtx(12_000, 't')));
    s = t.state;
    expect(agentOf(s, 't-1')).toMatchObject({ kind: 'tester', status: 'STARTING' });
    expect(types(t.effects)).toEqual(['remove-review-checkout', 'start-agent']);
    expect(effectsOf(t.effects, 'start-agent')[0]).toMatchObject({
      kind: 'tester',
      fromBranch: BRANCH,
    });
    expect(effectsOf(t.effects, 'start-agent')[0]?.prompt).toContain('ticket branch');

    // The tester's change goes through the loop like a helper's.
    s = ok(agentEvent(s, 't-1', finished, makeCtx(13_000, 'tf'))).state;
    expect(statusOf(s, 't-1')).toBe('AWAITING_REVIEW');
    s = ok(sealed(s, 't-1', 'tr', true, 'abcd999', 14_000)).state;
    expect(agentOf(s, 'tr-1').reviewsAgentRunId).toBe('t-1');
    s = ok(
      leadTool(s, 'submit_review', { verdict: 'approve', findings: 'Good tests.' }, 'sr', 'tr-1'),
    ).state;
    expect(deriveRunWorkflow(s).stages.find((x) => x.stage === 'unit-tests')?.state).toBe('active');
    s = ok(leadTool(s, 'merge_change', { agentId: 't-1' }, 'm2')).state;
    const done = ok(
      recordChangeDecision(
        s,
        't-1',
        { decision: 'merge', by: 'lead', outcome: 'merged' },
        makeCtx(15_000, 'z'),
      ),
    );
    s = done.state;
    // The tester's review agent may still be winding down; the owner's merge waits for it.
    s = ok(agentEvent(s, 'tr-1', finished, makeCtx(16_000))).state;
    expect(s.run.status).toBe('REVIEW');
    expect(statusOf(s, LEAD)).toBe('RUNNING');
    const wf = deriveRunWorkflow(s);
    expect(wf.stages.find((x) => x.stage === 'code-review')?.state).toBe('done');
    expect(wf.stages.find((x) => x.stage === 'unit-tests')?.state).toBe('done');
    expect(wf.stages.find((x) => x.stage === 'review')?.state).toBe('done');
    expect(wf.review).toMatchObject({ merged: 2, needsOwner: 0, reworkRounds: 0 });

    // The owner merges the ticket branch once: COMPLETED, the lead stops.
    expect(checkTicketBranchAction(s, 'merge')).toBeNull();
    const c = ok(recordTicketBranchDecision(s, 'merged', makeCtx(17_000)));
    expect(c.state.run.status).toBe('COMPLETED');
    expect(statusOf(c.state, LEAD)).toBe('CANCELLED');
    expect(c.effects).toEqual([{ type: 'abort-agent', agentRunId: LEAD }]);
    expect(refused(recordTicketBranchDecision(c.state, 'merged', makeCtx()))).toBe(
      'run-not-active',
    );
  });

  it('with nothing merged, no final stage runs', () => {
    let s = inDecision({ workflow: STAGES });
    s = ok(leadTool(s, 'discard_change', { agentId: A, reason: 'Wrong approach.' }, 'dc')).state;
    s = ok(agentEvent(s, RA, finished, makeCtx(6000))).state;
    const r = ok(leadTool(s, 'request_review', {}, 'h'));
    expect(r.state.run.status).toBe('REVIEW');
    expect(r.state.agents.some((a) => a.stage === 'code-review')).toBe(false);
  });
});

describe('the owner’s final decision on the ticket branch', () => {
  function inReview(): RunState {
    return ok(leadTool(mergedA(), 'request_review', {}, 'h')).state;
  }

  it('is only for review-loop runs in REVIEW, with every change decided', () => {
    expect(checkTicketBranchAction(loopRunning(), 'merge')).toMatchObject({
      code: 'run-not-active',
    });
    expect(checkTicketBranchAction(loopRunning(), 'discard')).toMatchObject({
      code: 'run-not-active',
    });
    const s = inReview();
    for (const action of [
      'merge',
      'merge-anyway',
      'update-from-base',
      'discard',
      'request-changes',
    ] as const) {
      expect(checkTicketBranchAction(s, action)).toBeNull();
    }
  });

  it('request changes: back to RUNNING with the comment for the lead', () => {
    const r = ok(requestTicketChanges(inReview(), 'Rename the flag to darkMode.', makeCtx(9000)));
    expect(r.state.run.status).toBe('RUNNING');
    expect(r.state.integration?.handedOver).toBe(false);
    expect(leadMessages(r.effects)[0]).toContain('Rename the flag to darkMode.');
    // The lead may start helpers again.
    expect(leadTool(r.state, 'start_agent', { role: 'Fixer', task: 'Rename' }, 'fx').ok).toBe(true);
    expect(refused(requestTicketChanges(inReview(), '  ', makeCtx()))).toBe('invalid-input');
  });

  it('discard: undecided changes are dropped too, and the run completes', () => {
    // The lead ends early: its undecided change goes to the owner, the run to REVIEW.
    let s = inDecision();
    s = ok(agentEvent(s, RA, finished, makeCtx(5500))).state;
    s = ok(agentEvent(s, LEAD, finished, makeCtx(6000))).state;
    expect(s.run.status).toBe('REVIEW');
    expect(changeOf(s, A).state).toBe('needs-owner');
    expect(checkTicketBranchAction(s, 'merge')).toMatchObject({ code: 'changes-undecided' });
    expect(checkTicketBranchAction(s, 'request-changes')).toMatchObject({ code: 'agent-not-live' });
    const r = ok(recordTicketBranchDecision(s, 'discarded', makeCtx(7000)));
    expect(r.state.run.status).toBe('COMPLETED');
    expect(changeOf(r.state, A).state).toBe('discarded');
    expect(statusOf(r.state, A)).toBe('CANCELLED');
    expect(r.effects).toEqual([{ type: 'discard-change', agentRunId: A }]);
  });
});

describe('the lead ending early', () => {
  it('a change at the lead’s decision goes to the owner, who decides it', () => {
    let s = inDecision();
    s = ok(agentEvent(s, LEAD, finished, makeCtx(6000))).state;
    expect(changeOf(s, A).state).toBe('needs-owner');
    expect(s.run.status).toBe('REVIEW');
    s = ok(agentEvent(s, RA, finished, makeCtx(6500))).state;
    const owner = ok(
      recordChangeDecision(
        s,
        A,
        { decision: 'merge', by: 'owner', outcome: 'merged' },
        makeCtx(7000),
      ),
    );
    expect(owner.state.run.status).toBe('REVIEW');
    expect(checkTicketBranchAction(owner.state, 'merge')).toBeNull();
  });

  it('a verdict that arrives after the lead ended goes to the owner', () => {
    let s = readyForReview(helper(loopRunning(), 'API builder', 'wa'), A);
    s = ok(agentEvent(s, LEAD, finished, makeCtx(5500))).state;
    expect(changeOf(s, A).state).toBe('reviewing');
    s = ok(leadTool(s, 'submit_review', { verdict: 'approve', findings: 'ok' }, 'sr', RA)).state;
    expect(changeOf(s, A).state).toBe('needs-owner');
  });

  it('with the lead as reviewer, a sealed change goes straight to the owner', () => {
    let s = ok(finishTurn(helper(loopRunning({ reviewer: 'lead' }), 'API builder', 'wa'), A)).state;
    s = ok(agentEvent(s, LEAD, finished, makeCtx(4500))).state;
    expect(ok(sealed(s, A)).state.agents.find((a) => a.id === A)?.change?.state).toBe(
      'needs-owner',
    );
  });

  it('the final stages still run without the lead once the owner decided every change', () => {
    let s = inDecision({ workflow: workflow({ codeReview: true }) });
    s = ok(agentEvent(s, RA, finished, makeCtx(5500))).state;
    s = ok(agentEvent(s, LEAD, finished, makeCtx(6000))).state;
    const r = ok(
      recordChangeDecision(
        s,
        A,
        { decision: 'merge', by: 'owner', outcome: 'merged' },
        makeCtx(7000, 'ow'),
      ),
    );
    expect(agentOf(r.state, 'ow-1')).toMatchObject({ kind: 'reviewer', stage: 'code-review' });
    expect(effectsOf(r.effects, 'create-review-checkout')[0]).toMatchObject({
      ticketBranch: BRANCH,
    });
    expect(r.state.run.status).toBe('REVIEW');
  });
});

describe('a helper stopped mid-turn', () => {
  it('leaves its work for a decision: merge or discard, never rework', () => {
    const s = helper(loopRunning(), 'API builder', 'wa');
    const r = ok(leadTool(s, 'stop_agent', { agentId: A }, 'st'));
    expect(statusOf(r.state, A)).toBe('CANCELLED');
    expect(changeOf(r.state, A)).toMatchObject({ state: 'decision', headCommit: null });
    expect(leadMessages(r.effects)[0]).toContain('stopped before finishing');
    expect(
      refusalOf(leadTool(r.state, 'request_rework', { agentId: A, comments: 'x' })),
    ).toMatchObject({
      code: 'change-not-decidable',
    });
    expect(ok(leadTool(r.state, 'view_change', { agentId: A })).value).toContain('Not saved yet');
    expect(refusalOf(leadTool(r.state, 'request_review', {}))).toMatchObject({
      code: 'changes-undecided',
    });
    expect(leadTool(r.state, 'merge_change', { agentId: A }).ok).toBe(true);
  });

  it('one that crashed while parked in an approval too', () => {
    let s = helper(loopRunning(), 'API builder', 'wa');
    s = ok(
      requestPermission(
        s,
        { agentRunId: A, toolName: 'Edit', toolUseId: 't', summary: 'Edit a.ts' },
        makeCtx(3500, 'ap'),
      ),
    ).state;
    const r = ok(finishTurn(s, A, 'error'));
    expect(statusOf(r.state, A)).toBe('FAILED');
    expect(changeOf(r.state, A).state).toBe('decision');
  });
});

describe('Stop all and restart', () => {
  function busy(): RunState {
    let s = inDecision();
    s = helper(s, 'UI builder', 'wb');
    return s;
  }

  it('Stop all: waiting helpers are cancelled without an abort; the ticket branch stays open', () => {
    const s = busy();
    const r = ok(cancelRun(s, makeCtx(9000)));
    expect(r.state.run.status).toBe('CANCELLING');
    expect(statusOf(r.state, A)).toBe('CANCELLED');
    expect(changeOf(r.state, A).state).toBe('decision');
    const aborted = effectsOf(r.effects, 'abort-agent').map((e) => e.agentRunId);
    expect(aborted).toEqual(expect.arrayContaining([B, RA, LEAD]));
    expect(aborted).not.toContain(A);
    expect(agentOf(r.state, B).change).toBeUndefined();
    const c = ok(completeCancellation(r.state, makeCtx(9100))).state;
    expect(checkTicketBranchAction(c, 'discard')).toBeNull();
    expect(checkTicketBranchAction(c, 'merge')).toMatchObject({ code: 'run-not-active' });
    const d = ok(recordTicketBranchDecision(c, 'discarded', makeCtx(9200)));
    expect(d.state).toBe(c);
    expect(d.effects).toEqual([]);
  });

  it('restart: checks that were running have no result, so the owner may merge (WG-F3)', () => {
    const begun = ok(leadTool(busy(), 'merge_change', { agentId: A }, 'm')).state;
    const pending = ok(changeMergeBlocked(begun, A, { reason: 'checks-pending' }, makeCtx(7000)));
    expect(changeOf(pending.state, A).checks).toBe('pending');
    const r = ok(recoverAfterRestart(pending.state, makeCtx(20_000)));
    expect(changeOf(r.state, A)).toMatchObject({ state: 'needs-owner', checks: null });
    // The engine lets the owner's merge through; the server's gate starts the checks again.
    expect(checkChangeAction(r.state, A, 'merge', 'owner')).toBeNull();
    // A real failure from before the restart still blocks a plain merge.
    const failed = ok(
      checksFinished(
        pending.state,
        A,
        { commit: COMMIT, requiredPassed: false, failed: ['lint'] },
        makeCtx(8000),
      ),
    ).state;
    const again = ok(recoverAfterRestart(failed, makeCtx(20_000))).state;
    expect(changeOf(again, A).checks).toBe('failed');
    expect(checkChangeAction(again, A, 'merge', 'owner')).toMatchObject({ code: 'checks-failed' });
  });

  it('restart: nothing relaunches; waiting helpers and reviewers need review; changes need the owner', () => {
    let s = busy();
    s = ok(leadTool(s, 'merge_change', { agentId: A }, 'm')).state;
    expect(changeOf(s, A).merging).toBe(true);
    const r = ok(recoverAfterRestart(s, makeCtx(20_000)));
    expect(r.state.run.status).toBe('NEEDS_REVIEW');
    for (const id of [A, B, RA, LEAD]) expect(statusOf(r.state, id)).toBe('NEEDS_REVIEW');
    expect(changeOf(r.state, A)).toMatchObject({ state: 'needs-owner', merging: false });
    expect(changeOf(r.state, B).state).toBe('needs-owner');
    expect(types(r.effects)).toEqual(['remove-review-checkout']);
    // The owner decides; the first decision moves the run to REVIEW. No rework after a restart.
    expect(
      refusalOf(
        recordChangeDecision(
          r.state,
          A,
          { decision: 'rework', by: 'owner', comments: 'x' },
          makeCtx(),
        ),
      ),
    ).toMatchObject({
      code: 'change-not-decidable',
    });
    const d = ok(
      recordChangeDecision(
        r.state,
        B,
        { decision: 'discard', by: 'owner', comments: 'Unfinished.' },
        makeCtx(21_000),
      ),
    );
    expect(d.state.run.status).toBe('REVIEW');
    expect(effectsOf(d.effects, 'change-round')[0]).toMatchObject({
      reviewer: 'owner',
      decidedBy: 'owner',
    });
    expect(effectsOf(d.effects, 'change-comment')[0]).toMatchObject({
      author: 'owner',
      kind: 'discard',
    });
    expect(effectsOf(d.effects, 'discard-change')).toHaveLength(1);
  });
});

describe('depth 2', () => {
  const D2 = { limits: { maxConcurrentHelpers: 3, maxDepth: 2 } };

  it('every change goes through the loop, the parent’s own too', () => {
    let s = helper(loopRunning(D2), 'Parent', 'wp');
    const child = ok(leadTool(s, 'start_agent', { role: 'Child', task: 'Sub' }, 'wc', 'wp-1'));
    expect(effectsOf(child.effects, 'start-agent')[0]).toMatchObject({ fromBranch: BRANCH });
    expect(effectsOf(child.effects, 'start-agent')[0]).not.toHaveProperty('canStartHelpers');
    s = ok(
      event(child.state, 'wc-1', { type: 'started', providerSessionId: 's-c', model: null }),
    ).state;
    s = ok(finishTurn(s, 'wp-1')).state;
    expect(agentOf(s, 'wp-1')).toMatchObject({ status: 'RUNNING', awaitingHelpers: true });
    const r = ok(finishTurn(s, 'wc-1', 'success', 5000));
    expect(statusOf(r.state, 'wc-1')).toBe('AWAITING_REVIEW');
    expect(statusOf(r.state, 'wp-1')).toBe('AWAITING_REVIEW');
    expect(effectsOf(r.effects, 'seal-change').map((e) => e.agentRunId)).toEqual(['wc-1', 'wp-1']);
    // The lead decides both changes.
    expect(ok(leadTool(r.state, 'view_change', { agentId: 'wc-1' })).value).toContain('Child');
    expect(controlToolsFor(r.state, 'wp-1')).toEqual([]);
  });

  it('a parent’s rework turn cannot start helpers; stopping a parent keeps a waiting child', () => {
    let s = helper(loopRunning(D2), 'Parent', 'wp');
    s = readyForReview(s, 'wp-1', 'pr');
    s = ok(leadTool(s, 'submit_review', { verdict: 'rework', findings: 'x' }, 'sr', 'pr-1')).state;
    s = ok(agentEvent(s, 'pr-1', finished, makeCtx(5500))).state;
    const rework = ok(
      leadTool(s, 'request_rework', { agentId: 'wp-1', comments: 'Split it.' }, 'rw'),
    );
    s = rework.state;
    expect(effectsOf(rework.effects, 'start-agent')[0]).not.toHaveProperty('canStartHelpers');
    expect(controlToolsFor(s, 'wp-1')).toEqual([]);
    expect(refused(leadTool(s, 'start_agent', { role: 'C', task: 'x' }, 'x', 'wp-1'))).toBe(
      'depth-exceeded',
    );

    let t = helper(loopRunning(D2), 'Parent', 'wp');
    t = ok(leadTool(t, 'start_agent', { role: 'Child', task: 'Sub' }, 'wc', 'wp-1')).state;
    t = ok(finishTurn(t, 'wc-1')).state;
    expect(statusOf(t, 'wc-1')).toBe('AWAITING_REVIEW');
    const stopped = ok(leadTool(t, 'stop_agent', { agentId: 'wp-1' }, 'st'));
    expect(statusOf(stopped.state, 'wp-1')).toBe('CANCELLED');
    expect(statusOf(stopped.state, 'wc-1')).toBe('AWAITING_REVIEW');
    expect(effectsOf(stopped.effects, 'abort-agent').map((e) => e.agentRunId)).toEqual(['wp-1']);
  });
});

describe('budgets and BLOCKED', () => {
  it('a change reviewer has its own budget and is held at its cap like any agent', () => {
    let s = readyForReview(helper(loopRunning({ budget: 100 }), 'API builder', 'wa'), A);
    expect(agentOf(s, RA).budgetLimit).toBe(100);
    s = ok(event(s, RA, { type: 'started', providerSessionId: 's-r', model: null }, 5100)).state;
    const r = ok(event(s, RA, { type: 'usage', messageId: 'r1', tokens: tokens(200) }, 5200));
    expect(statusOf(r.state, RA)).toBe('BLOCKED');
    expect(types(r.effects)).toContain('approval-requested');
  });

  it('BLOCKED counts only agents with a process; a waiting helper does not keep the run RUNNING', () => {
    let s = loopRunning({ budget: 100 });
    s = helper(helper(s, 'API builder', 'wa'), 'UI builder', 'wb');
    s = ok(finishTurn(s, A)).state;
    s = ok(
      requestPermission(
        s,
        { agentRunId: B, toolName: 'Edit', toolUseId: 't', summary: 'Edit b.ts' },
        makeCtx(4100, 'ap'),
      ),
    ).state;
    const r = ok(event(s, LEAD, { type: 'usage', messageId: 'l1', tokens: tokens(200) }, 4200));
    expect(statusOf(r.state, LEAD)).toBe('BLOCKED');
    expect(statusOf(r.state, A)).toBe('AWAITING_REVIEW');
    expect(r.state.run.status).toBe('BLOCKED');
  });

  it('messages are held while the lead is BLOCKED and listed when it resumes', () => {
    let s = helper(loopRunning({ reviewer: 'lead', budget: 100 }), 'API builder', 'wa');
    s = ok(finishTurn(s, A)).state;
    s = ok(event(s, LEAD, { type: 'usage', messageId: 'l1', tokens: tokens(200) }, 4200)).state;
    const held = ok(sealed(s, A));
    expect(changeOf(held.state, A).state).toBe('reviewing');
    expect(leadMessages(held.effects)).toEqual([]);
    const budget = held.state.approvals.find((a) => a.kind === 'budget-raise');
    if (budget === undefined) throw new Error('no budget approval');
    const r = ok(
      decideApproval(held.state, budget.id, 'approve', makeCtx(6000), { newLimit: 1000 }),
    );
    const [resume] = leadMessages(r.effects);
    expect(resume).toContain('Changes not decided yet');
    expect(resume).toContain('API builder (agentId wa-1)');
  });

  it('the owner’s merge past a failed check is the owner’s alone', () => {
    let s = inDecision();
    s = ok(leadTool(s, 'merge_change', { agentId: A }, 'm')).state;
    s = ok(
      changeMergeBlocked(s, A, { reason: 'checks-failed', failed: ['test'] }, makeCtx(7000)),
    ).state;
    expect(refused(beginChangeMerge(s, A, { by: 'lead', anyway: true }, makeCtx()))).toBe(
      'not-lead',
    );
    expect(refusalOf(beginChangeMerge(s, A, { by: 'owner' }, makeCtx()))).toMatchObject({
      code: 'checks-failed',
    });
    const r = ok(beginChangeMerge(s, A, { by: 'owner', anyway: true }, makeCtx(8000)));
    expect(r.effects).toEqual([{ type: 'merge-change', agentRunId: A, by: 'owner', anyway: true }]);
  });
});
