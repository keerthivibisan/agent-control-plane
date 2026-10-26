import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TicketBranchReviewDtoSchema } from '@acp/core/api';
import request from 'supertest';
import { HELPER_BRANCH_CHANGED } from '../../src/control/review-loop.js';
import { expectError } from '../control/helpers.js';
import { git, head } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, run, type Board } from './loop-helpers.js';

/*
 * F-1 (incident ACPGIT-3, 2026-10-24), end to end through the routes with the fake adapter and a
 * throwaway repository: a helper switches its folder to the ticket branch and commits there. The
 * seal fails clearly, the lead discards the change and starts a fresh helper (no loop), and the
 * owner sees that the ticket branch changed outside the app and resets it to the last reviewed
 * commit. Synthetic data only.
 */

const BRANCH = 'acp/WEBAPP-1';

/** The lead's helper does what the incident's helper did, then finishes. */
async function helperCommitsOnTicketBranch(s: Board, runId: string) {
  const lead = s.fake.lead();
  expect(await lead.callLead('start_agent', { role: 'Builder', task: 'Brand it' })).toContain(
    'Started agent',
  );
  await s.settle();
  const worker = s.fake.workers().at(-1);
  if (worker === undefined) throw new Error('no worker');
  worker.started();
  await s.settle();
  const wt = s.worktree(runId, worker.id);
  git(wt, 'checkout', '--quiet', BRANCH);
  writeFileSync(join(wt, 'brand.css'), 'body { color: teal; }\n');
  git(wt, 'add', 'brand.css');
  git(wt, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '--quiet', '-m', 'brand');
  worker.finish('success');
  await s.settle();
  return worker;
}

describe('a helper that switched its folder to the ticket branch (F-1)', () => {
  it('fails clearly, the lead discards it and starts a fresh helper; the owner resets the branch', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    const base = head(s.repo);
    const worker = await helperCommitsOnTicketBranch(s, runId);
    const moved = head(s.repo, `refs/heads/${BRANCH}`);
    expect(moved).not.toBe(base);

    // The helper's spec carried the branch rule (the adapter adds the hook; the fake does not).
    expect(worker.spec.prompt).toContain('The app owns branches and commits.');

    // The seal refused it: the change waits for the lead with no commit, no reviewer started.
    let detail = await run(s, runId);
    const change = detail.changes?.find((c) => c.agentRunId === worker.id);
    expect(change).toMatchObject({ state: 'decision', headCommit: null });
    expect(s.fake.agents.filter((a) => a.spec.kind === 'reviewer')).toHaveLength(0);
    expect(lead.sent.some((t) => t.includes('switched its folder to another branch'))).toBe(true);
    const comments = (await s.detail(ticket.id)).comments;
    expect(comments.some((c) => c.author === 'app' && c.body.includes(HELPER_BRANCH_CHANGED))).toBe(
      true,
    );
    // Its folder no longer holds the ticket branch; no ref moved for that.
    expect(git(s.repo, 'worktree', 'list', '--porcelain')).not.toContain(
      `branch refs/heads/${BRANCH}`,
    );
    expect(head(s.repo, `refs/heads/${BRANCH}`)).toBe(moved);

    // Merge is refused; the lead discards it (not owner-only) and starts a fresh helper.
    await expect(lead.callLead('merge_change', { agentId: worker.id })).rejects.toThrow(
      'switched its folder to another branch',
    );
    const discard = await lead.callLead('discard_change', {
      agentId: worker.id,
      reason: 'Its folder left its branch.',
    });
    expect(discard).toContain('Discarded');
    detail = await run(s, runId);
    expect(detail.changes?.find((c) => c.agentRunId === worker.id)?.state).toBe('discarded');
    expect(existsWorktree(s, runId, worker.id)).toBe(false);
    // Only the helper's own branch went; the ticket branch is still where the helper left it.
    expect(head(s.repo, `refs/heads/${BRANCH}`)).toBe(moved);
    expect(await lead.callLead('start_agent', { role: 'Builder', task: 'Brand it' })).toContain(
      'Started agent',
    );
    await s.settle();

    // The owner's final step shows the branch was changed outside the app.
    const tb = TicketBranchReviewDtoSchema.parse(
      (await s.get(`/api/runs/${runId}/ticket-branch`)).body,
    );
    expect(tb.ticketBranch.headCommit).toBe(base);
    expect(tb.ticketBranch.movedOutside).toEqual({ tip: moved });

    // Reset: CSRF only, compare-and-swap from the tip the owner saw.
    expectError(
      await request(s.app).post(`/api/runs/${runId}/ticket-branch/reset`).send({ from: moved }),
      403,
      'csrf_missing',
    );
    expectError(
      await s.post(`/api/runs/${runId}/ticket-branch/reset`, { from: base }),
      409,
      'ticket_branch_not_moved',
    );
    const bad = await s.post(`/api/runs/${runId}/ticket-branch/reset`, { from: 'nope' });
    expect(bad.status).toBe(400);
    const main = head(s.repo, 'refs/heads/main');
    const reset = await s.post(`/api/runs/${runId}/ticket-branch/reset`, { from: moved });
    expect(reset.status).toBe(200);
    const after = TicketBranchReviewDtoSchema.parse(reset.body);
    expect(after.ticketBranch.movedOutside).toBeUndefined();
    expect(head(s.repo, `refs/heads/${BRANCH}`)).toBe(base);
    expect(head(s.repo, 'refs/heads/main')).toBe(main);
    const lines = (await s.detail(ticket.id)).comments.filter((c) => c.author === 'app');
    expect(lines.some((c) => c.body.includes(`${BRANCH} was reset to ${base.slice(0, 7)}`))).toBe(
      true,
    );
  });
});

function existsWorktree(s: Board, runId: string, agentId: string): boolean {
  return git(s.repo, 'worktree', 'list', '--porcelain').includes(s.worktree(runId, agentId));
}
