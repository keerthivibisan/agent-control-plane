import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * F-1 for Codex (CX-1 result 8): only the app commits and moves refs. Codex's sandbox keeps a
 * writable root's own `.git` read-only, and a linked worktree's common git directory normally lies
 * outside every writable root, so `git commit` and `git checkout -b` fail there. But a repository
 * under a writable temp folder had a branch created. A writing Codex agent therefore never starts
 * when its git directories sit where it can write.
 */

export type GitLocationResult =
  | { safe: true }
  | { safe: false; reason: 'not-a-repository' | 'git-dir-writable' | 'common-dir-writable' };

/** The temp folders counted as writable, whatever the turn's policy says (belt and braces). */
export function defaultTmpRoots(env: Readonly<Record<string, string | undefined>>): string[] {
  const roots = ['/tmp', '/private/tmp', os.tmpdir()];
  const tmpdir = env['TMPDIR'];
  if (tmpdir !== undefined && tmpdir !== '') roots.push(tmpdir);
  return roots;
}

/** `p` through symlinks when it exists, else lexically resolved. */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function inside(child: string, dir: string): boolean {
  const relative = path.relative(dir, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Whether a writing agent in `cwd` could write its repository's git data:
 * - `cwd/.git` is read; a file (`gitdir: …`, a linked worktree) is followed to the worktree's git
 *   directory and its `commondir`, both resolved through symlinks;
 * - unsafe when either directory lies inside a writable root: the temp folders (`tmpRoots`), the
 *   extra roots (the run's temp folder), and `cwd` itself only for a linked worktree's external
 *   git directory (a plain `.git` inside `cwd` is protected by Codex);
 * - no `.git` at all is unsafe: git would search the parent folders, and that is not checked.
 */
export function checkGitLocation(
  cwd: string,
  extraWritableRoots: readonly string[],
  tmpRoots: readonly string[],
): GitLocationResult {
  const dotGit = path.join(cwd, '.git');
  let isFile: boolean;
  try {
    const stat = lstatSync(dotGit);
    if (!stat.isFile() && !stat.isDirectory()) return { safe: false, reason: 'not-a-repository' };
    isFile = stat.isFile();
  } catch {
    return { safe: false, reason: 'not-a-repository' };
  }
  const roots = [...tmpRoots, ...extraWritableRoots].map(real);
  if (!isFile) {
    const gitDir = real(dotGit);
    return roots.some((root) => inside(gitDir, root))
      ? { safe: false, reason: 'git-dir-writable' }
      : { safe: true };
  }
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dotGit) ?? '');
  if (match?.[1] === undefined) return { safe: false, reason: 'not-a-repository' };
  const gitDir = real(path.resolve(cwd, match[1]));
  const commonText = readText(path.join(gitDir, 'commondir'))?.trim() ?? '';
  const commonDir = commonText === '' ? gitDir : real(path.resolve(gitDir, commonText));
  const withCwd = [...roots, real(cwd)];
  if (withCwd.some((root) => inside(commonDir, root))) {
    return { safe: false, reason: 'common-dir-writable' };
  }
  if (withCwd.some((root) => inside(gitDir, root))) {
    return { safe: false, reason: 'git-dir-writable' };
  }
  return { safe: true };
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
