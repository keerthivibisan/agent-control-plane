import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';
import { createGitRunner, type ExecFileFn, type GitRunner } from '../../src/workspace/index.js';

/**
 * Every repository here is a throwaway `git init` in a temp dir. Git never sees this checkout's
 * repository or the owner's global config: inherited GIT_* variables are dropped and the global and
 * system config files are disabled.
 */

export const GIT_TEST_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  // Never guess an identity from the user name and host name: macOS can, a CI runner can't, so a
  // test that commits without an identity must fail everywhere, not only on CI.
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'user.useConfigOnly',
  GIT_CONFIG_VALUE_0: 'true',
};

/**
 * `GIT_TEST_ENV` plus a fixed identity, as an owner's git config would give it. Set as config through
 * the environment, so an explicit `git -c user.name=…` (the app's own commits) still wins.
 */
export const GIT_TEST_IDENTITY_ENV: Readonly<Record<string, string>> = {
  ...GIT_TEST_ENV,
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_1: 'user.name',
  GIT_CONFIG_VALUE_1: 'Test Owner',
  GIT_CONFIG_KEY_2: 'user.email',
  GIT_CONFIG_VALUE_2: 'owner@example.invalid',
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

export function tempDir(prefix = 'acp-ws-test-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function testEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return { ...env, ...GIT_TEST_ENV, LC_ALL: 'C' };
}

/** Test-side git for arranging repositories (argument arrays, no shell, like the product). */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test Owner', '-c', 'user.email=owner@example.invalid', ...args],
    { cwd, env: testEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

export function write(root: string, path: string, content: string | Buffer): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** A repo on `main` with one commit containing `files`. */
export function makeRepo(files: Record<string, string> = { 'README.md': 'hello\n' }): string {
  const repo = tempDir('acp-ws-repo-');
  git(repo, 'init', '--quiet', '-b', 'main');
  for (const [path, content] of Object.entries(files)) write(repo, path, content);
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', 'initial');
  return repo;
}

export function head(repo: string, ref = 'HEAD'): string {
  return git(repo, 'rev-parse', ref).trim();
}

export interface ExecCall {
  file: string;
  args: unknown;
  options: Parameters<ExecFileFn>[2];
}

/** The real runner with a spy on `execFile`, recording every process the manager starts. */
export function spyingGit(): { git: GitRunner; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const execFile: ExecFileFn = (file, args, options, callback) => {
    calls.push({ file, args: [...args], options });
    execFileReal(file, args, options, callback);
  };
  return { git: createGitRunner({ execFile, env: GIT_TEST_ENV }), calls };
}

const execFileReal: ExecFileFn = (file, args, options, callback) => {
  execFile(file, args, options, callback);
};
