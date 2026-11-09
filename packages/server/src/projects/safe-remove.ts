import { realpath, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isPathInside } from '@acp/core';

/**
 * Deleting ACP's own folders with the file system only (ADR-0036 §2): no git command runs, and
 * only a path that resolves strictly inside the data directory is ever removed.
 */

export type SafeRemoveOutcome = 'removed' | 'missing' | 'refused';

export interface SafeRemoveOptions {
  /** Real paths that must never be removed, nor anything that contains them (the project folder). */
  protect?: readonly string[];
}

/**
 * Removes `path` (absolute, or relative to `dataDir`) recursively when its real path is strictly
 * inside the data directory's real path and neither is nor contains a protected path.
 *
 * - The path is resolved with `realpath` first, so a symlink that points out of the data
 *   directory is refused, not followed and not removed.
 * - The resolved path is what gets removed, and `rm` does not follow symlinks inside the tree, so
 *   nothing outside it is touched.
 * - A path that does not exist is `missing`, which is not an error.
 */
export async function removeInsideDataDir(
  dataDir: string,
  path: string,
  options: SafeRemoveOptions = {},
): Promise<SafeRemoveOutcome> {
  const absolute = isAbsolute(path) ? path : join(dataDir, path);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return 'missing';
    throw error;
  }
  const root = await realpath(dataDir);
  if (real === root || !isPathInside(root, real)) return 'refused';
  for (const protectedPath of options.protect ?? []) {
    if (isPathInside(protectedPath, real) || isPathInside(real, protectedPath)) return 'refused';
  }
  await rm(real, { recursive: true, force: true });
  return 'removed';
}
