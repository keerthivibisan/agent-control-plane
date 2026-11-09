import type { CodeMapStatus } from '@acp/core/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  codeMapPaths,
  codeMapSchemas,
  isCodeMapPath,
  refreshCodeMap,
} from '../../lib/api';
import { useApiQuery, useQueryStore } from '../../lib/query';

export const POLL_MS = 2_000;
export const POLL_LIMIT_MS = 5 * 60_000;

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError({
    kind: 'parse',
    path: '',
    message: e instanceof Error ? e.message : 'unknown client error',
  });
}

/**
 * The project's code map summary, the Refresh action, and polling: there is no push event for a
 * build, so while the summary reads `building` it is fetched again every `pollMs`, for at most
 * `limitMs` (then `slow` is set and polling stops). When a new map arrives, the cached graph, file
 * and search reads of the project are fetched again.
 */
export function useCodeMap(
  projectId: string,
  { pollMs = POLL_MS, limitMs = POLL_LIMIT_MS }: { pollMs?: number; limitMs?: number } = {},
) {
  const store = useQueryStore();
  const path = codeMapPaths.summary(projectId);
  const summary = useApiQuery(path, codeMapSchemas.summary);
  const status: CodeMapStatus | undefined = summary.data?.status;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [slow, setSlow] = useState(false);
  const builtAt = summary.data?.manifest?.builtAt ?? null;
  const previousBuilt = useRef<string | null>(null);
  const matchAll = useMemo(() => isCodeMapPath(projectId), [projectId]);

  // A new map (a build ended, here or elsewhere): read the graph, file and search views again.
  useEffect(() => {
    const was = previousBuilt.current;
    previousBuilt.current = builtAt;
    if (was !== null && builtAt !== was) store.invalidate((key) => key !== path && matchAll(key));
  }, [builtAt, store, matchAll, path]);

  // A build that ended clears "taking long", so the next build polls again.
  const [seenStatus, setSeenStatus] = useState(status);
  if (status !== seenStatus) {
    setSeenStatus(status);
    if (status !== 'building') setSlow(false);
  }

  useEffect(() => {
    if (status !== 'building' || slow) return;
    // Counted in ticks, not by the clock, so tests and slow tabs agree on the limit.
    let ticks = 0;
    const maxTicks = Math.max(1, Math.ceil(limitMs / pollMs));
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > maxTicks) {
        clearInterval(timer);
        setSlow(true);
        return;
      }
      store.invalidate((key) => key === path);
    }, pollMs);
    return () => clearInterval(timer);
  }, [status, slow, pollMs, limitMs, store, path]);

  const refresh = useCallback(async () => {
    setPending(true);
    setError(null);
    setSlow(false);
    try {
      await refreshCodeMap(store.client, projectId);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setPending(false);
      store.invalidate((key) => key === path);
    }
  }, [store, projectId, path]);

  return { summary, pending, error, slow, refresh };
}
