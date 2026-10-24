// Merging a pull request and deleting the ticket branch (G-G, ADR-0025 §9): the code host
// service with a fake `gh`, temporary repositories and a local bare `origin`. No network.
// Repositories, branches and numbers are synthetic.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CodeHostError,
  codeHostHttpError,
  createCodeHostService,
  type CodeHostErrorCode,
} from '../../src/code-host/index.js';
import {
  GIT_TEST_ENV,
  git,
  head,
  makeRepo,
  spyingGit,
  tempDir,
  write,
} from '../workspace/helpers.js';
import { CANARY, REMOTE_URL, bareTip, createFakeGh, withBareOrigin } from './fake-gh.js';
import { createGitRunner } from '../../src/workspace/index.js';

const TIMEOUT = 30_000;
const BRANCH = 'feature/WEB-1-dark-mode';

async function setup(options: { open?: boolean } = {}) {
  const repo = makeRepo();
  const bare = withBareOrigin(repo);
  git(repo, 'branch', BRANCH);
  const gh = createFakeGh();
  gh.state.bare = bare;
  const lines: string[] = [];
  const spy = spyingGit();
  const scratch = tempDir('acp-gh-tmp-');
  const service = createCodeHostService({
    git: spy.git,
    cli: gh.run,
    tmpDir: scratch,
    logger: {
      log: (level, message, fields) => lines.push(JSON.stringify({ level, message, fields })),
    },
  });
  if (options.open !== false) {
    await service.openPullRequest(repo, {
      head: BRANCH,
      base: 'main',
      title: 'WEB-1: Dark mode',
      body: 'Synthetic summary.',
      draft: false,
    });
  }
  return { repo, bare, gh, service, lines, spy, scratch };
}

async function refusal(promise: Promise<unknown>): Promise<CodeHostError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CodeHostError) return error;
    throw error;
  }
  throw new Error('expected a CodeHostError');
}

const code = async (p: Promise<unknown>): Promise<CodeHostErrorCode> => (await refusal(p)).code;

/** HEAD, the index, the working tree and the branch list, to show nothing local changed. */
function checkoutState(repo: string) {
  return {
    head: git(repo, 'symbolic-ref', 'HEAD'),
    tip: head(repo),
    status: git(repo, 'status', '--porcelain=v1', '--untracked-files=all'),
    index: git(repo, 'ls-files', '--stage'),
    readme: readFileSync(join(repo, 'README.md'), 'utf8'),
  };
}

const mergeCalls = (gh: ReturnType<typeof createFakeGh>) =>
  gh.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'merge');

describe('merge (gh pr merge, outside the checkout)', { timeout: TIMEOUT }, () => {
  for (const method of ['merge', 'squash', 'rebase'] as const) {
    for (const deleteBranch of [false, true]) {
      it(`--${method}${deleteBranch ? ' --delete-branch' : ''}`, async () => {
        const { repo, bare, gh, service, scratch, lines } = await setup();
        // Local work in progress: staged, unstaged and untracked.
        write(repo, 'README.md', 'edited\n');
        write(repo, 'staged.txt', 'staged\n');
        git(repo, 'add', 'staged.txt');
        write(repo, 'untracked.txt', 'new\n');
        const before = checkoutState(repo);
        const from = gh.calls.length;

        await service.mergePullRequest(repo, { number: 12, method, deleteBranch });

        const [call, ...more] = mergeCalls(gh);
        expect(more).toEqual([]);
        expect(call?.args).toEqual([
          'pr',
          'merge',
          '12',
          '--repo=acme/widgets',
          `--${method}`,
          ...(deleteBranch ? ['--delete-branch'] : []),
        ]);
        // Never in the project's checkout: gh cannot switch or delete anything there.
        expect(call?.options.cwd).toBe(scratch);
        expect(call?.options.cwd).not.toBe(repo);
        // Every gh call of the merge (the readiness checks too) ran outside the checkout.
        for (const c of gh.calls.slice(from)) expect(c.options.cwd).toBe(scratch);
        expect(gh.prs[0]).toMatchObject({ state: 'MERGED', mergedWith: method });
        expect(bareTip(bare, BRANCH) === null).toBe(deleteBranch);
        // The local branch is the caller's to delete; the checkout is untouched.
        expect(git(repo, 'branch', '--list', BRANCH).trim()).not.toBe('');
        expect(checkoutState(repo)).toEqual(before);
        expect(lines.join('\n')).not.toContain(CANARY);
      });
    }
  }

  it('code_host_not_ready when gh is missing or signed out (nothing merged)', async () => {
    const { repo, gh, service } = await setup();
    gh.state.loggedIn = false;
    const e = await refusal(
      service.mergePullRequest(repo, { number: 12, method: 'merge', deleteBranch: true }),
    );
    expect(e.code).toBe('code_host_not_ready');
    expect(codeHostHttpError(e).status).toBe(409);
    gh.state.loggedIn = true;
    gh.state.installed = false;
    expect(
      await code(
        service.mergePullRequest(repo, { number: 12, method: 'merge', deleteBranch: true }),
      ),
    ).toBe('code_host_not_ready');
    expect(mergeCalls(gh)).toEqual([]);
    expect(gh.prs[0]?.state).toBe('OPEN');
  });

  it('explains refusals from GitHub’s JSON, never gh’s words', async () => {
    const { repo, gh, service } = await setup();
    const merge = (method: 'merge' | 'squash' | 'rebase' = 'squash') =>
      refusal(service.mergePullRequest(repo, { number: 12, method, deleteBranch: false }));

    gh.state.methods.squashMergeAllowed = false;
    let e = await merge('squash');
    expect(e.code).toBe('merge_method_not_allowed');
    expect(e.message).toContain('squash merging');
    expect(codeHostHttpError(e).status).toBe(409);
    gh.state.methods.squashMergeAllowed = true;

    const pr = gh.prs[0];
    if (pr === undefined) throw new Error('no pull request');
    pr.mergeable = 'CONFLICTING';
    pr.mergeStateStatus = 'DIRTY';
    e = await merge();
    expect(e.code).toBe('pull_request_not_mergeable');
    expect(e.message).toContain('conflicts');
    pr.mergeable = 'MERGEABLE';
    pr.mergeStateStatus = 'BLOCKED';
    e = await merge();
    expect(e.code).toBe('pull_request_not_mergeable');
    expect(e.message).toContain('required reviews or passing required checks');
    pr.mergeStateStatus = 'BEHIND';
    expect((await merge()).message).toContain('behind its target');
    delete pr.mergeStateStatus;
    pr.draft = true;
    expect((await merge()).message).toContain('is a draft');
    pr.draft = false;

    // Something else: a plain sentence.
    gh.fail.merge = { exitCode: 1, stdout: CANARY, timedOut: false, notFound: false };
    e = await merge();
    expect(e.code).toBe('merge_failed');
    expect(codeHostHttpError(e).status).toBe(502);
    expect(e.message).not.toContain(CANARY);

    // A timeout: it may or may not be merged.
    gh.fail.merge = { exitCode: null, stdout: '', timedOut: true, notFound: false };
    e = await merge();
    expect(e.code).toBe('timeout');
    expect(e.message).toContain('may or may not be merged');
    expect(e.message).toContain('Refresh');
    expect(codeHostHttpError(e).status).toBe(504);
    delete gh.fail.merge;

    // Closed on GitHub meanwhile.
    gh.close(12);
    e = await merge();
    expect(e.code).toBe('pull_request_not_mergeable');
    expect(e.message).toContain('is closed');
    expect(gh.prs[0]?.state).toBe('CLOSED');
  });

  it('a failed exit with the pull request merged on GitHub counts as merged', async () => {
    const { repo, gh, service } = await setup();
    gh.merge(12);
    gh.fail.merge = { exitCode: 1, stdout: '', timedOut: false, notFound: false };
    await expect(
      service.mergePullRequest(repo, { number: 12, method: 'merge', deleteBranch: false }),
    ).resolves.toBeUndefined();
  });

  it('refuses without a GitHub origin', async () => {
    const { repo, service } = await setup({ open: false });
    git(repo, 'remote', 'remove', 'origin');
    expect(
      await code(
        service.mergePullRequest(repo, { number: 12, method: 'merge', deleteBranch: false }),
      ),
    ).toBe('no-github-remote');
  });
});

describe('presence (local refs, or asking origin)', { timeout: TIMEOUT }, () => {
  it('tracking reads refs only; remote asks origin and drops a stale tracking ref', async () => {
    const { repo, bare, service, spy } = await setup();
    expect(await service.ticketBranchPresence(repo, BRANCH, 'tracking')).toEqual({
      localExists: true,
      onOrigin: true,
      current: false,
    });
    // GitHub deleted the branch: the tracking ref is stale until origin is asked.
    git(bare, 'update-ref', '-d', `refs/heads/${BRANCH}`);
    expect((await service.ticketBranchPresence(repo, BRANCH, 'tracking')).onOrigin).toBe(true);
    const calls = spy.calls.length;
    expect((await service.ticketBranchPresence(repo, BRANCH, 'remote')).onOrigin).toBe(false);
    const asked = spy.calls.slice(calls).map((c) => c.args as string[]);
    expect(asked.some((a) => a.includes('ls-remote'))).toBe(true);
    expect(git(repo, 'for-each-ref', `refs/remotes/origin/${BRANCH}`).trim()).toBe('');
    expect((await service.ticketBranchPresence(repo, BRANCH, 'tracking')).onOrigin).toBe(false);
    // Only that branch's tracking ref went.
    expect(git(repo, 'for-each-ref', 'refs/heads').trim()).not.toBe('');
  });

  it('no origin: unknown on origin; the current branch is reported', async () => {
    const repo = makeRepo();
    const service = createCodeHostService({
      git: createGitRunner({ env: GIT_TEST_ENV }),
      cli: createFakeGh().run,
    });
    expect(await service.ticketBranchPresence(repo, 'main', 'remote')).toEqual({
      localExists: true,
      onOrigin: null,
      current: true,
    });
    // A branch whose name starts the same is not this one.
    git(repo, 'branch', `${BRANCH}/x`);
    expect((await service.ticketBranchPresence(repo, BRANCH, 'tracking')).localExists).toBe(false);
  });
});

describe('delete (on origin, then in the project)', { timeout: TIMEOUT }, () => {
  it('deletes on origin and locally with argument arrays; the checkout is untouched', async () => {
    const { repo, bare, service, spy } = await setup();
    write(repo, 'README.md', 'edited\n');
    const before = checkoutState(repo);
    const calls = spy.calls.length;
    const left = await service.deleteTicketBranch(repo, BRANCH, ['main']);
    expect(left).toEqual({ localExists: false, onOrigin: false, current: false });
    expect(bareTip(bare, BRANCH)).toBeNull();
    expect(git(repo, 'branch', '--list', BRANCH).trim()).toBe('');
    expect(checkoutState(repo)).toEqual(before);
    const args = spy.calls.slice(calls).map((c) => (c.args as string[]).filter((a) => a !== '-c'));
    // F-2: origin's own address, never the remote name (a planted pushurl is never followed).
    expect(
      args.some((a) =>
        a.join(' ').endsWith(`push --no-verify ${REMOTE_URL} --delete refs/heads/${BRANCH}`),
      ),
    ).toBe(true);
    expect(args.some((a) => a.join(' ').endsWith(`branch -D ${BRANCH}`))).toBe(true);
    for (const c of spy.calls) {
      expect(Array.isArray(c.args)).toBe(true);
      expect(c.options.shell).toBe(false);
    }
  });

  it('origin already without it: only the local branch goes', async () => {
    const { repo, bare, service, spy } = await setup();
    git(bare, 'update-ref', '-d', `refs/heads/${BRANCH}`);
    const calls = spy.calls.length;
    await service.deleteTicketBranch(repo, BRANCH, ['main']);
    const args = spy.calls.slice(calls).map((c) => (c.args as string[]).join(' '));
    expect(args.some((a) => a.includes('push'))).toBe(false);
    expect(git(repo, 'branch', '--list', BRANCH).trim()).toBe('');
    expect(git(repo, 'for-each-ref', `refs/remotes/origin/${BRANCH}`).trim()).toBe('');
  });

  it('no origin remote: deletes locally', async () => {
    const repo = makeRepo();
    git(repo, 'branch', BRANCH);
    const service = createCodeHostService({
      git: createGitRunner({ env: GIT_TEST_ENV }),
      cli: createFakeGh().run,
    });
    expect(await service.deleteTicketBranch(repo, BRANCH, ['main'])).toEqual({
      localExists: false,
      onOrigin: null,
      current: false,
    });
  });

  it('refuses the checked-out branch and a protected one, deleting nothing', async () => {
    const { repo, bare, service } = await setup();
    git(repo, 'switch', '--quiet', BRANCH);
    let e = await refusal(service.deleteTicketBranch(repo, BRANCH, ['main']));
    expect(e.code).toBe('branch_checked_out');
    expect(codeHostHttpError(e).status).toBe(409);
    expect(bareTip(bare, BRANCH)).not.toBeNull();
    git(repo, 'switch', '--quiet', 'main');
    e = await refusal(service.deleteTicketBranch(repo, BRANCH, ['main', BRANCH]));
    expect(e.code).toBe('branch_protected');
    expect(bareTip(bare, BRANCH)).not.toBeNull();
    expect(git(repo, 'branch', '--list', BRANCH).trim()).not.toBe('');
  });

  it('checked out in another worktree: origin goes, the local branch stays, said plainly', async () => {
    const { repo, service } = await setup();
    const other = join(tempDir('acp-wt-'), 'wt');
    git(repo, 'worktree', 'add', '--quiet', other, BRANCH);
    const e = await refusal(service.deleteTicketBranch(repo, BRANCH, ['main']));
    expect(e.code).toBe('branch_checked_out');
    expect(e.message).toContain('another worktree');
    expect(git(repo, 'branch', '--list', BRANCH).trim()).not.toBe('');
  });

  it('origin refuses the delete: the project keeps its branch', async () => {
    const { repo, bare, service, lines } = await setup();
    const hook = join(bare, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    const e = await refusal(service.deleteTicketBranch(repo, BRANCH, ['main']));
    expect(e.code).toBe('branch_delete_failed');
    expect(e.message).toContain('Nothing was deleted in the project folder');
    expect(bareTip(bare, BRANCH)).not.toBeNull();
    expect(git(repo, 'branch', '--list', BRANCH).trim()).not.toBe('');
    expect(lines.join('\n')).not.toContain(bare);
  });

  it('origin cannot be reached: nothing is deleted', async () => {
    const { repo, bare, service } = await setup();
    const missing = join(tempDir('acp-gone-'), 'nothing-here');
    git(repo, 'config', '--unset-all', `url.${bare}.insteadOf`);
    git(repo, 'config', `url.${missing}.insteadOf`, REMOTE_URL);
    const e = await refusal(service.deleteTicketBranch(repo, BRANCH, ['main']));
    expect(e.code).toBe('branch_delete_failed');
    expect(e.message).toContain('could not reach origin');
    expect(git(repo, 'branch', '--list', BRANCH).trim()).not.toBe('');
  });

  it('the local half after a merge: never the checked-out branch', async () => {
    const { repo, service } = await setup();
    git(repo, 'switch', '--quiet', BRANCH);
    expect(await service.deleteLocalBranch(repo, BRANCH)).toBe('checked-out');
    git(repo, 'switch', '--quiet', 'main');
    expect(await service.deleteLocalBranch(repo, BRANCH)).toBe('deleted');
    expect(await service.deleteLocalBranch(repo, BRANCH)).toBe('absent');
  });
});
