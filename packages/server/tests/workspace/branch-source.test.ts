// Real throwaway git repositories (G-H, ADR-0025 §10: where a ticket branch starts). Names, files
// and commits are synthetic.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { branchStrategyPreset, type BranchStrategy } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  WorkspaceError,
  createWorkspaceManager,
  legacyTicketBranchPlan,
  strategyProtectedNames,
  ticketBranchPlan,
  type TicketBranchRef,
  type WorkspaceErrorCode,
} from '../../src/workspace/index.js';
import { git, head, makeRepo, spyingGit, tempDir, write } from './helpers.js';

// Each merge test makes a worktree, seals, integrates and merges: slow on a loaded machine.
const GIT_TIMEOUT_MS = 90_000;
const RUN = '4c1e8f0a-7b2d-4e6a-9c35-1d2e3f4a5b6c';
const A1 = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

const ticket = { key: 'WEB-21', title: 'Release notes page', type: 'feature' as const };
const githubFlow = branchStrategyPreset('github-flow');
const withSource = (from: string): BranchStrategy => ({ ...githubFlow, defaultSourceBranch: from });

function setup() {
  const dataDir = tempDir('acp-src-data-');
  const spy = spyingGit();
  return { manager: createWorkspaceManager({ dataDir, git: spy.git }), calls: spy.calls };
}

async function code(promise: Promise<unknown>): Promise<WorkspaceErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WorkspaceError) return error.code;
    throw error;
  }
  throw new Error('expected a WorkspaceError');
}

function commitOn(repo: string, branch: string, file: string): string {
  git(repo, 'checkout', '--quiet', branch);
  write(repo, file, `${file}\n`);
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', `work on ${branch}`);
  const tip = head(repo);
  git(repo, 'checkout', '--quiet', 'main');
  return tip;
}

/** `main` (checked out), `dev` one commit ahead of it, `release/1.0` one commit ahead of `dev`. */
function repoWithRelease() {
  const repo = makeRepo();
  const main = head(repo);
  git(repo, 'branch', 'dev');
  const dev = commitOn(repo, 'dev', 'dev.txt');
  git(repo, 'branch', 'release/1.0', 'dev');
  const release = commitOn(repo, 'release/1.0', 'release.txt');
  return { repo, main, dev, release };
}

describe('the plan names a source (pure)', () => {
  it("takes the ticket's from, else the strategy's default source, else null (the target)", () => {
    expect(ticketBranchPlan(githubFlow, ticket).source).toBeNull();
    expect(ticketBranchPlan(undefined, ticket).source).toBeNull();
    expect(legacyTicketBranchPlan('WEB-21').source).toBeNull();
    expect(ticketBranchPlan(withSource('release/1.0'), ticket).source).toBe('release/1.0');
    expect(
      ticketBranchPlan(withSource('release/1.0'), { ...ticket, branch: { from: 'hotfix/base' } })
        .source,
    ).toBe('hotfix/base');
    expect(ticketBranchPlan(undefined, { ...ticket, branch: { from: 'dev' } }).source).toBe('dev');
  });

  it("protects the strategy's default source as a long-lived branch", () => {
    expect(strategyProtectedNames(withSource('release/1.0')).sort()).toEqual([
      'main',
      'master',
      'release/1.0',
    ]);
  });
});

describe('creating the ticket branch from its source', { timeout: GIT_TIMEOUT_MS }, () => {
  it('defaults to the target: no source recorded, as before', async () => {
    const { manager } = setup();
    const { repo, dev } = repoWithRelease();
    const plan = ticketBranchPlan(githubFlow, { ...ticket, branch: { target: 'dev' } });
    const created = await manager.createTicketBranch(repo, plan);
    expect(created).toEqual({
      branch: 'feature/WEB-21-release-notes-page',
      baseBranch: 'dev',
      baseCommit: dev,
    });
    // A source equal to the target is the same as none.
    const same = ticketBranchPlan(githubFlow, {
      ...ticket,
      branch: { target: 'dev', from: 'dev' },
    });
    expect(await manager.checkTicketBranchPlan(repo, same)).toEqual({ target: 'dev', commit: dev });
  });

  it("starts at the project's source tip, never switching the checkout", async () => {
    const { manager, calls } = setup();
    const { repo, main, release } = repoWithRelease();
    write(repo, 'README.md', 'owner edits\n');
    const plan = ticketBranchPlan(withSource('release/1.0'), {
      ...ticket,
      branch: { target: 'dev' },
    });
    expect(await manager.checkTicketBranchPlan(repo, plan)).toEqual({
      target: 'dev',
      commit: release,
      sourceBranch: 'release/1.0',
    });
    const created = await manager.createTicketBranch(repo, plan);
    expect(created).toEqual({
      branch: 'feature/WEB-21-release-notes-page',
      baseBranch: 'dev',
      baseCommit: release,
      sourceBranch: 'release/1.0',
    });
    expect(head(repo, `refs/heads/${created.branch}`)).toBe(release);
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
    expect(head(repo)).toBe(main);
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('owner edits\n');
    const subcommands = calls.map((c) =>
      (c.args as string[]).find((a) => !a.startsWith('-') && !a.includes('=')),
    );
    expect(subcommands).not.toContain('checkout');
    expect(subcommands).not.toContain('switch');
  });

  it("lets the ticket's from override the project's, and the target stand without either", async () => {
    const { manager } = setup();
    const { repo, dev, release } = repoWithRelease();
    const own = ticketBranchPlan(withSource('release/1.0'), {
      ...ticket,
      branch: { target: 'main', from: 'dev' },
    });
    const a = await manager.createTicketBranch(repo, own);
    expect([a.baseBranch, a.baseCommit, a.sourceBranch]).toEqual(['main', dev, 'dev']);
    // No target anywhere: the checked-out branch (main) is the target, the source still applies.
    const legacyTarget = ticketBranchPlan(undefined, {
      ...ticket,
      branch: { from: 'release/1.0' },
    });
    const b = await manager.createTicketBranch(repo, legacyTarget);
    expect([b.branch, b.baseBranch, b.baseCommit, b.sourceBranch]).toEqual([
      'acp/WEB-21',
      'main',
      release,
      'release/1.0',
    ]);
  });

  it('refuses a missing source plainly, before anything is made', async () => {
    const { manager } = setup();
    const { repo } = repoWithRelease();
    const plan = ticketBranchPlan(withSource('release/2.0'), {
      ...ticket,
      branch: { target: 'dev' },
    });
    // Only on origin is not enough: the app never fetches for this.
    git(repo, 'update-ref', 'refs/remotes/origin/release/2.0', head(repo));
    const refused = manager.checkTicketBranchPlan(repo, plan);
    await expect(refused).rejects.toThrow(
      'The branch release/2.0, which the ticket branch starts from, does not exist in the project yet',
    );
    expect(await code(manager.createTicketBranch(repo, plan))).toBe('source-branch-missing');
    expect(git(repo, 'branch', '--format=%(refname:short)').trim().split('\n').sort()).toEqual([
      'dev',
      'main',
      'release/1.0',
    ]);
    // A missing target is still reported first.
    const both = ticketBranchPlan(withSource('release/2.0'), {
      ...ticket,
      branch: { target: 'next' },
    });
    expect(await code(manager.createTicketBranch(repo, both))).toBe('target-branch-missing');
  });

  it('refuses a ticket branch named like its source (a long-lived branch here)', async () => {
    const { manager } = setup();
    const { repo } = repoWithRelease();
    const plan = ticketBranchPlan(githubFlow, {
      ...ticket,
      branch: { name: 'release/1.0', target: 'dev', from: 'release/1.0' },
    });
    expect(await code(manager.checkTicketBranchPlan(repo, plan))).toBe('invalid-ticket-branch');
  });
});

describe('merging back into the target (ADR-0025 §10)', { timeout: GIT_TIMEOUT_MS }, () => {
  /** A ticket branch from `from` into `dev`, with one sealed change on it. */
  async function ready(repo: string, from: string) {
    const s = setup();
    const strategy = withSource(from);
    const created = await s.manager.createTicketBranch(
      repo,
      ticketBranchPlan(strategy, { ...ticket, branch: { target: 'dev' } }),
    );
    const ref: TicketBranchRef & { runId: string } = {
      projectRoot: repo,
      branch: created.branch,
      baseBranch: created.baseBranch,
      protectedNames: strategyProtectedNames(strategy),
      runId: RUN,
    };
    const ws = await s.manager.create(repo, RUN, A1, {
      from: { branch: created.branch, commit: created.baseCommit },
    });
    write(ws.path, 'notes.txt', 'release notes\n');
    await s.manager.seal(ws);
    const done = await s.manager.integrate(ws, created.baseCommit);
    await s.manager.advanceTicketBranch(ref, created.baseCommit, done.commit);
    await s.manager.discard(ws);
    return { ...s, ref, created, tip: done.commit };
  }

  it('a source ahead of the target fast-forwards the target, as git would', async () => {
    const { repo, dev, release } = repoWithRelease();
    const { manager, ref, tip } = await ready(repo, 'release/1.0');
    const review = await manager.reviewTicketBranch(ref);
    expect(review.baseMoved).toBe(false);
    expect(review.baseHead).toBe(dev);
    const merged = await manager.mergeTicketBranch(ref, tip);
    expect(merged.previousBaseCommit).toBe(dev);
    expect(head(repo, 'refs/heads/dev')).toBe(tip);
    expect(git(repo, 'merge-base', '--is-ancestor', release, 'dev')).toBe('');
  });

  it('a source the target lacks commits from asks to update from the target first', async () => {
    const { repo, release } = repoWithRelease();
    // dev gains a commit release/1.0 does not have: the ticket branch no longer contains dev.
    const devMoved = commitOn(repo, 'dev', 'dev-2.txt');
    const { manager, ref, tip } = await ready(repo, 'release/1.0');
    expect(git(repo, 'merge-base', '--is-ancestor', release, `refs/heads/${ref.branch}`)).toBe('');
    expect((await manager.reviewTicketBranch(ref)).baseMoved).toBe(true);
    const refused = manager.mergeTicketBranch(ref, tip);
    await expect(refused).rejects.toThrow('update it from dev first');
    expect(head(repo, 'refs/heads/dev')).toBe(devMoved);
    const updated = await manager.updateTicketFromBase(ref, tip);
    expect(updated.baseHead).toBe(devMoved);
    const merged = await manager.mergeTicketBranch(ref, updated.headCommit);
    expect(merged.commit).toBe(updated.headCommit);
    expect(head(repo, 'refs/heads/dev')).toBe(updated.headCommit);
  });
});
