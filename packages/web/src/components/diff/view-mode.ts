import { useCallback, useSyncExternalStore } from 'react';

/**
 * Unified or side by side: the owner's choice, remembered in this browser (`acp.diff.view` in
 * localStorage) and shared by every diff on the page, so switching one switches them all. Storage
 * can be unavailable (private windows, blocked site data), so every access is guarded and a miss
 * means the default, unified, as in `sidebar-state.ts`.
 */
export type DiffViewMode = 'unified' | 'split';

export const VIEW_MODE_KEY = 'acp.diff.view';

export function readViewMode(): DiffViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
}

const listeners = new Set<() => void>();
let current: DiffViewMode | null = null;

function snapshot(): DiffViewMode {
  current ??= readViewMode();
  return current;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab's choice applies here too.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== VIEW_MODE_KEY) return;
    current = readViewMode();
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function setViewMode(mode: DiffViewMode): void {
  current = mode;
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Not remembering is harmless: the choice lasts until the page reloads.
  }
  for (const l of listeners) l();
}

/** Forgets the in-memory choice so the next read comes from storage (tests). */
export function resetViewModeForTests(): void {
  current = null;
}

export function useViewMode(): [DiffViewMode, (mode: DiffViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, snapshot, () => 'unified' as const);
  const set = useCallback((m: DiffViewMode) => setViewMode(m), []);
  return [mode, set];
}
