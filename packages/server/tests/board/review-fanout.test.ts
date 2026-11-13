import { describe, expect, it } from 'vitest';
import type { WorkflowGraphV3 } from '@acp/core';
import { createRunStore } from '../../src/control/store.js';
import { agentV3, arrowV3, projectMode, putGraph, templateV3, withV3 } from './graph-helpers.js';
import { BOARD_NOW, setupBoard } from './helpers.js';
import { FILES, approved, helperDone, reviewers, run } from './loop-helpers.js';

/*
 * A review fan-out's rounds in the database and on the run detail (ADR-0037 §5, ADR-0021 §3).
 * The AR-6 real run stored one `change_reviews` row per round: the second reviewer's verdict and
 * findings overwrote the first one's row. Each reviewer now has its own row of the round, with its
 * own verdict and findings comment; the lead's decision is recorded once, on a row of its own.
 * The fake managed adapter plays every agent. Synthetic data only.
 */

/** The lead-only template with the pool's change going to two change reviewers. */
function fanOutGraph(): WorkflowGraphV3 {
  const base = templateV3('lead-only');
  const g: WorkflowGraphV3 = {
    ...base,
    edges: base.edges.filter((e) => !(e.type === 'review' && e.to === 'orchestrate')),
  };
  return withV3(
    g,
    [agentV3('review', 'Claude review'), agentV3('review-2', 'Codex review')],
    [
      arrowV3('review', 'helpers', 'review'),
      arrowV3('review', 'helpers', 'review-2'),
      arrowV3('findings', 'review', 'orchestrate'),
      arrowV3('findings', 'review-2', 'orchestrate'),
    ],
  );
}

describe('review fan-out rounds (ADR-0037 §5)', () => {
  it('stores one row per reviewer with its own verdict and findings, and the decision once', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'auto-edits');
    await putGraph(s, fanOutGraph());
    const { ticket, runId, lead } = await approved(s);
    const worker = await helperDone(s, lead, runId, { 'fixed.txt': 'ok\n' });
    const [first, second] = reviewers(s);
    if (first === undefined || second === undefined) throw new Error('two reviewers expected');
    first.started();
    second.started();
    await s.settle();
    await first.callLead('submit_review', { verdict: 'approve', findings: 'Fine. Synthetic.' });
    await second.callLead('submit_review', {
      verdict: 'rework',
      findings: 'Empty case. Synthetic.',
    });
    await s.settle();

    // The lead's view lists each reviewer's verdict (by its block's label).
    const view = await lead.callLead('view_change', { agentId: worker.id });
    const verdicts = view.split('\n').filter((l) => l.startsWith('Review agent '));
    expect(verdicts).toHaveLength(2);
    expect(verdicts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Review agent (Claude|Codex) review: verdict approve\.$/),
        expect.stringMatching(/^Review agent (Claude|Codex) review: verdict rework\.$/),
      ]),
    );
    expect(new Set(verdicts.map((l) => l.split(':')[0])).size).toBe(2);

    await lead.callLead('request_rework', { agentId: worker.id, comments: 'Handle it.' });
    const detail = await run(s, runId);
    const reviews = detail.changes?.find((c) => c.agentRunId === worker.id)?.reviews ?? [];
    const comments = (await s.detail(ticket.id)).comments;
    const bodyOf = (id: string | null) => comments.find((c) => c.id === id)?.body;
    expect(reviews).toHaveLength(3);
    // The reviewers' rows come in start order (the fake adapter's launch order may differ), then
    // the decision's row.
    const a = reviews.find((r) => r.reviewerAgentRunId === first.id);
    const b = reviews.find((r) => r.reviewerAgentRunId === second.id);
    const decision = reviews[2];
    expect(a).toMatchObject({
      round: 0,
      reviewer: 'agent',
      reviewerAgentRunId: first.id,
      verdict: 'approve',
      decision: null,
    });
    expect(b).toMatchObject({
      round: 0,
      reviewer: 'agent',
      reviewerAgentRunId: second.id,
      verdict: 'rework',
      decision: null,
    });
    expect(bodyOf(a?.commentId ?? null)).toBe('Fine. Synthetic.');
    expect(bodyOf(b?.commentId ?? null)).toBe('Empty case. Synthetic.');
    expect(decision).toMatchObject({
      round: 0,
      reviewer: 'lead',
      reviewerAgentRunId: null,
      verdict: null,
      decision: 'rework',
      decidedBy: 'lead',
    });
    expect(bodyOf(decision?.commentId ?? null)).toBe('Handle it.');
    // The rows in the database are the same three.
    const rows = createRunStore({
      db: s.db,
      now: () => BOARD_NOW,
    }).loopRepos.changeReviews.listForAgentRun(worker.id);
    expect(rows.map((r) => [r.reviewerAgentRunId, r.verdict, r.decision]).slice(0, 2)).toEqual(
      expect.arrayContaining([
        [first.id, 'approve', null],
        [second.id, 'rework', null],
      ]),
    );
    expect(rows.map((r) => r.id)).toEqual(reviews.map((r) => r.id));
    expect(rows[2]).toMatchObject({ reviewerAgentRunId: null, verdict: null, decision: 'rework' });
  });
});
