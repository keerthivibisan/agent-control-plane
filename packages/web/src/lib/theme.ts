import { useEffect, useSyncExternalStore } from 'react';

/*
 * The colour theme (DESIGN.md, "Theme"): Light, Dark or System (follow the computer), chosen in
 * the top bar's theme menu and in Settings, remembered in this browser. One small store, so every
 * control shows the same choice. `index.html` runs the same rule in an inline script before the
 * page paints (no flash of the wrong theme); keep the key and the class in step with it.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];
export const THEME_STORAGE_KEY = 'acp.theme';
const QUERY = '(prefers-color-scheme: dark)';

export function readThemePreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function writeThemePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  return pref === 'dark' || (pref === 'system' && systemDark) ? 'dark' : 'light';
}

/** Sets `.dark` and `color-scheme` on <html> for a preference (System reads the media query). */
export function applyTheme(pref: ThemePreference): void {
  const dark = resolveTheme(pref, systemPrefersDark()) === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

// The store: the preference in memory (read once from storage), and who to tell when it changes.
let current: ThemePreference | null = null;
const listeners = new Set<() => void>();

function preference(): ThemePreference {
  current ??= readThemePreference();
  return current;
}

function emit(): void {
  for (const l of listeners) l();
}

/** Choose a theme: applied at once, remembered in this browser, shown by every theme control. */
export function setThemePreference(pref: ThemePreference): void {
  current = pref;
  writeThemePreference(pref);
  applyTheme(pref);
  emit();
}

function subscribePreference(onChange: () => void): () => void {
  listeners.add(onChange);
  // A choice made in another tab of the app.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY && e.key !== null) return;
    current = readThemePreference();
    applyTheme(current);
    emit();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function subscribeSystem(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** Forget the in-memory choice (tests: each one starts from storage). */
export function resetThemeStore(): void {
  current = null;
}

/**
 * The theme: the stored preference, what it resolves to now, and the setter. System follows
 * `prefers-color-scheme` live: when the computer switches, the page switches with it.
 */
export function useTheme(): {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (pref: ThemePreference) => void;
} {
  const pref = useSyncExternalStore(subscribePreference, preference, () => 'system' as const);
  const systemDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => false);
  const resolved = resolveTheme(pref, systemDark);

  useEffect(() => {
    applyTheme(pref);
  }, [pref, systemDark]);

  return { preference: pref, resolved, setPreference: setThemePreference };
}
