import type { OverviewDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { Details } from '../../components/Details';
import { EmptyState } from '../../components/EmptyState';
import { EstimatedCost } from '../../components/EstimatedCost';
import { RelativeTime } from '../../components/RelativeTime';
import { EMPTY, GLOSSARY, NOT_REPORTED, OVERVIEW_COPY, TECH_LABELS } from '../../lib/copy';
import { href } from '../../lib/router';
import { sessionNameFromTitle } from '../../lib/session-name';

type Snapshot = OverviewDto['latestSnapshots'][number];

const RAW_COLUMNS: readonly Column<Snapshot>[] = [
  {
    key: 'id',
    label: TECH_LABELS.sessionId,
    cell: (s) => <code className="font-mono text-caption break-all">{s.sessionId}</code>,
  },
  { key: 'scope', label: TECH_LABELS.scope, cell: (s) => <code>{s.scope}</code> },
  {
    key: 'at',
    label: TECH_LABELS.reportedAt,
    cell: (s) => <span className="font-mono text-caption">{s.occurredAt ?? NOT_REPORTED}</span>,
  },
  {
    key: 'provenance',
    label: TECH_LABELS.provenance,
    cell: (s) => <code>{s.reportedCostUsd.provenance}</code>,
  },
];

/**
 * Each recent session's latest cost as Claude Code reported it, one row per session. There is
 * deliberately no total: the reports are estimates of unverified scope and are never summed
 * (docs/usage-accounting.md §9). Scope and provenance stay available under Technical details.
 */
export function CostBySession({ snapshots }: { snapshots: OverviewDto['latestSnapshots'] }) {
  return (
    <Card
      title={OVERVIEW_COPY.costs.title}
      tip={GLOSSARY.estimatedCost.tip}
      description={OVERVIEW_COPY.costs.description}
    >
      {snapshots.length === 0 ? (
        <EmptyState
          compact
          testId="latest-snapshots-empty"
          title={EMPTY.costs.title}
          text={EMPTY.costs.text}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ul
            data-testid="latest-snapshots"
            aria-label={OVERVIEW_COPY.costs.title}
            className="-my-3"
          >
            {snapshots.map((s) => (
              <li
                key={s.sessionId}
                data-session={s.sessionId}
                className="flex items-center gap-4 border-b border-line py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={href.session(s.sessionId)}
                    className="block truncate font-medium text-ink no-underline hover:text-accent hover:underline"
                  >
                    {sessionNameFromTitle(s.sessionId, s.title)}
                  </a>
                  <div className="text-caption text-dim">
                    {OVERVIEW_COPY.costs.asOf} <RelativeTime iso={s.occurredAt} />
                  </div>
                </div>
                <EstimatedCost cost={s.reportedCostUsd} showLabel={false} />
              </li>
            ))}
          </ul>
          <Details>
            <DataTable
              label={TECH_LABELS.costReports}
              columns={RAW_COLUMNS}
              rows={snapshots}
              rowKey={(s) => s.sessionId}
            />
          </Details>
        </div>
      )}
    </Card>
  );
}
