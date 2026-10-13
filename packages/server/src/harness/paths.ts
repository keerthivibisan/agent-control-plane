import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { HarnessError } from './errors.js';

/** Resolves an absolute directory through symlinks (macOS `/var` → `/private/var`). */
export async function realDirectory(path: string): Promise<string> {
  if (!isAbsolute(path))
    throw new HarnessError('invalid-root', 'The folder must be an absolute path');
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    throw new HarnessError('invalid-root', 'The folder does not exist');
  }
  if (!(await stat(real)).isDirectory()) {
    throw new HarnessError('invalid-root', 'The path is not a folder');
  }
  return real;
}

export function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * The real path of a repo-relative `rel` under the already-real `root`, or null when it does not
 * exist or resolves outside `root` (a symlink pointing elsewhere, or a path with `..`). Every file
 * or folder the harness touches goes through this, so a repository can never point it at
 * `~/.claude` or anywhere else outside the checkout.
 */
export async function resolveInside(root: string, rel: string): Promise<string | null> {
  let real: string;
  try {
    real = await realpath(join(root, rel));
  } catch {
    return null;
  }
  return isInside(root, real) ? real : null;
}
