/**
 * True for a POSIX absolute path or a Windows drive-absolute path (core `AbsolutePathSchema`).
 * Containment checks use `isPathInside` from `@acp/core`.
 */
export function isAbsolutePathString(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}
