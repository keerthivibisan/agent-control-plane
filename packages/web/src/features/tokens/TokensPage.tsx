import type { ProjectTokensDto } from '@acp/core/api';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { TokensIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { ProvenanceBadge } from '../../components/ProvenanceBadge';
import { QueryView } from '../../components/QueryView';
import { TokenValue } from '../../components/TokenValue';
import { tokensPaths, tokensSchemas } from '../../lib/api';
import { PAGES_REFRESH_COPY, TOKEN_TYPES, TOKENS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { RangeControl } from './RangeControl';
import { TokensSkeleton } from './TokensSkeleton';
import { TokensBreakdown } from './TokensBreakdown';
import { CACHE, formatDayLong, NEW_WORK, TokensChart, type DayRow } from './TokensChart';
import { CountsOnly, TokenTiles } from './TokenTiles';
import { readTokensParams, toRangeQuery, type TokensParams } from './tokens-params';

const systemNow = () => new Date();
const C = TOKENS_COPY.charts;

const DAY_COLUMNS: readonly Column<DayRow>[] = [
  { key: 'day', label: C.day, cell: (r) => formatDayLong(r.day) },
  ...TOKEN_TYPES.map((t): Column<DayRow> => ({
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

function Charts({ data }: { data: ProjectTokensDto }) {
  const [asTable, setAsTable] = useState(false);
  const rows = useMemo<DayRow[]>(
    () => data.byDay.map((d) => ({ day: d.day, ...d.usage.tokens })),
    [data.byDay],
  );
  const dated = data.byDay.reduce((n, d) => n + d.usage.recordCount, 0);
  const undated = data.totals.recordCount - dated;
  return (
    <Card
      title={C.title}
      tip={C.tip}
      testId="tokens-charts"
      actions={
        rows.length > 0 ? (
          <Button size="sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? C.showChart : C.showTable}
          </Button>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={<TokensIcon size={18} />}
          title={TOKENS_COPY.emptyRange.title}
          text={TOKENS_COPY.emptyRange.text}
        />
      ) : asTable ? (
        <div data-testid="tokens-day-table" className="-mx-5 border-y border-line">
          <DataTable
            label={C.tableLabel}
            columns={DAY_COLUMNS}
            rows={[...rows].reverse()}
            rowKey={(r) => r.day}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="max-w-3xl text-caption text-dim">{C.note}</p>
          <div className="grid gap-x-8 gap-y-8 xl:grid-cols-2">
            <TokensChart title={C.newWork} rows={rows} series={NEW_WORK} />
            <TokensChart title={C.cache} rows={rows} series={CACHE} />
          </div>
        </div>
      )}
      {undated > 0 ? (
        <p className="mt-4 text-caption text-dim" data-testid="undated-usage">
          {C.undated(undated)}
        </p>
      ) : null}
    </Card>
  );
}

function Body({ data, params }: { data: ProjectTokensDto; params: TokensParams }) {
  if (data.totals.recordCount === 0 && params.preset === 'all') {
    // Runs or sessions without usage keep their counts in view; usage stays unreported, not 0.
    const counted = data.runs > 0 || data.sessions.total > 0;
    return (
      <div className="flex flex-col gap-6">
        {counted ? <CountsOnly data={data} /> : null}
        <Card>
          <EmptyState
            icon={<TokensIcon size={22} />}
            title={TOKENS_COPY.empty.title}
            text={counted ? TOKENS_COPY.empty.withRuns : TOKENS_COPY.empty.text}
          />
        </Card>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <TokenTiles data={data} />
        <p className="flex items-center gap-2 text-caption text-dim">
          <ProvenanceBadge provenance={data.headline.provenance} />
          {TOKENS_COPY.derivedTip}
        </p>
      </div>
      <Charts data={data} />
      <TokensBreakdown data={data} params={params} />
    </div>
  );
}

/**
 * `#/p/:projectId/tokens`: how many sessions and tokens the project used, and new work vs cache
 * reuse (docs/redesign/README.md §4.5). One request (`ProjectTokensDto`) feeds the whole page, so
 * the tiles, charts and tables always describe the same range.
 */
export function TokensPage({
  projectId,
  search,
  now = systemNow,
}: {
  projectId: string;
  search: URLSearchParams;
  /** Injected clock for the date presets (AGENTS.md §6). */
  now?: () => Date;
}) {
  const params = readTokensParams(search, now());
  const query = useApiQuery(
    tokensPaths.project(projectId, toRangeQuery(params)),
    tokensSchemas.project,
  );
  return (
    <div>
      <PageHeader
        title={TOKENS_COPY.title}
        description={TOKENS_COPY.description}
        tip={TOKENS_COPY.tip}
      />
      {/* Its own row, not the header's actions: a custom range adds two date fields, which
          would squeeze the title at 1024px. */}
      <div className="-mt-2 mb-6">
        <RangeControl projectId={projectId} params={params} now={now} />
      </div>
      {query.data === undefined && query.error === null ? (
        <TokensSkeleton label={PAGES_REFRESH_COPY.loading} />
      ) : (
        <QueryView query={query}>{(data) => <Body data={data} params={params} />}</QueryView>
      )}
    </div>
  );
}
