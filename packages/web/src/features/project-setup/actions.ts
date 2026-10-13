import { useCallback, useState } from 'react';
import { ApiError, type ApiClient } from '../../lib/api';
import { useQueryStore } from '../../lib/query';

export interface SetupActionState<R> {
  pending: boolean;
  error: ApiError | null;
  /** The last successful result, until the next attempt. */
  result: R | null;
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
 * One project-setup mutation (`fn` is a module-level function from lib/api.ts). Afterwards, also
 * after a failure, the cached views `invalidate` matches are refetched, because a refusal often
 * means the state changed (the harness file was edited, a ticket already exists). Resolves to null
 * on failure; the error stays in `error` for the UI to explain.
 */
export function useSetupAction<A extends unknown[], R>(
  fn: (client: ApiClient, ...args: A) => Promise<R>,
  invalidate: (key: string) => boolean,
) {
  const store = useQueryStore();
  const [state, setState] = useState<SetupActionState<R>>({
    pending: false,
    error: null,
    result: null,
  });

  const run = useCallback(
    async (...args: A): Promise<R | null> => {
      setState({ pending: true, error: null, result: null });
      try {
        const result = await fn(store.client, ...args);
        setState({ pending: false, error: null, result });
        return result;
      } catch (e) {
        setState({ pending: false, error: toApiError(e), result: null });
        return null;
      } finally {
        store.invalidate(invalidate);
      }
    },
    [store, fn, invalidate],
  );

  return { ...state, run };
}
