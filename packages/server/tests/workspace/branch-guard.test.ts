// F-1: real throwaway git repositories. Names, files and commits are synthetic.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WorkspaceError,
  createWorkspaceManager,
  type WorkspaceErrorCode,
} from '../../src/workspace/index.js';
import { git, head, makeRepo, tempDir, write } from './helpers.js';

const GIT_TIMEOUT_MS = 30_000;
const RUN = '3f1c2a9e-0b4d-4c55-9b0e-5a7d2f1e8c01';
const A1 = 'b7e4d2a1-6c3f-4e8a-9d10-2f5b7c9e0a12';

function setup() {
  const dataDir = tempDir('acp-f1-data-');
  return { dataDir, manager: createWorkspaceManager({ dataDir }) };
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

/** The incident: a helper worktree on the ticket branch commits there itself. */
async function helperSwitched() {
  const { manager } = setup();
  const repo = makeRepo();
  const created = await manager.createTicketBranch(repo, 'ACPGIT-3');
  const ws = await manager.create(repo, RUN, A1, {
    from: { branch: created.branch, commit: created.baseCommit },
  });
  // What the helper ran: switch its folder to the ticket branch and commit there.
  git(ws.path, 'checkout', '--quiet', created.branch);
  write(ws.path, 'brand.css', 'body { color: teal; }\n');
  git(ws.path, 'add', 'brand.css');
  git(ws.path, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '--quiet', '-m', 'brand');
  return { manager, repo, created, ws, moved: head(repo, `refs/heads/${created.branch}`) };
}

describe('gitDirs (F-1 §1b)', { timeout: GIT_TIMEOUT_MS }, () => {
  it('names the worktree private folder and the repository .git, absolute', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    const ws = await manager.create(repo, RUN, A1);
    const dirs = await manager.gitDirs(ws);
    const common = realpathSync(join(repo, '.git'));
    expect(dirs).toContain(common);
    expect(dirs.some((d) => d.startsWith(join(common, 'worktrees')))).toBe(true);
    for (const d of dirs) expect(d.startsWith('/')).toBe(true);
  });

  it('refuses a worktree that left its branch (the helper does not start)', async () => {
    const { manager, ws } = await helperSwitched();
    expect(await code(manager.gitDirs(ws))).toBe('workspace-branch-changed');
  });
});

describe('a helper that switched branches (F-1 §3a)', { timeout: GIT_TIMEOUT_MS }, () => {
  it('seal refuses it with workspace-branch-changed and commits nothing', async () => {
    const { manager, repo, created, ws, moved } = await helperSwitched();
    write(ws.path, 'more.css', 'x\n');
    expect(await code(manager.seal(ws))).toBe('workspace-branch-changed');
    expect(head(repo, `refs/heads/${created.branch}`)).toBe(moved);
    expect(head(repo, `refs/heads/${ws.branch}`)).toBe(created.baseCommit);
  });

  it('detachForeignBranch frees the other branch and moves no ref', async () => {
    const { manager, repo, created, ws, moved } = await helperSwitched();
    const before = git(repo, 'for-each-ref', '--format=%(refname) %(objectname)');
    expect(await manager.detachForeignBranch(ws)).toBe(true);
    expect(git(repo, 'for-each-ref', '--format=%(refname) %(objectname)')).toBe(before);
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(
      `branch refs/heads/${created.branch}`,
    );
    // The folder keeps its files; HEAD stays at the commit it was on.
    expect(head(ws.path)).toBe(moved);
    // Once detached (or on its own branch) it is left alone.
    expect(await manager.detachForeignBranch(ws)).toBe(false);
  });

  it('a worktree on its own branch is never touched', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    const ws = await manager.create(repo, RUN, A1);
    expect(await manager.detachForeignBranch(ws)).toBe(false);
    expect(git(ws.path, 'symbolic-ref', 'HEAD').trim()).toBe(`refs/heads/${ws.branch}`);
  });

  it('discard removes the worktree and deletes only its own branch', async () => {
    const { manager, repo, created, ws, moved } = await helperSwitched();
    await manager.detachForeignBranch(ws);
    await manager.discard(ws);
    expect(head(repo, `refs/heads/${created.branch}`)).toBe(moved);
    expect(git(repo, 'branch', '--list', ws.branch).trim()).toBe('');
  });
});

describe('resetTicketBranch (F-1 §3b)', { timeout: GIT_TIMEOUT_MS }, () => {
  const ref = (repo: string, branch: string) => ({
    projectRoot: repo,
    branch,
    baseBranch: 'main',
  });

  it('refuses while a worktree has the branch checked out', async () => {
    const { manager, repo, created, moved } = await helperSwitched();
    expect(
      await code(manager.resetTicketBranch(ref(repo, created.branch), created.baseCommit, moved)),
    ).toBe('ticket-branch-checked-out');
    expect(head(repo, `refs/heads/${created.branch}`)).toBe(moved);
  });

  it('moves it back by compare-and-swap once nothing holds it; no other ref moves', async () => {
    const { manager, repo, created, ws, moved } = await helperSwitched();
    await manager.discard(ws);
    const main = head(repo, 'refs/heads/main');
    await manager.resetTicketBranch(ref(repo, created.branch), created.baseCommit, moved);
    expect(head(repo, `refs/heads/${created.branch}`)).toBe(created.baseCommit);
    expect(head(repo, 'refs/heads/main')).toBe(main);
    // Again: already there, nothing to do.
    await manager.resetTicketBranch(ref(repo, created.branch), created.baseCommit, moved);
    expect(head(repo, `refs/heads/${created.branch}`)).toBe(created.baseCommit);
  });

  it('refuses when the branch moved again since the owner looked', async () => {
    const { manager, repo, created, ws, moved } = await helperSwitched();
    await manager.discard(ws);
    // Someone moves it once more, to yet another commit.
    const next = git(repo, 'commit-tree', '-m', 'x', `${moved}^{tree}`, '-p', moved).trim();
    git(repo, 'update-ref', `refs/heads/${created.branch}`, next);
    const now = head(repo, `refs/heads/${created.branch}`);
    expect(now).not.toBe(moved);
    expect(
      await code(manager.resetTicketBranch(ref(repo, created.branch), created.baseCommit, moved)),
    ).toBe('ticket-branch-moved');
    expect(head(repo, `refs/heads/${created.branch}`)).toBe(now);
  });

  it('refuses a long-lived branch, the checked-out branch and bad commit ids', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    const tip = head(repo);
    expect(await code(manager.resetTicketBranch(ref(repo, 'main'), tip, tip))).toBe(
      'invalid-ticket-branch',
    );
    expect(await code(manager.resetTicketBranch(ref(repo, 'acp/WEB-1'), 'abc', tip))).toBe(
      'invalid-ticket-branch',
    );
    git(repo, 'branch', 'acp/WEB-1');
    git(repo, 'checkout', '--quiet', 'acp/WEB-1');
    expect(await code(manager.resetTicketBranch(ref(repo, 'acp/WEB-1'), tip, tip))).toBe(
      'ticket-branch-checked-out',
    );
  });
});
