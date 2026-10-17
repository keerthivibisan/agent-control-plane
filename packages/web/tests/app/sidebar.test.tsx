import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { crumbsFor, pageKey } from '../../src/app/nav';
import {
  isMacLike,
  isSidebarCollapsed,
  isSidebarShortcut,
  WIDE_QUERY,
} from '../../src/app/sidebar-state';
import { createApiClient, type FetchLike } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { parseRoute } from '../../src/lib/router';
import { project } from '../fixtures/dto';
import { fakeServer } from '../helpers';

/*
 * UI refresh U-B: the toggleable sidebar (the full list or a slim icon rail; owner request
 * 2026-10-17), and the top bar's trail.
 */

function renderApp(fetch: FetchLike) {
  const store = new QueryStore(createApiClient(fetch));
  return render(<App store={store} eventSource={null} />);
}

const alpha = project({ id: 'p-1', name: 'alpha' });
const server = () => fakeServer({ '/api/projects': [alpha] }).fetch;
const sidebar = () => screen.getByTestId('sidebar');
const nav = () => screen.getByRole('navigation', { name: 'Main' });
const mod = isMacLike() ? { metaKey: true } : { ctrlKey: true };

/** A screen wider than 1280px. */
function wideScreen() {
  const narrow = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    ...narrow(query),
    matches: query === WIDE_QUERY,
  }));
}
function narrowScreen() {
  vi.restoreAllMocks();
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('sidebar state', () => {
  it('follows the screen until the owner chooses, then keeps the choice', () => {
    expect(isSidebarCollapsed(null, true)).toBe(false);
    expect(isSidebarCollapsed(null, false)).toBe(true);
    expect(isSidebarCollapsed('expanded', false)).toBe(false);
    expect(isSidebarCollapsed('collapsed', true)).toBe(true);
  });

  it('is toggled by ⌘B on Apple keyboards and Ctrl+B elsewhere, nothing else', () => {
    const key = (over: Partial<KeyboardEvent>) => ({
      key: 'b',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...over,
    });
    expect(isSidebarShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isSidebarShortcut(key({ key: 'B', metaKey: true }), true)).toBe(true);
    expect(isSidebarShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isSidebarShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isSidebarShortcut(key({ metaKey: true }), false)).toBe(false);
    expect(isSidebarShortcut(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSidebarShortcut(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isSidebarShortcut(key({ key: 'k', ctrlKey: true }), false)).toBe(false);
  });
});

describe('toggleable sidebar', () => {
  it('is the full list above 1280px and the icon rail at 1280px and below, by default', async () => {
    window.location.hash = '#/p/p-1/board';
    wideScreen();
    const { unmount } = renderApp(server());
    expect(sidebar().getAttribute('data-collapsed')).toBeNull();
    expect(screen.getByTestId('sidebar-toggle').getAttribute('aria-label')).toBe(
      'Collapse sidebar',
    );
    unmount();
    narrowScreen();
    renderApp(server());
    expect(sidebar().getAttribute('data-collapsed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    // Every entry keeps its name (and its address) in the rail.
    await waitFor(() =>
      expect(within(nav()).getByRole('link', { name: 'Board' }).getAttribute('href')).toBe(
        '#/p/p-1/board',
      ),
    );
    expect(within(nav()).getByRole('link', { name: 'Data health' })).toBeTruthy();
  });

  it('the button and the shortcut switch it, and the choice is remembered in this browser', () => {
    window.location.hash = '#/p/p-1/board';
    const { unmount } = renderApp(server());
    const toggle = screen.getByTestId('sidebar-toggle');
    expect(toggle.getAttribute('aria-keyshortcuts')).toBe(isMacLike() ? 'Meta+B' : 'Control+B');
    fireEvent.click(toggle);
    expect(sidebar().getAttribute('data-collapsed')).toBeNull();
    expect(toggle.getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(window.localStorage.getItem('acp.sidebar')).toBe('expanded');

    fireEvent.keyDown(window, { key: 'b', ...mod });
    expect(sidebar().getAttribute('data-collapsed')).toBe('true');
    expect(window.localStorage.getItem('acp.sidebar')).toBe('collapsed');
    fireEvent.keyDown(window, { key: 'b', ...mod });
    expect(sidebar().getAttribute('data-collapsed')).toBeNull();
    unmount();

    // A wide screen would show the full list anyway; the stored rail wins over it.
    window.localStorage.setItem('acp.sidebar', 'collapsed');
    wideScreen();
    const again = renderApp(server());
    expect(sidebar().getAttribute('data-collapsed')).toBe('true');
    again.unmount();
    // And the stored full list wins over a narrow screen.
    narrowScreen();
    window.localStorage.setItem('acp.sidebar', 'expanded');
    renderApp(server());
    expect(sidebar().getAttribute('data-collapsed')).toBeNull();
  });

  it('leaves the shortcut to a field that handles it, and works without storage', () => {
    window.location.hash = '#/projects';
    const blocked = () => {
      throw new Error('blocked');
    };
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    try {
      renderApp(server());
      expect(sidebar().getAttribute('data-collapsed')).toBe('true');
      fireEvent.click(screen.getByTestId('sidebar-toggle'));
      expect(sidebar().getAttribute('data-collapsed')).toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
    const field = document.createElement('textarea');
    field.addEventListener('keydown', (e) => e.preventDefault());
    document.body.append(field);
    fireEvent.keyDown(field, { key: 'b', ...mod });
    expect(sidebar().getAttribute('data-collapsed')).toBeNull();
    field.remove();
  });

  it('in the rail, an entry shows its label as a tooltip on focus; in the full list it does not', async () => {
    window.location.hash = '#/p/p-1/board';
    renderApp(server());
    const tokens = await within(nav()).findByRole('link', { name: 'Tokens' });
    fireEvent.focus(tokens);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Tokens');
    // The tip repeats the name, so the link is not also described by it.
    expect(tokens.getAttribute('aria-describedby')).toBeNull();
    fireEvent.blur(tokens);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    fireEvent.focus(tokens);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('top bar trail', () => {
  it('shows the project switcher, then the page you are on', async () => {
    window.location.hash = '#/p/p-1/tokens';
    renderApp(server());
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      await within(trail).findByRole('button', { name: 'Project: alpha. Switch project' }),
    ).toBeTruthy();
    const page = within(trail).getByText('Tokens');
    expect(page.getAttribute('aria-current')).toBe('page');
    expect(
      within(screen.getByRole('banner', { name: 'App bar' }))
        .getByRole('link', { name: 'Agent Control Plane home' })
        .getAttribute('href'),
    ).toBe('#/');
  });

  it('puts a ticket or a run under Board and a session under Sessions; global pages have no step', () => {
    expect(crumbsFor(parseRoute('#/p/p-1/tickets/t-1'), 'p-1')).toEqual([
      { label: 'Board', to: '#/p/p-1/board' },
    ]);
    expect(crumbsFor(parseRoute('#/p/p-1/runs/r-1'), 'p-1')).toEqual([
      { label: 'Board', to: '#/p/p-1/board' },
    ]);
    expect(crumbsFor(parseRoute('#/sessions/s-1'), 'p-2')).toEqual([
      { label: 'Sessions', to: '#/p/p-2/sessions' },
    ]);
    expect(crumbsFor(parseRoute('#/sessions/s-1'), null)).toEqual([]);
    expect(crumbsFor(parseRoute('#/p/p-1/skills/review'), 'p-1')).toEqual([
      { label: 'Skills & Agents', to: '#/p/p-1/skills' },
      { label: 'review', to: null },
    ]);
    for (const hash of ['#/projects', '#/projects/new', '#/health', '#/nope', '#/p/p-1/nope']) {
      expect(crumbsFor(parseRoute(hash), 'p-1')).toEqual([]);
    }
  });

  it('animates a page change, not a filter or a selected item', () => {
    const key = (hash: string) => pageKey(parseRoute(hash));
    expect(key('#/p/p-1/tokens')).toBe(key('#/p/p-1/tokens?groupBy=day'));
    expect(key('#/p/p-1/skills')).toBe(key('#/p/p-1/skills/review'));
    expect(key('#/p/p-1/tokens')).not.toBe(key('#/p/p-1/sessions'));
    expect(key('#/p/p-1/tokens')).not.toBe(key('#/p/p-2/tokens'));
    expect(key('#/health')).not.toBe(key('#/health/connection'));
  });
});
