import { describe, expect, it } from 'vitest';
import {
  HANDOVER_NOTE_LINE,
  VIEW_CHANGE_MAX_BYTES,
  agentEvent,
  beginChangeMerge,
  changeMergeBlocked,
  changeSealed,
  checkChangeAction,
  checksFinished,
  controlToolsFor,
  createRun,
  decidePlan,
  deriveRunWorkflow,
  recordChangeDecision,
  recordReview,
  requestPermission,
  stopAgent,
  ticketBranchCreated,
  viewChangeReply,
} from '../src/index.js';
import {
  LEAD,
  PROJECT,
  REGISTERED,
  RUN,
  TICKET,
  agentOf,
  event,
  makeCtx,
  ok,
  refused,
  statusOf,
  submitPlanFor,
} from './helpers.js';
import {
  A,
  BRANCH,
  COMMIT,
  RA,
  inDecision,
  KEY,
  changeOf,
  createLoopRun,
  effectsOf,
  finishTurn,
  helper,
  leadMessages,
  leadTool,
  loopRunning,
  readyForReview,
  sealed,
  types,
} from './loop-helpers.js';
import { workflow } from './workflow-helpers.js';

/** The review loop (ADR-0021 §3, docs/review-loop/README.md §5). Synthetic data only. */

const B = 'wb-1';

function refusalOf<T>(r: { ok: true } | { ok: false; refusal: T }): T {
  if (r.ok) throw new Error('expected a refusal');
  return r.refusal;
}

describe('creating a loop run', () => {
  it('snapshots the review settings and the approval policy', () => {
    const approvals = {
      mode: 'auto' as const,
      commands: [{ argv: ['npm'], match: 'prefix' as const }],
    };
    const s = ok(createLoopRun({ reviewer: 'lead', rounds: 3, approvals })).state;
    expect(s.integration).toEqual({
      reviewer: 'lead',
      maxReworkRounds: 3,
      handedOver: false,
      ticketKey: KEY,
      ticketBranch: null,
    });
    expect(s.approvalPolicy).toEqual(approvals);
  });

  it('refuses a bad ticket key, rounds, reviewer or approvals, and a loop without a ticket', () => {
    const base = ok(createLoopRun()).state;
    expect(base.integration?.reviewer).toBe('agent');
    const bad = (patch: object) => refused(createRunRaw(patch));
    expect(
      bad({ reviewLoop: { ticketKey: 'web-12', reviewer: 'agent', maxReworkRounds: 2 } }),
    ).toBe('invalid-input');
    expect(bad({ reviewLoop: { ticketKey: KEY, reviewer: 'agent', maxReworkRounds: 6 } })).toBe(
      'invalid-input',
    );
    expect(bad({ reviewLoop: { ticketKey: KEY, reviewer: 'owner', maxReworkRounds: 2 } })).toBe(
      'invalid-input',
    );
    expect(bad({ approvals: { mode: 'yolo', commands: [] } })).toBe('invalid-input');
    expect(
      bad({ approvals: { mode: 'auto', commands: [{ argv: ['bash', '-c'], match: 'prefix' }] } }),
    ).toBe('invalid-input');
    expect(bad({ ticket: undefined })).toBe('invalid-input');
  });
});

/** A loop run's input with raw overrides (for refusal tests). */
function createRunRaw(patch: object) {
  return createRun(
    {
      runId: RUN,
      leadAgentRunId: LEAD,
      projectId: PROJECT,
      title: 'WEB-12',
      ticket: { ticketId: TICKET, leadPrompt: 'Plan first' },
      reviewLoop: { ticketKey: KEY, reviewer: 'agent', maxReworkRounds: 2 },
      registeredProjectIds: REGISTERED,
      ...patch,
    },
    makeCtx(),
  );
}

describe('plan approval and the ticket branch', () => {
  function approve(o: Parameters<typeof createLoopRun>[0] = {}) {
    let s = ok(createLoopRun(o)).state;
    s = ok(event(s, LEAD, { type: 'started', providerSessionId: 'sess-lead', model: null })).state;
    const p = submitPlanFor(s);
    return decidePlan(p.state, p.planId, 'approve', makeCtx(1600, 'd'));
  }

  it('asks for the ticket branch at approval, before the lead is told to start helpers', () => {
    const r = ok(approve());
    expect(types(r.effects)).toEqual(['plan-decided', 'create-ticket-branch', 'send-to-agent']);
    expect(r.effects[1]).toEqual({ type: 'create-ticket-branch', ticketKey: KEY });
    const [text] = leadMessages(r.effects);
    expect(text).toContain('merge_change');
    expect(text).toContain('request_review once every change is decided');
    // RL-F: a lead that just ended its turn here waited for the run timeout.
    expect(text).toContain('nothing goes on until you call it');
    // ADR-0024 §3: the lead is asked for a short handover note.
    expect(text).toContain(HANDOVER_NOTE_LINE);
  });

  it('separate planner mode: the branch comes before the lead starts', () => {
    const wf = workflow({ plannerMode: 'separate' });
    let s = ok(createLoopRun({ workflow: wf })).state;
    s = ok(event(s, 'id-1', { type: 'started', providerSessionId: 's', model: null })).state;
    s = ok(
      leadTool(
        s,
        'submit_plan',
        { summary: 'Plan', steps: [{ title: 'API', role: 'API builder', detail: '' }] },
        'p',
        'id-1',
      ),
    ).state;
    const r = ok(decidePlan(s, 'p-1', 'approve', makeCtx(1600, 'd')));
    const t = types(r.effects);
    expect(t.indexOf('create-ticket-branch')).toBeLessThan(t.indexOf('start-agent'));
    const start = effectsOf(r.effects, 'start-agent')[0];
    expect(start?.prompt).toContain('merge_change');
  });

  it('refuses start_agent until the server reports the branch; then helpers start from it', () => {
    const approved = ok(approve()).state;
    const early = leadTool(approved, 'start_agent', { role: 'API builder', task: 'x' });
    expect(refusalOf(early)).toMatchObject({
      code: 'ticket-branch-pending',
    });
    const s = ok(ticketBranchCreated(approved, BRANCH, makeCtx(1700))).state;
    expect(s.integration?.ticketBranch).toBe(BRANCH);
    const r = ok(leadTool(s, 'start_agent', { role: 'API builder', task: 'x' }, 'w'));
    expect(effectsOf(r.effects, 'start-agent')[0]).toMatchObject({
      kind: 'worker',
      fromBranch: BRANCH,
    });
    expect(effectsOf(r.effects, 'start-agent')[0]).not.toHaveProperty('rework');
  });

  it('accepts only this ticket’s branch names', () => {
    const approved = ok(approve()).state;
    expect(refused(ticketBranchCreated(approved, 'acp/WEB-13', makeCtx()))).toBe('invalid-input');
    expect(refused(ticketBranchCreated(approved, 'main', makeCtx()))).toBe('invalid-input');
    expect(refused(ticketBranchCreated(approved, 'acp/WEB-12/x', makeCtx()))).toBe('invalid-input');
    const r1 = ok(ticketBranchCreated(approved, 'acp/WEB-12-r1', makeCtx())).state;
    expect(r1.integration?.ticketBranch).toBe('acp/WEB-12-r1');
    expect(refused(ticketBranchCreated(r1, BRANCH, makeCtx()))).toBe('invalid-input');
  });

  it('ADR-0025: accepts a name from a branching strategy or the ticket, never main or unsafe', () => {
    const approved = ok(approve()).state;
    for (const bad of ['master', 'acp/WEB-12-rx', '-D', 'a..b', 'refs/heads/x', 'HEAD']) {
      expect(refused(ticketBranchCreated(approved, bad, makeCtx())), bad).toBe('invalid-input');
    }
    const named = ok(ticketBranchCreated(approved, 'feature/WEB-12-dark-mode', makeCtx())).state;
    expect(named.integration?.ticketBranch).toBe('feature/WEB-12-dark-mode');
    expect(
      ok(ticketBranchCreated(approved, 'hotfix/login-r2', makeCtx())).state.integration,
    ).toMatchObject({ ticketBranch: 'hotfix/login-r2' });
  });
});

describe('sealing a finished helper', () => {
  it('a finished turn waits for review (no process, no slot) and is sealed', () => {
    const s = helper(
      loopRunning({ limits: { maxConcurrentHelpers: 1, maxDepth: 1 } }),
      'API builder',
      'wa',
    );
    expect(refused(leadTool(s, 'start_agent', { role: 'UI', task: 'x' }))).toBe('too-many-agents');
    const r = ok(finishTurn(s, A));
    expect(statusOf(r.state, A)).toBe('AWAITING_REVIEW');
    expect(r.effects).toEqual([{ type: 'seal-change', agentRunId: A }]);
    expect(changeOf(r.state, A)).toMatchObject({ state: 'sealing', round: 0, turnFailed: false });
    expect(agentOf(r.state, A).review).toBeNull();
    expect(r.state.run.status).toBe('RUNNING');
    // The slot is free again.
    expect(leadTool(r.state, 'start_agent', { role: 'UI', task: 'x' }).ok).toBe(true);
    // A late second report changes nothing.
    const again = ok(finishTurn(r.state, A));
    expect(again.effects).toEqual([{ type: 'diagnostic', code: 'event-after-end', agentRunId: A }]);
  });

  it('an errored turn goes through the loop too', () => {
    const r = ok(finishTurn(helper(loopRunning(), 'API builder', 'wa'), A, 'error'));
    expect(statusOf(r.state, A)).toBe('AWAITING_REVIEW');
    expect(changeOf(r.state, A).turnFailed).toBe(true);
  });

  it('no changes: SUCCEEDED (FAILED after an errored turn), and the lead hears of it', () => {
    const s = ok(finishTurn(helper(loopRunning(), 'API builder', 'wa'), A)).state;
    const r = ok(sealed(s, A, 'rv', false, null));
    expect(statusOf(r.state, A)).toBe('SUCCEEDED');
    expect(changeOf(r.state, A).state).toBe('no-changes');
    expect(agentOf(r.state, A).review).toBe('no-changes');
    expect(leadMessages(r.effects)[0]).toContain('no changes');
    const e = ok(finishTurn(helper(loopRunning(), 'API builder', 'wa'), A, 'error')).state;
    expect(statusOf(ok(sealed(e, A, 'rv', false, null)).state, A)).toBe('FAILED');
  });

  it('a seal that failed goes to the owner', () => {
    const s = ok(finishTurn(helper(loopRunning(), 'API builder', 'wa'), A)).state;
    const r = ok(sealed(s, A, 'rv', true, null));
    expect(changeOf(r.state, A).state).toBe('needs-owner');
    expect(r.state.agents.some((a) => a.kind === 'reviewer')).toBe(false);
  });

  it('refuses a seal report that does not fit', () => {
    const s = helper(loopRunning(), 'API builder', 'wa');
    expect(refusalOf(sealed(s, A))).toMatchObject({ code: 'change-not-found' });
    const f = ok(finishTurn(s, A)).state;
    expect(refused(sealed(f, A, 'rv', true, 'not-a-commit'))).toBe('invalid-input');
    expect(
      refused(
        changeSealed(f, A, { changed: true, headCommit: COMMIT, changedFiles: -1 }, makeCtx()),
      ),
    ).toBe('invalid-input');
    const ready = ok(sealed(f, A)).state;
    expect(refusalOf(sealed(ready, A))).toMatchObject({ code: 'change-not-decidable' });
  });
});

describe('the review agent', () => {
  it('starts read-only on a detached checkout of the sealed commit, with the review stage', () => {
    const wf = workflow();
    wf.stages.review = {
      requireChecks: true,
      model: 'claude-haiku',
      skill: 'code-review',
      agent: 'strict-reviewer',
    };
    const s = ok(finishTurn(helper(loopRunning({ workflow: wf }), 'API builder', 'wa'), A)).state;
    const r = ok(sealed(s, A));
    expect(agentOf(r.state, RA)).toMatchObject({
      kind: 'reviewer',
      role: 'Review: API builder',
      stage: 'review',
      status: 'STARTING',
      reviewsAgentRunId: A,
      parentAgentRunId: null,
      budgetLimit: 1000,
    });
    expect(changeOf(r.state, A)).toMatchObject({
      state: 'reviewing',
      reviewer: 'agent',
      reviewerAgentRunId: RA,
      headCommit: COMMIT,
      changedFiles: 2,
    });
    expect(types(r.effects)).toEqual(['change-round', 'create-review-checkout', 'start-agent']);
    expect(r.effects[0]).toEqual({
      type: 'change-round',
      agentRunId: A,
      round: 0,
      reviewer: 'agent',
      reviewerAgentRunId: RA,
      verdict: null,
      decision: null,
      decidedBy: null,
    });
    expect(r.effects[1]).toEqual({
      type: 'create-review-checkout',
      agentRunId: RA,
      commit: COMMIT,
      reviewsAgentRunId: A,
    });
    const start = effectsOf(r.effects, 'start-agent')[0];
    expect(start).toMatchObject({
      kind: 'reviewer',
      reviewScope: 'change',
      model: 'claude-haiku',
      skills: ['code-review'],
      agent: 'strict-reviewer',
    });
    expect(start?.prompt).toContain('Build the API builder');
    expect(start?.prompt).toContain('submit_review');
    expect(start?.prompt).toContain('acp-skills:code-review');
    expect(controlToolsFor(r.state, RA)).toEqual(['submit_review']);
    const perm = requestPermission(
      r.state,
      { agentRunId: RA, toolName: 'Bash', toolUseId: 't', summary: 'ls' },
      makeCtx(5100),
    );
    expect(refused(perm)).toBe('unknown-tool');
    expect(refused(leadTool(r.state, 'post_review', { text: 'x' }, 'x', RA))).toBe('not-lead');
    expect(refused(leadTool(r.state, 'start_agent', { role: 'x', task: 'y' }, 'x', RA))).toBe(
      'not-lead',
    );
  });

  it('takes the oldest ready change first and waits for a free slot', () => {
    let s = loopRunning({ limits: { maxConcurrentHelpers: 2, maxDepth: 1 } });
    s = helper(helper(s, 'API builder', 'wa'), 'UI builder', 'wb');
    s = ok(finishTurn(ok(finishTurn(s, A)).state, B)).state;
    s = helper(helper(s, 'Docs', 'wc'), 'Tests', 'wd');
    // Both slots are busy: B (sealed first) and A queue up.
    s = ok(
      changeSealed(
        s,
        B,
        { changed: true, headCommit: 'bbb1111', changedFiles: 1 },
        makeCtx(5000, 'q1'),
      ),
    ).state;
    s = ok(
      changeSealed(
        s,
        A,
        { changed: true, headCommit: 'aaa1111', changedFiles: 1 },
        makeCtx(5100, 'q2'),
      ),
    ).state;
    expect(changeOf(s, A).state).toBe('ready');
    expect(changeOf(s, B).state).toBe('ready');
    expect(s.agents.some((a) => a.kind === 'reviewer')).toBe(false);
    // One slot frees: B's change is the oldest.
    const done = { type: 'finished', outcome: 'success', reportedCostUsd: null } as const;
    const r1 = ok(agentEvent(s, 'wc-1', done, makeCtx(6000, 'f1')));
    expect(agentOf(r1.state, 'f1-1').reviewsAgentRunId).toBe(B);
    expect(changeOf(r1.state, B).state).toBe('reviewing');
    expect(changeOf(r1.state, A).state).toBe('ready');
    s = r1.state;
    const r2 = ok(agentEvent(s, 'wd-1', done, makeCtx(7000, 'f2')));
    expect(agentOf(r2.state, 'f2-1').reviewsAgentRunId).toBe(A);
    expect(changeOf(r2.state, A).state).toBe('reviewing');
    // A change reviewer counts as a helper: both slots are taken by reviewers now.
    expect(refused(leadTool(r2.state, 'start_agent', { role: 'X', task: 'x' }))).toBe(
      'too-many-agents',
    );
  });

  it('submit_review: findings become a ticket comment and go to the lead with the verdict', () => {
    const s = readyForReview(helper(loopRunning(), 'API builder', 'wa'), A);
    const r = ok(
      leadTool(
        s,
        'submit_review',
        { verdict: 'rework', findings: 'Missing null check; key sk-ant-abcdefghijkl0123' },
        'sr',
        RA,
      ),
    );
    expect(changeOf(r.state, A)).toMatchObject({ state: 'decision', verdict: 'rework' });
    const comment = effectsOf(r.effects, 'review-comment')[0];
    expect(comment).toMatchObject({ agentRunId: RA, changeOf: A, round: 0, verdict: 'rework' });
    expect(comment?.body).toContain('Missing null check');
    expect(comment?.body).not.toContain('sk-ant-abcdefghijkl0123');
    expect(effectsOf(r.effects, 'change-round')[0]).toMatchObject({
      verdict: 'rework',
      decision: null,
    });
    const [msg] = leadMessages(r.effects);
    expect(msg).toContain('Verdict: rework');
    expect(msg).toContain('Missing null check');
    expect(agentOf(r.state, RA).latestActivity).toBe("Reviewed API builder's change: rework");
    // Once only.
    expect(
      refused(leadTool(r.state, 'submit_review', { verdict: 'approve', findings: 'x' }, 'sr', RA)),
    ).toBe('run-not-active');
    expect(
      refused(leadTool(s, 'submit_review', { verdict: 'maybe', findings: 'x' }, 'sr', RA)),
    ).toBe('invalid-input');
    expect(refused(leadTool(s, 'submit_review', { verdict: 'approve', findings: 'x' }))).toBe(
      'not-lead',
    );
  });

  it('a review agent that ends removes its checkout; without a verdict the lead decides', () => {
    const s = readyForReview(helper(loopRunning(), 'API builder', 'wa'), A);
    const r = ok(finishTurn(s, RA, 'success', 6000));
    expect(statusOf(r.state, RA)).toBe('SUCCEEDED');
    expect(changeOf(r.state, A)).toMatchObject({ state: 'decision', verdict: null });
    expect(leadMessages(r.effects)[0]).toContain('ended without a verdict');
    expect(r.effects.at(-1)).toEqual({ type: 'remove-review-checkout', agentRunId: RA });
    // The owner's Stop on a reviewer does the same.
    const stopped = ok(stopAgent(s, RA, makeCtx(6000)));
    expect(changeOf(stopped.state, A).state).toBe('decision');
  });
});

describe('the lead as reviewer', () => {
  it('gets a message instead of a review agent, and decides the change itself', () => {
    const s = ok(
      finishTurn(helper(loopRunning({ reviewer: 'lead' }), 'API builder', 'wa'), A),
    ).state;
    const r = ok(sealed(s, A));
    expect(r.state.agents.some((a) => a.kind === 'reviewer')).toBe(false);
    expect(changeOf(r.state, A)).toMatchObject({
      state: 'reviewing',
      reviewer: 'lead',
      reviewerAgentRunId: null,
    });
    expect(effectsOf(r.effects, 'change-round')[0]).toMatchObject({ reviewer: 'lead' });
    expect(leadMessages(r.effects)[0]).toContain('ready for your review');
    expect(checkChangeAction(r.state, A, 'merge', 'lead')).toBeNull();
    const merged = ok(leadTool(r.state, 'merge_change', { agentId: A }, 'm'));
    expect(changeOf(merged.state, A).merging).toBe(true);
  });
});

describe('the lead’s decisions', () => {
  it('offers the change tools only in loop runs, never submit_review or post_review', () => {
    const tools = controlToolsFor(loopRunning(), LEAD);
    expect(tools).toEqual(
      expect.arrayContaining([
        'view_change',
        'merge_change',
        'request_rework',
        'discard_change',
        'ask_owner',
      ]),
    );
    expect(tools).not.toContain('submit_review');
    expect(tools).not.toContain('post_review');
  });

  it('view_change: a bounded summary from engine state; the server appends the diff', () => {
    const s = inDecision();
    const r = ok(leadTool(s, 'view_change', { agentId: A }));
    expect(r.value).toContain(`Change of API builder (agentId ${A})`);
    expect(r.value).toContain(`commit ${COMMIT}`);
    expect(r.value).toContain('Rework rounds used: 0 of 2');
    expect(r.value).toContain("Review agent's verdict: approve");
    expect(r.value).toContain('Required checks: not run yet');
    expect(r.effects).toEqual([]);
    expect(agentOf(r.state, LEAD).latestActivity).toBe("Looked at API builder's change");
    expect(refusalOf(leadTool(s, 'view_change', { agentId: 'nope' }))).toMatchObject({
      code: 'change-not-found',
    });
  });

  it('viewChangeReply caps the reply at 32 KiB, never splitting a character', () => {
    const summary = 'Summary';
    expect(viewChangeReply(summary, null)).toContain('No diff');
    expect(viewChangeReply(summary, '+a\n')).toBe('Summary\n\nDiff:\n+a\n');
    const big = viewChangeReply(summary, '€'.repeat(20_000));
    expect(new TextEncoder().encode(big).length).toBeLessThanOrEqual(VIEW_CHANGE_MAX_BYTES);
    expect(big).toContain('diff cut at 32 KiB');
    expect(big).not.toContain('�');
  });

  it('merge_change: begins the merge on the server; the result records the decision', () => {
    const s = inDecision();
    const begun = ok(leadTool(s, 'merge_change', { agentId: A }, 'm'));
    expect(begun.effects).toEqual([
      { type: 'merge-change', agentRunId: A, by: 'lead', anyway: false },
    ]);
    expect(changeOf(begun.state, A).merging).toBe(true);
    expect(agentOf(begun.state, LEAD).latestActivity).toBe(`Merging API builder into ${BRANCH}`);
    expect(refusalOf(leadTool(begun.state, 'merge_change', { agentId: A }))).toMatchObject({
      code: 'change-busy',
    });
    const r = ok(
      recordChangeDecision(
        begun.state,
        A,
        { decision: 'merge', by: 'lead', outcome: 'merged', headCommit: 'def5678' },
        makeCtx(7000),
      ),
    );
    expect(r.value).toBe(`Merged API builder into ${BRANCH}.`);
    expect(statusOf(r.state, A)).toBe('SUCCEEDED');
    expect(agentOf(r.state, A).review).toBe('merged');
    expect(changeOf(r.state, A)).toMatchObject({
      state: 'merged',
      headCommit: 'def5678',
      merging: false,
    });
    expect(agentOf(r.state, LEAD).latestActivity).toBe(`Merged API builder into ${BRANCH}`);
    expect(effectsOf(r.effects, 'change-round')[0]).toMatchObject({
      round: 0,
      reviewer: 'agent',
      verdict: 'approve',
      decision: 'merge',
      decidedBy: 'lead',
    });
    // A merge that found nothing new.
    const none = ok(
      recordChangeDecision(
        begun.state,
        A,
        { decision: 'merge', by: 'lead', outcome: 'no-changes' },
        makeCtx(7000),
      ),
    );
    expect(changeOf(none.state, A).state).toBe('no-changes');
    expect(
      refused(recordChangeDecision(begun.state, A, { decision: 'merge', by: 'lead' }, makeCtx())),
    ).toBe('invalid-input');
  });

  it('refuses a merge while the change is sealed or reviewed', () => {
    const s = ok(finishTurn(helper(loopRunning(), 'API builder', 'wa'), A)).state;
    expect(refusalOf(leadTool(s, 'merge_change', { agentId: A }))).toMatchObject({
      code: 'change-not-decidable',
    });
    const reviewing = ok(sealed(s, A)).state;
    const refusal = refusalOf(leadTool(reviewing, 'merge_change', { agentId: A }));
    expect(refusal).toMatchObject({ code: 'change-not-decidable' });
    expect(refusal.message).toContain('being reviewed');
    // The owner cannot either while a review agent reviews it.
    expect(checkChangeAction(reviewing, A, 'merge', 'owner')).toMatchObject({
      code: 'change-not-decidable',
    });
  });

  it('conflicts, running checks and failed checks block the merge', () => {
    const begun = ok(leadTool(inDecision(), 'merge_change', { agentId: A }, 'm')).state;
    const conflict = ok(
      changeMergeBlocked(
        begun,
        A,
        { reason: 'merge-conflict', files: ['src/a.ts', 'src/b.ts'] },
        makeCtx(7000),
      ),
    );
    expect(conflict.value).toContain('src/a.ts, src/b.ts');
    expect(changeOf(conflict.state, A)).toMatchObject({
      merging: false,
      conflictFiles: ['src/a.ts', 'src/b.ts'],
    });

    const pending = ok(changeMergeBlocked(begun, A, { reason: 'checks-pending' }, makeCtx(7000)));
    expect(changeOf(pending.state, A).checks).toBe('pending');
    expect(refusalOf(leadTool(pending.state, 'merge_change', { agentId: A }))).toMatchObject({
      code: 'checks-pending',
    });
    const passed = ok(
      checksFinished(
        pending.state,
        A,
        { commit: COMMIT, requiredPassed: true, failed: [] },
        makeCtx(8000),
      ),
    );
    expect(leadMessages(passed.effects)[0]).toContain('Call merge_change');
    expect(leadTool(passed.state, 'merge_change', { agentId: A }).ok).toBe(true);

    const failed = ok(
      checksFinished(
        pending.state,
        A,
        { commit: COMMIT, requiredPassed: false, failed: ['lint'] },
        makeCtx(8000),
      ),
    );
    expect(leadMessages(failed.effects)[0]).toContain('lint');
    expect(refusalOf(leadTool(failed.state, 'merge_change', { agentId: A }))).toMatchObject({
      code: 'checks-failed',
    });
    // The owner may merge anyway; the lead may not.
    expect(checkChangeAction(failed.state, A, 'merge-anyway', 'owner')).toBeNull();
    expect(
      refused(
        recordChangeDecision(
          failed.state,
          A,
          { decision: 'merge-anyway', by: 'lead', outcome: 'merged' },
          makeCtx(),
        ),
      ),
    ).toBe('not-lead');

    const broken = ok(changeMergeBlocked(begun, A, { reason: 'failed' }, makeCtx(7000)));
    expect(broken.value).toContain('failed');
    expect(
      refusalOf(changeMergeBlocked(broken.state, A, { reason: 'failed' }, makeCtx())),
    ).toMatchObject({
      code: 'change-not-decidable',
    });
    expect(
      refused(
        checksFinished(begun, A, { commit: 'zz', requiredPassed: true, failed: [] }, makeCtx()),
      ),
    ).toBe('invalid-input');
    // The ticket tip's checks are the owner's to see.
    expect(
      ok(
        checksFinished(
          begun,
          null,
          { commit: COMMIT, requiredPassed: true, failed: [] },
          makeCtx(),
        ),
      ).effects,
    ).toEqual([]);
  });

  it('request_rework: the same helper resumes in its worktree, never with helper tools', () => {
    const s = inDecision();
    const r = ok(
      leadTool(s, 'request_rework', { agentId: A, comments: 'Add the null check.' }, 'rw'),
    );
    expect(statusOf(r.state, A)).toBe('STARTING');
    expect(changeOf(r.state, A)).toMatchObject({
      state: 'rework',
      round: 1,
      verdict: null,
      reviewerAgentRunId: null,
    });
    expect(types(r.effects)).toEqual(['change-round', 'change-comment', 'start-agent']);
    expect(r.effects[0]).toMatchObject({ round: 0, decision: 'rework', decidedBy: 'lead' });
    expect(r.effects[1]).toEqual({
      type: 'change-comment',
      agentRunId: A,
      round: 0,
      author: 'lead',
      kind: 'rework',
      body: 'Add the null check.',
    });
    const start = effectsOf(r.effects, 'start-agent')[0];
    expect(start).toMatchObject({
      agentRunId: A,
      kind: 'worker',
      rework: { resumeSessionId: `sess-${A}` },
    });
    expect(start).not.toHaveProperty('canStartHelpers');
    expect(start?.prompt).toContain('Add the null check.');
    expect(start?.prompt).toContain('round 1 of 2');
    expect(agentOf(r.state, LEAD).latestActivity).toBe(
      'Asked API builder to rework its change (round 1)',
    );
    expect(controlToolsFor(r.state, A)).toEqual([]);
    // Round 1: started, finished, sealed, reviewed again.
    let t = ok(
      event(r.state, A, { type: 'started', providerSessionId: `sess-${A}`, model: null }, 6000),
    ).state;
    expect(statusOf(t, A)).toBe('RUNNING');
    t = ok(finishTurn(t, A, 'success', 7000)).state;
    expect(changeOf(t, A)).toMatchObject({ state: 'sealing', round: 1 });
    const again = ok(
      changeSealed(
        t,
        A,
        { changed: true, headCommit: 'fff0000', changedFiles: 1 },
        makeCtx(8000, 'r2'),
      ),
    );
    expect(effectsOf(again.effects, 'change-round')[0]).toMatchObject({
      round: 1,
      reviewer: 'agent',
    });
    expect(effectsOf(again.effects, 'start-agent')[0]?.prompt).toContain('after rework round 1');
  });

  it('request_rework is refused past the round limit, over budget, or with no free slot', () => {
    // Round limit (1): one rework, then refused; the owner may grant another.
    let s = inDecision({ rounds: 1 });
    s = ok(leadTool(s, 'request_rework', { agentId: A, comments: 'Again.' }, 'rw')).state;
    s = ok(finishTurn(s, A, 'success', 7000)).state;
    s = ok(
      changeSealed(
        s,
        A,
        { changed: true, headCommit: 'fff0000', changedFiles: 1 },
        makeCtx(8000, 'r2'),
      ),
    ).state;
    s = ok(
      leadTool(s, 'submit_review', { verdict: 'rework', findings: 'Still wrong.' }, 'sr', 'r2-1'),
    ).state;
    expect(
      refusalOf(leadTool(s, 'request_rework', { agentId: A, comments: 'Again.' })),
    ).toMatchObject({
      code: 'rework-limit',
    });
    expect(checkChangeAction(s, A, 'rework', 'owner')).toBeNull();
    const granted = ok(
      recordChangeDecision(
        s,
        A,
        { decision: 'rework', by: 'owner', comments: 'One more try.' },
        makeCtx(9000),
      ),
    );
    expect(changeOf(granted.state, A).round).toBe(2);
    expect(effectsOf(granted.effects, 'change-comment')[0]).toMatchObject({ author: 'owner' });
    expect(leadMessages(granted.effects)[0]).toContain('The owner decided');
    expect(
      refused(
        recordChangeDecision(s, A, { decision: 'rework', by: 'owner', comments: '  ' }, makeCtx()),
      ),
    ).toBe('invalid-input');

    // Over budget.
    let o = helper(loopRunning({ budget: 100 }), 'API builder', 'wa');
    o = ok(
      event(o, A, {
        type: 'usage',
        messageId: 'm1',
        tokens: { input: 10, output: 200, cacheCreation: 0, cacheRead: 0 },
      }),
    ).state;
    o = ok(finishTurn(o, A, 'success', 4000)).state;
    o = ok(sealed(o, A)).state;
    o = ok(leadTool(o, 'submit_review', { verdict: 'rework', findings: 'x' }, 'sr', RA)).state;
    expect(refused(leadTool(o, 'request_rework', { agentId: A, comments: 'x' }))).toBe(
      'over-budget',
    );
    // The owner's rework raises the cap by one agent budget.
    const raised = ok(
      recordChangeDecision(
        o,
        A,
        { decision: 'rework', by: 'owner', comments: 'Fix it.' },
        makeCtx(9000),
      ),
    );
    expect(agentOf(raised.state, A).budgetLimit).toBe(agentOf(o, A).budgetTokensUsed + 100);

    // No free slot.
    let n = inDecision({ limits: { maxConcurrentHelpers: 2, maxDepth: 1 } });
    n = helper(n, 'UI builder', 'wb');
    // RA (finishing) still holds a slot; with B that is both.
    expect(refused(leadTool(n, 'request_rework', { agentId: A, comments: 'x' }))).toBe(
      'too-many-agents',
    );
  });

  it('discard_change: the work is dropped and the reason stored', () => {
    const r = ok(
      leadTool(inDecision(), 'discard_change', { agentId: A, reason: 'Not needed.' }, 'dc'),
    );
    expect(statusOf(r.state, A)).toBe('CANCELLED');
    expect(changeOf(r.state, A).state).toBe('discarded');
    expect(agentOf(r.state, A).review).toBe('discarded');
    expect(types(r.effects)).toEqual(['change-round', 'change-comment', 'discard-change']);
    expect(r.effects[1]).toMatchObject({ kind: 'discard', author: 'lead', body: 'Not needed.' });
    expect(agentOf(r.state, LEAD).latestActivity).toBe("Discarded API builder's change");
    expect(refused(leadTool(inDecision(), 'discard_change', { agentId: A, reason: '' }))).toBe(
      'invalid-input',
    );
  });

  it('ask_owner: needs-owner; only the owner decides it then', () => {
    const r = ok(
      leadTool(inDecision(), 'ask_owner', { agentId: A, question: 'Keep the old API?' }, 'ao'),
    );
    expect(changeOf(r.state, A).state).toBe('needs-owner');
    expect(effectsOf(r.effects, 'change-comment')[0]).toMatchObject({
      kind: 'ask-owner',
      body: 'Keep the old API?',
    });
    expect(effectsOf(r.effects, 'change-round')[0]).toMatchObject({
      decision: 'ask-owner',
      decidedBy: 'lead',
    });
    expect(agentOf(r.state, LEAD).latestActivity).toBe(
      "Asked the owner about API builder's change",
    );
    expect(deriveRunWorkflow(r.state).review).toMatchObject({ needsOwner: 1 });
    expect(deriveRunWorkflow(r.state).stages.find((x) => x.stage === 'review')?.state).toBe(
      'needs-you',
    );
    expect(refusalOf(leadTool(r.state, 'merge_change', { agentId: A }))).toMatchObject({
      code: 'change-not-decidable',
    });
    expect(
      refusalOf(leadTool(r.state, 'ask_owner', { agentId: A, question: 'Again?' })),
    ).toMatchObject({
      code: 'change-not-decidable',
    });
    // The owner merges it (the server merged; begin-less path is checked here).
    const owner = ok(
      recordChangeDecision(
        r.state,
        A,
        { decision: 'merge', by: 'owner', outcome: 'merged' },
        makeCtx(9000),
      ),
    );
    expect(changeOf(owner.state, A).state).toBe('merged');
    expect(effectsOf(owner.effects, 'change-round')[0]).toMatchObject({ decidedBy: 'owner' });
    expect(leadMessages(owner.effects)[0]).toBe(
      `The owner decided: Merged API builder into ${BRANCH}.`,
    );
  });

  it('the legacy per-change owner review is refused in loop runs', () => {
    expect(refusalOf(recordReview(inDecision(), A, 'merged', makeCtx()))).toMatchObject({
      code: 'legacy-review',
    });
  });

  it('message_agent and Stop are refused for a helper waiting for review', () => {
    const s = inDecision();
    expect(refused(leadTool(s, 'message_agent', { agentId: A, text: 'hi' }))).toBe(
      'agent-not-live',
    );
    expect(refused(leadTool(s, 'stop_agent', { agentId: A }))).toBe('agent-not-live');
    expect(refused(stopAgent(s, A, makeCtx()))).toBe('agent-not-live');
    const perm = requestPermission(
      s,
      { agentRunId: A, toolName: 'Edit', toolUseId: 't', summary: 'x' },
      makeCtx(),
    );
    expect(refused(perm)).toBe('agent-not-live');
  });
});

describe('humanized activity lines (ADR-0021 fix)', () => {
  it('name the helper for the lead’s own actions', () => {
    let s = loopRunning();
    s = helper(s, 'API builder', 'wa');
    expect(agentOf(s, LEAD).latestActivity).toBe('Started API builder');
    s = ok(leadTool(s, 'agent_status', { agentId: A })).state;
    expect(agentOf(s, LEAD).latestActivity).toBe('Checked on API builder');
    s = ok(leadTool(s, 'message_agent', { agentId: A, text: 'Hurry.' })).state;
    expect(agentOf(s, LEAD).latestActivity).toBe('Messaged API builder');
    s = ok(leadTool(s, 'stop_agent', { agentId: A })).state;
    expect(agentOf(s, LEAD).latestActivity).toBe('Stopped API builder');
  });

  it('leaves a helper own activity line alone', () => {
    const s = helper(loopRunning(), 'API builder', 'wa');
    const r = ok(agentEvent(s, A, { type: 'activity', summary: 'Edit src/api.ts' }, makeCtx(3500)));
    expect(agentOf(r.state, A).latestActivity).toBe('Edit src/api.ts');
  });
});

describe('a change reviewer as decider (ADR-0023 §4)', () => {
  it('never merges, discards or asks the owner through the change commands', () => {
    const s = inDecision();
    for (const action of ['merge', 'rework', 'discard', 'ask-owner'] as const) {
      expect(checkChangeAction(s, A, action, 'reviewer')?.code).toBe('not-lead');
    }
    expect(
      refused(recordChangeDecision(s, A, { decision: 'discard', by: 'reviewer' }, makeCtx(6000))),
    ).toBe('not-lead');
    expect(refused(beginChangeMerge(s, A, { by: 'reviewer' }, makeCtx(6000)))).toBe('not-lead');
  });
});
