import { useCallback, useState } from 'react';
import { ApiError, isTicketPagePath, type ApiClient } from '../../lib/api';
import { useQueryStore } from '../../lib/query';
import type { ActionState } from '../control/actions';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError({
    kind: 'parse',
    path: '',
    message: e instanceof Error ? e.message : 'unknown client error',
  });
}

/**
 * One ticket-page mutation (`fn` must be a module-level function from lib/api.ts), like
 * `useControlAction`, but it refetches the ticket views as well as the run views afterwards (also
 * after a failure: a refusal often means the ticket or run moved on). Resolves to null on failure;
 * the error stays in `error` for the UI to explain.
 */
export function useTicketAction<A extends unknown[], R>(
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
        store.invalidate(isTicketPagePath);
      }
    },
    [store, fn],
  );
  const reset = useCallback(() => setState({ pending: false, error: null }), []);

  return { ...state, run, reset };
}
