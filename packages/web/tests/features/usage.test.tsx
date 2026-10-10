import { screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { toChartRows } from '../../src/features/usage/chart-rows';
import { toUsageQuery, readUsageParams } from '../../src/features/usage/usage-params';
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

const days = usageSummary({
  groupBy: 'day',
  groups: [
    { key: '2026-10-09', label: '2026-10-09', usage: partialUsage },
    { key: 'unknown', label: 'Unknown date', usage: usage({ recordCount: 2 }) },
    { key: '2026-10-08', label: '2026-10-08', usage: usage() },
  ],
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
    const p = readUsageParams(new URLSearchParams('groupBy=bogus&from=2026-10-01&to=nope'));
    expect(p).toMatchObject({ groupBy: 'project', from: '2026-10-01', to: undefined });
    expect(toUsageQuery({ ...p, to: '2026-10-02' }, 'day')).toEqual({
      groupBy: 'day',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T23:59:59.999Z',
      projectId: undefined,
    });
  });
});

describe('Usage analytics', () => {
  const routes = {
    '/api/usage/summary?groupBy=day': days,
    '/api/usage/summary?groupBy=model': usageSummary({
      groupBy: 'model',
      groups: [
        { key: 'model-a', label: 'model-a', usage: partialUsage },
        { key: 'unknown', label: 'Unknown model', usage: usage() },
      ],
      totals: partialUsage,
    }),
  };

  it('renders two separate charts, labels DIRECT usage and shows unavailable (not 0)', async () => {
    const server = fakeServer(routes);
    renderWithApi(<UsageAnalytics search={new URLSearchParams('groupBy=model')} />, server);
    expect(await screen.findByTestId('chart-input')).toBeTruthy();
    expect(screen.getByTestId('chart-cacheCreation')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Input and output tokens' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Cache creation and cache read tokens' })).toBeTruthy();

    // Chart data table: the null day shows "unavailable".
    const table = screen.getByTestId('chart-table');
    const row = within(table).getByText('2026-10-09').closest('tr') as HTMLElement;
    expect(within(row).getByText('unavailable')).toBeTruthy();

    expect(await screen.findByTestId('direct-note')).toBeTruthy();
    expect(screen.getByText(/Groups and totals sum DIRECT usage/)).toBeTruthy();
    const groupRow = (await screen.findByText('Unknown model')).closest('tr') as HTMLElement;
    expect(groupRow.getAttribute('data-group')).toBe('unknown');
    expect(screen.getByTestId('undated-usage').textContent).toContain('2 usage records');
  });

  it('passes the range and project filter to both queries', async () => {
    const q = 'from=2026-10-01T00%3A00%3A00.000Z&groupBy=';
    const server = fakeServer({
      [`/api/usage/summary?${q}day&projectId=p-1`]: days,
      [`/api/usage/summary?${q}project&projectId=p-1`]: usageSummary(),
    });
    renderWithApi(
      <UsageAnalytics search={new URLSearchParams('from=2026-10-01&projectId=p-1')} />,
      server,
    );
    expect(await screen.findByTestId('usage-totals')).toBeTruthy();
    expect(await screen.findByTestId('chart-input')).toBeTruthy();
  });

  it('shows a clear message when the API is unreachable', async () => {
    const server = fakeServer({}, { withDefaults: false });
    server.fetch = () => Promise.reject(new TypeError('fetch failed'));
    renderWithApi(<UsageAnalytics search={new URLSearchParams()} />, server);
    expect((await screen.findAllByText(/not reachable/i)).length).toBeGreaterThan(0);
  });
});
