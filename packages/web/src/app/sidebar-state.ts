import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Whether the sidebar is the full list or the slim icon rail. The owner's choice (the toggle or
 * ⌘B/Ctrl+B) is remembered in this browser only; with no choice stored, the sidebar follows the
 * screen: full above 1280px, the rail at 1280px and below (DESIGN.md, "Layout"). Storage can be
 * unavailable (private windows, blocked site data), so every access is guarded and a miss just
 * means "no choice yet", as in `last-project.ts`.
 */
const KEY = 'acp.sidebar';

export type SidebarChoice = 'collapsed' | 'expanded';

/** The `wide:` breakpoint (index.css `--breakpoint-wide`, 1281px). */
export const WIDE_QUERY = '(min-width: 80.0625rem)';

export function readSidebarChoice(): SidebarChoice | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'collapsed' || v === 'expanded' ? v : null;
  } catch {
    return null;
  }
}

export function rememberSidebarChoice(choice: SidebarChoice): void {
  try {
    window.localStorage.setItem(KEY, choice);
  } catch {
    // Not remembering is harmless: the choice lasts until the page reloads.
  }
}

/** Collapsed unless the owner chose otherwise; without a choice, collapsed on narrow screens. */
export function isSidebarCollapsed(choice: SidebarChoice | null, wide: boolean): boolean {
  return choice === null ? !wide : choice === 'collapsed';
}

function wideNow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;
}

function subscribeWide(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(WIDE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** Apple keyboards say ⌘; everything else says Ctrl. */
export function isMacLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/**
 * The shortcut that toggles the sidebar: ⌘B on Apple keyboards, Ctrl+B elsewhere (Ctrl+B on a
 * Mac moves the caret in text fields, so it is left alone there).
 */
export function isSidebarShortcut(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  mac: boolean,
): boolean {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b';
}

export function useSidebar(): { collapsed: boolean; toggle: () => void } {
  const [choice, setChoice] = useState<SidebarChoice | null>(readSidebarChoice);
  const wide = useSyncExternalStore(subscribeWide, wideNow, () => true);
  const collapsed = isSidebarCollapsed(choice, wide);

  const toggle = useCallback(() => {
    const next: SidebarChoice = collapsed ? 'expanded' : 'collapsed';
    setChoice(next);
    rememberSidebarChoice(next);
  }, [collapsed]);

  useEffect(() => {
    const mac = isMacLike();
    const onKey = (e: KeyboardEvent) => {
      // A field or editor that handles the keys itself (bold, say) wins.
      if (e.defaultPrevented || !isSidebarShortcut(e, mac)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { collapsed, toggle };
}
