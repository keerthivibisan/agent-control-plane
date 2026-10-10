import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionDetail } from '../../src/features/session-detail/SessionDetail';
import { detail, event, page, partialUsage, usage } from '../fixtures/dto';
import { fakeServer, renderWithApi } from '../helpers';

const events1 = page([event({ id: 9, eventType: 'usage.reported' })], 'ev-2');
const events2 = page([event({ id: 3, eventType: 'session.ended' })]);

describe('Session detail', () => {
  it('shows direct and aggregate usage, unavailable (not 0), ambiguity note and unknown parent', async () => {
    const s = detail({
      id: 's-1',
      title: 'Fix login',
      directUsage: partialUsage,
      aggregateUsage: usage({ recordCount: 9 }),
      ambiguousAttributionCount: 2,
      continuationIds: ['s-fork-1'],
    });
    const server = fakeServer({
      '/api/sessions/s-1': s,
      '/api/sessions/s-1/events': events1,
      '/api/sessions/s-1/events?cursor=ev-2': events2,
    });
    renderWithApi(<SessionDetail id="s-1" />, server);
    expect(await screen.findByRole('heading', { name: 'Fix login' })).toBeTruthy();

    const direct = screen.getByTestId('usage-direct');
    const creation = direct.querySelector('[data-category="cacheCreation"]') as HTMLElement;
    expect(creation.textContent).toBe('unavailable');
    expect(creation.textContent).not.toContain('0');
    expect(within(direct).getByTestId('ambiguous-attribution')).toBeTruthy();
    expect(screen.getByTestId('usage-aggregate')).toBeTruthy();

    expect(screen.getByTestId('parent-unknown').textContent).toBe('parent: unknown');
    expect(screen.getByTestId('continuations').textContent).toContain('s-fork-');
    expect(screen.queryByText(/completed/i)).toBeNull();
    expect(screen.getByTestId('show-in-graph').getAttribute('href')).toBe(
      '#/sessions?root=s-1&view=graph',
    );
  });

  it('labels the snapshot cost estimated and lists per-model tokens', async () => {
    const s = detail({
      id: 's-2',
      latestSnapshot: {
        occurredAt: '2026-10-10T08:20:00.000Z',
        scope: 'session',
        byModel: {
          'model-b': { input: 1, output: 2, cacheCreation: null, cacheRead: 4 },
          'model-a': { input: 10, output: 20, cacheCreation: 30, cacheRead: 40 },
        },
        reportedCostUsd: { provenance: 'estimated', value: 1.5 },
      },
    });
    const server = fakeServer({
      '/api/sessions/s-2': s,
      '/api/sessions/s-2/events': page([]),
    });
    renderWithApi(<SessionDetail id="s-2" />, server);
    const snap = await screen.findByTestId('snapshot');
    expect(within(snap).getByText('estimated (provider-reported)')).toBeTruthy();
    const rows = within(snap).getAllByRole('row');
    // header + 2 models, sorted by model id
    expect(rows[1]?.textContent).toContain('model-a');
    expect(rows[2]?.textContent).toContain('unavailable');
  });

  it('says no snapshot was observed instead of showing a zero cost', async () => {
    const server = fakeServer({
      '/api/sessions/s-3': detail({ id: 's-3', latestSnapshot: null }),
      '/api/sessions/s-3/events': page([]),
    });
    renderWithApi(<SessionDetail id="s-3" />, server);
    expect(await screen.findByTestId('no-snapshot')).toBeTruthy();
    expect(screen.queryByTestId('cost')).toBeNull();
  });

  it('known parent links to the parent with its provenance', async () => {
    const server = fakeServer({
      '/api/sessions/s-4': detail({
        id: 's-4',
        parent: {
          state: 'known',
          sessionId: 'parent-1',
          kind: 'subagent',
          provenance: 'observed',
          evidence: ['subagent-metadata'],
        },
      }),
      '/api/sessions/s-4/events': page([]),
    });
    renderWithApi(<SessionDetail id="s-4" />, server);
    expect(await screen.findByTestId('parent-known')).toBeTruthy();
    expect(screen.queryByTestId('parent-unknown')).toBeNull();
  });

  it('paginates the event timeline with the API cursor', async () => {
    const server = fakeServer({
      '/api/sessions/s-1': detail({ id: 's-1' }),
      '/api/sessions/s-1/events': events1,
      '/api/sessions/s-1/events?cursor=ev-2': events2,
    });
    renderWithApi(<SessionDetail id="s-1" />, server);
    expect(await screen.findByText('usage.reported')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(await screen.findByText('session.ended')).toBeTruthy();
    expect(server.calls.map((c) => c.path)).toContain('/api/sessions/s-1/events?cursor=ev-2');
  });

  it('shows the API error for an unknown session', async () => {
    renderWithApi(<SessionDetail id="missing" />, fakeServer({}));
    expect(await screen.findByText(/no route/)).toBeTruthy();
  });
});
