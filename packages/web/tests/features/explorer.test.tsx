import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionExplorer } from '../../src/features/sessions/SessionExplorer';
import {
  capabilities,
  edge,
  page,
  partialUsage,
  project,
  session,
  T0,
  tree,
  usageSummary,
} from '../fixtures/dto';
import { formatSessionStart } from '../../src/lib/session-name';
import { paths } from '../../src/lib/api';
import { fakeServer, renderWithApi } from '../helpers';

const parent = session({ id: 's-1', title: 'Fix login', childCount: 1 });
const helper = session({
  id: 's-2',
  agentType: 'Explore',
  providerAgentId: 'ag-2',
  directUsage: partialUsage,
  status: {
    value: 'stale',
    provenance: 'derived',
    basis: { lastEventAt: null, endedAt: null, evaluatedAt: '2026-10-10T09:00:00.000Z' },
  },
});
const untitled = session({ id: 's-9', title: null });
// API order is latest activity first: the helper comes before its parent here.
const sessions = [helper, untitled, parent];

const routes = {
  '/api/projects': [project({ id: 'p-1', name: 'alpha' })],
  '/api/usage/summary?groupBy=model': usageSummary({ groupBy: 'model', groups: [] }),
  '/api/sessions?limit=50': page(sessions, 'cur-2'),
  '/api/sessions?cursor=cur-2&limit=50': page([session({ id: 's-3', title: 'Third' })]),
  '/api/sessions?limit=50&status=stale': page([helper]),
  '/api/sessions/s-1/tree': tree('s-1', [parent, helper], [edge('s-1', 's-2')]),
};

const rowOf = (id: string) => document.querySelector(`tr[data-session-id="${id}"]`) as HTMLElement;

describe('Sessions page', () => {
  it('lists sessions in plain words, with units, and "Not reported" for missing tokens', async () => {
    renderWithApi(<SessionExplorer search={new URLSearchParams()} />, fakeServer(routes));
    expect(await screen.findByRole('heading', { name: 'Sessions', level: 1 })).toBeTruthy();
    await waitFor(() => expect(rowOf('s-1')).toBeTruthy());
    // No title, not a helper: named after its branch and start, never "Untitled".
    expect(
      within(rowOf('s-9')).getByText(`Session on main · ${formatSessionStart(T0)}`),
    ).toBeTruthy();

    const helperRow = rowOf('s-2');
    expect(within(helperRow).getByText('Helper agent: Explore')).toBeTruthy();
    expect(helperRow.querySelector('[data-status]')?.textContent).toBe('Inactive');
    expect(within(helperRow).getByText('Cache write tokens: Not reported')).toBeTruthy();
    expect(helperRow.textContent).not.toMatch(/\b0 cache write/);

    const parentRow = rowOf('s-1');
    expect(within(parentRow).getByText('1 helper agent')).toBeTruthy();
    expect(parentRow.textContent).toContain('1.2K input tokens');
    expect(parentRow.textContent).toContain('3.4K output tokens');
    expect(within(parentRow).getByText('alpha')).toBeTruthy();
    expect(screen.queryByText(/completed/i)).toBeNull();
  });

  it('shows a helper agent under the session that started it, from tree edges only', async () => {
    renderWithApi(<SessionExplorer search={new URLSearchParams()} />, fakeServer(routes));
    await waitFor(() => expect(rowOf('s-2').getAttribute('data-depth')).toBe('1'));
    const ids = [...document.querySelectorAll('tr[data-session-id]')].map((r) =>
      r.getAttribute('data-session-id'),
    );
    expect(ids).toEqual(['s-9', 's-1', 's-2']);
  });

  it('paginates by cursor', async () => {
    const server = fakeServer(routes);
    renderWithApi(<SessionExplorer search={new URLSearchParams()} />, server);
    await waitFor(() => expect(rowOf('s-1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Third')).toBeTruthy();
    expect(server.calls.map((c) => c.path)).toContain('/api/sessions?cursor=cur-2&limit=50');
    expect(screen.getByText('Page 2')).toBeTruthy();
  });

  it('inside a project: no Project filter, and the copy says "this project"', async () => {
    const scoped = {
      ...routes,
      [paths.sessions({ projectId: 'p-1', limit: 50 })]: page(sessions),
      [paths.sessions({ projectId: 'p-1', status: 'stale', limit: 50 })]: page([]),
    };
    const { unmount } = renderWithApi(
      <SessionExplorer search={new URLSearchParams('projectId=p-1')} projectId="p-1" />,
      fakeServer(scoped),
    );
    const header = (await screen.findByRole('heading', { name: 'Sessions', level: 1 })).closest(
      'header',
    );
    expect(header?.textContent).toContain('in this project');
    expect(header?.textContent).not.toContain('your projects');
    const form = screen.getByRole('form', { name: 'Session filters' });
    expect(within(form).queryByRole('combobox', { name: /^Project/ })).toBeNull();
    // The project from the address is not a filter: no "Clear filters".
    expect(within(form).queryByRole('link', { name: /Clear/ })).toBeNull();
    await waitFor(() => expect(rowOf('s-1')).toBeTruthy());
    unmount();

    // A real filter is cleared back to the project, not to every project.
    renderWithApi(
      <SessionExplorer
        search={new URLSearchParams('projectId=p-1&status=stale')}
        projectId="p-1"
      />,
      fakeServer(scoped),
    );
    const clear = await screen.findAllByRole('link', { name: /Clear/ });
    for (const link of clear) expect(link.getAttribute('href')).toBe('#/p/p-1/sessions');
  });

  it('lists every project with a Project filter outside a project', async () => {
    renderWithApi(<SessionExplorer search={new URLSearchParams()} />, fakeServer(routes));
    const form = await screen.findByRole('form', { name: 'Session filters' });
    expect(within(form).getByRole('combobox', { name: /^Project/ })).toBeTruthy();
    expect(screen.getByText(/in your projects/)).toBeTruthy();
  });

  it('applies filters from the hash, and a status change updates the hash', async () => {
    renderWithApi(
      <SessionExplorer search={new URLSearchParams('status=stale')} />,
      fakeServer(routes),
    );
    expect(await screen.findByText('Helper agent: Explore')).toBeTruthy();
    expect(screen.queryByText('Fix login')).toBeNull();
    const form = screen.getByRole('form', { name: 'Session filters' });
    const status = within(form).getByRole('combobox', { name: /^Status/ });
    expect(within(status).getByRole('option', { name: 'Paused' })).toBeTruthy();
    fireEvent.change(status, { target: { value: 'ended' } });
    await waitFor(() => expect(window.location.hash).toBe('#/sessions?status=ended'));
  });

  it('shows the provider filter only when more than one provider is connected', async () => {
    const { unmount } = renderWithApi(
      <SessionExplorer search={new URLSearchParams()} />,
      fakeServer(routes),
    );
    await waitFor(() => expect(rowOf('s-1')).toBeTruthy());
    expect(screen.queryByRole('combobox', { name: /^Provider/ })).toBeNull();
    unmount();

    const base = capabilities();
    const first = base.providers[0];
    if (first === undefined) throw new Error('fixture has a provider');
    renderWithApi(
      <SessionExplorer search={new URLSearchParams()} />,
      fakeServer({
        ...routes,
        '/api/capabilities': capabilities({
          providers: [first, { ...first, provider: 'codex' }],
        }),
      }),
    );
    expect(await screen.findByRole('combobox', { name: /^Provider/ })).toBeTruthy();
  });

  it('draws the relationships of the first session with helpers by default', async () => {
    const server = fakeServer(routes);
    renderWithApi(<SessionExplorer search={new URLSearchParams()} />, server);
    const card = await screen.findByRole('region', { name: 'How sessions relate' });
    expect(
      within(card).getByRole('tab', { name: 'Relationships' }).getAttribute('aria-selected'),
    ).toBe('true');
    const picker = within(card).getByRole('combobox', { name: 'Show relationships for' });
    expect((picker as HTMLSelectElement).value).toBe('s-1');
    expect(await within(card).findByText('Started a helper agent')).toBeTruthy();
    expect(within(card).getByText('Continued as')).toBeTruthy();
    // The default is the family tree, from the tree's edges: the helper sits under its parent.
    const top = await within(card).findByTestId('family-member-s-1');
    expect(within(top).getByTestId('family-no-known-parent')).toBeTruthy();
    const nested = within(card).getByRole('list', { name: 'Helper agents: Fix login' });
    expect(within(nested).getByTestId('family-member-s-2')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Diagram' }).getAttribute('href')).toBe(
      '#/sessions?view=graph',
    );
    fireEvent.change(picker, { target: { value: 's-9' } });
    await waitFor(() =>
      expect(window.location.hash).toBe('#/sessions?root=s-9&view=relationships'),
    );
  });

  it('shows the timeline tab for the current page', async () => {
    renderWithApi(
      <SessionExplorer search={new URLSearchParams('view=timeline')} />,
      fakeServer(routes),
    );
    expect(await screen.findByTestId('gantt')).toBeTruthy();
    expect(screen.getByTestId('bar-s-1')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('guides the reader when there are no sessions, or none match', async () => {
    const { unmount } = renderWithApi(
      <SessionExplorer search={new URLSearchParams()} />,
      fakeServer({ ...routes, '/api/sessions?limit=50': page([]) }),
    );
    expect(await screen.findByText('No sessions yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add a project' }).getAttribute('href')).toBe(
      '#/health/connection',
    );
    expect(screen.queryByRole('region', { name: 'How sessions relate' })).toBeNull();
    unmount();

    renderWithApi(
      <SessionExplorer search={new URLSearchParams('status=ended')} />,
      fakeServer({ ...routes, '/api/sessions?limit=50&status=ended': page([]) }),
    );
    expect(await screen.findByText('No matching sessions')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  });
});
