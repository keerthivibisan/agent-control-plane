import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOMATION, type ProjectAutomation } from '@acp/core';
import {
  ConflictResolutionDtoSchema,
  ConflictResolutionViewDtoSchema,
  TicketBranchReviewDtoSchema,
  type ConflictResolutionDto,
} from '@acp/core/api';
import { createReviewLoopRepositories } from '@acp/db';
import { expectError } from '../control/helpers.js';
import { git, head } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone, run, type Board } from './loop-helpers.js';

/*
 * ADR-0030 (CR-C) through the server: "Update target / Resolve conflicts" on a ticket branch whose
 * target moved. Synthetic repository, harness and agents (the fake managed adapter); real git.
 */

const SETUP = {
  projectKey: 'WEBAPP',
  maxConcurrentHelpers: 3,
  maxDepth: 1,
  defaultBudgetTokensPerAgent: 100_000,
  model: null,
  contextFiles: [],
};
const LEAD_REVIEWS = { reviewer: 'lead' } as const;
const NO_HARNESS = { 'README.md': 'x\n', 'src/app.ts': 'port = 1\n' };
/** The target's check, made stricter by the owner: it also needs owner.txt. */
const STRICTER_CHECK =
  "import { existsSync } from 'node:fs';\nprocess.exit(existsSync('fixed.txt') && existsSync('owner.txt') ? 0 : 1);\n";

async function setPolicy(s: Board, automation: ProjectAutomation) {
  const res = await s.send('put', `/api/projects/${s.project.id}/setup`, { ...SETUP, automation });
  expect(res.status).toBe(200);
}

/** A run at its final step: one helper's change (`files`) merged into the ticket branch. */
async function atFinalStep(s: Board, files: Record<string, string>) {
  const { ticket, runId, lead } = await approved(s, LEAD_REVIEWS);
  const worker = await helperDone(s, lead, runId, files);
  expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged');
  await lead.callLead('request_review', {});
  await s.settle();
  expect((await run(s, runId)).status).toBe('REVIEW');
  return { ticket, runId, lead };
}

/** The owner commits on main meanwhile (the target moves). */
function ownerCommits(s: Board, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) writeFileSync(join(s.repo, path), content);
  git(s.repo, 'add', '--all');
  git(s.repo, 'commit', '--quiet', '-m', 'owner work');
}

const url = (runId: string) => `/api/runs/${runId}/conflict-resolution`;

async function view(s: Board, runId: string) {
  await s.settle();
  return ConflictResolutionViewDtoSchema.parse((await s.get(url(runId))).body);
}

async function op(s: Board, runId: string): Promise<ConflictResolutionDto> {
  const v = await view(s, runId);
  if (v.operation === null) throw new Error('no operation');
  return v.operation;
}

async function startOp(s: Board, runId: string) {
  const res = await s.post(url(runId), {});
  expect(res.status).toBe(200);
  return ConflictResolutionDtoSchema.parse(res.body);
}

const resolvers = (s: Board) =>
  s.fake.workers().filter((w) => w.spec.prompt.startsWith('Resolve a merge conflict'));

/** The latest resolver writes `files` into its worktree, reports and finishes its turn. */
async function resolve(
  s: Board,
  runId: string,
  files: Record<string, string>,
  report?: { note: string; outcome?: string; assessment?: object },
) {
  await s.settle();
  const resolver = resolvers(s).at(-1);
  if (resolver === undefined) throw new Error('no resolver');
  resolver.started();
  await s.settle();
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(s.worktree(runId, resolver.id), path), content);
  }
  if (report !== undefined)
    expect(await resolver.callLead('report_work', report)).toContain('Noted');
  resolver.finish('success');
  await s.settle();
  return resolver;
}

const tip = (s: Board) => head(s.repo, 'refs/heads/acp/WEBAPP-1');

describe('update target: clean merges (ADR-0030)', () => {
  it('owner-triggered, clean: checks run on the candidate, then it is promoted', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId } = await atFinalStep(s, { 'a.txt': 'a\n', 'fixed.txt': 'ok\n' });
    const before = tip(s);
    ownerCommits(s, { 'NOTES.md': 'owner\n' });
    const v = await view(s, runId);
    expect(v.baseMoved).toBe(true);
    expect(v.startBlocked).toBeNull();
    expect(v.policy).toEqual(DEFAULT_AUTOMATION);
    const started = await startOp(s, runId);
    expect(started).toMatchObject({ trigger: 'owner', ticketCommit: before });
    const done = await op(s, runId);
    expect(done.state).toBe('completed');
    expect(done.resolution.status).toBe('clean');
    expect(done.verification).toMatchObject({
      status: 'passed',
      route: 'run-checks',
      checkIds: ['test'],
      checkedCommit: done.candidateCommit,
    });
    expect(done.review.status).toBe('pending-owner');
    expect(done.delivery.status).toBe('not-delegated');
    expect(tip(s)).toBe(done.candidateCommit);
    expect(git(s.repo, 'merge-base', '--is-ancestor', before, tip(s))).toBe('');
    // The owner's final merge needs nothing more: the checks passed on exactly this tip.
    const branch = `/api/runs/${runId}/ticket-branch`;
    const review = TicketBranchReviewDtoSchema.parse((await s.get(branch)).body);
    expect(review.baseMoved).toBe(false);
    expect((await s.post(branch, { action: 'merge' })).status).toBe(200);
    expect((await run(s, runId)).status).toBe('COMPLETED');
  }, 90_000);

  it('a docs-only change takes the approved skip path; nothing is shown as passed', async () => {
    const s = await setupBoard({ files: FILES });
    await setPolicy(s, {
      ...DEFAULT_AUTOMATION,
      verification: {
        ...DEFAULT_AUTOMATION.verification,
        mode: 'agent-adaptive',
        skipScopes: ['docs/**', '*.txt', '*.md'],
      },
    });
    const { runId } = await atFinalStep(s, { 'notes.txt': 'n\n', 'fixed.txt': 'ok\n' });
    git(s.repo, 'rm', '--quiet', 'check.mjs');
    ownerCommits(s, { 'NOTES.md': 'owner\n' });
    // The target update also removed a script: a runtime change, so checks are needed.
    await startOp(s, runId);
    const runtime = await op(s, runId);
    expect(runtime.verification.classification).toBe('runtime');
    expect(runtime.verification.outsideScope).toContain('check.mjs');
    expect(runtime.verification.status).not.toBe('skipped-by-policy');
  }, 90_000);

  it('prose only: skipped by policy; the owner merge is gated only by always-run checks', async () => {
    const s = await setupBoard({ files: FILES });
    await setPolicy(s, {
      ...DEFAULT_AUTOMATION,
      verification: {
        ...DEFAULT_AUTOMATION.verification,
        mode: 'agent-adaptive',
        skipScopes: ['*.txt', '*.md'],
      },
    });
    const { runId } = await atFinalStep(s, { 'notes.txt': 'n\n', 'fixed.txt': 'ok\n' });
    ownerCommits(s, { 'NOTES.md': 'owner\n' });
    await startOp(s, runId);
    const done = await op(s, runId);
    expect(done.verification).toMatchObject({
      status: 'skipped-by-policy',
      route: 'skipped-by-policy',
      classification: 'prose-only',
      checkIds: [],
      checkedCommit: null,
    });
    expect(done.verification.omitted.map((o) => o.id)).toEqual(['test']);
    expect(done.verification.matchedRule).toContain('skip-scope');
    expect(tip(s)).toBe(done.candidateCommit);
    // No check ever ran on the candidate.
    const review = TicketBranchReviewDtoSchema.parse(
      (await s.get(`/api/runs/${runId}/ticket-branch`)).body,
    );
    expect(review.checks.filter((c) => c.commit === done.candidateCommit)).toEqual([]);
    // The workflow's gate would start the required check and refuse (checks_running); the
    // current policy skip for exactly this tip lets the owner merge at once.
    expect((await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' })).status).toBe(
      200,
    );
    expect((await run(s, runId)).status).toBe('COMPLETED');
  }, 90_000);
});

describe('update target: conflicts (ADR-0030)', () => {
  it('a resolver repairs the conflict; the server seals and promotes it', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead } = await atFinalStep(s, { 'src/app.ts': 'ticket\n', 'fixed.txt': 'ok\n' });
    const before = tip(s);
    ownerCommits(s, { 'src/app.ts': 'owner\n' });
    const started = await startOp(s, runId);
    expect(started.state).toBe('resolving');
    expect(started.conflictFiles).toEqual(['src/app.ts']);
    // The resolver works in a worktree with the merge in progress.
    await s.settle();
    const resolver = resolvers(s)[0];
    if (resolver === undefined) throw new Error('no resolver');
    expect(resolver.spec.prompt).toContain('src/app.ts');
    const worktree = s.worktree(runId, resolver.id);
    expect(readFileSync(join(worktree, 'src/app.ts'), 'utf8')).toContain('<<<<<<<');
    // Nothing else may start meanwhile; the owner merge is blocked.
    expectError(await s.post(url(runId), {}), 409, 'resolution_unavailable');
    await resolve(
      s,
      runId,
      { 'src/app.ts': 'ticket and owner\n' },
      {
        note: 'Kept both lines.',
        assessment: {
          classification: 'runtime',
          recommendation: 'run-checks',
          proposedCheckIds: ['test'],
          reason: 'src changed',
        },
      },
    );
    const done = await op(s, runId);
    expect(done.state).toBe('completed');
    expect(done.resolution.status).toBe('resolved');
    expect(done.attempts.map((a) => a.outcome)).toEqual(['resolved']);
    expect(done.attempts[0]?.note).toBe('Kept both lines.');
    expect(done.verification).toMatchObject({
      status: 'passed',
      checkedCommit: done.candidateCommit,
    });
    expect(done.verification.assessment?.candidateCommit).toBe(done.candidateCommit);
    expect(git(s.repo, 'show', 'acp/WEBAPP-1:src/app.ts')).toBe('ticket and owner\n');
    expect(git(s.repo, 'merge-base', '--is-ancestor', before, tip(s))).toBe('');
    expect(git(s.repo, 'merge-base', '--is-ancestor', 'main', tip(s))).toBe('');
    // The resolver ended; its worktree is gone; the lead heard of it.
    const detail = await run(s, runId);
    expect(detail.agents.find((a) => a.id === resolver.id)?.status).toBe('SUCCEEDED');
    expect(lead.sent.some((m) => m.includes('Conflict resolver') && m.includes('resolved'))).toBe(
      true,
    );
    expect(git(s.repo, 'for-each-ref', 'refs/acp/').trim()).toBe('');
  }, 90_000);

  it('no-change and marker attempts count; the budget ends it with the reasons kept', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId } = await atFinalStep(s, { 'src/app.ts': 'ticket\n', 'fixed.txt': 'ok\n' });
    const before = tip(s);
    ownerCommits(s, { 'src/app.ts': 'owner\n' });
    await startOp(s, runId);
    await resolve(s, runId, {}, { note: 'Both sides own the port.', outcome: 'blocked' });
    expect(resolvers(s)).toHaveLength(2);
    // The second attempt's brief carries the first one's report.
    expect(resolvers(s)[1]?.spec.prompt).toContain('Both sides own the port.');
    await resolve(s, runId, {});
    const done = await op(s, runId);
    expect(done.state).toBe('failed');
    expect(done.resolution.status).toBe('failed');
    expect(done.attempts.map((a) => a.outcome)).toEqual(['blocked', 'markers-left']);
    expect(resolvers(s)).toHaveLength(2);
    expect(tip(s)).toBe(before);
    // The owner can start again later.
    expect((await view(s, runId)).startBlocked).toBeNull();
  }, 90_000);

  it('a required check failure with no attempt left waits for the owner', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId } = await atFinalStep(s, { 'src/app.ts': 'ticket\n', 'fixed.txt': 'ok\n' });
    ownerCommits(s, { 'src/app.ts': 'owner\n', 'check.mjs': STRICTER_CHECK });
    await startOp(s, runId);
    // Resolved, but the target's stricter check now also needs owner.txt: it fails.
    await resolve(s, runId, { 'src/app.ts': 'both\n' });
    await s.settle();
    const failed = await op(s, runId);
    expect(failed.attempts.map((a) => a.outcome)).toEqual(['resolved', 'checks-failed']);
    expect(failed.state).toBe('awaiting-owner');
    expect(failed.verification.status).toBe('failed');
    expect(failed.verification.failedChecks).toEqual(['test']);
    expect(tip(s)).not.toBe(failed.candidateCommit);
  }, 90_000);

  it('with budget left, a failed check starts another resolver with the failure', async () => {
    const s = await setupBoard({ files: FILES });
    await setPolicy(s, {
      ...DEFAULT_AUTOMATION,
      conflictResolution: { mode: 'manual', maxAttempts: 3, helper: null },
    });
    const { runId } = await atFinalStep(s, { 'src/app.ts': 'ticket\n', 'fixed.txt': 'ok\n' });
    ownerCommits(s, { 'src/app.ts': 'owner\n', 'check.mjs': STRICTER_CHECK });
    await startOp(s, runId);
    await resolve(s, runId, { 'src/app.ts': 'both\n' });
    await s.settle();
    expect(resolvers(s)).toHaveLength(2);
    expect(resolvers(s)[1]?.spec.prompt).toContain('failed these checks');
    await resolve(s, runId, { 'src/app.ts': 'both\n', 'owner.txt': 'ok\n' });
    const done = await op(s, runId);
    expect(done.state).toBe('completed');
    expect(done.attempts.map((a) => a.outcome)).toEqual(['resolved', 'checks-failed', 'resolved']);
    expect(done.verification.status).toBe('passed');
    expect(git(s.repo, 'show', 'acp/WEBAPP-1:owner.txt')).toBe('ok\n');
  }, 90_000);

  it('the target moving during resolution makes the evidence stale; nothing is promoted', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId } = await atFinalStep(s, { 'src/app.ts': 'ticket\n', 'fixed.txt': 'ok\n' });
    const before = tip(s);
    ownerCommits(s, { 'src/app.ts': 'owner\n' });
    await startOp(s, runId);
    ownerCommits(s, { 'MORE.md': 'again\n' });
    const mid = await op(s, runId);
    expect(mid.stale).toMatch(/target branch moved/);
    expect(mid.verification.status).toBe('stale');
    await resolve(s, runId, { 'src/app.ts': 'both\n' });
    const done = await op(s, runId);
    expect(done.state).toBe('failed');
    expect(done.resolution.reason).toMatch(/target branch moved/);
    expect(tip(s)).toBe(before);
  }, 90_000);

  it('cancel stops the resolver and keeps the ticket branch; a second cancel is refused', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId } = await atFinalStep(s, { 'src/app.ts': 'ticket\n', 'fixed.txt': 'ok\n' });
    const before = tip(s);
    ownerCommits(s, { 'src/app.ts': 'owner\n' });
    await startOp(s, runId);
    await s.settle();
    const resolver = resolvers(s)[0];
    resolver?.started();
    const cancelled = ConflictResolutionDtoSchema.parse(
      (await s.post(`${url(runId)}/cancel`, {})).body,
    );
    expect(cancelled.state).toBe('cancelled');
    await s.settle();
    expect(tip(s)).toBe(before);
    const detail = await run(s, runId);
    expect(detail.status).toBe('REVIEW');
    expect(detail.agents.find((a) => a.id === resolver?.id)?.status).toBe('CANCELLED');
    expect(detail.changes?.every((c) => c.state === 'merged')).toBe(true);
    expectError(await s.post(`${url(runId)}/cancel`, {}), 409, 'resolution_not_active');
    expect(resolvers(s)).toHaveLength(1);
  }, 90_000);
});

describe('missing harness and delegated delivery (ADR-0030)', () => {
  it('no harness: verification unavailable; it waits; the owner applies it with a reason', async () => {
    const s = await setupBoard({ files: NO_HARNESS });
    const { runId } = await atFinalStep(s, { 'a.ts': 'a\n' });
    const before = tip(s);
    ownerCommits(s, { 'b.ts': 'b\n' });
    await startOp(s, runId);
    const held = await op(s, runId);
    expect(held.state).toBe('awaiting-owner');
    expect(held.verification).toMatchObject({ status: 'unavailable', deliverAs: 'none' });
    expect(held.verification.reason).toMatch(/no harness file/);
    expect(tip(s)).toBe(before);
    expectError(await s.post(`${url(runId)}/promote`, {}), 400, 'reason_required');
    const applied = ConflictResolutionDtoSchema.parse(
      (await s.post(`${url(runId)}/promote`, { reason: 'Reviewed by hand. Synthetic.' })).body,
    );
    expect(applied.state).toBe('completed');
    expect(applied.review.status).toBe('owner-approved');
    expect(applied.verification.status).toBe('unavailable');
    expect(applied.delivery.status).toBe('not-delegated');
    expect(tip(s)).toBe(applied.candidateCommit);
  }, 90_000);

  it('explicit unverified delivery with a delegated local merge completes the ticket', async () => {
    const s = await setupBoard({ files: NO_HARNESS });
    await setPolicy(s, {
      conflictResolution: { mode: 'auto', maxAttempts: 2, helper: null },
      verification: { ...DEFAULT_AUTOMATION.verification, allowUnverifiedDelivery: true },
      delivery: { mode: 'merge', allowedTargets: ['main'] },
    });
    const { runId } = await atFinalStep(s, { 'a.ts': 'a\n' });
    ownerCommits(s, { 'b.ts': 'b\n' });
    // Automatic: opening the ticket branch finds the moved target and updates it.
    await s.get(`/api/runs/${runId}/ticket-branch`);
    await s.settle();
    const done = await op(s, runId);
    expect(done.trigger).toBe('auto');
    expect(done.verification.status).toBe('unverified-by-policy');
    expect(done.verification.reason).toMatch(/nothing was tested/);
    expect(done.review.status).toBe('not-required-by-policy');
    expect(done.delivery).toMatchObject({ status: 'merged', commit: done.candidateCommit });
    expect((await run(s, runId)).status).toBe('COMPLETED');
    expect(head(s.repo, 'refs/heads/main')).toBe(done.candidateCommit);
  }, 90_000);

  it('delivery to a target the policy does not allow is never automatic', async () => {
    const s = await setupBoard({ files: NO_HARNESS });
    await setPolicy(s, {
      conflictResolution: { mode: 'manual', maxAttempts: 2, helper: null },
      verification: { ...DEFAULT_AUTOMATION.verification, allowUnverifiedDelivery: true },
      delivery: { mode: 'merge', allowedTargets: ['release'] },
    });
    const { runId } = await atFinalStep(s, { 'a.ts': 'a\n' });
    ownerCommits(s, { 'b.ts': 'b\n' });
    await startOp(s, runId);
    const done = await op(s, runId);
    expect(done.state).toBe('completed');
    expect(done.delivery.status).toBe('not-delegated');
    expect((await run(s, runId)).status).toBe('REVIEW');
  }, 90_000);

  it('automatic start happens once per pinned target, never again after it is held', async () => {
    const s = await setupBoard({ files: NO_HARNESS });
    await setPolicy(s, {
      ...DEFAULT_AUTOMATION,
      conflictResolution: { mode: 'auto', maxAttempts: 2, helper: null },
    });
    const { runId } = await atFinalStep(s, { 'a.ts': 'a\n' });
    ownerCommits(s, { 'b.ts': 'b\n' });
    await view(s, runId);
    const held = await op(s, runId);
    expect(held.state).toBe('awaiting-owner');
    await s.post(`${url(runId)}/cancel`, {});
    await view(s, runId);
    await view(s, runId);
    const loop = createReviewLoopRepositories(s.db).conflictResolutions;
    expect(loop.latestForRun(runId)?.id).toBe(held.id);
  }, 90_000);
});

describe('restart (ADR-0030, ADR-0013 §7)', () => {
  it('an interrupted resolver is discarded, never merged; the operation is interrupted', async () => {
    const first = await setupBoard({ files: FILES });
    const { runId } = await atFinalStep(first, { 'src/app.ts': 'ticket\n', 'fixed.txt': 'ok\n' });
    const before = tip(first);
    ownerCommits(first, { 'src/app.ts': 'owner\n' });
    await startOp(first, runId);
    await first.settle();
    resolvers(first)[0]?.started();
    await first.settle();
    const reopen = { dbPath: first.dbPath, dataDir: first.dataDir, repo: first.repo };
    const second = await setupBoard({ files: FILES, reopen });
    expect(second.fake.agents).toEqual([]);
    const after = await op(second, runId);
    expect(after.state).toBe('interrupted');
    expect(after.resolution.reason).toMatch(/restart/);
    const detail = await run(second, runId);
    expect(detail.status).toBe('REVIEW');
    expect(detail.changes?.some((c) => c.state === 'needs-owner')).toBe(false);
    expect(tip(second)).toBe(before);
    // The owner can start again; nothing restarted by itself.
    expect((await view(second, runId)).startBlocked).toBeNull();
    expect(second.fake.workers()).toEqual([]);
  }, 90_000);

  it('a delivery under way at a restart becomes unknown and is never retried', async () => {
    const first = await setupBoard({ files: FILES });
    const { runId } = await atFinalStep(first, { 'a.txt': 'a\n', 'fixed.txt': 'ok\n' });
    ownerCommits(first, { 'NOTES.md': 'owner\n' });
    await startOp(first, runId);
    const done = await op(first, runId);
    const repo = createReviewLoopRepositories(first.db).conflictResolutions;
    // As if the process stopped between recording the push and its result.
    const { stale: _, ...record } = done;
    repo.update(
      {
        ...record,
        state: 'delivering',
        finishedAt: null,
        delivery: { status: 'pushing', reason: null, commit: done.candidateCommit, draft: false },
      },
      'completed',
    );
    const reopen = { dbPath: first.dbPath, dataDir: first.dataDir, repo: first.repo };
    const second = await setupBoard({ files: FILES, reopen });
    const after = await op(second, runId);
    expect(after.state).toBe('interrupted');
    expect(after.delivery.status).toBe('unknown');
    expect(after.delivery.reason).toMatch(/Refresh/);
  }, 90_000);
});
