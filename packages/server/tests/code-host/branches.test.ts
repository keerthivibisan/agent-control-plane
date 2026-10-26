// A project's branches (G-F, ADR-0025 §8): listing (current, detached, unborn, origin) and
// creating on the owner's click, without ever switching the owner's checkout. Temp repositories
// and a local bare `origin` only; nothing reaches GitHub. Synthetic names only.
import { execFile as nodeExecFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectBranchesDtoSchema } from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  CodeHostError,
  MAX_BRANCHES,
  codeHostHttpError,
  createCodeHostService,
  type CodeHostErrorCode,
} from '../../src/code-host/index.js';
import {
  SAFE_GIT_CONFIG,
  createGitRunner,
  type ExecFileFn,
  type ExecFileOptions,
} from '../../src/workspace/index.js';
import { GIT_TEST_ENV, git, head, makeRepo, tempDir, write } from '../workspace/helpers.js';
import { createFakeGh, bareTip } from './fake-gh.js';

const TIMEOUT = 30_000;

interface Call {
  file: string;
  args: string[];
  options: ExecFileOptions;
}

/** The real runner (real git), recording every process it starts. */
function setup() {
  const calls: Call[] = [];
  const execFile: ExecFileFn = (file, args, options, callback) => {
    calls.push({ file, args: [...args], options });
    nodeExecFile(file, args, options, callback);
  };
  const lines: string[] = [];
  const service = createCodeHostService({
    git: createGitRunner({ env: GIT_TEST_ENV, execFile }),
    cli: createFakeGh().run,
    tmpDir: tempDir('acp-gh-tmp-'),
    logger: {
      log: (level, message, fields) => lines.push(JSON.stringify({ level, message, fields })),
    },
  });
  return { service, calls, lines };
}

function withOrigin(repo: string): string {
  const bare = tempDir('acp-bare-');
  git(bare, 'init', '--quiet', '--bare');
  git(repo, 'remote', 'add', 'origin', bare);
  return bare;
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

const code = async (promise: Promise<unknown>): Promise<CodeHostErrorCode> =>
  (await refusal(promise)).code;

const localBranches = (repo: string): string[] =>
  git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean);

/** Everything about the owner's checkout that creating a branch must not change. */
function checkout(repo: string) {
  return {
    head: readFileSync(join(repo, '.git', 'HEAD'), 'utf8'),
    commit: head(repo),
    status: git(repo, 'status', '--porcelain=v1', '--untracked-files=all'),
    index: git(repo, 'ls-files', '--stage'),
    staged: git(repo, 'diff', '--cached'),
    files: ['README.md', 'src/app.ts', 'notes.txt'].map((f) => readFileSync(join(repo, f), 'utf8')),
  };
}

describe('list the project’s branches', { timeout: TIMEOUT }, () => {
  it('sorted by name, the current one marked, without an origin', async () => {
    const repo = makeRepo();
    git(repo, 'branch', 'release/1.0');
    git(repo, 'branch', 'develop');
    const { service } = setup();
    const dto = ProjectBranchesDtoSchema.parse(await service.branches(repo));
    const tip = head(repo);
    expect(dto).toEqual({
      current: 'main',
      hasOrigin: false,
      truncated: false,
      branches: [
        { name: 'develop', commit: tip, current: false, onOrigin: null },
        { name: 'main', commit: tip, current: true, onOrigin: null },
        { name: 'release/1.0', commit: tip, current: false, onOrigin: null },
      ],
    });
  });

  it('onOrigin from refs/remotes/origin as of the last fetch (no fetch)', async () => {
    const repo = makeRepo();
    const bare = withOrigin(repo);
    git(repo, 'push', '--quiet', 'origin', 'main');
    git(repo, 'branch', 'feature/a');
    // On the remote, but not fetched yet: the list must not say it is there.
    git(bare, 'branch', 'feature/a', 'main');
    const { service, calls } = setup();
    const dto = await service.branches(repo);
    expect(dto.hasOrigin).toBe(true);
    expect(dto.branches.map((b) => [b.name, b.onOrigin])).toEqual([
      ['feature/a', false],
      ['main', true],
    ]);
    expect(calls.some((c) => c.args.includes('fetch'))).toBe(false);
  });

  it('current is null on a detached HEAD and on an unborn branch', async () => {
    const repo = makeRepo();
    git(repo, 'checkout', '--quiet', '--detach');
    const { service } = setup();
    const detached = await service.branches(repo);
    expect(detached.current).toBeNull();
    expect(detached.branches).toEqual([
      { name: 'main', commit: head(repo), current: false, onOrigin: null },
    ]);

    const unborn = tempDir('acp-unborn-');
    git(unborn, 'init', '--quiet', '-b', 'main');
    expect(await service.branches(unborn)).toEqual({
      current: null,
      hasOrigin: false,
      branches: [],
      truncated: false,
    });
  });

  it('at most 500, with truncated; names outside the safe subset are left out', async () => {
    const repo = makeRepo();
    const tip = head(repo);
    const lines = Array.from(
      { length: MAX_BRANCHES + 5 },
      (_, i) => `create refs/heads/b-${String(i).padStart(4, '0')} ${tip}\n`,
    ).join('');
    execFileSync('git', ['update-ref', '--stdin'], {
      cwd: repo,
      input: lines,
      env: { ...process.env, ...GIT_TEST_ENV },
    });
    const { service } = setup();
    const dto = ProjectBranchesDtoSchema.parse(await service.branches(repo));
    expect(dto.truncated).toBe(true);
    expect(dto.branches).toHaveLength(MAX_BRANCHES);
    expect(dto.branches[0]?.name).toBe('b-0000');

    const odd = makeRepo();
    git(odd, 'branch', 'Ünïcode');
    const oddDto = await service.branches(odd);
    expect(oddDto.branches.map((b) => b.name)).toEqual(['main']);
  });

  it('refuses a folder that is not a git repository', async () => {
    const { service } = setup();
    const error = await refusal(service.branches(tempDir('acp-plain-')));
    expect(error.code).toBe('not_a_git_repository');
    expect(codeHostHttpError(error).status).toBe(409);
  });
});

describe('create a branch', { timeout: TIMEOUT }, () => {
  it('from main, without switching or touching the owner’s checkout', async () => {
    const repo = makeRepo({ 'README.md': 'hello\n', 'src/app.ts': 'export {};\n' });
    // The owner is mid-work: a staged change, an unstaged one and an untracked file.
    write(repo, 'README.md', 'hello, staged\n');
    git(repo, 'add', 'README.md');
    write(repo, 'src/app.ts', 'export const unstaged = 1;\n');
    write(repo, 'notes.txt', 'untracked\n');
    const before = checkout(repo);
    const { service } = setup();
    const dto = await service.createBranch(repo, { name: 'dev', from: 'main' });
    expect(checkout(repo)).toEqual(before);
    expect(head(repo, 'refs/heads/dev')).toBe(head(repo));
    expect(dto.current).toBe('main');
    expect(dto.branches.map((b) => b.name)).toEqual(['dev', 'main']);
    // --no-track: the new branch follows nothing.
    expect(() => git(repo, 'config', '--get', 'branch.dev.merge')).toThrow();
  });

  it('from another branch: the new one starts at that branch’s tip', async () => {
    const repo = makeRepo();
    git(repo, 'checkout', '--quiet', '-b', 'develop');
    write(repo, 'more.txt', 'more\n');
    git(repo, 'add', 'more.txt');
    git(repo, 'commit', '--quiet', '-m', 'more');
    git(repo, 'checkout', '--quiet', 'main');
    const { service } = setup();
    await service.createBranch(repo, { name: 'release/2.0', from: 'develop' });
    expect(head(repo, 'refs/heads/release/2.0')).toBe(head(repo, 'refs/heads/develop'));
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
  });

  it('refuses an existing branch and never moves it (409 branch_exists)', async () => {
    const repo = makeRepo();
    git(repo, 'checkout', '--quiet', '-b', 'develop');
    write(repo, 'more.txt', 'more\n');
    git(repo, 'add', 'more.txt');
    git(repo, 'commit', '--quiet', '-m', 'more');
    git(repo, 'checkout', '--quiet', 'main');
    const tip = head(repo, 'refs/heads/develop');
    git(repo, 'branch', 'dev');
    const { service } = setup();
    const error = await refusal(service.createBranch(repo, { name: 'develop', from: 'main' }));
    expect(error.code).toBe('branch_exists');
    expect(codeHostHttpError(error).status).toBe(409);
    expect(error.message).toContain('develop');
    expect(head(repo, 'refs/heads/develop')).toBe(tip);
  });

  it('refuses a missing base (404 base_branch_missing); remote-only is not a base', async () => {
    const repo = makeRepo();
    withOrigin(repo);
    git(repo, 'push', '--quiet', 'origin', 'main:refs/heads/trunk');
    const { service } = setup();
    for (const from of ['nope', 'trunk']) {
      const error = await refusal(service.createBranch(repo, { name: 'dev', from }));
      expect(error.code).toBe('base_branch_missing');
      expect(codeHostHttpError(error).status).toBe(404);
    }
    expect(localBranches(repo)).toEqual(['main']);
  });

  it('refuses names git or the app does not accept', async () => {
    const repo = makeRepo();
    const { service } = setup();
    // Outside the app's safe subset: refused before git runs.
    for (const name of ['-x', 'a..b', 'HEAD', 'refs/heads/x', 'a b', 'x.lock', '@{-1}', '']) {
      await expect(service.createBranch(repo, { name, from: 'main' })).rejects.toBeInstanceOf(
        ZodError,
      );
    }
    // Inside the subset, but `git check-ref-format --branch` says no (a part ending in .lock).
    const error = await refusal(service.createBranch(repo, { name: 'x.lock/y', from: 'main' }));
    expect(error.code).toBe('invalid_branch_name');
    expect(codeHostHttpError(error).status).toBe(422);
    // A name that clashes with an existing branch's path: git refuses, said plainly.
    git(repo, 'branch', 'feature');
    expect(await code(service.createBranch(repo, { name: 'feature/x', from: 'main' }))).toBe(
      'branch_create_failed',
    );
    expect(localBranches(repo)).toEqual(['feature', 'main']);
  });

  it('with push: pushes refs/heads/<name> to origin with hooks off', async () => {
    const repo = makeRepo();
    const bare = withOrigin(repo);
    // A pre-push hook that would leave a mark: it must never run.
    write(repo, '.git/hooks/pre-push', '#!/bin/sh\ntouch "$GIT_DIR/../hook-ran"\nexit 1\n');
    execFileSync('chmod', ['+x', join(repo, '.git/hooks/pre-push')]);
    const { service, calls } = setup();
    const dto = await service.createBranch(repo, { name: 'dev', from: 'main', push: true });
    expect(bareTip(bare, 'dev')).toBe(head(repo));
    expect(dto.branches.find((b) => b.name === 'dev')?.onOrigin).toBe(true);
    const push = calls.find((c) => c.args.includes('push'));
    // F-2: origin's own address (never the remote name), the exact commit, no ext/fd transports.
    expect(push?.args).toEqual([
      ...SAFE_GIT_CONFIG,
      '-c',
      'protocol.ext.allow=never',
      '-c',
      'protocol.fd.allow=never',
      '-c',
      'push.recurseSubmodules=no',
      'push',
      '--no-verify',
      bare,
      `${head(repo)}:refs/heads/dev`,
    ]);
    // What `--set-upstream origin` did: the upstream is origin, not the address.
    expect(git(repo, 'config', '--get', 'branch.dev.remote').trim()).toBe('origin');
    expect(git(repo, 'config', '--get', 'branch.dev.merge').trim()).toBe('refs/heads/dev');
    expect(() => readFileSync(join(repo, 'hook-ran'))).toThrow();
  });

  it('push without an origin is refused before anything is created (409 no_origin)', async () => {
    const repo = makeRepo();
    const { service, calls } = setup();
    const error = await refusal(
      service.createBranch(repo, { name: 'dev', from: 'main', push: true }),
    );
    expect(error.code).toBe('no_origin');
    expect(codeHostHttpError(error).status).toBe(409);
    expect(localBranches(repo)).toEqual(['main']);
    expect(calls.some((c) => c.args.includes('branch'))).toBe(false);
  });

  it('a failed push says plainly that the branch was created locally', async () => {
    const repo = makeRepo();
    git(repo, 'remote', 'add', 'origin', join(tempDir('acp-gone-'), 'missing.git'));
    const { service, lines } = setup();
    const error = await refusal(
      service.createBranch(repo, { name: 'dev', from: 'main', push: true }),
    );
    expect(error.code).toBe('push-rejected');
    expect(error.message).toMatch(/^The app created dev in the project, but pushing it to origin/);
    expect(localBranches(repo)).toEqual(['dev', 'main']);
    // Codes only in the log: no remote path or git output.
    expect(lines.join('\n')).not.toContain('missing.git');
  });

  it('runs only git, as argument arrays without a shell, hooks disabled, never a checkout', async () => {
    const repo = makeRepo();
    withOrigin(repo);
    const { service, calls } = setup();
    await service.branches(repo);
    await service.createBranch(repo, { name: 'dev', from: 'main', push: true });
    expect(calls.length).toBeGreaterThan(5);
    for (const call of calls) {
      expect(call.file).toBe('git');
      expect(call.options.shell).toBe(false);
      expect(call.options.cwd).toBe(repo);
      expect(call.args.slice(0, SAFE_GIT_CONFIG.length)).toEqual([...SAFE_GIT_CONFIG]);
      for (const sub of ['checkout', 'switch', 'reset', 'fetch']) {
        expect(call.args).not.toContain(sub);
      }
      // F-2: the push goes to origin's address, so the app sets the remote-tracking ref itself
      // (what a push to `origin` did); it never moves any other ref.
      const at = call.args.indexOf('update-ref');
      if (at >= 0) expect(call.args[at + 1]).toBe('refs/remotes/origin/dev');
    }
    const branch = calls.find((c) => c.args.includes('branch'));
    expect(branch?.args.slice(SAFE_GIT_CONFIG.length)).toEqual([
      'branch',
      '--no-track',
      'dev',
      'refs/heads/main',
    ]);
  });
});
