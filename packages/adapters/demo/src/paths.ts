import path from 'node:path';

/**
 * Segment-wise containment for POSIX paths: `/repo-evil` is not inside `/repo` (docs/security.md
 * §2.2). Demo cwds are synthetic POSIX paths, so no realpath is involved.
 */
export function isInsidePosix(child: string, root: string): boolean {
  const c = segments(child);
  const r = segments(root);
  if (c === null || r === null || r.length > c.length) return false;
  return r.every((seg, i) => seg === c[i]);
}

function segments(p: string): string[] | null {
  if (!p.startsWith('/')) return null;
  return path.posix
    .normalize(p)
    .split('/')
    .filter((s) => s.length > 0);
}
