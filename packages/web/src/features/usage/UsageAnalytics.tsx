import type { UsageSummaryDto } from '@acp/core/api';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { TokensIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { TokenValue } from '../../components/TokenValue';
import { paths, schemas } from '../../lib/api';
import { EMPTY, PAGES, TOKEN_TYPES, TOKENS_PAGE } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { toChartRows, type ChartRow } from './chart-rows';
import { TokenExplainer } from './TokenExplainer';
import { TokenStats } from './TokenStats';
import { UsageBreakdown } from './UsageBreakdown';
import { CACHE, formatDayLong, INPUT_OUTPUT, UsageChart } from './UsageChart';
import { UsageFilters } from './UsageFilters';
import { readUsageParams, toUsageQuery, type UsageParams } from './usage-params';

const systemNow = () => new Date();

const DAY_COLUMNS: readonly Column<ChartRow>[] = [
  { key: 'day', label: TOKENS_PAGE.groupWords.day, cell: (r) => formatDayLong(r.day) },
  ...TOKEN_TYPES.map((t): Column<ChartRow> => ({
    key: t.key,
    label: t.label,
    align: 'right',
    cell: (r) => (
      <span data-category={t.key}>
        <TokenValue value={r[t.key]} type={t.key} showUnit={false} />
      </span>
    ),
  })),
];

function ChartBody({ summary }: { summary: UsageSummaryDto }) {
  const [asTable, setAsTable] = useState(false);
  const { rows, undated } = useMemo(() => toChartRows(summary.groups), [summary.groups]);
  const { charts } = TOKENS_PAGE;
  if (rows.length === 0 && !undated) {
    return (
      <EmptyState
        compact
        icon={<TokensIcon size={18} />}
        title={TOKENS_PAGE.emptyRange.title}
        text={TOKENS_PAGE.emptyRange.text}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-2xl text-caption text-dim">{charts.note}</p>
            <Button onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
              {asTable ? charts.showChart : charts.showTable}
            </Button>
          </div>
          {asTable ? (
            <div data-testid="chart-table" className="-mx-4">
              <DataTable
                label={charts.tableLabel}
                columns={DAY_COLUMNS}
                rows={[...rows].reverse()}
                rowKey={(r) => r.day}
              />
            </div>
          ) : (
            <div className="grid gap-x-8 gap-y-6 xl:grid-cols-2">
              <UsageChart title={charts.inputOutput} rows={rows} series={INPUT_OUTPUT} />
              <UsageChart title={charts.cache} rows={rows} series={CACHE} />
            </div>
          )}
        </>
      ) : null}
      {undated ? (
        <p className="text-caption text-dim" data-testid="undated-usage">
          {TOKENS_PAGE.undated(undated.recordCount)}
        </p>
      ) : null}
    </div>
  );
}

/** Stats and charts share the per-day query: its totals are the selected range's totals. */
function RangeOverview({ params }: { params: UsageParams }) {
  const query = useApiQuery(paths.usageSummary(toUsageQuery(params, 'day')), schemas.usageSummary);
  return (
    <QueryView query={query}>
      {(s) =>
        s.totals.recordCount === 0 && params.preset === 'all' && !params.projectId ? (
          <Card>
            <EmptyState
              icon={<TokensIcon size={22} />}
              title={EMPTY.tokens.title}
              text={EMPTY.tokens.text}
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            <TokenStats usage={s.totals} testId="usage-totals" />
            <Card title={TOKENS_PAGE.charts.title}>
              <ChartBody summary={s} />
            </Card>
          </div>
        )
      }
    </QueryView>
  );
}

/** `#/usage`, the Tokens page: how many tokens sessions used, and where. Never a combined total. */
export function UsageAnalytics({
  search,
  now = systemNow,
}: {
  search: URLSearchParams;
  /** Injected clock for the date presets (AGENTS.md §6). */
  now?: () => Date;
}) {
  const params = readUsageParams(search, now());
  // Remount on a filter change so a previous range's numbers are never shown under new filters.
  const range = JSON.stringify([params.from, params.to, params.projectId]);
  const key = `${range}|${params.groupBy}`;
  return (
    <div>
      <PageHeader title={PAGES.tokens.title} description={PAGES.tokens.description} />
      <div className="flex flex-col gap-6">
        <TokenExplainer />
        <UsageFilters params={params} now={now} />
        <RangeOverview key={`o|${range}`} params={params} />
        <UsageBreakdown key={`t|${key}`} params={params} />
        <p className="text-dim">
          {TOKENS_PAGE.cost.text}{' '}
          <a href={href.sessions({ projectId: params.projectId })}>{TOKENS_PAGE.cost.link}</a>
        </p>
      </div>
    </div>
  );
}
