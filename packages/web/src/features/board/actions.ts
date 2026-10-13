import { useCallback, useState } from 'react';
import { ApiError, isBoardPath, isControlPath, type ApiClient } from '../../lib/api';
import { useQueryStore } from '../../lib/query';

export interface BoardActionState {
  pending: boolean;
  error: ApiError | null;
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError({
    kind: 'parse',
    path: '',
    message: e instanceof Error ? e.message : 'unknown client error',
  });
}

/**
 * Runs one board mutation (`fn` must be a module-level function from lib/api.ts), then refetches
 * the board and ticket views, and the run views too because starting a ticket creates a run. It
 * refetches after a failure as well: a refusal usually means the ticket moved on meanwhile.
 * Resolves to null on failure; the error stays in `error` for the UI to explain.
 */
export function useBoardAction<A extends unknown[], R>(
  fn: (client: ApiClient, ...args: A) => Promise<R>,
) {
  const store = useQueryStore();
  const [state, setState] = useState<BoardActionState>({ pending: false, error: null });

  const run = useCallback(
    async (...args: A): Promise<R | null> => {
      setState({ pending: true, error: null });
      try {
        const result = await fn(store.client, ...args);
        setState({ pending: false, error: null });
        return result;
      } catch (e) {
        setState({ pending: false, error: toApiError(e) });
        return null;
      } finally {
        store.invalidate((key) => isBoardPath(key) || isControlPath(key));
      }
    },
    [store, fn],
  );
  const reset = useCallback(() => setState({ pending: false, error: null }), []);

  return { ...state, run, reset };
}
