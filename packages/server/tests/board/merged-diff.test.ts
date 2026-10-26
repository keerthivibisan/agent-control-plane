import { describe, expect, it } from 'vitest';
import { ReviewDtoSchema, TicketBranchReviewDtoSchema } from '@acp/core/api';
import { createGitRunner } from '../../src/workspace/git.js';
import { createWorkspaceManager } from '../../src/workspace/manager.js';
import { GIT_TEST_ENV, git, head, makeRepo, tempDir, write } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone, reviewers, type Board } from './loop-helpers.js';

/*
 * ADR-0026 §5 (C-A): after the owner's merge, "Files changed" stays readable from the recorded
 * commits (the ticket branch base → tip, and each merged change's start → sealed head); when git
 * no longer has them, the ticket branch answers 410 `diff_unavailable`. Diffs are never stored.
 * Synthetic repositories only.
 */

async function mergedTicket(s: Board) {
  const { ticket, runId, lead } = await approved(s);
  const worker = await helperDone(s, lead, runId, { 'fixed.txt': 'ok\n', 'theme.ts': 'x;\n' });
  const reviewer = reviewers(s).at(-1);
  if (reviewer === undefined) throw new Error('no change reviewer');
  reviewer.started();
  await s.settle();
  await reviewer.callLead('submit_review', { verdict: 'approve', findings: 'Fine.' });
  reviewer.finish('success');
  await s.settle();
  expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged');
  await s.settle();
  await lead.callLead('request_review', {});
  await s.settle();
  expect((await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' })).status).toBe(200);
  await s.settle();
  return { ticket, runId, worker };
}

describe('Files changed after the merge (ADR-0026 §5)', () => {
  it('serves the ticket branch and each change from the recorded commits, then 410', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, worker } = await mergedTicket(s);

    const branch = await s.get(`/api/runs/${runId}/ticket-branch`);
    expect(branch.status).toBe(200);
    const dto = TicketBranchReviewDtoSchema.parse(branch.body);
    expect(dto.ticketBranch.state).toBe('merged');
    expect(dto.files.map((f) => f.path).sort()).toEqual(['fixed.txt', 'theme.ts']);
    expect(dto.diff).toContain('+x;');
    expect(dto.baseMoved).toBe(false);

    // The helper's worktree is gone; its change still shows.
    const review = ReviewDtoSchema.parse((await s.get(`/api/runs/${runId}/review`)).body);
    const change = review.agents.find((a) => a.agentRunId === worker.id);
    expect(change?.files.map((f) => f.path).sort()).toEqual(['fixed.txt', 'theme.ts']);

    // Commits git no longer has: a clear "no longer available".
    s.db.connection
      .prepare('UPDATE ticket_branches SET head_commit = ? WHERE run_id = ?')
      .run('f'.repeat(40), runId);
    const gone = await s.get(`/api/runs/${runId}/ticket-branch`);
    expect(gone.status).toBe(410);
    expect((gone.body as { error: { code: string } }).error.code).toBe('diff_unavailable');
  }, 90_000);
});

describe('diffCommits (ADR-0026 §5)', () => {
  it('diffs two recorded commits, and answers null for one git does not have', async () => {
    const repo = makeRepo({ 'README.md': 'hello\n' });
    const base = head(repo);
    write(repo, 'a.txt', 'a\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'a');
    const tip = head(repo);
    const manager = createWorkspaceManager({
      dataDir: tempDir(),
      git: createGitRunner({ env: GIT_TEST_ENV }),
    });
    const changes = await manager.diffCommits(repo, base, tip);
    expect(changes?.files).toEqual([
      { path: 'a.txt', status: 'added', additions: 1, deletions: 0 },
    ]);
    expect(await manager.diffCommits(repo, base, 'e'.repeat(40))).toBeNull();
    await expect(manager.diffCommits(repo, base, 'HEAD')).rejects.toThrow('full commit id');
  });
});
