import { useCallback, useMemo } from 'react';
import { scopeId, type ReviewScope } from './pending-review';
import { keysWithPrefix, readRaw, useStoredRaw, writeRaw } from './storage';

/**
 * The files the owner marked as viewed (v0.3.0 D-A), per change and commit, in this browser: a
 * new commit (a rework, the branch moving on) starts with nothing viewed, as on GitHub when a file
 * changes. Writing a commit's list drops the scope's lists for older commits.
 */

export const VIEWED_PREFIX = 'acp.review.viewed.';

function scopePrefix(scope: ReviewScope): string {
  return `${VIEWED_PREFIX}${scopeId(scope)}@`;
}

export function viewedKey(scope: ReviewScope, commit: string | null): string {
  return `${scopePrefix(scope)}${commit ?? 'none'}`;
}

/** Stored paths; anything that isn't a list of strings counts as nothing viewed. */
export function parseViewed(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return new Set();
    return new Set(data.filter((p): p is string => typeof p === 'string'));
  } catch {
    return new Set();
  }
}

export function readViewed(scope: ReviewScope, commit: string | null): Set<string> {
  return parseViewed(readRaw(viewedKey(scope, commit)));
}

export function writeViewed(
  scope: ReviewScope,
  commit: string | null,
  paths: ReadonlySet<string>,
): void {
  const key = viewedKey(scope, commit);
  for (const old of keysWithPrefix(scopePrefix(scope))) if (old !== key) writeRaw(old, null);
  writeRaw(key, paths.size === 0 ? null : JSON.stringify([...paths].sort()));
}

/** Marks `path` viewed (or not) in a copy of `viewed`. */
export function toggleViewed(viewed: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(viewed);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

export function useViewed(scope: ReviewScope, commit: string | null) {
  const { runId, agentRunId } = scope;
  const raw = useStoredRaw(viewedKey(scope, commit));
  const viewed = useMemo(() => parseViewed(raw), [raw]);
  const toggle = useCallback(
    (path: string) => {
      const s = { runId, agentRunId };
      writeViewed(s, commit, toggleViewed(readViewed(s, commit), path));
    },
    [runId, agentRunId, commit],
  );
  return { viewed, toggle };
}
