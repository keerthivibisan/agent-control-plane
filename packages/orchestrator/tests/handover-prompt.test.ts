import { describe, expect, it } from 'vitest';
import {
  agentEvent,
  decideApproval,
  recordChangeDecision,
  requestTicketChanges,
} from '../src/index.js';
import type { EngineResult, RunState } from '../src/index.js';
import { LEAD, event, makeCtx, ok, runningRun, startWorker, statusOf, tokens } from './helpers.js';
import {
  A,
  BRANCH,
  RA,
  finishTurn,
  helper,
  inDecision,
  leadMessages,
  leadTool,
  loopRunning,
  mergedA,
  sealed,
} from './loop-helpers.js';
import { workflow } from './workflow-helpers.js';

/**
 * RL-F: the lead is told once to hand over when every change is decided and nothing but the lead
 * works (the consented real run of 2026-10-17 showed a lead waiting for the run timeout).
 * Synthetic data only.
 */

const PROMPT = 'Every change is decided';
const finished = { type: 'finished', outcome: 'success', reportedCostUsd: null } as const;

function prompts(result: Extract<EngineResult<unknown>, { ok: true }>): string[] {
  return leadMessages(result.effects).filter((t) => t.startsWith(PROMPT));
}

/** Helper `id` finishes its turn and the server finds nothing to save: `no-changes`. */
function noChanges(state: RunState, id: string, offset: number) {
  const s = ok(finishTurn(state, id, 'success', offset)).state;
  return ok(sealed(s, id, `nc-${id}`, false, null, offset + 50));
}

describe('the hand-over prompt', () => {
  it('is sent once when the last change is decided', () => {
    let s = inDecision();
    s = ok(finishTurn(s, RA, 'success', 5500)).state;
    const merge = ok(leadTool(s, 'merge_change', { agentId: A }, 'm'));
    expect(prompts(merge)).toEqual([]);
    const decided = ok(
      recordChangeDecision(
        merge.state,
        A,
        { decision: 'merge', by: 'lead', outcome: 'merged', headCommit: 'def5678' },
        makeCtx(7000, 'md'),
      ),
    );
    expect(prompts(decided)).toEqual([
      `${PROMPT} (1 merged into ${BRANCH}, 0 discarded, 0 with no changes) and no helper is working. Hand over with request_review (with your summary), or start helpers with start_agent for work that is still missing.`,
    ]);
    expect(decided.state.handoverPrompted).toBe(true);
    // Later commands at the same idle point do not repeat it.
    const again = ok(leadTool(decided.state, 'list_agents', {}, 'la'));
    expect(prompts(again)).toEqual([]);
    const activity = ok(event(again.state, LEAD, { type: 'activity', summary: 'Thinking' }, 8000));
    expect(prompts(activity)).toEqual([]);
  });

  it('says plainly that nothing was merged when every helper had no changes', () => {
    let s = loopRunning();
    s = helper(helper(helper(s, 'Slug', 'wa'), 'CLI', 'wb'), 'Tests', 'wc');
    const first = noChanges(s, 'wa-1', 4000);
    expect(prompts(first)).toEqual([]);
    const second = noChanges(first.state, 'wb-1', 4200);
    expect(prompts(second)).toEqual([]);
    const last = noChanges(second.state, 'wc-1', 4400);
    const [text] = prompts(last);
    expect(prompts(last)).toHaveLength(1);
    expect(text).toContain(`(0 merged into ${BRANCH}, 0 discarded, 3 with no changes)`);
    expect(text).toContain(`Nothing was merged, so ${BRANCH} has none of the ticket's work yet.`);
    expect(text).toContain('or hand over the empty branch with request_review');
  });

  it('counts discarded changes and is not sent while a review agent still works', () => {
    let s = inDecision();
    // The review agent sent its verdict but has not ended yet.
    const discard = ok(leadTool(s, 'discard_change', { agentId: A, reason: 'Wrong.' }, 'dc'));
    expect(statusOf(discard.state, RA)).not.toBe('SUCCEEDED');
    expect(prompts(discard)).toEqual([]);
    s = discard.state;
    const reviewerDone = ok(agentEvent(s, RA, finished, makeCtx(6000)));
    expect(prompts(reviewerDone)).toEqual([
      `${PROMPT} (0 merged into ${BRANCH}, 1 discarded, 0 with no changes) and no helper is working. Nothing was merged, so ${BRANCH} has none of the ticket's work yet. Start helpers with start_agent for the work that is still missing, or hand over the empty branch with request_review (with your summary).`,
    ]);
  });

  it('is not sent while a helper works or a change is undecided', () => {
    let s = helper(helper(loopRunning(), 'Slug', 'wa'), 'CLI', 'wb');
    const first = noChanges(s, 'wa-1', 4000);
    expect(prompts(first)).toEqual([]);
    expect(first.state.handoverPrompted).toBeUndefined();
    // B finishes with a change: undecided while it is reviewed.
    s = ok(finishTurn(first.state, 'wb-1', 'success', 4500)).state;
    const ready = ok(sealed(s, 'wb-1', 'rv', true));
    expect(prompts(ready)).toEqual([]);
  });

  it('is sent again only after new helper work', () => {
    const s = mergedA();
    expect(s.handoverPrompted).toBe(true);
    const started = ok(leadTool(s, 'start_agent', { role: 'Docs', task: 'Write docs' }, 'wd'));
    expect(started.state.handoverPrompted).toBeUndefined();
    let t = ok(
      event(started.state, 'wd-1', { type: 'started', providerSessionId: 's-wd', model: null }),
    ).state;
    const done = noChanges(t, 'wd-1', 8000);
    expect(prompts(done)).toHaveLength(1);
    expect(prompts(done)[0]).toContain(`(1 merged into ${BRANCH}, 0 discarded, 1 with no changes)`);
    t = done.state;
    expect(prompts(ok(leadTool(t, 'list_agents', {}, 'la')))).toEqual([]);
  });

  it('waits while the lead is BLOCKED and is sent when it can read again', () => {
    let s = inDecision({ budget: 100 });
    s = ok(finishTurn(s, RA, 'success', 5500)).state;
    s = ok(leadTool(s, 'merge_change', { agentId: A }, 'm')).state;
    s = ok(event(s, LEAD, { type: 'usage', messageId: 'l1', tokens: tokens(200) }, 6000)).state;
    expect(statusOf(s, LEAD)).toBe('BLOCKED');
    const decided = ok(
      recordChangeDecision(
        s,
        A,
        { decision: 'merge', by: 'lead', outcome: 'merged' },
        makeCtx(7000, 'md'),
      ),
    );
    expect(prompts(decided)).toEqual([]);
    expect(decided.state.handoverPrompted).toBeUndefined();
    const budget = decided.state.approvals.find((a) => a.kind === 'budget-raise');
    if (budget === undefined) throw new Error('no budget approval');
    const raised = ok(
      decideApproval(decided.state, budget.id, 'approve', makeCtx(8000), { newLimit: 1000 }),
    );
    expect(prompts(raised)).toHaveLength(1);
    expect(raised.state.handoverPrompted).toBe(true);
  });

  it('is never sent after the handover, nor right after the owner asks for changes', () => {
    // With final stages: the reviewer and the tester run after the handover; no prompt.
    let s = mergedA({ workflow: workflow({ codeReview: true, unitTests: false }) });
    const handover = ok(leadTool(s, 'request_review', {}, 'h'));
    expect(prompts(handover)).toEqual([]);
    const reviewed = ok(agentEvent(handover.state, 'h-1', finished, makeCtx(9000)));
    expect(prompts(reviewed)).toEqual([]);
    expect(reviewed.state.run.status).toBe('REVIEW');

    // The owner asks for changes: the owner's message is enough; no prompt with it.
    const changes = ok(requestTicketChanges(reviewed.state, 'Add a README.', makeCtx(10_000)));
    expect(changes.state.run.status).toBe('RUNNING');
    expect(leadMessages(changes.effects)).toHaveLength(1);
    expect(prompts(changes)).toEqual([]);
    expect(prompts(ok(leadTool(changes.state, 'list_agents', {}, 'la', LEAD, 10_100)))).toEqual([]);

    // New helper work re-arms it.
    s = helper(changes.state, 'Docs', 'wd');
    expect(prompts(noChanges(s, 'wd-1', 11_000))).toHaveLength(1);
  });

  it('is not part of legacy runs', () => {
    const { state, id } = startWorker(runningRun());
    const r = ok(agentEvent(state, id, finished, makeCtx(4000)));
    expect(prompts(r)).toEqual([]);
    expect(r.state.handoverPrompted).toBeUndefined();
  });
});
