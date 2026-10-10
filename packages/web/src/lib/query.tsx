import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Schema } from './api';
import type { QueryState, QueryStore } from './query-store';

const StoreContext = createContext<QueryStore | null>(null);

export function ApiProvider({ store, children }: { store: QueryStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useQueryStore(): QueryStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useQueryStore must be used inside <ApiProvider>');
  return store;
}

const IDLE: QueryState<never> = Object.freeze({ data: undefined, error: null, fetching: false });
const noopUnsubscribe = () => {};

/**
 * Subscribe to one API path. `path: null` disables the query (for example, before a selection).
 * `schema` must be a module-level constant (see `schemas` in api.ts) so the subscription is stable.
 */
export function useApiQuery<T>(path: string | null, schema: Schema<T>): QueryState<T> {
  const store = useQueryStore();
  const subscribe = useCallback(
    (onChange: () => void) =>
      path === null ? noopUnsubscribe : store.subscribe(path, schema, onChange),
    [store, path, schema],
  );
  const getSnapshot = useCallback(
    (): QueryState<T> => (path === null ? IDLE : store.getState<T>(path)),
    [store, path],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
