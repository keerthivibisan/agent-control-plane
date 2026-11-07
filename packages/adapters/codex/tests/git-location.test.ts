import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkGitLocation, defaultTmpRoots } from '../src/git-location.js';

/*
 * Synthetic layouts built in a scratch folder. The "temp roots" are injected, so the cases do not
 * depend on where the test machine's temp folder is.
 */

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A scratch base with `fakeTmp/` (playing a writable temp root) and `safe/` (not writable). */
function base(): { fakeTmp: string; safe: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'acp-gitloc-'));
  made.push(root);
  const fakeTmp = path.join(root, 'fakeTmp');
  const safe = path.join(root, 'safe');
  mkdirSync(fakeTmp);
  mkdirSync(safe);
  return { fakeTmp, safe };
}

/** A main checkout at `main` plus a linked worktree at `wt` (the layout ACP uses). */
function linked(main: string, wt: string, name = 'wt1'): void {
  const gitDir = path.join(main, '.git', 'worktrees', name);
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(path.join(gitDir, 'commondir'), '../..\n');
  mkdirSync(wt, { recursive: true });
  writeFileSync(path.join(wt, '.git'), `gitdir: ${gitDir}\n`);
}

describe('checkGitLocation', () => {
  it('a linked worktree whose repository is outside every writable root is safe', () => {
    const { fakeTmp, safe } = base();
    linked(path.join(safe, 'repo'), path.join(safe, 'worktrees', 'a'));
    expect(checkGitLocation(path.join(safe, 'worktrees', 'a'), [], [fakeTmp])).toEqual({
      safe: true,
    });
  });

  it('a linked worktree whose repository is under a temp root is unsafe', () => {
    const { fakeTmp, safe } = base();
    linked(path.join(fakeTmp, 'repo'), path.join(safe, 'wt'));
    expect(checkGitLocation(path.join(safe, 'wt'), [], [fakeTmp])).toEqual({
      safe: false,
      reason: 'common-dir-writable',
    });
  });

  it('a worktree and repository both under a temp root are unsafe', () => {
    const { fakeTmp } = base();
    linked(path.join(fakeTmp, 'repo'), path.join(fakeTmp, 'wt'));
    expect(checkGitLocation(path.join(fakeTmp, 'wt'), [], [fakeTmp]).safe).toBe(false);
  });

  it('a repository inside an extra writable root (the run temp folder) is unsafe', () => {
    const { fakeTmp, safe } = base();
    linked(path.join(safe, 'run-tmp', 'repo'), path.join(safe, 'wt'));
    const result = checkGitLocation(path.join(safe, 'wt'), [path.join(safe, 'run-tmp')], [fakeTmp]);
    expect(result).toEqual({ safe: false, reason: 'common-dir-writable' });
  });

  it("a linked worktree's external git directory inside the worktree itself is unsafe", () => {
    const { fakeTmp, safe } = base();
    const wt = path.join(safe, 'wt');
    linked(path.join(wt, 'nested-repo'), wt);
    expect(checkGitLocation(wt, [], [fakeTmp]).safe).toBe(false);
  });

  it('a plain .git directory inside the folder is safe outside temp roots (Codex protects it)', () => {
    const { fakeTmp, safe } = base();
    mkdirSync(path.join(safe, 'repo', '.git'), { recursive: true });
    expect(checkGitLocation(path.join(safe, 'repo'), [], [fakeTmp])).toEqual({ safe: true });
  });

  it('a plain .git directory under a temp root is unsafe', () => {
    const { fakeTmp } = base();
    mkdirSync(path.join(fakeTmp, 'repo', '.git'), { recursive: true });
    expect(checkGitLocation(path.join(fakeTmp, 'repo'), [], [fakeTmp])).toEqual({
      safe: false,
      reason: 'git-dir-writable',
    });
  });

  it('a folder without .git, or with an unreadable .git file, is unsafe', () => {
    const { fakeTmp, safe } = base();
    mkdirSync(path.join(safe, 'plain'));
    expect(checkGitLocation(path.join(safe, 'plain'), [], [fakeTmp])).toEqual({
      safe: false,
      reason: 'not-a-repository',
    });
    mkdirSync(path.join(safe, 'odd'));
    writeFileSync(path.join(safe, 'odd', '.git'), 'nonsense\n');
    expect(checkGitLocation(path.join(safe, 'odd'), [], [fakeTmp]).safe).toBe(false);
  });

  it('default temp roots include /tmp, /private/tmp, the OS temp folder and $TMPDIR', () => {
    expect(defaultTmpRoots({ TMPDIR: '/synthetic/tmpdir' })).toEqual([
      '/tmp',
      '/private/tmp',
      os.tmpdir(),
      '/synthetic/tmpdir',
    ]);
  });
});
