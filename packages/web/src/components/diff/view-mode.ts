import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react';

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

// --- Room for side by side (G-D) ----------------------------------------------------------------

/** The side-by-side table's minimum width (`min-w-[36rem]` in DiffFileView). */
export const SPLIT_MIN_REM = 36;
/** The file card's border, left and right, around the table. */
const FILE_FRAME_PX = 2;

/**
 * Whether side by side fits a viewer `width` pixels wide without scrolling sideways. A width of 0
 * (not laid out yet, or hidden in a closed disclosure) says nothing, so it counts as fitting.
 */
export function splitFits(width: number, remPx: number): boolean {
  return width <= 0 || width >= SPLIT_MIN_REM * remPx + FILE_FRAME_PX;
}

function rootFontPx(): number {
  try {
    const px = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(px) && px > 0 ? px : 16;
  } catch {
    return 16;
  }
}

/**
 * Whether the element has room for side by side, followed as it is resized (a side panel, a
 * window, a narrow phone). Without ResizeObserver (jsdom, old browsers) it always fits, so the
 * owner's choice applies as before.
 */
export function useSplitFits(el: HTMLElement | null): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const check = (width: number) => setFits(splitFits(width, rootFontPx()));
    check(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last !== undefined) check(last.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return fits;
}
