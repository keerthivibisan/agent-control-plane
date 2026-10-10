import { compareStrings } from '../usage/ordering.js';

/**
 * Pure POSIX path containment (docs/security.md §2.2, docs/domain-model.md Project).
 *
 * These functions only do string logic. The caller must `realpath` both sides first, so symlinks
 * are already resolved; `..` handling here is lexical. Comparison is case-sensitive: `realpath`
 * returns the on-disk spelling, even on case-insensitive file systems.
 */

/**
 * Normalizes a POSIX absolute path: collapses repeated and trailing slashes and resolves `.` and
 * `..` segments (`..` at the root stays at the root). Returns null for anything that is not a POSIX
 * absolute path, including Windows-style paths (`C:\repo`, `C:/repo`, `\\server\share`) and paths
 * containing NUL.
 */
export function normalizePosixPath(path: string): string | null {
  if (!path.startsWith('/') || path.includes('\0')) return null;
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

function segmentsOf(normalized: string): string[] {
  return normalized === '/' ? [] : normalized.slice(1).split('/');
}

/**
 * Whether `candidate` is `root` or inside it, compared segment by segment, so `/repo-evil` is not
 * inside `/repo` (a plain `startsWith` would say it is). Either path being invalid gives false.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const r = normalizePosixPath(root);
  const c = normalizePosixPath(candidate);
  if (r === null || c === null) return false;
  const rootSegments = segmentsOf(r);
  const candidateSegments = segmentsOf(c);
  if (rootSegments.length > candidateSegments.length) return false;
  return rootSegments.every((segment, i) => candidateSegments[i] === segment);
}

/**
 * The registered root that owns `cwd`. Nested roots are allowed, and the deepest (longest) match
 * wins, so a package registered inside a monorepo claims its own sessions. Roots that normalize to
 * the same path are tie-broken by their raw `rootPath`, so the answer does not depend on list order.
 * Returns null when no root contains `cwd`.
 */
export function findOwningRoot<T extends { rootPath: string }>(
  roots: readonly T[],
  cwd: string,
): T | null {
  let best: T | null = null;
  let bestDepth = -1;
  for (const root of roots) {
    if (!isPathInside(root.rootPath, cwd)) continue;
    const normalized = normalizePosixPath(root.rootPath);
    if (normalized === null) continue;
    const depth = segmentsOf(normalized).length;
    if (
      depth > bestDepth ||
      (best !== null && depth === bestDepth && compareStrings(root.rootPath, best.rootPath) < 0)
    ) {
      best = root;
      bestDepth = depth;
    }
  }
  return best;
}
