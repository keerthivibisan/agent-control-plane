import { useCallback, useState } from 'react';
import { ApiError, isControlPath, type ApiClient } from '../../lib/api';
import { useQueryStore } from '../../lib/query';

export interface ActionState {
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
 * Runs one control-panel mutation (`fn` must be a module-level function from lib/api.ts) and then
 * refetches the control-panel views, also after a failure, because a refusal often means the run
 * moved on (an approval expired, an agent already stopped). Resolves to null on failure; the error
 * stays in `error` for the UI to explain.
 */
export function useControlAction<A extends unknown[], R>(
  fn: (client: ApiClient, ...args: A) => Promise<R>,
) {
  const store = useQueryStore();
  const [state, setState] = useState<ActionState>({ pending: false, error: null });

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
        store.invalidate(isControlPath);
      }
    },
    [store, fn],
  );
  const reset = useCallback(() => setState({ pending: false, error: null }), []);

  return { ...state, run, reset };
}
