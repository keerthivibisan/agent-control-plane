// Real throwaway git repositories (ADR-0021 §4, RL-B). Names, files and commits are synthetic.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReviewCheckouts } from '../../src/control/review-checkouts.js';
import {
  WorkspaceError,
  createWorkspaceManager,
  type WorkspaceErrorCode,
} from '../../src/workspace/index.js';
import { git, head, makeRepo, spyingGit, tempDir, write } from './helpers.js';

/** Real git in temp repos; slow on a loaded machine, so more than the 5 s default. */
const GIT_TIMEOUT_MS = 30_000;
const RUN = '3f1c2a9e-0b4d-4c55-9b0e-5a7d2f1e8c01';
const A1 = 'b7e4d2a1-6c3f-4e8a-9d10-2f5b7c9e0a12';
const A2 = 'c8f5e3b2-7d40-4f9b-8e21-3a6c8d0f1b23';

function setup() {
  const dataDir = tempDir('acp-tb-data-');
  const spy = spyingGit();
  const manager = createWorkspaceManager({ dataDir, git: spy.git });
  return { dataDir, manager, calls: spy.calls };
}

async function refusal(promise: Promise<unknown>): Promise<WorkspaceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WorkspaceError) return error;
    throw error;
  }
  throw new Error('expected a WorkspaceError');
}

async function code(promise: Promise<unknown>): Promise<WorkspaceErrorCode> {
  return (await refusal(promise)).code;
}

const branches = (repo: string) =>
  git(repo, 'branch', '--format=%(refname:short)').trim().split('\n').sort();

describe('createTicketBranch', { timeout: GIT_TIMEOUT_MS }, () => {
  it('creates acp/<KEY> at the base tip without touching the owner checkout', async () => {
    const { manager, calls } = setup();
    const repo = makeRepo();
    const base = head(repo);
    const created = await manager.createTicketBranch(repo, 'WEB-12');
    expect(created).toEqual({ branch: 'acp/WEB-12', baseBranch: 'main', baseCommit: base });
    expect(head(repo, 'refs/heads/acp/WEB-12')).toBe(base);
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
    // Argument arrays only, with the safety config, never a shell.
    for (const call of calls) {
      expect(call.file).toBe('git');
      expect(call.options.shell).toBe(false);
      expect((call.args as string[]).slice(0, 2)).toEqual(['-c', 'core.hooksPath=/dev/null']);
    }
    expect(calls.some((c) => (c.args as string[]).includes('--no-track'))).toBe(true);
  });

  it('takes acp/<KEY>-r<n> when the name exists in git or is taken by an open record', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    git(repo, 'branch', 'acp/WEB-12');
    const second = await manager.createTicketBranch(repo, 'WEB-12');
    expect(second.branch).toBe('acp/WEB-12-r1');
    const third = await manager.createTicketBranch(repo, 'WEB-12', (b) => b === 'acp/WEB-12-r2');
    expect(third.branch).toBe('acp/WEB-12-r3');
  });

  it('refuses a key that gives no valid name, and a detached project', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    for (const bad of ['web-12', 'WEB-0', '../x', 'WEB-1 --force', '-D']) {
      expect(await code(manager.createTicketBranch(repo, bad)), bad).toBe('invalid-ticket-branch');
    }
    git(repo, 'checkout', '--quiet', '--detach');
    expect(await code(manager.createTicketBranch(repo, 'WEB-1'))).toBe('detached-head');
  });
});

/** A repo with a ticket branch and two helpers working from its tip. */
async function loopSetup(files: Record<string, string> = { 'README.md': 'hello\n' }) {
  const s = setup();
  const repo = makeRepo(files);
  const tb = await s.manager.createTicketBranch(repo, 'WEB-1');
  const ref = { projectRoot: repo, branch: tb.branch, baseBranch: tb.baseBranch, runId: RUN };
  const from = { branch: tb.branch, commit: tb.baseCommit };
  const w1 = await s.manager.create(repo, RUN, A1, { from });
  const w2 = await s.manager.create(repo, RUN, A2, { from });
  return { ...s, repo, tb, ref, w1, w2 };
}

describe(
  'the review loop on the ticket branch (seal, integrate, advance)',
  { timeout: GIT_TIMEOUT_MS },
  () => {
    it('starts helpers from the tip, seals, integrates and moves the branch by CAS', async () => {
      const { manager, repo, tb, ref, w1, w2 } = await loopSetup();
      expect(w1.baseBranch).toBe('acp/WEB-1');
      expect(w1.baseCommit).toBe(tb.baseCommit);
      write(w1.path, 'one.txt', '1\n');
      write(w2.path, 'two.txt', '2\n');

      const sealed = await manager.seal(w1, { role: 'API builder' });
      expect(sealed).toMatchObject({ changed: true, changedFiles: 1 });
      expect(git(w1.path, 'log', '-1', '--format=%an%n%s')).toContain('Agent Control Plane');

      const first = await manager.integrate(w1, tb.baseCommit);
      // The tip is the start: nothing to merge, the sealed commit itself is the result.
      expect(first).toEqual({ outcome: 'integrated', commit: sealed.headCommit });
      await manager.advanceTicketBranch(ref, tb.baseCommit, first.commit);
      expect(head(repo, 'refs/heads/acp/WEB-1')).toBe(first.commit);

      // The second helper started from the old tip: integration merges the new tip in.
      await manager.seal(w2);
      const second = await manager.integrate(w2, first.commit);
      expect(second.outcome).toBe('integrated');
      expect(
        git(w2.path, 'show', '--quiet', '--format=%P', second.commit).trim().split(' '),
      ).toHaveLength(2);
      expect(readFileSync(join(w2.path, 'one.txt'), 'utf8')).toBe('1\n');
      await manager.advanceTicketBranch(ref, first.commit, second.commit);
      expect(git(repo, 'ls-tree', '--name-only', 'acp/WEB-1').trim().split('\n').sort()).toEqual([
        'README.md',
        'one.txt',
        'two.txt',
      ]);
      // The owner's checkout never moved.
      expect(head(repo)).toBe(tb.baseCommit);
      expect(git(repo, 'status', '--porcelain')).toBe('');
    });

    it('reports an empty change as no-changes at seal and at integration', async () => {
      const { manager, tb, w1, w2 } = await loopSetup();
      expect(await manager.seal(w1)).toMatchObject({ changed: false, changedFiles: 0 });
      expect(await manager.integrate(w1, tb.baseCommit)).toEqual({
        outcome: 'no-changes',
        commit: tb.baseCommit,
      });
      // A change identical to what the tip already has is no change either.
      write(w2.path, 'README.md', 'hello\n');
      expect((await manager.seal(w2)).changed).toBe(false);
    });

    it('a conflict is aborted and refused with the file names only', async () => {
      const { manager, ref, tb, w1, w2 } = await loopSetup();
      write(w1.path, 'README.md', 'one\n');
      write(w2.path, 'README.md', 'two\n');
      await manager.seal(w1);
      const first = await manager.integrate(w1, tb.baseCommit);
      await manager.advanceTicketBranch(ref, tb.baseCommit, first.commit);
      const sealed = await manager.seal(w2);
      const error = await refusal(manager.integrate(w2, first.commit));
      expect(error.code).toBe('merge-conflict');
      expect(error.conflictFiles).toEqual(['README.md']);
      expect(error.message).not.toContain('one');
      // Aborted: the helper's branch and tree are as sealed.
      expect(head(w2.path)).toBe(sealed.headCommit);
      expect(git(w2.path, 'status', '--porcelain')).toBe('');
      expect(readFileSync(join(w2.path, 'README.md'), 'utf8')).toBe('two\n');
    });

    it('refuses to integrate unsealed edits', async () => {
      const { manager, tb, w1 } = await loopSetup();
      write(w1.path, 'x.txt', 'x\n');
      expect(await code(manager.integrate(w1, tb.baseCommit))).toBe('workspace-unsealed');
    });

    it('advance refuses a stale tip, a non-fast-forward and a checked-out branch', async () => {
      const { manager, repo, ref, tb, w1, w2 } = await loopSetup();
      write(w1.path, 'a.txt', 'a\n');
      write(w2.path, 'b.txt', 'b\n');
      const s1 = await manager.seal(w1);
      const s2 = await manager.seal(w2);
      await manager.advanceTicketBranch(ref, tb.baseCommit, s1.headCommit);
      // Expected tip no longer matches: compare-and-swap refuses.
      expect(await code(manager.advanceTicketBranch(ref, tb.baseCommit, s2.headCommit))).toBe(
        'ticket-branch-moved',
      );
      // s2 does not contain s1: the move would drop a merged change.
      expect(await code(manager.advanceTicketBranch(ref, s1.headCommit, s2.headCommit))).toBe(
        'not-fast-forward',
      );
      const wt = join(tempDir('acp-tb-co-'), 'co');
      git(repo, 'worktree', 'add', '--quiet', wt, 'acp/WEB-1');
      write(w1.path, 'c.txt', 'c\n');
      const s3 = await manager.seal(w1);
      expect(await code(manager.advanceTicketBranch(ref, s1.headCommit, s3.headCommit))).toBe(
        'ticket-branch-checked-out',
      );
      expect(head(repo, 'refs/heads/acp/WEB-1')).toBe(s1.headCommit);
      expect(
        await code(
          manager.advanceTicketBranch({ ...ref, branch: 'main' }, s1.headCommit, s3.headCommit),
        ),
      ).toBe('invalid-ticket-branch');
      expect(await code(manager.advanceTicketBranch(ref, 'HEAD', s3.headCommit))).toBe(
        'invalid-ticket-branch',
      );
    });

    it('changeDiff shows only what the change adds to the tip', async () => {
      const { manager, ref, tb, w1, w2 } = await loopSetup();
      write(w1.path, 'one.txt', '1\n');
      write(w2.path, 'two.txt', '2\n');
      await manager.seal(w1);
      const first = await manager.integrate(w1, tb.baseCommit);
      await manager.advanceTicketBranch(ref, tb.baseCommit, first.commit);
      await manager.seal(w2);
      const view = await manager.changeDiff(w2, first.commit, { maxDiffBytes: 32 * 1024 });
      expect(view.files.map((f) => f.path)).toEqual(['two.txt']);
      expect(view.diff).toContain('+2');
      expect(view.diffTruncated).toBe(false);
    });
  },
);

describe("the owner's final merge", { timeout: GIT_TIMEOUT_MS }, () => {
  async function merged() {
    const s = await loopSetup();
    write(s.w1.path, 'one.txt', '1\n');
    await s.manager.seal(s.w1);
    const done = await s.manager.integrate(s.w1, s.tb.baseCommit);
    await s.manager.advanceTicketBranch(s.ref, s.tb.baseCommit, done.commit);
    return { ...s, tip: done.commit };
  }

  it('reviews base...tip, then fast-forwards the clean base and deletes the branch', async () => {
    const { manager, repo, ref, tip, tb } = await merged();
    const review = await manager.reviewTicketBranch(ref);
    expect(review).toMatchObject({ tip, baseHead: tb.baseCommit, baseMoved: false });
    expect(review.files.map((f) => f.path)).toEqual(['one.txt']);
    const result = await manager.mergeTicketBranch(ref, tip);
    expect(result).toEqual({
      commit: tip,
      previousBaseCommit: tb.baseCommit,
      branchDeleted: true,
      movedCheckout: true,
    });
    expect(head(repo)).toBe(tip);
    expect(readFileSync(join(repo, 'one.txt'), 'utf8')).toBe('1\n');
    expect(branches(repo)).not.toContain('acp/WEB-1');
  });

  it('refuses a dirty tree on the target, a moved tip and a moved base', async () => {
    const { manager, repo, ref, tip } = await merged();
    write(repo, 'README.md', 'dirty\n');
    expect(await code(manager.mergeTicketBranch(ref, tip))).toBe('base-dirty');
    git(repo, 'checkout', '--quiet', '--', 'README.md');
    // ADR-0025: another checked-out branch no longer refuses the merge; branching.test.ts covers
    // the compare-and-swap of a target that is not checked out.
    expect(await code(manager.mergeTicketBranch(ref, 'f'.repeat(40)))).toBe('ticket-branch-moved');
    write(repo, 'main.txt', 'm\n');
    git(repo, 'add', '--all');
    git(repo, 'commit', '--quiet', '-m', 'main moved');
    expect((await manager.reviewTicketBranch(ref)).baseMoved).toBe(true);
    expect(await code(manager.mergeTicketBranch(ref, tip))).toBe('base-moved');
    // Nothing changed in the owner's tree.
    expect(existsSync(join(repo, 'one.txt'))).toBe(false);
  });

  it('update from base merges main into the tip in a temporary checkout, then merges', async () => {
    const { dataDir, manager, repo, ref, tip } = await merged();
    write(repo, 'main.txt', 'm\n');
    git(repo, 'add', '--all');
    git(repo, 'commit', '--quiet', '-m', 'main moved');
    const mainHead = head(repo);
    const updated = await manager.updateTicketFromBase(ref, tip);
    expect(updated.baseHead).toBe(mainHead);
    expect(head(repo, 'refs/heads/acp/WEB-1')).toBe(updated.headCommit);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(head(repo)).toBe(mainHead);
    // The temporary checkout is gone.
    expect(readdirSync(join(dataDir, 'ticket-checkouts'))).toEqual([]);
    const review = await manager.reviewTicketBranch(ref);
    expect(review.baseMoved).toBe(false);
    expect(review.files.map((f) => f.path)).toEqual(['one.txt']);
    expect((await manager.mergeTicketBranch(ref, updated.headCommit)).commit).toBe(
      updated.headCommit,
    );
  });

  it('update from base refuses a conflict and leaves the branch where it was', async () => {
    const { manager, repo, ref, tip } = await merged();
    write(repo, 'one.txt', 'other\n');
    git(repo, 'add', '--all');
    git(repo, 'commit', '--quiet', '-m', 'conflicting');
    const error = await refusal(manager.updateTicketFromBase(ref, tip));
    expect(error.code).toBe('merge-conflict');
    expect(error.conflictFiles).toEqual(['one.txt']);
    expect(head(repo, 'refs/heads/acp/WEB-1')).toBe(tip);
  });

  it('discard deletes only the named ticket branch; a missing one is fine', async () => {
    const { manager, repo, ref } = await merged();
    git(repo, 'branch', 'acp/OTHER-1');
    await manager.discardTicketBranch(ref);
    expect(branches(repo)).not.toContain('acp/WEB-1');
    expect(branches(repo)).toContain('acp/OTHER-1');
    await manager.discardTicketBranch(ref);
    expect(await code(manager.discardTicketBranch({ ...ref, branch: 'main' }))).toBe(
      'invalid-ticket-branch',
    );
  });
});

describe(
  'temporary commit checkouts (checks on the ticket tip)',
  { timeout: GIT_TIMEOUT_MS },
  () => {
    it('checks out a commit detached, in the project subfolder, and removes it', async () => {
      const { dataDir, manager } = setup();
      const repo = makeRepo({ 'apps/web/a.txt': 'a\n' });
      const commit = head(repo);
      const co = await manager.checkoutCommit(join(repo, 'apps', 'web'), RUN, commit);
      expect(co.cwd).toBe(join(co.path, 'apps', 'web'));
      expect(readFileSync(join(co.cwd, 'a.txt'), 'utf8')).toBe('a\n');
      expect(git(co.path, 'rev-parse', 'HEAD').trim()).toBe(commit);
      await manager.removeCheckout(co);
      expect(existsSync(co.path)).toBe(false);
      const left = await manager.checkoutCommit(repo, RUN, commit);
      expect(await manager.cleanupCheckouts()).toBe(1);
      expect(existsSync(left.path)).toBe(false);
      expect(readdirSync(join(dataDir, 'ticket-checkouts'))).toEqual([]);
      expect(await code(manager.checkoutCommit(repo, RUN, 'main'))).toBe('invalid-ticket-branch');
      await expect(manager.removeCheckout({ ...left, path: repo })).rejects.toThrow();
    });
  },
);

describe('git operations are serialized per worktree (U-V)', { timeout: GIT_TIMEOUT_MS }, () => {
  it('concurrent changes() and seal() on one worktree all succeed', async () => {
    const { manager, w1 } = await loopSetup();
    for (let i = 0; i < 20; i++) write(w1.path, `f${i}.txt`, `${i}\n`);
    const results = await Promise.allSettled([
      ...Array.from({ length: 6 }, () => manager.changes(w1)),
      manager.seal(w1),
      ...Array.from({ length: 4 }, () => manager.changes(w1)),
    ]);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    for (const r of results.slice(0, 6)) {
      expect(r.status === 'fulfilled' && 'files' in r.value && r.value.files).toHaveLength(20);
    }
  });

  it('concurrent merges of one worktree are applied once, cleanly', async () => {
    const { manager } = setup();
    const ws = await manager.create(makeRepo(), RUN, A1);
    write(ws.path, 'x.txt', 'x\n');
    const results = await Promise.allSettled([
      manager.changes(ws),
      manager.merge(ws),
      manager.changes(ws),
      manager.merge(ws),
    ]);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(readFileSync(join(ws.repoRoot, 'x.txt'), 'utf8')).toBe('x\n');
  });
});

describe(
  "the change reviewer's checkout of one sealed commit (ADR-0021 §3)",
  { timeout: GIT_TIMEOUT_MS },
  () => {
    it('checks out the given commit detached; HEAD when none is given', async () => {
      const { manager, dataDir, w1 } = await loopSetup();
      write(w1.path, 'one.txt', '1\n');
      const sealed = await manager.seal(w1);
      const checkouts = createReviewCheckouts({ dataDir, git: spyingGit().git });
      const change = await checkouts.create(w1.repoRoot, RUN, A2, sealed.headCommit);
      expect(change.commit).toBe(sealed.headCommit);
      expect(readFileSync(join(change.cwd, 'one.txt'), 'utf8')).toBe('1\n');
      const main = await checkouts.create(w1.repoRoot, RUN, 'rev-2');
      expect(main.commit).toBe(head(w1.repoRoot));
      expect(existsSync(join(main.cwd, 'one.txt'))).toBe(false);
      await checkouts.remove(change);
      await checkouts.remove(main);
      for (const bad of ['main', 'HEAD', 'f'.repeat(40)]) {
        await expect(checkouts.create(w1.repoRoot, RUN, 'rev-3', bad)).rejects.toBeInstanceOf(
          WorkspaceError,
        );
      }
    });
  },
);

describe(
  'attachment copies never reach a commit (ADR-0026 §4)',
  { timeout: GIT_TIMEOUT_MS },
  () => {
    it('leaves them out even when the agent removed their .gitignore and staged one', async () => {
      const { manager, w1 } = await loopSetup();
      write(w1.path, 'fixed.txt', 'ok\n');
      write(w1.path, '.acp-attachments/notes.txt', 'owner notes\n');
      git(w1.path, 'add', '--force', '--', '.acp-attachments/notes.txt');
      const sealed = await manager.seal(w1);
      expect(sealed).toMatchObject({ changed: true, changedFiles: 1 });
      expect(git(w1.path, 'ls-tree', '-r', '--name-only', sealed.headCommit)).not.toContain(
        '.acp-attachments',
      );
    });

    it('refuses a branch where the agent committed a copy itself', async () => {
      const { manager, w1 } = await loopSetup();
      write(w1.path, '.acp-attachments/notes.txt', 'owner notes\n');
      git(w1.path, 'add', '--force', '--', '.acp-attachments/notes.txt');
      git(w1.path, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'x');
      git(w1.path, 'rm', '-r', '--cached', '--quiet', '--', '.acp-attachments');
      expect(await code(manager.seal(w1))).toBe('invalid-workspace');
    });
  },
);
