import path from 'node:path';

/**
 * Segment-wise containment: true when `child` equals `root` or lies below it. `/repo-evil` is not
 * inside `/repo` (docs/security.md §2.2). Callers pass realpath-normalized absolute paths when the
 * paths exist on disk; this function itself does no I/O.
 *
 * Duplicates the planned core helper (P1-A task A6) so this package does not wait on it; swap it
 * for the core export once that lands.
 */
export function isPathInside(child: string, root: string): boolean {
  if (!path.isAbsolute(child) || !path.isAbsolute(root)) return false;
  const c = splitSegments(child);
  const r = splitSegments(root);
  if (r.length > c.length) return false;
  return r.every((seg, i) => seg === c[i]);
}

function splitSegments(p: string): string[] {
  return path
    .resolve(p)
    .split(/[\\/]+/)
    .filter((s) => s.length > 0);
}

/** True for a POSIX absolute path or a Windows drive-absolute path (core `AbsolutePathSchema`). */
export function isAbsolutePathString(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}
