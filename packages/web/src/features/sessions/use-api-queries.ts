import { useEffect, useReducer, useRef } from 'react';
import type { Schema } from '../../lib/api';
import { useQueryStore } from '../../lib/query';
import type { QueryState } from '../../lib/query-store';

/**
 * `useApiQuery` for a list of paths whose length changes at runtime (a hook per path would break
 * the rules of hooks). Subscribes to new paths and drops removed ones without touching the rest,
 * so already-loaded paths are not refetched when one is added. `schema` must be a module-level
 * constant, as for `useApiQuery`.
 *
 * Local to the sessions screens; proposed as a shared hook in lib/query.tsx.
 */
export function useApiQueries<T>(paths: readonly string[], schema: Schema<T>): QueryState<T>[] {
  const store = useQueryStore();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const subscriptions = useRef(new Map<string, () => void>());
  const key = paths.join('\n');

  useEffect(() => {
    const wanted = new Set(key === '' ? [] : key.split('\n'));
    const subs = subscriptions.current;
    for (const [path, unsubscribe] of subs) {
      if (wanted.has(path)) continue;
      unsubscribe();
      subs.delete(path);
    }
    for (const path of wanted) {
      if (!subs.has(path)) subs.set(path, store.subscribe(path, schema, rerender));
    }
  }, [store, schema, key]);

  useEffect(() => {
    const subs = subscriptions.current;
    return () => {
      for (const unsubscribe of subs.values()) unsubscribe();
      subs.clear();
    };
  }, []);

  return paths.map((p) => store.getState<T>(p));
}
