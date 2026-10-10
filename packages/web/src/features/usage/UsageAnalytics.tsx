import type { UsageSummaryDto } from '@acp/core/api';
import { useMemo } from 'react';
import { PageHeader, Panel } from '../../components/Panel';
import { QueryView } from '../../components/QueryView';
import { TokenCount } from '../../components/TokenCount';
import { UsageTotals } from '../../components/UsageTotals';
import { paths, schemas } from '../../lib/api';
import { useApiQuery } from '../../lib/query';
import { href, navigate } from '../../lib/router';
import { TOKEN_CATEGORIES } from '../../lib/tokens';
import { toChartRows } from './chart-rows';
import { CACHE, INPUT_OUTPUT, UsageChart } from './UsageChart';
import { readUsageParams, toUsageQuery, usageHref, type UsageParams } from './usage-params';

const field = 'rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-ink';

const GROUP_LABEL: Record<UsageParams['groupBy'], string> = {
  project: 'project',
  session: 'session',
  model: 'model',
  day: 'day (UTC)',
};

function Controls({ params }: { params: UsageParams }) {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const go = (change: Partial<UsageParams>) => navigate(usageHref({ ...params, ...change }));
  return (
    <form
      aria-label="Usage filters"
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-wrap items-end gap-2 rounded border border-line bg-panel px-3 py-2"
    >
      <label className="flex flex-col gap-0.5 text-[11px] text-dim">
        Group table by
        <select
          className={field}
          value={params.groupBy}
          onChange={(e) =>
            // Only GROUP_LABEL's keys are offered, and readUsageParams re-validates the hash.
            go({ groupBy: e.target.value as UsageParams['groupBy'] })
          }
        >
          {Object.entries(GROUP_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-dim">
        Project
        <select
          className={field}
          value={params.projectId ?? ''}
          onChange={(e) => go({ projectId: e.target.value || undefined })}
        >
          <option value="">all projects</option>
          {projects.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-dim">
        From (UTC day)
        <input
          type="date"
          className={field}
          value={params.from ?? ''}
          onChange={(e) => go({ from: e.target.value || undefined })}
        />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-dim">
        To (UTC day, inclusive)
        <input
          type="date"
          className={field}
          value={params.to ?? ''}
          onChange={(e) => go({ to: e.target.value || undefined })}
        />
      </label>
      {params.from || params.to || params.projectId ? (
        <a
          className="text-xs"
          href={usageHref({ groupBy: params.groupBy })}
          aria-label="Clear filters"
        >
          clear filters
        </a>
      ) : null}
    </form>
  );
}

function Charts({ params }: { params: UsageParams }) {
  const query = useApiQuery(paths.usageSummary(toUsageQuery(params, 'day')), schemas.usageSummary);
  return (
    <Panel title="Direct tokens per day (UTC)">
      <QueryView query={query} loading="Loading daily usage…">
        {(s) => <ChartBody summary={s} />}
      </QueryView>
    </Panel>
  );
}

function ChartBody({ summary }: { summary: UsageSummaryDto }) {
  const { rows, undated } = useMemo(() => toChartRows(summary.groups), [summary.groups]);
  if (rows.length === 0 && !undated) {
    return <p className="text-dim italic">No usage records in this range.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-dim">
        Observed usage records summed per UTC day (direct usage; each message is counted once).
        Lines are not stacked. A category no record reported is a gap in the line, not zero. Days
        without records are omitted.
      </p>
      {rows.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <UsageChart title="Input and output tokens" rows={rows} series={INPUT_OUTPUT} />
          <UsageChart title="Cache creation and cache read tokens" rows={rows} series={CACHE} />
        </div>
      ) : null}
      {undated ? (
        <p className="text-[11px] text-estimated italic" data-testid="undated-usage">
          {undated.recordCount} usage record{undated.recordCount === 1 ? '' : 's'} have no timestamp
          and are not on the chart; they are included in the totals below.
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer text-[11px] text-dim">Chart data as a table</summary>
        <table className="mt-1 w-full border-collapse text-left text-xs" data-testid="chart-table">
          <thead className="text-[11px] text-dim">
            <tr className="border-b border-line">
              <th className="py-1 pr-2 font-medium">Day (UTC)</th>
              {TOKEN_CATEGORIES.map((c) => (
                <th key={c.key} className="py-1 pr-2 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className="border-b border-line/60">
                <td className="py-1 pr-2 font-mono">{r.day}</td>
                {TOKEN_CATEGORIES.map((c) => (
                  <td key={c.key} className="py-1 pr-2 text-right font-mono">
                    <TokenCount value={r[c.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function groupLink(groupBy: UsageParams['groupBy'], key: string, label: string) {
  if (groupBy === 'session' && key !== 'unknown') return <a href={href.session(key)}>{label}</a>;
  if (groupBy === 'project' && key !== 'unassigned') return <a href={href.project(key)}>{label}</a>;
  return <span className={key === 'unknown' || key === 'unassigned' ? 'italic' : ''}>{label}</span>;
}

function GroupTable({ params }: { params: UsageParams }) {
  const query = useApiQuery(
    paths.usageSummary(toUsageQuery(params, params.groupBy)),
    schemas.usageSummary,
  );
  return (
    <Panel title={`Usage by ${GROUP_LABEL[params.groupBy]}`}>
      <QueryView query={query} loading="Loading usage…">
        {(s) => (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] text-dim" data-testid="direct-note">
              Groups and totals sum DIRECT usage of sessions, so a subagent&apos;s usage is counted
              once, under its own session, and never again under its parent. Aggregate (with
              subagents) is shown only on the session page.
            </p>
            <UsageTotals
              usage={s.totals}
              title="Totals (sum of direct usage)"
              testId="usage-totals"
            />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="text-[11px] text-dim">
                  <tr className="border-b border-line">
                    <th className="py-1 pr-2 font-medium">{GROUP_LABEL[params.groupBy]}</th>
                    {TOKEN_CATEGORIES.map((c) => (
                      <th key={c.key} className="py-1 pr-2 text-right font-medium">
                        direct {c.short}
                      </th>
                    ))}
                    <th className="py-1 text-right font-medium">records</th>
                  </tr>
                </thead>
                <tbody>
                  {s.groups.map((g) => (
                    <tr key={g.key} className="border-b border-line/60" data-group={g.key}>
                      <td className="py-1 pr-2">{groupLink(params.groupBy, g.key, g.label)}</td>
                      {TOKEN_CATEGORIES.map((c) => (
                        <td key={c.key} className="py-1 pr-2 text-right font-mono">
                          <TokenCount
                            value={g.usage.tokens[c.key]}
                            unavailableRecords={g.usage.recordsWithUnavailable[c.key]}
                            recordCount={g.usage.recordCount}
                            compact
                          />
                        </td>
                      ))}
                      <td className="py-1 text-right font-mono">{g.usage.recordCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.groups.length === 0 ? (
                <p className="py-2 text-dim italic">No usage records in this range.</p>
              ) : null}
            </div>
          </div>
        )}
      </QueryView>
    </Panel>
  );
}

/** `#/usage`: daily token charts (Recharts) plus a group table; both sum DIRECT usage. */
export function UsageAnalytics({ search }: { search: URLSearchParams }) {
  const params = readUsageParams(search);
  const key = JSON.stringify(params);
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Usage">
        <span className="text-[11px] text-dim">
          Token counts are observed from provider usage records. Cost is not shown here: only
          provider-reported snapshot cost exists, and it is an estimate (see a session&apos;s page).
        </span>
      </PageHeader>
      <Controls params={params} />
      <Charts key={`c|${key}`} params={params} />
      <GroupTable key={`t|${key}`} params={params} />
    </div>
  );
}
