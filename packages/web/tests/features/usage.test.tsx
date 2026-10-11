import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { toChartRows } from '../../src/features/usage/chart-rows';
import { sortGroups } from '../../src/features/usage/UsageBreakdown';
import {
  presetRange,
  readUsageParams,
  toUsageQuery,
  usageHref,
} from '../../src/features/usage/usage-params';
import { UsageAnalytics } from '../../src/features/usage/UsageAnalytics';
import { partialUsage, usage, usageSummary } from '../fixtures/dto';
import { fakeServer, renderWithApi } from '../helpers';

beforeAll(() => {
  // Recharts' ResponsiveContainer observes its parent's size; jsdom has no ResizeObserver.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  window.localStorage.clear();
});

const NOW = new Date('2026-10-11T15:30:00.000Z');
const now = () => NOW;

const days = usageSummary({
  groupBy: 'day',
  groups: [
    { key: '2026-10-09', label: '2026-10-09', usage: partialUsage },
    { key: 'unknown', label: 'Unknown date', usage: usage({ recordCount: 2 }) },
    { key: '2026-10-08', label: '2026-10-08', usage: usage() },
  ],
  totals: partialUsage,
});

describe('toChartRows', () => {
  it('sorts by day, keeps null as null (never 0) and splits out the undated group', () => {
    const { rows, undated } = toChartRows(days.groups);
    expect(rows.map((r) => r.day)).toEqual(['2026-10-08', '2026-10-09']);
    expect(rows[1]).toEqual({
      day: '2026-10-09',
      input: 10,
      output: 200,
      cacheCreation: null,
      cacheRead: 5000,
    });
    expect(rows[1]?.cacheCreation).toBeNull();
    expect(undated?.recordCount).toBe(2);
  });

  it('does not invent rows for days without records, and handles empty input', () => {
    expect(toChartRows([])).toEqual({ rows: [], undated: null });
    const { rows } = toChartRows([days.groups[0], days.groups[2]].filter((g) => g !== undefined));
    expect(rows).toHaveLength(2);
  });
});

describe('usage params', () => {
  it('validates groupBy and dates and builds an inclusive UTC range', () => {
    const p = readUsageParams(new URLSearchParams('groupBy=bogus&from=2026-10-01&to=nope'), NOW);
    expect(p).toMatchObject({
      groupBy: 'project',
      preset: 'custom',
      from: '2026-10-01',
      to: undefined,
    });
    expect(toUsageQuery({ ...p, to: '2026-10-02' }, 'day')).toEqual({
      groupBy: 'day',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-03T00:00:00.000Z',
      projectId: undefined,
    });
  });

  it('resolves presets against the injected clock, in UTC days', () => {
    expect(presetRange('7d', NOW)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(presetRange('30d', NOW)).toEqual({ from: '2026-09-12', to: '2026-10-11' });
    expect(readUsageParams(new URLSearchParams('range=7d&groupBy=day'), NOW)).toEqual({
      groupBy: 'day',
      preset: '7d',
      from: '2026-10-05',
      to: '2026-10-11',
      projectId: undefined,
    });
    expect(readUsageParams(new URLSearchParams(''), NOW)).toMatchObject({
      preset: 'all',
      from: undefined,
      to: undefined,
    });
    expect(readUsageParams(new URLSearchParams('range=custom'), NOW).preset).toBe('custom');
  });

  it('keeps a preset as its name in the link, and a custom range as dates', () => {
    expect(usageHref({ groupBy: 'model', preset: '7d', from: '2026-10-05' })).toBe(
      '#/usage?groupBy=model&range=7d',
    );
    expect(usageHref({ groupBy: 'model', preset: 'custom', from: '2026-10-05' })).toBe(
      '#/usage?groupBy=model&from=2026-10-05',
    );
    expect(usageHref({ groupBy: 'day', preset: 'custom' })).toBe(
      '#/usage?groupBy=day&range=custom',
    );
    expect(usageHref({ groupBy: 'session', projectId: 'p-1' })).toBe(
      '#/usage?groupBy=session&projectId=p-1',
    );
  });
});

describe('sortGroups', () => {
  const g = (key: string, output: number | null) => ({
    key,
    label: key,
    usage: usage({ tokens: { input: 1, output, cacheCreation: 1, cacheRead: 1 } }),
  });

  it('orders days newest first with the undated group last', () => {
    const out = sortGroups([g('2026-10-08', 1), g('unknown', 1), g('2026-10-09', 1)], 'day');
    expect(out.map((x) => x.key)).toEqual(['2026-10-09', '2026-10-08', 'unknown']);
  });

  it('orders other groups by output tokens, a missing output last (not as 0)', () => {
    const out = sortGroups([g('a', 0), g('b', null), g('c', 50)], 'model');
    expect(out.map((x) => x.key)).toEqual(['c', 'a', 'b']);
  });
});

describe('Tokens page', () => {
  const routes = {
    '/api/usage/summary?groupBy=day': days,
    '/api/usage/summary?groupBy=model': usageSummary({
      groupBy: 'model',
      groups: [
        { key: 'unknown', label: 'Unknown model', usage: usage() },
        { key: 'model-a', label: 'model-a', usage: partialUsage },
      ],
      totals: partialUsage,
    }),
  };

  it('explains the four token types and can be hidden (remembered)', () => {
    const server = fakeServer(routes);
    const view = renderWithApi(
      <UsageAnalytics search={new URLSearchParams('groupBy=model')} now={now} />,
      server,
    );
    const explainer = screen.getByTestId('token-explainer');
    for (const term of ['Input tokens', 'Output tokens', 'Cache write tokens', 'Cache read tokens'])
      expect(within(explainer).getByText(term)).toBeTruthy();
    expect(within(explainer).getByText(/never adds them into one total/)).toBeTruthy();
    fireEvent.click(within(explainer).getByRole('button', { name: 'Hide' }));
    expect(screen.queryByTestId('token-explainer')).toBeNull();
    view.unmount();
    renderWithApi(<UsageAnalytics search={new URLSearchParams()} now={now} />, server);
    expect(screen.getByRole('button', { name: 'What do these mean?' })).toBeTruthy();
  });

  it('shows the four types side by side with "Not reported" and partial notes, never a total', async () => {
    renderWithApi(
      <UsageAnalytics search={new URLSearchParams('groupBy=model')} now={now} />,
      fakeServer(routes),
    );
    const stats = await screen.findByTestId('usage-totals');
    expect(within(stats).getByTestId('stat-cacheCreation').textContent).toContain('Not reported');
    expect(stats.querySelector('[data-category="cacheCreation"]')?.textContent).toBe(
      'Not reported',
    );
    expect(stats.querySelector('[data-category="output"]')?.textContent).toBe('200');
    expect(stats.querySelector('[data-partial="cacheRead"]')?.textContent).toMatch(
      /1 of 3 records didn't report this/,
    );
    expect(within(stats).queryByText(/total/i)).toBeNull();
  });

  it('draws two titled charts, offers a table instead, and notes undated records', async () => {
    renderWithApi(
      <UsageAnalytics search={new URLSearchParams('groupBy=model')} now={now} />,
      fakeServer(routes),
    );
    expect(
      await screen.findByRole('img', { name: 'Input and output tokens per day' }),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Prompt cache tokens per day' })).toBeTruthy();
    expect(screen.getByTestId('chart-input')).toBeTruthy();
    expect(screen.getByTestId('chart-cacheCreation')).toBeTruthy();
    expect(screen.getByTestId('undated-usage').textContent).toContain(
      '2 usage records have no date',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const table = screen.getByTestId('chart-table');
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2 days
    const row = within(table).getByText('Fri, Oct 9, 2026').closest('tr') as HTMLElement;
    expect(row.querySelector('[data-category="cacheCreation"]')?.textContent).toBe('Not reported');
    expect(screen.queryByRole('img', { name: 'Prompt cache tokens per day' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show as chart' }));
    expect(screen.getByRole('img', { name: 'Prompt cache tokens per day' })).toBeTruthy();
  });

  it('breaks tokens down by the chosen group with the counted-once note', async () => {
    renderWithApi(
      <UsageAnalytics search={new URLSearchParams('groupBy=model')} now={now} />,
      fakeServer(routes),
    );
    const card = await screen.findByTestId('usage-breakdown');
    expect(within(card).getByRole('heading', { name: 'Tokens by model' })).toBeTruthy();
    expect(screen.getByTestId('direct-note').textContent).toContain(
      "Each session's own tokens are counted once; helper agents count under themselves.",
    );
    const table = await within(card).findByRole('table', { name: 'Tokens by model' });
    for (const h of [
      'Model',
      'Input tokens',
      'Output tokens',
      'Cache write tokens',
      'Cache read tokens',
    ])
      expect(within(table).getByRole('columnheader', { name: h })).toBeTruthy();
    const rows = table.querySelectorAll('tr[data-group]');
    // Sorted by output: Unknown model (3,400) before model-a (200).
    expect([...rows].map((r) => r.getAttribute('data-group'))).toEqual(['unknown', 'model-a']);
    const modelA = table.querySelector('tr[data-group="model-a"]') as HTMLElement;
    expect(modelA.querySelector('[data-category="cacheCreation"]')?.textContent).toBe(
      'Not reported',
    );
    expect(modelA.querySelector('[data-partial="cacheRead"]')).toBeTruthy();
    // No cost on this page: it points to sessions instead.
    expect(screen.queryByTestId('cost')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to sessions' }).getAttribute('href')).toBe(
      '#/sessions',
    );
  });

  it('links session and project groups to their pages', async () => {
    renderWithApi(
      <UsageAnalytics search={new URLSearchParams('groupBy=session')} now={now} />,
      fakeServer({
        ...routes,
        '/api/usage/summary?groupBy=session': usageSummary({
          groupBy: 'session',
          groups: [
            { key: 's-1', label: 'Fix the build', usage: usage() },
            { key: 'unknown', label: 'Unknown session', usage: usage() },
          ],
        }),
      }),
    );
    const link = await screen.findByRole('link', { name: 'Fix the build' });
    expect(link.getAttribute('href')).toBe('#/sessions/s-1');
    expect(screen.queryByRole('link', { name: 'Unknown session' })).toBeNull();
  });

  it('passes a preset range and the project filter to both queries', async () => {
    const q = 'from=2026-10-05T00%3A00%3A00.000Z&groupBy=';
    const to = '&projectId=p-1&to=2026-10-12T00%3A00%3A00.000Z';
    const server = fakeServer({
      [`/api/usage/summary?${q}day${to}`]: days,
      [`/api/usage/summary?${q}project${to}`]: usageSummary(),
    });
    renderWithApi(
      <UsageAnalytics search={new URLSearchParams('range=7d&projectId=p-1')} now={now} />,
      server,
    );
    expect(await screen.findByTestId('usage-totals')).toBeTruthy();
    expect(await screen.findByTestId('chart-input')).toBeTruthy();
    expect(await screen.findByRole('table', { name: 'Tokens by project' })).toBeTruthy();
    const dates = screen.getByRole('group', { name: 'Dates' });
    expect(
      within(dates).getByRole('button', { name: 'Last 7 days' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByText('Days are counted in UTC.')).toBeTruthy();
  });

  it('changes the hash from the filters', () => {
    window.location.hash = '#/usage';
    renderWithApi(<UsageAnalytics search={new URLSearchParams()} now={now} />, fakeServer(routes));
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    expect(window.location.hash).toBe('#/usage?groupBy=project&range=30d');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Group by' })).getByRole('button', { name: 'Day' }),
    );
    expect(window.location.hash).toBe('#/usage?groupBy=day');
  });

  it('shows a clear message when the API is unreachable', async () => {
    const server = fakeServer({}, { withDefaults: false });
    server.fetch = () => Promise.reject(new TypeError('fetch failed'));
    renderWithApi(<UsageAnalytics search={new URLSearchParams()} now={now} />, server);
    expect((await screen.findAllByText(/not reachable/i)).length).toBeGreaterThan(0);
  });
});
