import { useCallback, useSyncExternalStore } from 'react';

/**
 * The review page's memory in this browser (localStorage): the pending review and the viewed
 * files. Storage can be unavailable (private windows, blocked site data) or full, so every access
 * is guarded, as in `sidebar-state.ts`: a failed read is "nothing stored", a failed write keeps
 * the value for this page only. Stored text is data from an earlier visit (or another tab), so
 * each reader checks its shape before using it. Nothing here leaves the browser.
 */

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Values written while storage refused them: they last until the page reloads. */
const memory = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();

export function readRaw(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stores `value` (null removes it) and tells every reader of the key on this page. */
export function writeRaw(key: string, value: string | null): void {
  try {
    const s = storage();
    if (s === null) throw new Error('no storage');
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
  for (const l of listeners.get(key) ?? []) l();
}

/** Every stored key that starts with `prefix` (to drop a scope's older entries). */
export function keysWithPrefix(prefix: string): string[] {
  const out = new Set<string>();
  try {
    const s = storage();
    if (s !== null) {
      for (let i = 0; i < s.length; i += 1) {
        const k = s.key(i);
        if (k?.startsWith(prefix) === true) out.add(k);
      }
    }
  } catch {
    // Unreadable storage holds nothing to drop.
  }
  for (const k of memory.keys()) if (k.startsWith(prefix)) out.add(k);
  return [...out];
}

function subscribe(key: string, onChange: () => void): () => void {
  let set = listeners.get(key);
  if (set === undefined) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onChange);
  // Another tab's change applies here too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === key || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    set.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** The raw stored string of `key`, kept in step with writes on this page and in other tabs. */
export function useStoredRaw(key: string): string | null {
  const sub = useCallback((onChange: () => void) => subscribe(key, onChange), [key]);
  const get = useCallback(() => readRaw(key), [key]);
  return useSyncExternalStore(sub, get, () => null);
}

/** Forgets the page-only values (tests). */
export function resetReviewStorageForTests(): void {
  memory.clear();
}
