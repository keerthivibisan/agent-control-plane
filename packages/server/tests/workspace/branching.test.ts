// Real throwaway git repositories (G-A, ADR-0025: branch naming, the target, the guard and the
// merge into the target). Names, files and commits are synthetic.
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

const GIT_TIMEOUT_MS = 30_000;
const RUN = '9a1c2a9e-0b4d-4c55-9b0e-5a7d2f1e8c01';
const A1 = 'd7e4d2a1-6c3f-4e8a-9d10-2f5b7c9e0a12';

const ticket = {
  key: 'WEB-13',
  title: 'Login crash on Safari',
  type: 'bug' as const,
};
const githubFlow = branchStrategyPreset('github-flow');
const gitFlow = branchStrategyPreset('git-flow');

function setup() {
  const dataDir = tempDir('acp-br-data-');
  const spy = spyingGit();
  return { dataDir, manager: createWorkspaceManager({ dataDir, git: spy.git }), calls: spy.calls };
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

/** A repo on `main` with a `develop` branch one commit ahead. */
function repoWithDevelop() {
  const repo = makeRepo();
  git(repo, 'checkout', '--quiet', '-b', 'develop');
  write(repo, 'dev.txt', 'd\n');
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', 'develop work');
  const develop = head(repo);
  git(repo, 'checkout', '--quiet', 'main');
  return { repo, develop, main: head(repo) };
}

describe('the ticket branch plan (pure)', () => {
  it('names from the ticket, else the strategy, else acp/<KEY>; -r<n> for every kind', () => {
    const own = ticketBranchPlan(githubFlow, { ...ticket, branch: { name: 'fix/safari-login' } });
    expect([own.nameFor(0), own.nameFor(2)]).toEqual(['fix/safari-login', 'fix/safari-login-r2']);
    const strategy = ticketBranchPlan(gitFlow, ticket);
    expect([strategy.nameFor(0), strategy.nameFor(1)]).toEqual([
      'bugfix/WEB-13-login-crash-on-safari',
      'bugfix/WEB-13-login-crash-on-safari-r1',
    ]);
    const legacy = ticketBranchPlan(undefined, ticket);
    expect([legacy.nameFor(0), legacy.nameFor(1)]).toEqual(['acp/WEB-13', 'acp/WEB-13-r1']);
    expect(legacyTicketBranchPlan('WEB-13').nameFor(3)).toBe('acp/WEB-13-r3');
    expect(() => legacyTicketBranchPlan('web-13').nameFor(0)).toThrow(WorkspaceError);
    expect(() => own.nameFor(-1)).toThrow(WorkspaceError);
  });

  it('targets the ticket, else the strategy default, else the checked-out branch (null)', () => {
    expect(ticketBranchPlan(gitFlow, { ...ticket, branch: { target: 'release/2.0' } }).target).toBe(
      'release/2.0',
    );
    expect(ticketBranchPlan(gitFlow, ticket).target).toBe('develop');
    const custom: BranchStrategy = {
      ...githubFlow,
      preset: 'custom',
      defaultTargetBranch: 'trunk',
    };
    expect(ticketBranchPlan(custom, ticket).target).toBe('trunk');
    expect(ticketBranchPlan(undefined, ticket).target).toBeNull();
    expect(ticketBranchPlan(undefined, { ...ticket, branch: { target: 'main' } }).target).toBe(
      'main',
    );
  });

  it('protects main, master, the strategy branches and develop in Git flow', () => {
    expect(strategyProtectedNames(undefined).sort()).toEqual(['main', 'master']);
    expect(strategyProtectedNames(gitFlow).sort()).toEqual(['develop', 'main', 'master']);
    expect(
      strategyProtectedNames({ ...githubFlow, baseBranch: 'trunk', defaultTargetBranch: 'next' })
        .slice()
        .sort(),
    ).toEqual(['main', 'master', 'next', 'trunk']);
  });
});

describe('creating the ticket branch from its target', { timeout: GIT_TIMEOUT_MS }, () => {
  it('starts at the target tip, not the checked-out branch, and leaves the checkout alone', async () => {
    const { manager, calls } = setup();
    const { repo, develop, main } = repoWithDevelop();
    const created = await manager.createTicketBranch(repo, ticketBranchPlan(gitFlow, ticket));
    expect(created).toEqual({
      branch: 'bugfix/WEB-13-login-crash-on-safari',
      baseBranch: 'develop',
      baseCommit: develop,
    });
    expect(head(repo, 'refs/heads/bugfix/WEB-13-login-crash-on-safari')).toBe(develop);
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
    expect(head(repo)).toBe(main);
    for (const call of calls) {
      expect(call.file).toBe('git');
      expect(call.options.shell).toBe(false);
    }
  });

  it("uses the ticket's own name and target, adding -r<n> when taken", async () => {
    const { manager } = setup();
    const { repo, develop } = repoWithDevelop();
    const plan = ticketBranchPlan(githubFlow, {
      ...ticket,
      branch: { name: 'fix/safari', target: 'develop' },
    });
    git(repo, 'branch', 'fix/safari');
    const first = await manager.createTicketBranch(repo, plan);
    expect(first).toEqual({ branch: 'fix/safari-r1', baseBranch: 'develop', baseCommit: develop });
    const second = await manager.createTicketBranch(repo, plan, (b) => b === 'fix/safari-r2');
    expect(second.branch).toBe('fix/safari-r3');
  });

  it('refuses a missing target before anything is made, at creation and in the check', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    const plan = ticketBranchPlan(gitFlow, ticket);
    expect(await code(manager.checkTicketBranchPlan(repo, plan))).toBe('target-branch-missing');
    expect(await code(manager.createTicketBranch(repo, plan))).toBe('target-branch-missing');
    // A remote-tracking branch is not enough: the app never creates from (or fetches) a remote.
    git(repo, 'update-ref', 'refs/remotes/origin/develop', head(repo));
    expect(await code(manager.createTicketBranch(repo, plan))).toBe('target-branch-missing');
    expect(git(repo, 'branch', '--format=%(refname:short)').trim()).toBe('main');
    git(repo, 'branch', 'develop');
    expect(await manager.checkTicketBranchPlan(repo, plan)).toEqual({
      target: 'develop',
      commit: head(repo),
    });
  });

  it('refuses a name that is a long-lived branch: main, the target, checked out, default', async () => {
    const { manager } = setup();
    const { repo } = repoWithDevelop();
    const named = (name: string, target?: string) =>
      ticketBranchPlan(gitFlow, {
        ...ticket,
        branch: { name, ...(target !== undefined && { target }) },
      });
    for (const plan of [
      named('main'),
      named('master'),
      named('develop'),
      named('release/2.0', 'release/2.0'),
    ]) {
      if (plan.target === 'release/2.0') git(repo, 'branch', '--force', 'release/2.0');
      expect(await code(manager.createTicketBranch(repo, plan)), plan.nameFor(0)).toBe(
        'invalid-ticket-branch',
      );
    }
    // The checked-out branch, even when it is not one of the usual names.
    git(repo, 'checkout', '--quiet', '-b', 'spike');
    expect(await code(manager.checkTicketBranchPlan(repo, named('spike')))).toBe(
      'invalid-ticket-branch',
    );
    // origin's default branch as the repository knows it.
    git(repo, 'update-ref', 'refs/remotes/origin/trunk', head(repo));
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    expect(await code(manager.createTicketBranch(repo, named('trunk')))).toBe(
      'invalid-ticket-branch',
    );
  });
});

describe('the ticket-branch guard (ADR-0025)', { timeout: GIT_TIMEOUT_MS }, () => {
  async function withTicketBranch() {
    const s = setup();
    const { repo, develop } = repoWithDevelop();
    const created = await s.manager.createTicketBranch(repo, ticketBranchPlan(gitFlow, ticket));
    const ref: TicketBranchRef = {
      projectRoot: repo,
      branch: created.branch,
      baseBranch: created.baseBranch,
      protectedNames: strategyProtectedNames(gitFlow),
    };
    const ws = await s.manager.create(repo, RUN, A1, {
      from: { branch: created.branch, commit: develop },
    });
    write(ws.path, 'fix.txt', 'fixed\n');
    const sealed = await s.manager.seal(ws);
    return { ...s, repo, develop, ref, tip: sealed.headCommit };
  }

  it('refuses the target, main, a strategy branch and an unsafe name on every operation', async () => {
    const { manager, ref, develop, tip } = await withTicketBranch();
    const refs: TicketBranchRef[] = [
      { ...ref, branch: ref.baseBranch },
      { ...ref, branch: 'main' },
      { ...ref, branch: 'master' },
      { ...ref, branch: 'release/next', baseBranch: 'release/next' },
      { ...ref, branch: 'trunk', protectedNames: ['trunk'] },
      { ...ref, branch: '-D' },
      { ...ref, branch: 'refs/heads/x' },
    ];
    for (const bad of refs) {
      const what = bad.branch;
      expect(await code(manager.advanceTicketBranch(bad, develop, tip)), what).toBe(
        'invalid-ticket-branch',
      );
      expect(await code(manager.mergeTicketBranch(bad, develop)), what).toBe(
        'invalid-ticket-branch',
      );
      expect(await code(manager.discardTicketBranch(bad)), what).toBe('invalid-ticket-branch');
      expect(await code(manager.updateTicketFromBase({ ...bad, runId: RUN }, develop)), what).toBe(
        'invalid-ticket-branch',
      );
      expect(await code(manager.reviewTicketBranch(bad)), what).toBe('invalid-ticket-branch');
    }
  });

  it("refuses origin's default branch and the project's checked-out branch", async () => {
    const { manager, repo, ref, develop, tip } = await withTicketBranch();
    // A ticket branch that origin calls its default (a rename on the host, say): never touched.
    git(repo, 'update-ref', `refs/remotes/origin/${ref.branch}`, develop);
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${ref.branch}`);
    expect(await code(manager.advanceTicketBranch(ref, develop, tip))).toBe(
      'invalid-ticket-branch',
    );
    expect(await code(manager.discardTicketBranch(ref))).toBe('invalid-ticket-branch');
    git(repo, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
    // The owner switched to the ticket branch: it is not moved, merged or deleted under them.
    git(repo, 'checkout', '--quiet', ref.branch);
    expect(await code(manager.advanceTicketBranch(ref, develop, tip))).toBe(
      'ticket-branch-checked-out',
    );
    expect(await code(manager.mergeTicketBranch(ref, develop))).toBe('ticket-branch-checked-out');
    expect(await code(manager.discardTicketBranch(ref))).toBe('ticket-branch-checked-out');
    git(repo, 'checkout', '--quiet', 'main');
    await manager.advanceTicketBranch(ref, develop, tip);
    expect(head(repo, `refs/heads/${ref.branch}`)).toBe(tip);
  });
});

describe('the final merge into the target (ADR-0025)', { timeout: GIT_TIMEOUT_MS }, () => {
  async function ready() {
    const s = setup();
    const { repo, develop, main } = repoWithDevelop();
    const created = await s.manager.createTicketBranch(repo, ticketBranchPlan(gitFlow, ticket));
    const ref: TicketBranchRef = {
      projectRoot: repo,
      branch: created.branch,
      baseBranch: 'develop',
      protectedNames: strategyProtectedNames(gitFlow),
    };
    const ws = await s.manager.create(repo, RUN, A1, {
      from: { branch: created.branch, commit: develop },
    });
    write(ws.path, 'fix.txt', 'fixed\n');
    await s.manager.seal(ws);
    const done = await s.manager.integrate(ws, develop);
    await s.manager.advanceTicketBranch(ref, develop, done.commit);
    await s.manager.discard(ws);
    return { ...s, repo, develop, main, ref, tip: done.commit };
  }

  it('moves a target that is checked out nowhere by compare-and-swap, never the tree', async () => {
    const { manager, repo, ref, develop, main, tip } = await ready();
    write(repo, 'scratch.txt', 'owner work in progress\n');
    write(repo, 'README.md', 'edited by the owner\n');
    const result = await manager.mergeTicketBranch(ref, tip);
    expect(result).toEqual({
      commit: tip,
      previousBaseCommit: develop,
      branchDeleted: true,
      movedCheckout: false,
    });
    expect(head(repo, 'refs/heads/develop')).toBe(tip);
    // The owner's checkout (main, with uncommitted edits) is exactly as it was.
    expect(head(repo)).toBe(main);
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('edited by the owner\n');
    expect(git(repo, 'branch', '--format=%(refname:short)')).not.toContain(ref.branch);
    expect(git(repo, 'log', '-g', '-1', '--format=%gs', 'develop').trim()).toBe(
      'acp: merge ticket branch',
    );
  });

  it('fast-forwards the clean checkout when the target is checked out, as before', async () => {
    const { manager, repo, ref, tip } = await ready();
    git(repo, 'checkout', '--quiet', 'develop');
    write(repo, 'README.md', 'dirty\n');
    expect(await code(manager.mergeTicketBranch(ref, tip))).toBe('base-dirty');
    git(repo, 'checkout', '--quiet', '--', 'README.md');
    const result = await manager.mergeTicketBranch(ref, tip);
    expect(result.movedCheckout).toBe(true);
    expect(head(repo)).toBe(tip);
    expect(readFileSync(join(repo, 'fix.txt'), 'utf8')).toBe('fixed\n');
  });

  it('refuses a target checked out in another worktree, and a moved target', async () => {
    const { manager, repo, ref, tip, develop } = await ready();
    const other = join(tempDir('acp-br-wt-'), 'dev');
    git(repo, 'worktree', 'add', '--quiet', other, 'develop');
    expect(await code(manager.mergeTicketBranch(ref, tip))).toBe('target-checked-out');
    git(repo, 'worktree', 'remove', '--force', other);
    write(repo, 'main-only.txt', 'm\n');
    git(repo, 'checkout', '--quiet', 'develop');
    git(repo, 'add', '--all');
    git(repo, 'commit', '--quiet', '-m', 'develop moved');
    git(repo, 'checkout', '--quiet', 'main');
    expect(await code(manager.mergeTicketBranch(ref, tip))).toBe('base-moved');
    expect(head(repo, 'refs/heads/develop')).not.toBe(develop);
    expect(head(repo, `refs/heads/${ref.branch}`)).toBe(tip);
  });
});
