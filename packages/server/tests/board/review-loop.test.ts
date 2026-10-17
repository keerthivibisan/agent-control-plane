import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RunWorkflowDtoSchema,
  TicketBranchReviewDtoSchema,
  TicketDetailDtoSchema,
} from '@acp/core/api';
import request from 'supertest';
import { expectError } from '../control/helpers.js';
import { git, head } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone, reviewers, run } from './loop-helpers.js';

/*
 * The review loop end to end through the routes (ADR-0021 §1–§4, RL-B): plan approval makes the
 * ticket branch; helpers start from its tip; a finished helper's change is sealed, reviewed by a
 * read-only review agent and decided by the lead (merge into the ticket branch, rework, discard,
 * ask the owner); the owner merges the ticket branch into main once. The fake managed adapter
 * plays every agent; checks are tiny node scripts; git runs in a throwaway repository.
 */

describe('the review loop (ADR-0021 §3)', () => {
  it('ticket branch at approval; seal, review agent, lead merge; owner merges once → Done', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    const base = head(s.repo);

    // Plan approval made acp/<KEY> at the base tip; nothing in the owner's checkout moved.
    let detail = await run(s, runId);
    expect(detail.approvalMode).toBe('auto-edits');
    expect(detail.ticketBranch).toMatchObject({
      branch: 'acp/WEBAPP-1',
      baseBranch: 'main',
      baseCommit: base,
      headCommit: base,
      state: 'open',
    });
    expect(head(s.repo, 'refs/heads/acp/WEBAPP-1')).toBe(base);

    const worker = await helperDone(s, lead, runId, {
      'src/theme.ts': 'export const dark = true;\n',
      'fixed.txt': 'ok\n',
    });
    // The helper started from the ticket branch tip, in its own worktree.
    const ws = await s.control.agentWorkspace(runId, worker.id);
    expect(ws?.baseBranch).toBe('acp/WEBAPP-1');
    detail = await run(s, runId);
    const change = detail.changes?.find((c) => c.agentRunId === worker.id);
    expect(change).toMatchObject({ state: 'reviewing', reworkRounds: 0, changedFiles: 2 });
    expect(detail.agents.find((a) => a.id === worker.id)?.status).toBe('AWAITING_REVIEW');
    const sealed = change?.headCommit ?? '';
    expect(sealed).toMatch(/^[0-9a-f]{40}$/);
    // The sealed commit's checks ran on that commit, in the helper's worktree.
    expect(change?.checks).toMatchObject([{ status: 'passed', commit: sealed }]);

    // A read-only review agent reviews a detached checkout of the sealed commit; its brief holds
    // the diff (sent to it, never stored).
    const reviewer = reviewers(s)[0];
    if (reviewer === undefined) throw new Error('no change reviewer');
    expect(reviewer.spec.reviewScope).toBe('change');
    expect(reviewer.spec.cwd).not.toBe(ws?.cwd);
    expect(readFileSync(join(reviewer.spec.cwd, 'src', 'theme.ts'), 'utf8')).toContain('dark');
    expect(git(reviewer.spec.cwd, 'rev-parse', 'HEAD').trim()).toBe(sealed);
    expect(reviewer.spec.prompt).toContain('+export const dark = true;');
    reviewer.started();
    await s.settle();
    await reviewer.callLead('submit_review', {
      verdict: 'approve',
      findings: 'Looks fine. Synthetic finding.',
    });
    reviewer.finish('success');
    await s.settle();

    // The lead sees the change with its diff, then merges it into the ticket branch.
    const view = await lead.callLead('view_change', { agentId: worker.id });
    expect(view).toContain('Diff:');
    expect(view).toContain('+export const dark = true;');
    const merged = await lead.callLead('merge_change', { agentId: worker.id });
    expect(merged).toContain('Merged Builder into acp/WEBAPP-1');
    detail = await run(s, runId);
    expect(detail.changes?.find((c) => c.agentRunId === worker.id)).toMatchObject({
      state: 'merged',
      reviews: [
        {
          round: 0,
          reviewer: 'agent',
          verdict: 'approve',
          decision: 'merge',
          decidedBy: 'lead',
        },
      ],
    });
    const comments = (await s.detail(ticket.id)).comments;
    const findings = comments.find((c) => c.author === 'reviewer');
    expect(findings?.body).toContain('Synthetic finding.');
    expect(detail.changes?.[0]?.reviews[0]?.commentId).toBe(findings?.id);
    expect(head(s.repo, 'refs/heads/acp/WEBAPP-1')).toBe(sealed);
    // main is untouched until the owner's merge, and the worktree was released.
    expect(head(s.repo)).toBe(base);
    expect(existsSync(s.worktree(runId, worker.id))).toBe(false);

    // RL-F: every change is decided and nothing else works, so the lead is told once, through
    // the server, to hand over.
    await s.settle();
    expect(lead.sent.filter((t) => t.startsWith('Every change is decided'))).toEqual([
      expect.stringContaining('(1 merged into acp/WEBAPP-1, 0 discarded, 0 with no changes)'),
    ]);

    // Hand over: no code-review or unit-tests stage in the default workflow → REVIEW.
    expect(await lead.callLead('request_review', {})).toBeTruthy();
    detail = await run(s, runId);
    expect(detail.status).toBe('REVIEW');
    expect(detail.agents.find((a) => a.kind === 'lead')?.status).toBe('RUNNING');
    const wf = RunWorkflowDtoSchema.parse((await s.get(`/api/runs/${runId}/workflow`)).body);
    expect(wf.review).toMatchObject({ merged: 1, waiting: 0, inReview: 0, reworkRounds: 0 });

    // The owner's single merge: the combined change base...tip and the tip's own checks.
    const tb = TicketBranchReviewDtoSchema.parse(
      (await s.get(`/api/runs/${runId}/ticket-branch`)).body,
    );
    expect(tb.files.map((f) => f.path).sort()).toEqual(['fixed.txt', 'src/theme.ts']);
    expect(tb.baseMoved).toBe(false);
    expect(tb.checks).toMatchObject([{ status: 'passed', agentRunId: null, commit: sealed }]);
    expectError(
      await request(s.app).post(`/api/runs/${runId}/ticket-branch`).send({ action: 'merge' }),
      403,
      'csrf_missing',
    );
    const done = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
    expect(done.status).toBe(200);
    expect(TicketBranchReviewDtoSchema.parse(done.body).ticketBranch).toMatchObject({
      state: 'merged',
      mergedCommit: sealed,
    });
    expect(head(s.repo)).toBe(sealed);
    expect(readFileSync(join(s.repo, 'src', 'theme.ts'), 'utf8')).toContain('dark');
    expect(git(s.repo, 'branch', '--list', 'acp/WEBAPP-1').trim()).toBe('');
    const after = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticket.id}`)).body);
    expect(after.currentRun?.status).toBe('COMPLETED');
    expect(after.ticket).toMatchObject({ status: 'DONE', stage: 'DONE' });
  }, 60_000);

  it('rework resumes the same helper in its own worktree; discard and ask-owner are recorded', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s, { reviewer: 'lead', maxReworkRounds: 1 });
    // RL-V: the run's snapshotted reviewer and rework limit are in its detail.
    expect(await run(s, runId)).toMatchObject({
      approvalMode: 'auto-edits',
      reviewer: 'lead',
      maxReworkRounds: 1,
    });
    const worker = await helperDone(s, lead, runId, { 'a.txt': 'first\n', 'fixed.txt': 'ok\n' });
    // Reviewer "lead": the lead reviews itself; no review agent starts.
    expect(reviewers(s)).toEqual([]);
    expect(lead.sent.some((m) => m.includes('is ready for your review'))).toBe(true);

    const reply = await lead.callLead('request_rework', {
      agentId: worker.id,
      comments: 'Rename a.txt to b.txt. Synthetic comment.',
    });
    expect(reply).toContain('round 1');
    await s.settle();
    const again = s.fake.byId(worker.id);
    expect(again).not.toBe(worker);
    expect(again.spec.rework).toEqual({ resumeSessionId: `sess-${worker.id}` });
    expect(again.spec.cwd).toBe(worker.spec.cwd);
    expect(again.spec.canStartHelpers).toBeUndefined();
    expect(again.spec.prompt).toContain('Rename a.txt to b.txt.');
    again.started(`sess-${worker.id}`);
    writeFileSync(join(s.worktree(runId, worker.id), 'b.txt'), 'second\n');
    again.finish('success');
    await s.settle();
    // The round limit (1) is used up: the lead may not ask again.
    await expect(
      lead.callLead('request_rework', { agentId: worker.id, comments: 'Again.' }),
    ).rejects.toThrow(/rework rounds/);
    await lead.callLead('ask_owner', { agentId: worker.id, question: 'Keep b.txt? Synthetic.' });
    let detail = await run(s, runId);
    expect(detail.changes?.[0]).toMatchObject({ state: 'needs-owner', reworkRounds: 1 });

    // The owner may grant another round past the limit; then discards the result.
    const owner = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'rework',
      comment: 'Also drop a.txt. Synthetic.',
    });
    expect(owner.status).toBe(200);
    await s.settle();
    const third = s.fake.byId(worker.id);
    third.started(`sess-${worker.id}`);
    third.finish('success');
    await s.settle();
    await lead.callLead('discard_change', { agentId: worker.id, reason: 'Not needed. Synthetic.' });
    detail = await run(s, runId);
    const change = detail.changes?.[0];
    expect(change).toMatchObject({ state: 'discarded', reworkRounds: 2 });
    // Each decision is a row; the owner's decision on a round the lead passed on is its own row.
    expect(change?.reviews.map((r) => [r.round, r.reviewer, r.decision, r.decidedBy])).toEqual([
      [0, 'lead', 'rework', 'lead'],
      [1, 'lead', 'ask-owner', 'lead'],
      [1, 'owner', 'rework', 'owner'],
      [2, 'lead', 'discard', 'lead'],
    ]);
    expect(existsSync(s.worktree(runId, worker.id))).toBe(false);
    const notes = (await s.detail(ticket.id)).comments.map((c) => [c.author, c.body]);
    expect(notes).toEqual(
      expect.arrayContaining([
        ['lead', 'Rename a.txt to b.txt. Synthetic comment.'],
        ['lead', 'Keep b.txt? Synthetic.'],
        ['owner', 'Also drop a.txt. Synthetic.'],
        ['lead', 'Not needed. Synthetic.'],
      ]),
    );
    expect(head(s.repo, 'refs/heads/acp/WEBAPP-1')).toBe(head(s.repo));
  }, 60_000);
});
