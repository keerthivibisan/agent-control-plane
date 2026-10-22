import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { switchTarget } from '../../src/app/ProjectSwitcher';
import { createApiClient, type FetchLike } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { parseRoute } from '../../src/lib/router';
import { board, PROJECT_ID, webProject } from '../fixtures/board';
import { candidate, capabilities, diagnostics, health, overview, project } from '../fixtures/dto';
import { fakeServer } from '../helpers';
import {
  L_UI,
  LOOP_KEY,
  LOOP_RUN_ID,
  LOOP_TICKET_ID,
  PROJECT_ID as LOOP_PROJECT,
  loopReviewScenario,
} from '../../e2e/review-loop-fixtures';

function renderApp(fetch: FetchLike) {
  const store = new QueryStore(createApiClient(fetch));
  return render(<App store={store} eventSource={null} />);
}

const alpha = project({ id: 'p-1', name: 'alpha' });
const beta = project({ id: 'p-2', name: 'beta' });
const nav = () => screen.getByRole('navigation', { name: 'Main' });
const navLink = (name: string) => within(nav()).getByRole('link', { name });

afterEach(() => {
  window.localStorage.clear();
});

describe('app shell', () => {
  it('shows the persistent sample-data banner when the server is in demo mode', async () => {
    const server = fakeServer({
      '/api/health': health({ mode: 'demo' }),
      '/api/capabilities': capabilities({ mode: 'demo' }),
    });
    renderApp(server.fetch);
    const banner = await screen.findByTestId('demo-banner');
    expect(banner.textContent).toContain("You're looking at sample data");
    expect(banner.textContent).toContain('Nothing here is real Claude Code activity');
  });

  it('shows no demo banner in live mode', async () => {
    renderApp(fakeServer({}).fetch);
    await screen.findByText('Server 0.0.0-test · live mode');
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });

  it('explains how to start the server when the API is unreachable, with no numbers', async () => {
    renderApp(() => Promise.reject(new TypeError('Failed to fetch')));
    const main = await screen.findByRole('main');
    const alert = await within(main).findByRole('alert');
    expect(alert.textContent).toContain('Server not reachable at /api');
    expect(alert.textContent).toContain('pnpm dev');
    expect(main.textContent).not.toMatch(/\d{2,}/);
  });

  it('has the project sidebar: available project pages, then All projects and Data health', async () => {
    window.location.hash = '#/p/p-1/board';
    renderApp(fakeServer({ '/api/projects': [alpha, beta] }).fetch);
    expect(navLink('Board').getAttribute('href')).toBe('#/p/p-1/board');
    expect(navLink('Board').getAttribute('aria-current')).toBe('page');
    expect(navLink('Workflow').getAttribute('href')).toBe('#/p/p-1/workflow');
    expect(navLink('Skills & Agents').getAttribute('href')).toBe('#/p/p-1/skills');
    expect(navLink('Harness').getAttribute('href')).toBe('#/p/p-1/harness');
    expect(navLink('Tokens').getAttribute('href')).toBe('#/p/p-1/tokens');
    expect(navLink('Sessions').getAttribute('href')).toBe('#/p/p-1/sessions');
    expect(navLink('Settings').getAttribute('href')).toBe('#/p/p-1/settings');
    expect(navLink('All projects').getAttribute('href')).toBe('#/projects');
    expect(navLink('Data health').getAttribute('href')).toBe('#/health');
    // The old global entries are gone.
    for (const name of ['Overview', 'Control panel', 'Setup', 'Projects']) {
      expect(within(nav()).queryByRole('link', { name })).toBeNull();
    }
    // renderApp passes no EventSource, so live updates are unavailable and the footer says so.
    expect(within(nav()).getByTestId('connection-status').textContent).toBe('Live updates off');
    // Theme and ⌘K live in the top bar.
    const bar = screen.getByRole('banner', { name: 'App bar' });
    expect(within(bar).getByRole('button', { name: /^Theme: / })).toBeTruthy();
    expect(within(bar).getByTestId('open-palette')).toBeTruthy();
    expect(
      await within(bar).findByRole('button', { name: 'Project: alpha. Switch project' }),
    ).toBeTruthy();
  });

  it('hides the project section when there is no project to show', async () => {
    window.location.hash = '#/projects';
    renderApp(fakeServer({}).fetch);
    await screen.findByText('Add your first project');
    expect(within(nav()).queryByRole('link', { name: 'Board' })).toBeNull();
    expect(navLink('All projects').getAttribute('aria-current')).toBe('page');
  });

  it('marks Sessions on a session page, linking to the last project', async () => {
    window.localStorage.setItem('acp.lastProject', 'p-1');
    window.location.hash = '#/sessions/s-1';
    renderApp(fakeServer({ '/api/projects': [alpha] }).fetch);
    await waitFor(() => expect(navLink('Sessions').getAttribute('aria-current')).toBe('page'));
    expect(navLink('Sessions').getAttribute('href')).toBe('#/p/p-1/sessions');
  });

  it('remembers the project in view, so #/ reopens its board', async () => {
    window.location.hash = '#/p/p-2/settings';
    const server = fakeServer({ '/api/projects': [alpha, beta] });
    const { unmount } = renderApp(server.fetch);
    await waitFor(() => expect(window.localStorage.getItem('acp.lastProject')).toBe('p-2'));
    unmount();
    window.location.hash = '#/';
    renderApp(server.fetch);
    await waitFor(() => expect(window.location.hash).toBe('#/p/p-2/board'));
  });

  it('#/ opens All projects when no project was used yet', async () => {
    window.location.hash = '#/';
    renderApp(fakeServer({ '/api/projects': [alpha] }).fetch);
    await waitFor(() => expect(window.location.hash).toBe('#/projects'));
    expect(await screen.findByRole('heading', { level: 1, name: 'All projects' })).toBeTruthy();
  });

  it('#/health has an Overview and a Connection (the old Setup) section', async () => {
    window.location.hash = '#/health';
    const server = fakeServer({
      '/api/diagnostics/ingestion': diagnostics(),
      '/api/discovery/candidates': [candidate({ cwd: '/work/new' })],
    });
    renderApp(server.fetch);
    expect(await screen.findByRole('heading', { level: 1, name: 'Data health' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'What this app can see' })).toBeTruthy();
    expect(await screen.findByTestId('ingestion-counters')).toBeTruthy();
    const tabs = screen.getByRole('navigation', { name: 'Data health sections' });
    expect(within(tabs).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(navLink('Data health').getAttribute('aria-current')).toBe('page');

    window.location.hash = '#/health/connection';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Connection' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Register a project' })).toBeTruthy();
    expect(await screen.findByText('/work/new')).toBeTruthy();
    expect(await screen.findByTestId('hooks-status')).toBeTruthy();
  });

  it('Data health: the section tabs sit under the title; the switcher shows the remembered project', async () => {
    window.localStorage.setItem('acp.lastProject', 'p-2');
    window.location.hash = '#/health';
    renderApp(
      fakeServer({ '/api/projects': [alpha, beta], '/api/diagnostics/ingestion': diagnostics() })
        .fetch,
    );
    const title = await screen.findByRole('heading', { level: 1, name: 'Data health' });
    const tabs = screen.getByRole('navigation', { name: 'Data health sections' });
    // The title comes first in the document, then the tabs.
    expect(title.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Project: beta. Switch project' }),
    ).toBeTruthy();
    expect(navLink('Board').getAttribute('href')).toBe('#/p/p-2/board');
  });

  it('#/setup redirects to the Connection section without a history entry', async () => {
    window.location.hash = '#/setup';
    const length = window.history.length;
    renderApp(fakeServer({}).fetch);
    await waitFor(() => expect(window.location.hash).toBe('#/health/connection'));
    expect(window.history.length).toBe(length);
  });

  it('an unknown address or an unknown project page says so and links to All projects', async () => {
    for (const hash of ['#/nope', '#/p/p-1/no-such-page']) {
      window.location.hash = hash;
      const { unmount } = renderApp(fakeServer({}).fetch);
      expect(await screen.findByText('Page not found')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Go to All projects' }).getAttribute('href')).toBe(
        '#/projects',
      );
      unmount();
    }
  });

  it('shows a contract violation instead of rendering a malformed response', async () => {
    window.location.hash = '#/projects';
    const server = fakeServer({
      '/api/capabilities': { mode: 'demo', providers: 'nope' },
      '/api/projects': [alpha],
      '/api/overview': overview(),
    });
    renderApp(server.fetch);
    const alerts = await screen.findAllByRole('alert');
    const alert = alerts.find((a) => a.textContent.includes('/api/capabilities'));
    expect(alert?.getAttribute('data-error-kind')).toBe('parse');
    expect(alert?.textContent).toContain('providers');
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });
});

describe('project switcher', () => {
  it('keeps the page when switching, and goes to the board from elsewhere', () => {
    expect(switchTarget(parseRoute('#/p/p-1/tokens?groupBy=day'), 'p-2')).toBe('#/p/p-2/tokens');
    expect(switchTarget(parseRoute('#/p/p-1/tickets/t-1'), 'p-2')).toBe('#/p/p-2/board');
    expect(switchTarget(parseRoute('#/p/p-1/workflow'), 'p-2')).toBe('#/p/p-2/workflow');
    expect(switchTarget(parseRoute('#/p/p-1/skills'), 'p-2')).toBe('#/p/p-2/skills');
    expect(switchTarget(parseRoute('#/projects'), 'p-2')).toBe('#/p/p-2/board');
  });

  it('lists the projects, All projects and New project; Esc closes it', async () => {
    window.location.hash = `#/p/${PROJECT_ID}/board`;
    renderApp(
      fakeServer({
        '/api/projects': [webProject, alpha],
        [`/api/board?projectId=${PROJECT_ID}`]: board(),
      }).fetch,
    );
    const button = await screen.findByRole('button', { name: 'Project: web-app. Switch project' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    const menu = screen.getByRole('navigation', { name: 'Switch project' });
    const current = within(menu).getByRole('link', { name: /web-app/ });
    expect(current.getAttribute('aria-current')).toBe('true');
    // Radix moves focus into the menu on the next tick.
    await waitFor(() => expect(document.activeElement).toBe(current));
    expect(within(menu).getByRole('link', { name: /alpha/ }).getAttribute('href')).toBe(
      '#/p/p-1/board',
    );
    expect(within(menu).getByRole('link', { name: 'All projects' }).getAttribute('href')).toBe(
      '#/projects',
    );
    expect(within(menu).getByRole('link', { name: 'New project' }).getAttribute('href')).toBe(
      '#/projects/new',
    );
    fireEvent.keyDown(current, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(document.activeElement).toBe(within(menu).getByRole('link', { name: /alpha/ })),
    );
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Switch project' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('reads "All projects" on All projects and "Unknown project" for a missing id', async () => {
    window.location.hash = '#/projects';
    const { unmount } = renderApp(fakeServer({ '/api/projects': [alpha] }).fetch);
    expect(
      await screen.findByRole('button', { name: 'Project: All projects. Switch project' }),
    ).toBeTruthy();
    unmount();
    window.location.hash = '#/p/gone/settings';
    renderApp(fakeServer({ '/api/projects': [alpha] }).fetch);
    expect(
      await screen.findByRole('button', { name: 'Project: Unknown project. Switch project' }),
    ).toBeTruthy();
    // A missing project is never remembered.
    expect(window.localStorage.getItem('acp.lastProject')).toBeNull();
  });
});

describe('a ticket in the shell (v0.3.0 C-D)', () => {
  const ticketHash = `#/p/${LOOP_PROJECT}/tickets/${LOOP_TICKET_ID}`;

  it('the trail reads Board / KEY, the key as the current page', async () => {
    window.location.hash = ticketHash;
    renderApp(fakeServer(loopReviewScenario().routes).fetch);
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const key = await within(trail).findByText(LOOP_KEY);
    expect(key.getAttribute('aria-current')).toBe('page');
    expect(key.closest('a')).toBeNull();
    expect(within(trail).getByRole('link', { name: 'Board' }).getAttribute('href')).toBe(
      `#/p/${LOOP_PROJECT}/board`,
    );
  });

  it('an old review page link lands on the Files changed tab, replacing the address', async () => {
    window.location.hash = `${ticketHash}/changes/${L_UI}?run=${LOOP_RUN_ID}`;
    const before = window.history.length;
    renderApp(fakeServer(loopReviewScenario().routes).fetch);
    await waitFor(() =>
      expect(window.location.hash).toBe(
        `${ticketHash}?tab=files&change=${L_UI}&run=${LOOP_RUN_ID}`,
      ),
    );
    expect(window.history.length).toBe(before);
    expect(
      (await screen.findByRole('tab', { name: /Files changed/ })).getAttribute('aria-selected'),
    ).toBe('true');
    expect((await screen.findByTestId('change-picker')).dataset['value']).toBe(L_UI);
  });
});
