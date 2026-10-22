/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeChoice, ThemeMenu } from '../../src/components/ThemeSwitch';
import {
  readThemePreference,
  resetThemeStore,
  resolveTheme,
  setThemePreference,
  THEME_STORAGE_KEY,
} from '../../src/lib/theme';

/*
 * v0.3.0 D-0: the theme (DESIGN.md, "Theme"). Light, Dark and System in the top bar's menu and in
 * Settings, one store for both, remembered in this browser (guarded), System following
 * prefers-color-scheme live, and index.html's inline script setting the theme before React.
 */

const html = document.documentElement;
const isDark = () => html.classList.contains('dark');

/** A controllable `(prefers-color-scheme: dark)`: `set(true)` is the computer switching to dark. */
function systemScheme(initial: boolean) {
  let dark = initial;
  const listeners = new Set<() => void>();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return query === '(prefers-color-scheme: dark)' && dark;
        },
        media: query,
        onchange: null,
        addEventListener: (_: string, l: () => void) => listeners.add(l),
        removeEventListener: (_: string, l: () => void) => listeners.delete(l),
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
  return {
    set(next: boolean) {
      dark = next;
      act(() => {
        for (const l of listeners) l();
      });
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetThemeStore();
  html.classList.remove('dark');
  html.style.colorScheme = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetThemeStore();
  html.classList.remove('dark');
});

describe('theme preference', () => {
  it('resolves Light, Dark and System', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('is remembered in this browser; System is the absence of a choice', () => {
    expect(readThemePreference()).toBe('system');
    setThemePreference('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(isDark()).toBe(true);
    expect(html.style.colorScheme).toBe('dark');
    resetThemeStore();
    expect(readThemePreference()).toBe('dark');
    setThemePreference('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    // Junk in storage reads as System.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemePreference()).toBe('system');
  });

  it('works without storage: the choice lasts for the page', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);
    expect(readThemePreference()).toBe('system');
    expect(() => setThemePreference('dark')).not.toThrow();
    expect(isDark()).toBe(true);
  });
});

describe('theme menu (top bar)', () => {
  it('offers Light, Dark and System with the current one checked, and applies a choice', () => {
    systemScheme(false);
    render(<ThemeMenu />);
    const button = screen.getByTestId('theme-menu');
    expect(button.getAttribute('aria-label')).toBe('Theme: System (light). Change theme');
    fireEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Theme' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      'Light',
      'Dark',
      'SystemFollows your computer',
    ]);
    expect(screen.getByTestId('theme-system').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByTestId('theme-dark'));
    expect(isDark()).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(button.getAttribute('aria-label')).toBe('Theme: Dark. Change theme');
    fireEvent.click(button);
    expect(screen.getByTestId('theme-dark').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('theme-light'));
    expect(isDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('System follows the computer live; a fixed choice ignores it', () => {
    const scheme = systemScheme(false);
    render(<ThemeMenu />);
    const button = screen.getByTestId('theme-menu');
    expect(isDark()).toBe(false);
    scheme.set(true);
    expect(isDark()).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Theme: System (dark). Change theme');
    act(() => setThemePreference('light'));
    expect(isDark()).toBe(false);
    scheme.set(false);
    scheme.set(true);
    expect(isDark()).toBe(false);
  });

  it('shares one choice with the Settings control', () => {
    systemScheme(false);
    render(
      <>
        <ThemeMenu />
        <ThemeChoice />
      </>,
    );
    const group = screen.getByRole('group', { name: 'Theme' });
    fireEvent.click(within(group).getByRole('button', { name: 'Dark' }));
    expect(within(group).getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByTestId('theme-menu').getAttribute('aria-label')).toBe(
      'Theme: Dark. Change theme',
    );
    expect(isDark()).toBe(true);
  });
});

describe('no flash of the wrong theme (index.html)', () => {
  // Vitest serves no HTML; read the page and run its inline script as the browser would, first.
  const page = readFileSync(`${import.meta.dirname}/../../index.html`, 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? '';
  const runInline = () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the page's own inline script
    const run = new Function(script) as () => void;
    run();
  };

  it('runs before the app, in the head', () => {
    expect(script).toContain(THEME_STORAGE_KEY);
    expect(page.indexOf('<script>')).toBeLessThan(page.indexOf('</head>'));
    expect(page.indexOf('<script>')).toBeLessThan(page.indexOf('src="/src/main.tsx"'));
  });

  it('sets the stored choice, else the computer’s', () => {
    systemScheme(true);
    runInline();
    expect(isDark()).toBe(true);
    expect(html.style.colorScheme).toBe('dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    runInline();
    expect(isDark()).toBe(false);
    vi.restoreAllMocks();
    systemScheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runInline();
    expect(isDark()).toBe(true);
  });

  it('falls back to the computer’s when storage is blocked', () => {
    systemScheme(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    runInline();
    expect(isDark()).toBe(true);
  });
});
