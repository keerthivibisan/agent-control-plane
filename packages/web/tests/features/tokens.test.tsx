import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { formatShare } from '../../src/lib/copy';
import { TokensPage } from '../../src/features/tokens/TokensPage';
import {
  presetDays,
  readTokensParams,
  toRangeQuery,
  tokensHref,
} from '../../src/features/tokens/tokens-params';
import { fakeServer, renderWithApi } from '../helpers';
import { emptyProjectTokens, headlineOf, projectTokens, totals } from '../fixtures/tokens';

beforeAll(() => {
  // Recharts' ResponsiveContainer observes its parent's size; jsdom has no ResizeObserver.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  window.location.hash = '';
});

const NOW = new Date('2026-10-16T15:30:00.000Z');
const now = () => NOW;
const PATH = '/api/projects/p-1/tokens';

function renderPage(search = '', routes: Record<string, unknown> = { [PATH]: projectTokens() }) {
  const server = fakeServer(routes);
  const view = renderWithApi(
    <TokensPage projectId="p-1" search={new URLSearchParams(search)} now={now} />,
    server,
  );
  return { server, ...view };
}

describe('tokens-params (R-F)', () => {
  it('reads presets by name, custom days, and the breakdown', () => {
    expect(readTokensParams(new URLSearchParams(''), NOW)).toEqual({
      preset: 'all',
      by: 'session',
    });
    expect(readTokensParams(new URLSearchParams('range=7d&by=model'), NOW)).toEqual({
      preset: '7d',
      by: 'model',
      from: '2026-10-10',
      to: '2026-10-16',
    });
    expect(readTokensParams(new URLSearchParams('from=2026-10-01&by=nope'), NOW)).toEqual({
      preset: 'custom',
      from: '2026-10-01',
      to: undefined,
      by: 'session',
    });
    expect(presetDays('30d', NOW)).toEqual({ from: '2026-09-17', to: '2026-10-16' });
  });

  it('asks the API for whole UTC days, `to` exclusive, swapping reversed days', () => {
    expect(toRangeQuery({ from: '2026-10-10', to: '2026-10-16' })).toEqual({
      from: '2026-10-10T00:00:00.000Z',
      to: '2026-10-17T00:00:00.000Z',
    });
    expect(toRangeQuery({ from: '2026-10-16', to: '2026-10-10' })).toEqual({
      from: '2026-10-10T00:00:00.000Z',
      to: '2026-10-17T00:00:00.000Z',
    });
    expect(toRangeQuery({})).toEqual({ from: undefined, to: undefined });
  });

  it('builds linkable addresses', () => {
    expect(tokensHref('p-1', { preset: 'all', by: 'session' })).toBe('#/p/p-1/tokens');
    expect(tokensHref('p-1', { preset: '7d', by: 'role', from: 'x', to: 'y' })).toBe(
      '#/p/p-1/tokens?range=7d&by=role',
    );
    expect(tokensHref('p-1', { preset: 'custom', from: '2026-10-01', by: 'session' })).toBe(
      '#/p/p-1/tokens?from=2026-10-01',
    );
    expect(tokensHref('p-1', { preset: 'custom', by: 'session' })).toBe(
      '#/p/p-1/tokens?range=custom',
    );
  });

  it('formats the share so a small one never reads as 0%', () => {
    expect(formatShare(0.9876)).toBe('99%');
    expect(formatShare(0.004)).toBe('0.4%');
    expect(formatShare(0)).toBe('0%');
  });
});

describe('TokensPage (R-F)', () => {
  it('shows the five headline tiles, with the cache share and its one-line reason', async () => {
    renderPage();
    const tiles = await screen.findByRole('group', { name: 'Tokens at a glance' });
    const tile = (id: string) => within(tiles).getByTestId(id);
    expect(tile('tile-sessions').textContent).toContain('6');
    expect(tile('tile-sessions').textContent).toContain('4 reported token usage');
    expect(tile('tile-runs').textContent).toContain('2');
    expect(tile('tile-runs').textContent).toContain('for 2 tickets');
    // New work is input + output; the exact count sits under the compact one.
    expect(tile('tile-new-work').textContent).toContain('12.4K');
    expect(tile('tile-new-work').textContent).toContain('12,400 tokens · input + output tokens');
    // 1,400 + 11,000 + 52,000 + 1,200,000.
    expect(tile('tile-total').textContent).toContain('1,264,400 tokens');
    expect(tile('tile-share').textContent).toContain('95%');
    expect(within(tile('tile-share')).getByTestId('share-why').textContent).toBe(
      'Every turn re-reads the conversation from the cache, so this share is usually large.',
    );
    // One input and two cache-write records were unavailable: both figures are partial.
    expect(within(tile('tile-new-work')).getByText('Partial')).toBeTruthy();
    expect(within(tile('tile-total')).getByText('Partial')).toBeTruthy();
    // Provenance stays visible.
    expect(document.querySelector('[data-provenance="derived"]')).not.toBeNull();
  });

  it('reads "Not reported" when nothing was reported, never 0', async () => {
    const none = totals({ input: null, output: null, cacheCreation: null, cacheRead: null }, 2, {
      input: 2,
      output: 2,
      cacheCreation: 2,
      cacheRead: 2,
    });
    renderPage('range=7d', {
      [`${PATH}?from=2026-10-10T00%3A00%3A00.000Z&to=2026-10-17T00%3A00%3A00.000Z`]: projectTokens({
        totals: none,
        headline: headlineOf(none.tokens),
      }),
    });
    const tiles = await screen.findByRole('group', { name: 'Tokens at a glance' });
    for (const id of ['tile-new-work', 'tile-total', 'tile-share']) {
      const t = within(tiles).getByTestId(id);
      expect(t.textContent).toContain('Not reported');
      expect(t.textContent).not.toMatch(/\b0\b/);
      expect(within(t).queryByText('Partial')).toBeNull();
    }
  });

  it('draws two separate charts and offers a day table; undated records are counted', async () => {
    renderPage();
    expect(await screen.findByRole('img', { name: 'New work per day' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Prompt cache per day' })).toBeTruthy();
    expect(screen.getByTestId('undated-usage').textContent).toContain('1 usage record has no date');
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const table = within(screen.getByTestId('tokens-day-table')).getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    // Newest day first.
    expect(rows[0]?.textContent).toContain('Oct 15, 2026');
    expect(rows[0]?.querySelector('[data-category="cacheRead"]')?.textContent).toBe('900,000');
  });

  it('breaks down by session with a provider-reported cost column and no cost total', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Tokens by session' });
    const header = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(header.some((h) => h?.includes('estimated (provider-reported)'))).toBe(true);
    const row = (id: string) => table.querySelector(`[data-row="${id}"]`) as HTMLElement;
    expect(within(row('sess-aaaaaaaa-1')).getByRole('link').getAttribute('href')).toBe(
      '#/sessions/sess-aaaaaaaa-1',
    );
    expect(row('sess-aaaaaaaa-1').textContent).toContain('~$1.25');
    // Only the id is known for an untitled session here: it is named by it, never "Untitled".
    expect(within(row('sess-bbbbbbbb-2')).getByRole('link').textContent).toBe('Session sess-bbb');
    // No snapshot and a snapshot without a cost both read "Not reported", never $0.
    for (const id of ['sess-bbbbbbbb-2', 'sess-cccccccc-3']) {
      const cost = within(row(id)).getByTestId('cost');
      expect(cost.textContent).toContain('Not reported');
      expect(cost.getAttribute('data-provenance')).toBe('unavailable');
    }
    expect(row('sess-cccccccc-3').querySelector('[data-figure="total"]')?.textContent).toBe(
      'Not reported',
    );
    expect(within(row('sess-aaaaaaaa-1')).getAllByText('Partial').length).toBe(2);
    // Costs are per session only: nothing on the page adds them up.
    expect(screen.queryByText(/\$2\.50|~\$1\.25.*~\$1\.25/)).toBeNull();
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });

  it('names sessions as the session list does when the server sends the fields (ADR-0024)', async () => {
    const base = projectTokens();
    const [first, second] = base.bySession;
    if (first === undefined || second === undefined) throw new Error('fixture');
    const data = {
      ...base,
      bySession: [
        {
          ...first,
          title: null,
          firstSeenAt: '2026-10-16T09:00:00.000Z',
          gitBranch: null,
          agentType: null,
          managed: {
            runId: 'r-1',
            agentRunId: 'a-1',
            ticketKey: 'WEB-12',
            kind: 'worker' as const,
            label: 'Frontend helper',
          },
        },
        { ...second, firstSeenAt: '2026-10-16T09:00:00.000Z', gitBranch: 'main', agentType: null },
      ],
    };
    renderPage('', { [PATH]: data });
    const table = await screen.findByRole('table', { name: 'Tokens by session' });
    const link = (id: string) =>
      within(table.querySelector(`[data-row="${id}"]`) as HTMLElement).getByRole('link');
    expect(link('sess-aaaaaaaa-1').textContent).toBe('WEB-12 · Frontend helper');
    expect(link('sess-bbbbbbbb-2').textContent).toMatch(/^Session on main · /);
  });

  it('switches breakdowns through the address', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Tokens by session' });
    fireEvent.click(screen.getByRole('button', { name: 'Agent role' }));
    expect(window.location.hash).toBe('#/p/p-1/tokens?by=role');
  });

  it('breaks down by ticket; a ticket with no observed usage reads "Not reported"', async () => {
    renderPage('by=ticket');
    const tickets = await screen.findByRole('table', { name: 'Tokens by ticket' });
    expect(within(tickets).getByText('WEB-1')).toBeTruthy();
    expect(within(tickets).getByRole('link', { name: /WEB-1/ }).getAttribute('href')).toBe(
      '#/p/p-1/tickets/t-1',
    );
    const web2 = tickets.querySelector('[data-row="t-2"]') as HTMLElement;
    expect(web2.querySelector('[data-figure="newWork"]')?.textContent).toContain('Not reported');
    // The cost column belongs to sessions only.
    expect(screen.queryByText('estimated (provider-reported)')).toBeNull();
  });

  it('breaks down by agent role, in workflow order, with "Outside the app"', async () => {
    renderPage('by=role');
    const roles = await screen.findByRole('table', { name: 'Tokens by agent role' });
    expect(
      within(roles)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.getAttribute('data-row')),
    ).toEqual(['lead', 'worker', 'external']);
    expect(within(roles).getByText('Outside the app')).toBeTruthy();
    expect(within(roles).getByText('Helpers')).toBeTruthy();
  });

  it('breaks down by model, naming records with no model', async () => {
    renderPage('by=model');
    const models = await screen.findByRole('table', { name: 'Tokens by model' });
    expect(within(models).getByText('claude-opus-4-1')).toBeTruthy();
    expect(within(models).getByText('Unknown model')).toBeTruthy();
  });

  it('asks for the chosen range and writes range changes to the address', async () => {
    const { server } = renderPage('range=7d', {
      [`${PATH}?from=2026-10-10T00%3A00%3A00.000Z&to=2026-10-17T00%3A00%3A00.000Z`]:
        projectTokens(),
    });
    await screen.findByRole('group', { name: 'Tokens at a glance' });
    expect(server.calls.map((c) => c.path)).toContain(
      `${PATH}?from=2026-10-10T00%3A00%3A00.000Z&to=2026-10-17T00%3A00%3A00.000Z`,
    );
    const range = screen.getByRole('form', { name: 'Date range' });
    expect(
      within(range).getByRole('button', { name: 'Last 7 days' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(range.textContent).toContain('Days are counted in UTC.');
    fireEvent.click(within(range).getByRole('button', { name: 'Custom' }));
    expect(window.location.hash).toBe('#/p/p-1/tokens?from=2026-10-10&to=2026-10-16');
    fireEvent.click(within(range).getByRole('button', { name: 'All time' }));
    expect(window.location.hash).toBe('#/p/p-1/tokens');
  });

  it('shows custom date fields for a custom range', async () => {
    renderPage('range=custom&from=2026-10-01&to=2026-10-05', {
      [`${PATH}?from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-06T00%3A00%3A00.000Z`]:
        projectTokens(),
    });
    await screen.findByRole('group', { name: 'Tokens at a glance' });
    expect(screen.getByLabelText<HTMLInputElement>('From').value).toBe('2026-10-01');
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-09' } });
    expect(window.location.hash).toBe('#/p/p-1/tokens?from=2026-10-01&to=2026-10-09');
  });

  it('has one empty state with no usage at all, and a range-empty state in a range', async () => {
    renderPage('', { [PATH]: emptyProjectTokens() });
    expect(await screen.findByText('No token usage yet')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Tokens at a glance' })).toBeNull();
    // Nothing to count either: the empty state alone.
    expect(screen.queryByTestId('token-counts')).toBeNull();
  });

  it('keeps the run and session counts when runs have no observed usage yet', async () => {
    renderPage('', {
      [PATH]: emptyProjectTokens({
        sessions: { total: 0, withUsage: 0 },
        runs: 2,
        ticketsWithRuns: 1,
      }),
    });
    expect(await screen.findByText('No token usage yet')).toBeTruthy();
    const counts = screen.getByRole('group', { name: 'Sessions and runs' });
    expect(within(counts).getByTestId('tile-runs').textContent).toContain('2');
    expect(within(counts).getByTestId('tile-runs').textContent).toContain('for 1 ticket');
    expect(within(counts).getByTestId('tile-sessions').textContent).toContain('0 reported');
    expect(screen.getByText(/once the app observes these Claude Code sessions/)).toBeTruthy();
    // No token figure: usage that was never reported is not shown as 0 tokens.
    expect(screen.queryByRole('group', { name: 'Tokens at a glance' })).toBeNull();
    expect(screen.queryByTestId('tile-new-work')).toBeNull();
  });

  it('keeps tiles in an empty range and says so in the charts', async () => {
    renderPage('range=7d', {
      [`${PATH}?from=2026-10-10T00%3A00%3A00.000Z&to=2026-10-17T00%3A00%3A00.000Z`]:
        emptyProjectTokens({ sessions: { total: 2, withUsage: 0 } }),
    });
    expect(await screen.findByText('No token usage in this range')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Tokens at a glance' })).toBeTruthy();
    expect(screen.getByText('No session used tokens in this range.')).toBeTruthy();
  });

  it('shows an error from the API instead of numbers', async () => {
    renderPage('', {});
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Tokens at a glance' })).toBeNull();
  });
});
