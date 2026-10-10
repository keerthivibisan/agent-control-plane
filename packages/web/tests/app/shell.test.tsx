import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { createApiClient, type FetchLike } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { candidate, capabilities, diagnostics, health, project } from '../fixtures/dto';
import { fakeServer } from '../helpers';

function renderApp(fetch: FetchLike) {
  const store = new QueryStore(createApiClient(fetch));
  return render(<App store={store} eventSource={null} />);
}

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

  it('has the DESIGN.md sidebar: pages, projects underneath, Setup and Data health', async () => {
    const server = fakeServer({
      '/api/projects': [
        project({ id: 'p-1', name: 'alpha' }),
        project({ id: 'p-2', name: 'beta' }),
      ],
    });
    renderApp(server.fetch);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const link = (name: string) => within(nav).getByRole('link', { name }).getAttribute('href');
    expect(link('Overview')).toBe('#/');
    expect(link('Sessions')).toBe('#/sessions');
    expect(link('Tokens')).toBe('#/usage');
    expect(link('Projects')).toBe('#/projects');
    expect(link('Setup')).toBe('#/setup');
    expect(link('Data health')).toBe('#/health');
    const list = await within(nav).findByRole('list', { name: 'Your projects' });
    expect(within(list).getByRole('link', { name: 'alpha' }).getAttribute('href')).toBe(
      '#/projects/p-1',
    );
    expect(within(nav).getByRole('button', { name: /^Theme: / })).toBeTruthy();
    // renderApp passes no EventSource, so live updates are unavailable and the footer says so.
    expect(within(nav).getByTestId('connection-status').textContent).toBe('Live updates off');
  });

  it('marks the current page in the sidebar', async () => {
    window.location.hash = '#/sessions/s-1';
    renderApp(fakeServer({}).fetch);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Sessions' }).getAttribute('aria-current')).toBe(
      'page',
    );
    await screen.findByText('Server 0.0.0-test · live mode');
  });

  it('#/projects lists projects with their folder and session count', async () => {
    window.location.hash = '#/projects';
    const server = fakeServer({
      '/api/projects': [project({ id: 'p-1', name: 'alpha', sessionCount: 1 })],
    });
    renderApp(server.fetch);
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Projects' });
    expect(within(table).getByRole('link', { name: 'alpha' })).toBeTruthy();
    expect(within(table).getByText('/work/p-1')).toBeTruthy();
    expect(within(table).getByText('1 session')).toBeTruthy();
  });

  it('#/projects says how to start when there are none', async () => {
    window.location.hash = '#/projects';
    renderApp(fakeServer({}).fetch);
    expect(await screen.findByText('No projects yet')).toBeTruthy();
    const main = screen.getByRole('main');
    expect(
      within(main)
        .getAllByRole('link', { name: 'Add a project' })
        .every((a) => a.getAttribute('href') === '#/setup'),
    ).toBe(true);
  });

  it('#/setup shows the register form, unadded folders and hook status', async () => {
    window.location.hash = '#/setup';
    const server = fakeServer({ '/api/discovery/candidates': [candidate({ cwd: '/work/new' })] });
    renderApp(server.fetch);
    expect(await screen.findByRole('heading', { level: 1, name: 'Setup' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Register a project' })).toBeTruthy();
    expect(await screen.findByText('/work/new')).toBeTruthy();
    expect(await screen.findByTestId('hooks-status')).toBeTruthy();
  });

  it('#/health shows capabilities and diagnostics', async () => {
    window.location.hash = '#/health';
    const server = fakeServer({ '/api/diagnostics/ingestion': diagnostics() });
    renderApp(server.fetch);
    expect(await screen.findByRole('heading', { level: 1, name: 'Data health' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Observation capabilities' })).toBeTruthy();
    expect(await screen.findByTestId('ingestion-counters')).toBeTruthy();
  });

  it('an unknown address says so and links back to the Overview', async () => {
    window.location.hash = '#/nope';
    renderApp(fakeServer({}).fetch);
    expect(await screen.findByText('Page not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Overview' }).getAttribute('href')).toBe('#/');
  });

  it('shows a contract violation instead of rendering a malformed response', async () => {
    const server = fakeServer({ '/api/capabilities': { mode: 'demo', providers: 'nope' } });
    renderApp(server.fetch);
    const alerts = await screen.findAllByRole('alert');
    const alert = alerts.find((a) => a.textContent.includes('/api/capabilities'));
    expect(alert?.getAttribute('data-error-kind')).toBe('parse');
    expect(alert?.textContent).toContain('providers');
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });
});
