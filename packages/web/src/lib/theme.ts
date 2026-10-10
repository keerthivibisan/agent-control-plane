import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'acp.theme';
const QUERY = '(prefers-color-scheme: dark)';

export function readThemePreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

export function applyTheme(pref: ThemePreference): void {
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

function subscribeSystem(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** Light/dark theme: follows `prefers-color-scheme` until the user picks one with the toggle. */
export function useTheme(): {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  cycle: () => void;
} {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  const systemDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => false);
  const resolved =
    preference === 'dark' || (preference === 'system' && systemDark) ? 'dark' : 'light';

  useEffect(() => {
    applyTheme(preference);
    try {
      if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts for this page only.
    }
  }, [preference, systemDark]);

  const cycle = useCallback(() => {
    setPreference((p) => (p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system'));
  }, []);

  return { preference, resolved, cycle };
}
