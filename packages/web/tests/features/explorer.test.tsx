import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionExplorer } from '../../src/features/sessions/SessionExplorer';
import { page, project, session, usageSummary } from '../fixtures/dto';
import { fakeServer, renderWithApi } from '../helpers';

const sessions = [
  session({ id: 's-1', title: 'Fix login' }),
  session({
    id: 's-2',
    agentType: 'Explore',
    providerAgentId: 'ag-2',
    status: {
      value: 'stale',
      provenance: 'derived',
      basis: { lastEventAt: null, endedAt: null, evaluatedAt: '2026-10-10T09:00:00.000Z' },
    },
  }),
];

const routes = {
  '/api/projects': [project({ id: 'p-1', name: 'alpha' })],
  '/api/usage/summary?groupBy=model': usageSummary({
    groupBy: 'model',
    groups: [],
  }),
  '/api/sessions?limit=50': page(sessions, 'cur-2'),
  '/api/sessions?cursor=cur-2&limit=50': page([session({ id: 's-3', title: 'Third' })]),
  '/api/sessions?limit=50&status=stale': page([sessions[1]]),
};

describe('Session Explorer', () => {
  it('lists sessions with status labels and paginates by cursor', async () => {
    const server = fakeServer(routes);
    renderWithApi(<SessionExplorer search={new URLSearchParams()} />, server);
    expect(await screen.findByText('Fix login')).toBeTruthy();
    const staleRow = screen.getByText('Explore').closest('tr') as HTMLElement;
    expect(staleRow.querySelector('[data-status]')?.textContent).toBe('stale (no recent activity)');
    expect(screen.getAllByText('alpha').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(await screen.findByText('Third')).toBeTruthy();
    expect(server.calls.map((c) => c.path)).toContain('/api/sessions?cursor=cur-2&limit=50');
  });

  it('applies filters from the hash to the API query', async () => {
    const server = fakeServer(routes);
    renderWithApi(<SessionExplorer search={new URLSearchParams('status=stale')} />, server);
    expect(await screen.findByText('Explore')).toBeTruthy();
    expect(screen.queryByText('Fix login')).toBeNull();
  });

  it('changing a filter updates the hash; graph selects a root', async () => {
    const server = fakeServer(routes);
    renderWithApi(<SessionExplorer search={new URLSearchParams()} />, server);
    const form = await screen.findByRole('form', { name: 'Session filters' });
    await screen.findByText('Fix login');
    fireEvent.change(within(form).getByRole('combobox', { name: /^Status/ }), {
      target: { value: 'ended' },
    });
    await waitFor(() => expect(window.location.hash).toBe('#/sessions?status=ended'));
    const row = screen.getByText('Fix login').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'graph' }));
    await waitFor(() => expect(window.location.hash).toBe('#/sessions?root=s-1&view=graph'));
  });

  it('shows the concurrency timeline for the current page', async () => {
    renderWithApi(
      <SessionExplorer search={new URLSearchParams('view=timeline')} />,
      fakeServer(routes),
    );
    expect(await screen.findByTestId('gantt')).toBeTruthy();
    expect(screen.getByTestId('bar-s-1')).toBeTruthy();
  });
});
