import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultProjectWorkflow } from '@acp/core';
import { RunDetailDtoSchema, TicketBranchReviewDtoSchema } from '@acp/core/api';
import { createReviewLoopRepositories } from '@acp/db';
import { expectError } from '../control/helpers.js';
import { git, head } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone, reviewers, run, type Board } from './loop-helpers.js';

/*
 * More of the review loop (ADR-0021, RL-B): approval modes in the gate, a conflict, a failed check
 * the owner merges past, the owner's ticket-branch actions, a restart, and a failed ticket branch.
 * Synthetic repository, checks and agents (the fake managed adapter).
 */

const SETUP = {
  projectKey: 'WEBAPP',
  maxConcurrentHelpers: 3,
  maxDepth: 1,
  defaultBudgetTokensPerAgent: 100_000,
  model: null,
  allowlist: { editInOwnWorktree: false, runHarnessChecks: false },
  contextFiles: [],
};

/** Polls the run until `count` approvals are recorded (an ask resolves after the gate's reads). */
async function approvalsOf(s: Board, runId: string, count: number) {
  for (let i = 0; i < 100; i++) {
    const approvals = (await run(s, runId)).approvals;
    if (approvals.length >= count) return approvals;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`expected ${count} approvals`);
}

/** The lead reviews changes itself (no review agent), so tests decide at once. */
const LEAD_REVIEWS = { reviewer: 'lead' } as const;

async function toTicketReview(s: Board, files: Record<string, string>) {
  const { ticket, runId, lead } = await approved(s, LEAD_REVIEWS);
  const worker = await helperDone(s, lead, runId, files);
  const merged = await lead.callLead('merge_change', { agentId: worker.id });
  expect(merged).toContain('Merged');
  await lead.callLead('request_review', {});
  await s.settle();
  expect((await run(s, runId)).status).toBe('REVIEW');
  return { ticket, runId, lead, worker };
}

describe('approval modes in the gate (ADR-0021 §1)', () => {
  it('auto-edits allows own-worktree edits and exact checks, records the rule; others ask', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead } = await approved(s, LEAD_REVIEWS);
    await lead.callLead('start_agent', { role: 'Builder', task: 'Build it' });
    await s.settle();
    const worker = s.fake.workers()[0];
    if (worker === undefined) throw new Error('no worker');
    worker.started();
    await s.settle();
    const wt = s.worktree(runId, worker.id);
    const SECRET = 'SECRET-INPUT-1234';
    expect(
      await worker.ask('Edit', 'Edit a.ts', { file_path: join(wt, 'a.ts'), new_string: SECRET }),
    ).toEqual({ allow: true });
    expect(await worker.ask('Bash', 'Bash node', { command: 'node check.mjs' })).toEqual({
      allow: true,
    });
    // Not covered: an edit under .git, and any other command, ask the owner.
    void worker.ask('Edit', 'Edit .git/config', { file_path: join(wt, '.git', 'config') });
    void worker.ask('Bash', 'Bash npm', { command: 'npm test' });
    const approvals = await approvalsOf(s, runId, 4);
    const detail = await run(s, runId);
    expect(approvals.map((a) => [a.status, a.decidedBy, a.allowRule ?? null])).toEqual([
      ['approved', 'allowlist', 'edit-in-own-worktree'],
      ['approved', 'allowlist', 'run-harness-check'],
      ['pending', null, null],
      ['pending', null, null],
    ]);
    const rules = createReviewLoopRepositories(s.db).approvalRules.forRun(runId);
    expect([...rules.values()]).toEqual(['edit-in-own-worktree', 'run-harness-check', null, null]);
    expect(JSON.stringify(detail)).not.toContain(SECRET);
  }, 60_000);

  it('manual asks for everything; auto adds the command allowlist (whole-command match)', async () => {
    const s = await setupBoard({ files: FILES });
    const url = `/api/projects/${s.project.id}/setup`;
    const approvals = { mode: 'auto', commands: [{ argv: ['npm'], match: 'prefix' }] };
    expect((await s.send('put', url, { ...SETUP, approvals })).status).toBe(200);

    // A per-run override to manual wins over the project's auto.
    const manual = await approved(s, { ...LEAD_REVIEWS, approvalMode: 'manual' });
    expect((await run(s, manual.runId)).approvalMode).toBe('manual');
    await manual.lead.callLead('start_agent', { role: 'Builder', task: 'Build it' });
    await s.settle();
    const w1 = s.fake.workers()[0];
    if (w1 === undefined) throw new Error('no worker');
    w1.started();
    await s.settle();
    void w1.ask('Edit', 'Edit a.ts', { file_path: join(s.worktree(manual.runId, w1.id), 'a.ts') });
    void w1.ask('Bash', 'Bash node', { command: 'node check.mjs' });
    const asked = await approvalsOf(s, manual.runId, 2);
    expect(asked.map((a) => a.status)).toEqual(['pending', 'pending']);
    // Stop it so the next ticket's run can start.
    await s.post(`/api/runs/${manual.runId}/stop`);
    await s.settle();

    const auto = await approved(s, LEAD_REVIEWS);
    expect((await run(s, auto.runId)).approvalMode).toBe('auto');
    await auto.lead.callLead('start_agent', { role: 'Builder', task: 'Build it' });
    await s.settle();
    const w2 = s.fake.workers().at(-1);
    if (w2 === undefined) throw new Error('no worker');
    w2.started();
    await s.settle();
    expect(await w2.ask('Bash', 'Bash npm', { command: 'npm run build' })).toEqual({ allow: true });
    void w2.ask('Bash', 'Bash npm', { command: 'npm test; rm -rf /' });
    void w2.ask('Bash', 'Bash npm', { command: 'npm test', run_in_background: true });
    const listed = await approvalsOf(s, auto.runId, 3);
    expect(listed.map((a) => [a.status, a.allowRule ?? null])).toEqual([
      ['approved', 'command-allowlist'],
      ['pending', null],
      ['pending', null],
    ]);
  }, 60_000);
});

describe('blocked merges (ADR-0021 §3)', () => {
  it('a conflict with the ticket branch is refused with the file names', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead } = await approved(s, LEAD_REVIEWS);
    const a = await helperDone(s, lead, runId, { 'README.md': 'one\n', 'fixed.txt': 'ok\n' }, 'A');
    const b = await helperDone(s, lead, runId, { 'README.md': 'two\n', 'fixed.txt': 'ok\n' }, 'B');
    expect(await lead.callLead('merge_change', { agentId: a.id })).toContain('Merged A');
    const reply = await lead.callLead('merge_change', { agentId: b.id });
    expect(reply).toContain('conflicts with acp/WEBAPP-1 in: README.md');
    const card = (await run(s, runId)).changes?.find((c) => c.agentRunId === b.id);
    expect(card).toMatchObject({ state: 'reviewing', conflictFiles: ['README.md'] });
    // Nothing of B reached the ticket branch.
    expect(git(s.repo, 'show', 'acp/WEBAPP-1:README.md')).toBe('one\n');
  }, 60_000);

  it('a failed required check blocks the lead; the owner merges anyway with a reason', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s, LEAD_REVIEWS);
    const worker = await helperDone(s, lead, runId, { 'src/x.ts': 'export {};\n' });
    const card = (await run(s, runId)).changes?.[0];
    expect(card?.checks).toMatchObject([{ status: 'failed' }]);
    // "Run checks" on a loop change runs them again on its sealed commit.
    const again = await s.post(`/api/runs/${runId}/agents/${worker.id}/checks`);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject([{ status: 'failed', commit: card?.headCommit }]);
    await expect(lead.callLead('merge_change', { agentId: worker.id })).rejects.toThrow(
      /required check failed/,
    );
    await lead.callLead('ask_owner', { agentId: worker.id, question: 'Merge anyway? Synthetic.' });
    const url = `/api/runs/${runId}/review`;
    expectError(
      await s.post(url, { agentRunId: worker.id, action: 'merge' }),
      409,
      'checks_failed',
    );
    const res = await s.post(url, {
      agentRunId: worker.id,
      action: 'merge-anyway',
      reason: 'Known flaky. Synthetic.',
    });
    expect(res.status).toBe(200);
    const detail = await run(s, runId);
    expect(detail.changes?.[0]).toMatchObject({ state: 'merged' });
    expect(detail.changes?.[0]?.reviews.at(-1)).toMatchObject({
      decision: 'merge-anyway',
      decidedBy: 'owner',
    });
    expect(lead.sent.some((m) => m.includes('The owner decided'))).toBe(true);
    const comments = (await s.detail(ticket.id)).comments;
    expect(comments.some((c) => c.author === 'owner' && c.body.includes('Known flaky.'))).toBe(
      true,
    );
  }, 60_000);
});

describe("the owner's ticket-branch actions (ADR-0021 §4)", () => {
  it('request changes reopens the run; a moved main is updated from base, then merged', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await toTicketReview(s, {
      'src/theme.ts': 'dark\n',
      'fixed.txt': 'ok\n',
    });
    const url = `/api/runs/${runId}/ticket-branch`;
    expectError(await s.post(url, { action: 'request-changes' }), 400, 'invalid_request');
    const changes = await s.post(url, {
      action: 'request-changes',
      comment: 'Also add a light theme. Synthetic.',
    });
    expect(changes.status).toBe(200);
    expect((await run(s, runId)).status).toBe('RUNNING');
    expect(lead.sent.at(-1)).toContain('Also add a light theme.');
    expect((await s.detail(ticket.id)).comments.at(-1)).toMatchObject({ author: 'owner' });
    await lead.callLead('request_review', {});
    expect((await run(s, runId)).status).toBe('REVIEW');

    // The owner commits on main meanwhile: the branch no longer fast-forwards.
    writeFileSync(join(s.repo, 'NOTES.md'), 'owner\n');
    git(s.repo, 'add', '--all');
    git(s.repo, 'commit', '--quiet', '-m', 'owner work');
    const moved = TicketBranchReviewDtoSchema.parse((await s.get(url)).body);
    expect(moved.baseMoved).toBe(true);
    expectError(await s.post(url, { action: 'merge' }), 409, 'base_moved');
    const updated = TicketBranchReviewDtoSchema.parse(
      (await s.post(url, { action: 'update-from-base' })).body,
    );
    expect(updated.baseMoved).toBe(false);
    expect(updated.files.map((f) => f.path).sort()).toEqual(['fixed.txt', 'src/theme.ts']);
    await s.settle();
    // The merged result's checks ran again on the new tip before the owner's merge.
    const tip = updated.ticketBranch.headCommit;
    const again = TicketBranchReviewDtoSchema.parse((await s.get(url)).body);
    expect(again.checks).toMatchObject([{ status: 'passed', commit: tip }]);
    expect((await s.post(url, { action: 'merge' })).status).toBe(200);
    expect(head(s.repo)).toBe(tip);
    expect((await run(s, runId)).status).toBe('COMPLETED');
  }, 60_000);

  it('discard deletes the ticket branch (only it) and completes the run', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId } = await toTicketReview(s, { 'a.txt': 'a\n', 'fixed.txt': 'ok\n' });
    git(s.repo, 'branch', 'acp/OTHER-1');
    const res = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'discard' });
    expect(res.status).toBe(200);
    expect(TicketBranchReviewDtoSchema.parse(res.body).ticketBranch.state).toBe('discarded');
    expect(git(s.repo, 'branch', '--list', 'acp/WEBAPP-1').trim()).toBe('');
    expect(git(s.repo, 'branch', '--list', 'acp/OTHER-1').trim()).not.toBe('');
    expect((await run(s, runId)).status).toBe('COMPLETED');
    expectError(
      await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' }),
      409,
      'run_not_active',
    );
  }, 60_000);

  it('a legacy run has no ticket branch and no rework', async () => {
    const s = await setupBoard({ files: FILES, legacyRuns: true });
    const { runId } = await approved(s);
    const detail = RunDetailDtoSchema.parse((await s.get(`/api/runs/${runId}`)).body);
    expect(detail.approvalMode).toBeUndefined();
    expect(detail.ticketBranch).toBeUndefined();
    expect(detail.changes).toBeUndefined();
    expect(detail.reviewer).toBeUndefined();
    expect(detail.maxReworkRounds).toBeUndefined();
    expectError(await s.get(`/api/runs/${runId}/ticket-branch`), 404, 'no_ticket_branch');
  }, 60_000);
});

describe('restart and failures (ADR-0021 §5)', () => {
  it('a restart puts an undecided change with the owner; the owner merges it', async () => {
    const first = await setupBoard({ files: FILES });
    const { runId, lead } = await approved(first, LEAD_REVIEWS);
    const worker = await helperDone(first, lead, runId, { 'a.txt': 'a\n', 'fixed.txt': 'ok\n' });
    const reopen = { dbPath: first.dbPath, dataDir: first.dataDir, repo: first.repo };
    const second = await setupBoard({ files: FILES, reopen });
    expect(second.fake.agents).toEqual([]);
    const detail = await run(second, runId);
    expect(detail.status).toBe('NEEDS_REVIEW');
    expect(detail.ticketBranch?.state).toBe('open');
    expect(detail.changes?.[0]).toMatchObject({ state: 'needs-owner', reworkRounds: 0 });
    expect(detail.agents.find((a) => a.id === worker.id)?.status).toBe('NEEDS_REVIEW');
    const res = await second.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'merge',
    });
    expect(res.status).toBe(200);
    expect((await run(second, runId)).changes?.[0]?.state).toBe('merged');
    expect(git(second.repo, 'show', 'acp/WEBAPP-1:a.txt')).toBe('a\n');
  }, 60_000);

  it('a ticket branch that cannot be made stops the run', async () => {
    const s = await setupBoard({ files: FILES });
    // The owner's checkout is detached: there is no base branch to start from.
    git(s.repo, 'checkout', '--quiet', '--detach');
    const ticket = await s.createTicket('Detached');
    await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
    await s.post(`/api/tickets/${ticket.id}/start`, LEAD_REVIEWS);
    await s.settle();
    s.fake.lead().started();
    await s.settle();
    await s.submitPlan();
    const plan = (await s.detail(ticket.id)).plans[0];
    await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
      decision: 'approve',
    });
    await s.settle();
    const status = (await s.detail(ticket.id)).currentRun?.status;
    expect(['CANCELLING', 'CANCELLED']).toContain(status);
    expect(s.control.counters().diagnostics['ticket-branch-failed']).toBe(1);
    expect(reviewers(s)).toEqual([]);
  }, 60_000);
});

describe('final stages on the ticket branch (ADR-0021 §5)', () => {
  it('the final reviewer reads the tip; the tester starts from it and goes through the loop', async () => {
    const s = await setupBoard({ files: FILES });
    const st = defaultProjectWorkflow('x', '2026-10-17T09:00:00.000Z').stages;
    st['code-review'] = { ...st['code-review'], enabled: true };
    st['unit-tests'] = { ...st['unit-tests'], enabled: true };
    const saved = await s.send('put', `/api/projects/${s.project.id}/workflow`, {
      plannerMode: 'lead',
      stages: st,
    });
    expect(saved.status).toBe(200);
    const { ticket, runId, lead } = await approved(s, LEAD_REVIEWS);
    const worker = await helperDone(s, lead, runId, { 'a.txt': 'a\n', 'fixed.txt': 'ok\n' });
    await lead.callLead('merge_change', { agentId: worker.id });
    const tip = head(s.repo, 'refs/heads/acp/WEBAPP-1');
    await lead.callLead('request_review', {});
    await s.settle();
    // The lead stays live; the final reviewer reads a detached checkout of the tip.
    let detail = await run(s, runId);
    expect(detail.status).toBe('RUNNING');
    const finalReviewer = reviewers(s)[0];
    if (finalReviewer === undefined) throw new Error('no final reviewer');
    expect(finalReviewer.spec.reviewScope).toBe('final');
    expect(git(finalReviewer.spec.cwd, 'rev-parse', 'HEAD').trim()).toBe(tip);
    finalReviewer.started();
    await finalReviewer.callLead('post_review', { text: 'Final finding. Synthetic.' });
    finalReviewer.finish('success');
    await s.settle();
    // The tester's worktree starts from the tip; its change is reviewed and merged too.
    const tester = s.fake.agents.find((a) => a.spec.kind === 'tester');
    if (tester === undefined) throw new Error('no tester');
    expect(git(tester.spec.cwd, 'rev-parse', 'HEAD').trim()).toBe(tip);
    tester.started();
    await s.settle();
    writeFileSync(join(s.worktree(runId, tester.id), 'a.test.txt'), 'test\n');
    tester.finish('success');
    await s.settle();
    expect(await lead.callLead('merge_change', { agentId: tester.id })).toContain('Merged');
    detail = await run(s, runId);
    expect(detail.status).toBe('REVIEW');
    expect(git(s.repo, 'show', 'acp/WEBAPP-1:a.test.txt')).toBe('test\n');
    const comments = (await s.detail(ticket.id)).comments;
    expect(comments.some((c) => c.author === 'reviewer' && c.body.includes('Final finding.'))).toBe(
      true,
    );
  }, 60_000);
});

describe('findings and notes on one round (RL-V)', () => {
  it('a review agent’s findings and the lead’s rework note are both linked from the round', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    const worker = await helperDone(s, lead, runId, {
      'src/x.ts': 'export {};\n',
      'fixed.txt': 'ok\n',
    });
    const reviewer = reviewers(s)[0];
    if (reviewer === undefined) throw new Error('no change reviewer');
    reviewer.started();
    await s.settle();
    await reviewer.callLead('submit_review', {
      verdict: 'rework',
      findings: 'Name the export. Synthetic finding.',
    });
    reviewer.finish('success');
    await s.settle();
    await lead.callLead('request_rework', {
      agentId: worker.id,
      comments: 'Rename x to y. Synthetic note.',
    });
    const reviews = (await run(s, runId)).changes?.[0]?.reviews ?? [];
    const comments = (await s.detail(ticket.id)).comments;
    const body = (id: string | null) => comments.find((c) => c.id === id)?.body;
    expect(reviews.map((r) => [r.round, r.reviewer, r.verdict, r.decision, r.decidedBy])).toEqual([
      [0, 'agent', 'rework', 'rework', 'lead'],
      [0, 'lead', null, 'rework', 'lead'],
    ]);
    expect(body(reviews[0]?.commentId ?? null)).toContain('Synthetic finding.');
    expect(body(reviews[1]?.commentId ?? null)).toContain('Synthetic note.');
  }, 60_000);

  it('the lead’s question keeps its own row; the owner’s decision gets the next one', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    const worker = await helperDone(s, lead, runId, {
      'src/x.ts': 'export {};\n',
      'fixed.txt': 'ok\n',
    });
    const reviewer = reviewers(s)[0];
    if (reviewer === undefined) throw new Error('no change reviewer');
    reviewer.started();
    await s.settle();
    await reviewer.callLead('submit_review', { verdict: 'approve', findings: 'Fine. Synthetic.' });
    reviewer.finish('success');
    await s.settle();
    await lead.callLead('ask_owner', { agentId: worker.id, question: 'Ship it? Synthetic.' });
    await s.settle();
    const decided = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'discard',
    });
    expect(decided.status).toBe(200);
    const reviews = (await run(s, runId)).changes?.[0]?.reviews ?? [];
    const comments = (await s.detail(ticket.id)).comments;
    expect(reviews.map((r) => [r.reviewer, r.verdict, r.decision, r.decidedBy])).toEqual([
      ['agent', 'approve', 'ask-owner', 'lead'],
      ['lead', null, 'ask-owner', 'lead'],
      ['owner', null, 'discard', 'owner'],
    ]);
    expect(comments.find((c) => c.id === reviews[1]?.commentId)?.body).toContain('Ship it?');
  }, 60_000);
});
