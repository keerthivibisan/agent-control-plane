import type { TokenCounts } from '@acp/core';
import type { UsageSnapshotDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { EstimatedCost } from '../../components/EstimatedCost';
import { RelativeTime } from '../../components/RelativeTime';
import { TokenValue } from '../../components/TokenValue';
import { GLOSSARY, SESSION_DETAIL_COPY, TOKEN_TYPES } from '../../lib/copy';
import { TOKEN_TYPE_COLOR } from '../../lib/tokens';

const COPY = SESSION_DETAIL_COPY.cost;

type ModelRow = { model: string; tokens: TokenCounts };

const COLUMNS: readonly Column<ModelRow>[] = [
  {
    key: 'model',
    label: COPY.model,
    cell: (r) => <span className="font-mono text-caption break-all">{r.model}</span>,
  },
  ...TOKEN_TYPES.map((t): Column<ModelRow> => ({
    key: t.key,
    label: t.label,
    align: 'right',
    header: (
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`inline-block size-2 rounded-sm ${TOKEN_TYPE_COLOR[t.key].bg}`}
        />
        {t.label}
      </span>
    ),
    cell: (r) => <TokenValue value={r.tokens[t.key]} type={t.key} showUnit={false} />,
  })),
];

/**
 * "Estimated cost": Claude Code's latest running total for this session, as reported (never
 * calculated, never added to anything), with the tokens by model from the same report. No report
 * says so instead of showing $0.
 */
export function CostCard({ snapshot }: { snapshot: UsageSnapshotDto | null }) {
  const title = GLOSSARY.estimatedCost.term;
  if (snapshot === null) {
    return (
      <Card title={title} tip={GLOSSARY.estimatedCost.tip}>
        <EmptyState compact title={COPY.none.title} text={COPY.none.text} testId="no-snapshot" />
      </Card>
    );
  }
  const rows = Object.entries(snapshot.byModel)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, tokens]) => ({ model, tokens }));
  return (
    <Card title={title} testId="snapshot" padded={false}>
      <div className="px-5 pb-4">
        <div className="text-stat font-semibold tracking-tight">
          <EstimatedCost cost={snapshot.reportedCostUsd} showLabel={false} />
        </div>
        <p className="mt-1 text-dim">
          {snapshot.occurredAt ? (
            <>
              {COPY.reported} <RelativeTime iso={snapshot.occurredAt} /> ·{' '}
            </>
          ) : null}
          {COPY.scope[snapshot.scope]}
        </p>
        <p className="mt-1 text-caption text-dim">{COPY.runningTotal}</p>
      </div>
      <div className="border-t border-line">
        <h3 className="px-5 pt-3 pb-1 text-caption font-medium text-dim">{COPY.byModel}</h3>
        {rows.length === 0 ? (
          <p className="px-5 pb-4 text-dim">{COPY.noModels}</p>
        ) : (
          <DataTable
            label={COPY.byModel}
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.model}
            rowAttributes={(r) => ({ 'data-model': r.model })}
          />
        )}
      </div>
    </Card>
  );
}
