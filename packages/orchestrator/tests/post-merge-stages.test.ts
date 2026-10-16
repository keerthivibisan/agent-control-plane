import { describe, expect, it } from 'vitest';
import {
  MAX_REVIEW_POSTS,
  REVIEW_POST_MAX_CHARS,
  TESTER_TASK,
  cancelRun,
  checkStartAgent,
  continueStages,
  controlToolsFor,
  decideApproval,
  leadToolCall,
  ownerChat,
  recordReview,
  recoverAfterRestart,
  requestPermission,
  stopAgent,
} from '../src/index.js';
import type { EngineEffect } from '../src/index.js';
import { LEAD, REGISTERED, agentOf, makeCtx, ok, refused, statusOf } from './helpers.js';
import { WORKER, finish, helperDone, merged, postReview, workflow } from './workflow-helpers.js';

/** The post-merge stages: code review and unit tests (ADR-0019 §2–§3). Synthetic data only. */

const REVIEW_ONLY = workflow({ codeReview: true });
const TESTS_ONLY = workflow({ unitTests: true });
const BOTH = workflow({ codeReview: true, unitTests: true });
const REVIEWER = 'm-1';

const types = (effects: readonly EngineEffect[]) => effects.map((e) => e.type);
function startOf(effects: readonly EngineEffect[]) {
  const e = effects.find((x) => x.type === 'start-agent');
  if (e?.type !== 'start-agent') throw new Error('no start-agent effect');
  return e;
}
describe('code review stage', () => {
  it('starts a read-only reviewer on a detached checkout once the helpers are merged', () => {
    const r = ok(merged(REVIEW_ONLY));
    expect(r.state.run.status).toBe('REVIEW');
    expect(agentOf(r.state, REVIEWER)).toMatchObject({
      kind: 'reviewer',
      role: 'Reviewer',
      stage: 'code-review',
      status: 'STARTING',
      parentAgentRunId: null,
      reviewPosts: 0,
    });
    // The lead's conversation is over; it is stopped before the reviewer starts.
    expect(statusOf(r.state, LEAD)).toBe('CANCELLED');
    expect(types(r.effects)).toEqual(['abort-agent', 'create-review-checkout', 'start-agent']);
    expect(r.effects[0]).toEqual({ type: 'abort-agent', agentRunId: LEAD });
    expect(r.effects[1]).toEqual({ type: 'create-review-checkout', agentRunId: REVIEWER });
    const start = startOf(r.effects);
    expect(start).toMatchObject({ kind: 'reviewer', role: 'Reviewer', agentRunId: REVIEWER });
    expect(start.prompt).toContain('Final code review for "WEB-1 Dark mode"');
    expect(start.prompt).toContain('- UI: Do the thing');
    expect(start.prompt).toContain('post_review');
  });

  it('posts findings as redacted, capped ticket comments; at most MAX_REVIEW_POSTS', () => {
    let s = ok(merged(REVIEW_ONLY)).state;
    const r = ok(postReview(s, REVIEWER, 'Bug in theme.ts; token sk-ant-abcdefghijkl0123'));
    expect(r.effects).toHaveLength(1);
    const comment = r.effects[0];
    if (comment?.type !== 'review-comment') throw new Error('expected review-comment');
    expect(comment.agentRunId).toBe(REVIEWER);
    expect(comment.body).toContain('Bug in theme.ts');
    expect(comment.body).not.toContain('sk-ant-abcdefghijkl0123');
    expect(agentOf(r.state, REVIEWER).reviewPosts).toBe(1);
    s = r.state;
    for (let i = 1; i < MAX_REVIEW_POSTS; i++)
      s = ok(postReview(s, REVIEWER, `finding ${i}`)).state;
    expect(refused(postReview(s, REVIEWER, 'one too many'))).toBe('invalid-input');
  });

  it('refuses empty or oversize findings, and anyone but the reviewer', () => {
    const s = ok(merged(REVIEW_ONLY)).state;
    expect(refused(postReview(s, REVIEWER, '   '))).toBe('invalid-input');
    expect(refused(postReview(s, REVIEWER, 'x'.repeat(REVIEW_POST_MAX_CHARS + 1)))).toBe(
      'invalid-input',
    );
    expect(refused(postReview(s, REVIEWER, { body: 'wrong field' }))).toBe('invalid-input');
    expect(refused(postReview(s, LEAD))).toBe('not-lead');
    const w = helperDone(REVIEW_ONLY);
    expect(refused(postReview(w, WORKER))).toBe('not-lead');
    expect(refused(postReview(w, LEAD))).toBe('not-lead');
  });

  it('has only post_review, never edits or runs commands', () => {
    const s = ok(merged(REVIEW_ONLY)).state;
    expect(controlToolsFor(s, REVIEWER)).toEqual(['post_review']);
    expect(
      refused(
        leadToolCall(
          s,
          {
            callerAgentRunId: REVIEWER,
            name: 'start_agent',
            input: { role: 'x', task: 'y' },
            registeredProjectIds: REGISTERED,
          },
          makeCtx(11_000),
        ),
      ),
    ).toBe('not-lead');
    const perm = requestPermission(
      s,
      { agentRunId: REVIEWER, toolName: 'Bash', toolUseId: 't', summary: 'Bash ls' },
      makeCtx(11_000),
    );
    expect(refused(perm)).toBe('unknown-tool');
  });

  it('completes the run once the reviewer ends, and removes its checkout', () => {
    const s = ok(postReview(ok(merged(REVIEW_ONLY)).state, REVIEWER)).state;
    const r = ok(finish(s, REVIEWER));
    expect(statusOf(r.state, REVIEWER)).toBe('SUCCEEDED');
    expect(r.state.run.status).toBe('COMPLETED');
    expect(r.effects).toEqual([{ type: 'remove-review-checkout', agentRunId: REVIEWER }]);
  });

  it('never blocks: a reviewer that fails still lets the run complete', () => {
    const r = ok(finish(ok(merged(REVIEW_ONLY)).state, REVIEWER, 'error'));
    expect(statusOf(r.state, REVIEWER)).toBe('FAILED');
    expect(r.state.run.status).toBe('COMPLETED');
  });

  it('is skipped when nothing was merged', () => {
    const r = ok(recordReview(helperDone(REVIEW_ONLY), WORKER, 'discarded', makeCtx(9000, 'm')));
    expect(r.state.run.status).toBe('COMPLETED');
    expect(r.state.agents.some((a) => a.kind === 'reviewer')).toBe(false);
  });

  it('closes chat with the lead once the stage started', () => {
    const s = ok(merged(REVIEW_ONLY)).state;
    expect(refused(ownerChat(s, 'hello', makeCtx(11_000)))).toBe('agent-not-live');
  });
});

describe('unit tests stage', () => {
  const TESTER = 'm-1';

  it('starts a tester in its own worktree with the fixed brief', () => {
    const r = ok(merged(TESTS_ONLY));
    expect(agentOf(r.state, TESTER)).toMatchObject({
      kind: 'tester',
      role: 'Tester',
      task: TESTER_TASK,
      stage: 'unit-tests',
      status: 'STARTING',
    });
    expect(types(r.effects)).toEqual(['abort-agent', 'start-agent']);
    const start = startOf(r.effects);
    expect(start).toMatchObject({ kind: 'tester', agentRunId: TESTER });
    expect(start.prompt.startsWith(TESTER_TASK)).toBe(true);
    expect(controlToolsFor(r.state, TESTER)).toEqual([]);
  });

  it('asks for edits like a helper, and its allowlist is the helpers', () => {
    const s = ok(merged(TESTS_ONLY)).state;
    const req = {
      agentRunId: TESTER,
      toolName: 'Edit',
      toolUseId: 't1',
      summary: 'Edit a.test.ts',
    };
    const asked = ok(requestPermission(s, req, makeCtx(11_000, 'ap')));
    expect(statusOf(asked.state, TESTER)).toBe('WAITING_APPROVAL');
    expect(asked.effects).toEqual([{ type: 'approval-requested', approvalId: 'ap-1' }]);
    const resumed = ok(decideApproval(asked.state, 'ap-1', 'approve', makeCtx(12_000)));
    expect(statusOf(resumed.state, TESTER)).toBe('RUNNING');
    const auto = ok(
      requestPermission(s, req, makeCtx(11_000, 'al'), {
        allowlist: { allowed: true, rule: 'edit-in-own-worktree' },
      }),
    );
    expect(auto.value).toMatchObject({ status: 'approved', decidedBy: 'allowlist' });
  });

  it('its change goes through the same review; the run completes when it is merged', () => {
    let s = ok(finish(ok(merged(TESTS_ONLY)).state, TESTER)).state;
    expect(agentOf(s, TESTER).review).toBe('pending');
    expect(s.run.status).toBe('REVIEW');
    s = ok(recordReview(s, TESTER, 'merged', makeCtx(12_000))).state;
    expect(s.run.status).toBe('COMPLETED');
  });

  it('a discarded tester change also finishes the stage', () => {
    const s = ok(finish(ok(merged(TESTS_ONLY)).state, TESTER, 'error')).state;
    const r = ok(recordReview(s, TESTER, 'discarded', makeCtx(12_000)));
    expect(r.state.run.status).toBe('COMPLETED');
  });

  it('cannot start helpers and counts against the helper limit', () => {
    const s = ok(merged(TESTS_ONLY)).state;
    expect(
      refused(
        leadToolCall(
          s,
          {
            callerAgentRunId: TESTER,
            name: 'start_agent',
            input: { role: 'x', task: 'y' },
            registeredProjectIds: REGISTERED,
          },
          makeCtx(11_000),
        ),
      ),
    ).toBe('not-lead');
    // Synthetic: a live lead in a RUNNING run with a limit of 1, next to the live tester.
    const liveLead = {
      ...s,
      limits: { maxConcurrentHelpers: 1, maxDepth: 1 },
      run: { ...s.run, status: 'RUNNING' as const },
      agents: s.agents.map((a) => (a.id === LEAD ? { ...a, status: 'RUNNING' as const } : a)),
    };
    expect(checkStartAgent(liveLead, LEAD, REGISTERED)?.code).toBe('too-many-agents');
  });
});

describe('both stages', () => {
  it('runs the reviewer, then the tester, then completes once the tester change is merged', () => {
    let s = ok(merged(BOTH)).state;
    expect(agentOf(s, 'm-1').kind).toBe('reviewer');
    s = ok(postReview(s, 'm-1')).state;
    const afterReview = ok(finish(s, 'm-1'));
    expect(types(afterReview.effects)).toEqual(['remove-review-checkout', 'start-agent']);
    const testerId = startOf(afterReview.effects).agentRunId;
    expect(agentOf(afterReview.state, testerId)).toMatchObject({ kind: 'tester' });
    expect(afterReview.state.run.status).toBe('REVIEW');
    s = ok(finish(afterReview.state, testerId)).state;
    expect(s.run.status).toBe('REVIEW');
    s = ok(recordReview(s, testerId, 'merged', makeCtx(13_000))).state;
    expect(s.run.status).toBe('COMPLETED');
  });

  it('stopping the reviewer skips its stage; the tester starts', () => {
    const r = ok(stopAgent(ok(merged(BOTH)).state, 'm-1', makeCtx(11_000, 's')));
    expect(statusOf(r.state, 'm-1')).toBe('CANCELLED');
    expect(types(r.effects)).toEqual(['abort-agent', 'remove-review-checkout', 'start-agent']);
    expect(startOf(r.effects).kind).toBe('tester');
  });
});

describe('Stop all and restarts in the post-merge stages', () => {
  it('Stop all during the code review aborts the reviewer and removes its checkout', () => {
    const r = ok(cancelRun(ok(merged(BOTH)).state, makeCtx(11_000)));
    expect(r.state.run.status).toBe('CANCELLING');
    expect(statusOf(r.state, 'm-1')).toBe('CANCELLED');
    expect(r.effects).toEqual([
      { type: 'abort-agent', agentRunId: 'm-1' },
      { type: 'remove-review-checkout', agentRunId: 'm-1' },
    ]);
  });

  it('Stop all during the unit tests aborts the tester; nothing new starts', () => {
    const r = ok(cancelRun(ok(merged(TESTS_ONLY)).state, makeCtx(11_000)));
    expect(statusOf(r.state, 'm-1')).toBe('CANCELLED');
    expect(r.effects.filter((e) => e.type === 'start-agent')).toEqual([]);
    expect(r.state.run.status).toBe('CANCELLING');
  });

  it('a restart during the code review holds the next stage until the owner continues', () => {
    const r = ok(recoverAfterRestart(ok(merged(BOTH)).state, makeCtx(11_000)));
    expect(statusOf(r.state, 'm-1')).toBe('NEEDS_REVIEW');
    expect(r.state.run.status).toBe('REVIEW');
    expect(r.state.stagesHeld).toBe(true);
    // The stale checkout is removed; no agent starts.
    expect(r.effects).toEqual([{ type: 'remove-review-checkout', agentRunId: 'm-1' }]);
    const c = ok(continueStages(r.state, makeCtx(12_000, 'c')));
    expect(c.state.stagesHeld).toBeUndefined();
    // The interrupted reviewer never posted, so the code review runs again.
    expect(startOf(c.effects)).toMatchObject({ kind: 'reviewer', agentRunId: 'c-1' });
    expect(types(c.effects)).toEqual(['create-review-checkout', 'start-agent']);
  });

  it('a restart during the unit tests puts the tester change up for review; no relaunch', () => {
    const r = ok(recoverAfterRestart(ok(merged(TESTS_ONLY)).state, makeCtx(11_000)));
    expect(agentOf(r.state, 'm-1').review).toBe('pending');
    expect(r.effects).toEqual([]);
    expect(refused(continueStages(r.state, makeCtx(12_000)))).toBe('review-not-allowed');
    const done = ok(recordReview(r.state, 'm-1', 'discarded', makeCtx(12_000)));
    expect(done.state.run.status).toBe('COMPLETED');
  });

  it('a restart during the helpers holds the code review after the owner merges', () => {
    const live = helperDone(REVIEW_ONLY);
    const running = { ...live, run: { ...live.run, status: 'RUNNING' as const } };
    const r = ok(recoverAfterRestart(running, makeCtx(6000)));
    expect(r.state.run.status).toBe('NEEDS_REVIEW');
    expect(r.state.stagesHeld).toBe(true);
    const m = ok(recordReview(r.state, WORKER, 'merged', makeCtx(9000, 'm')));
    expect(m.state.run.status).toBe('REVIEW');
    expect(m.state.agents.some((a) => a.kind === 'reviewer')).toBe(false);
    const c = ok(continueStages(m.state, makeCtx(10_000, 'c')));
    expect(startOf(c.effects).kind).toBe('reviewer');
  });

  it('the default workflow never holds: the run completes after the merge as in Phase 4', () => {
    const live = helperDone(undefined);
    const running = { ...live, run: { ...live.run, status: 'RUNNING' as const } };
    const r = ok(recoverAfterRestart(running, makeCtx(6000)));
    expect(r.state.stagesHeld).toBeUndefined();
    const m = ok(recordReview(r.state, WORKER, 'merged', makeCtx(9000)));
    expect(m.state.run.status).toBe('COMPLETED');
  });

  it('refuses Continue when nothing waits', () => {
    expect(refused(continueStages(ok(merged(BOTH)).state, makeCtx(11_000)))).toBe('run-not-active');
    const cancelled = ok(cancelRun(ok(merged(BOTH)).state, makeCtx(11_000))).state;
    expect(refused(continueStages(cancelled, makeCtx(12_000)))).toBe('run-cancelling');
  });

  it('refuses Continue while an agent is still live', () => {
    const s = { ...ok(merged(BOTH)).state, stagesHeld: true };
    expect(refused(continueStages(s, makeCtx(11_000)))).toBe('workers-still-running');
  });
});
