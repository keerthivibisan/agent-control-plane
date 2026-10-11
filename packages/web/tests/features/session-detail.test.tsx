import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionDetail } from '../../src/features/session-detail/SessionDetail';
import { detail, edge, event, page, partialUsage, session, tree, usage } from '../fixtures/dto';
import { fakeServer, renderWithApi } from '../helpers';

const events1 = page(
  [
    event({ id: 9, eventType: 'tool.called', payload: { toolName: 'Read' } }),
    event({ id: 8, eventType: 'message.user', payload: {} }),
  ],
  'ev-2',
);
const events2 = page([event({ id: 3, eventType: 'session.ended', payload: {} })]);

const helper = session({ id: 'h-1', agentType: 'Explore', providerAgentId: 'ag-1' });
const fork = session({ id: 's-fork-1', title: 'Fix login, part 2' });

describe('Session detail', () => {
  it('shows both token views side by side, "Not reported" for missing types, never summed', async () => {
    const s = detail({
      id: 's-1',
      title: 'Fix login',
      childCount: 1,
      directUsage: partialUsage,
      aggregateUsage: usage({ recordCount: 9 }),
      ambiguousAttributionCount: 2,
    });
    renderWithApi(
      <SessionDetail id="s-1" />,
      fakeServer({ '/api/sessions/s-1': s, '/api/sessions/s-1/events': page([]) }),
    );
    expect(await screen.findByRole('heading', { name: 'Fix login', level: 1 })).toBeTruthy();

    const direct = screen.getByTestId('usage-direct');
    const creation = direct.querySelector('[data-category="cacheCreation"]') as HTMLElement;
    expect(creation.textContent).toBe('Not reported');
    expect(screen.getByRole('region', { name: 'Tokens (this session)' })).toBeTruthy();
    const aggregate = screen.getByTestId('usage-aggregate');
    expect(aggregate.querySelector('[data-category="input"]')?.textContent).toBe('1,200');
    expect(screen.getByRole('region', { name: 'Tokens (with helpers)' })).toBeTruthy();
    // The two views are never added: nothing on the page shows 1,210 input tokens.
    expect(document.body.textContent).not.toContain('1,210');
    expect(screen.getByTestId('shared-messages').textContent).toContain(
      '2 messages were copied between sessions',
    );
    expect(screen.queryByText(/completed/i)).toBeNull();
  });

  it('says when a session started no helpers instead of repeating the same numbers', async () => {
    renderWithApi(
      <SessionDetail id="s-0" />,
      fakeServer({
        '/api/sessions/s-0': detail({
          id: 's-0',
          childCount: 0,
          aggregateUsage: usage(),
        }),
        '/api/sessions/s-0/events': page([]),
      }),
    );
    expect(await screen.findByText(/didn't start any helper agents/)).toBeTruthy();
    expect(screen.queryByTestId('usage-aggregate')).toBeNull();
    expect(screen.getByText('No helper agents')).toBeTruthy();
    expect(screen.getByText('No activity yet')).toBeTruthy();
  });

  it('labels the reported cost as estimated and lists tokens by model with units', async () => {
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
    renderWithApi(
      <SessionDetail id="s-2" />,
      fakeServer({ '/api/sessions/s-2': s, '/api/sessions/s-2/events': page([]) }),
    );
    const snap = await screen.findByTestId('snapshot');
    expect(within(snap).getByRole('heading', { name: 'Estimated cost' })).toBeTruthy();
    const cost = within(snap).getByTestId('cost');
    expect(cost.getAttribute('data-provenance')).toBe('estimated');
    expect(cost.textContent).toContain('~$1.50');
    expect(within(snap).getByText(/Covers this session only\./)).toBeTruthy();
    const table = within(snap).getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Output tokens' })).toBeTruthy();
    const rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent).toContain('model-a');
    expect(rows[2]?.textContent).toContain('Not reported');
  });

  it("says Claude Code didn't report a cost instead of showing $0", async () => {
    renderWithApi(
      <SessionDetail id="s-3" />,
      fakeServer({
        '/api/sessions/s-3': detail({ id: 's-3', latestSnapshot: null }),
        '/api/sessions/s-3/events': page([]),
      }),
    );
    const none = await screen.findByTestId('no-snapshot');
    expect(none.textContent).toContain("Claude Code didn't report a cost for this session");
    expect(screen.queryByTestId('cost')).toBeNull();
    expect(document.body.textContent).not.toContain('$0');
  });

  it('explains an unknown parent and links continuations and helper agents', async () => {
    const s = detail({
      id: 's-1',
      title: 'Fix login',
      childCount: 1,
      continuationIds: ['s-fork-1'],
    });
    renderWithApi(
      <SessionDetail id="s-1" />,
      fakeServer({
        '/api/sessions/s-1': s,
        '/api/sessions/s-1/events': page([]),
        '/api/sessions/s-1/tree': tree(
          's-1',
          [session({ id: 's-1', title: 'Fix login' }), helper, fork],
          [edge('s-1', 'h-1'), edge('s-1', 's-fork-1', 'continuation')],
        ),
      }),
    );
    expect((await screen.findByTestId('parent-unknown')).textContent).toBe('No known parent');
    const continuations = screen.getByTestId('continuations');
    expect(
      await within(continuations).findByRole('link', { name: 'Fix login, part 2' }),
    ).toBeTruthy();
    const helpers = screen.getByTestId('helper-agents');
    const link = await within(helpers).findByRole('link', { name: 'Helper agent: Explore' });
    expect(link.getAttribute('href')).toBe('#/sessions/h-1');
    // The fork is a continuation, not a helper agent.
    expect(within(helpers).queryByText('Fix login, part 2')).toBeNull();
    expect(screen.getByRole('link', { name: 'See how it relates' }).getAttribute('href')).toBe(
      '#/sessions?root=s-1&view=relationships',
    );
  });

  it('a known parent reads "Continued from" or "Started by" with a link', async () => {
    renderWithApi(
      <SessionDetail id="s-4" />,
      fakeServer({
        '/api/sessions/s-4': detail({
          id: 's-4',
          parent: {
            state: 'known',
            sessionId: 'parent-1',
            kind: 'continuation',
            provenance: 'observed',
            evidence: ['shared-message-history'],
          },
        }),
        '/api/sessions/s-4/events': page([]),
      }),
    );
    const known = await screen.findByTestId('parent-known');
    expect(known.textContent).toContain('Continued from');
    expect(within(known).getByRole('link', { name: 'Session' }).getAttribute('href')).toBe(
      '#/sessions/parent-1',
    );
    expect(screen.queryByTestId('parent-unknown')).toBeNull();
  });

  it('describes activity in plain sentences and loads older events with the cursor', async () => {
    const server = fakeServer({
      '/api/sessions/s-1': detail({ id: 's-1' }),
      '/api/sessions/s-1/events': events1,
      '/api/sessions/s-1/events?cursor=ev-2': events2,
    });
    renderWithApi(<SessionDetail id="s-1" />, server);
    expect(await screen.findByText('Used tool: Read')).toBeTruthy();
    expect(screen.getByText('You sent a message')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    expect(await screen.findByText('Session ended')).toBeTruthy();
    // Older events are added below, the newer ones stay.
    expect(screen.getByText('Used tool: Read')).toBeTruthy();
    expect(server.calls.map((c) => c.path)).toContain('/api/sessions/s-1/events?cursor=ev-2');
    await waitFor(() =>
      expect(screen.getByText('That is everything recorded for this session.')).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
    // Raw rows (event type, provenance) stay available under technical details.
    const raw = screen.getByTestId('raw-events');
    expect(raw.querySelectorAll('tr[data-event-id]')).toHaveLength(3);
    expect(within(raw).getByText('tool.called')).toBeTruthy();
  });

  it('keeps full ids and metadata under technical details', async () => {
    renderWithApi(
      <SessionDetail id="s-1" />,
      fakeServer({
        '/api/sessions/s-1': detail({ id: 's-1', providerVersion: '2.1.0' }),
        '/api/sessions/s-1/events': page([]),
      }),
    );
    const meta = await screen.findByTestId('session-metadata');
    expect(meta.closest('details')?.open).toBe(false);
    expect(meta.textContent).toContain('/work/repo');
    expect(meta.textContent).toContain('prov-s-1');
    expect(meta.textContent).toContain('2.1.0');
  });

  it('shows the API error for an unknown session', async () => {
    renderWithApi(<SessionDetail id="missing" />, fakeServer({}));
    expect(await screen.findByText(/no route/)).toBeTruthy();
  });
});
