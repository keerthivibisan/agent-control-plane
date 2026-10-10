import type { AdapterDiagnosticsDto, DiagnosticsDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { Panel } from '../../components/Panel';
import { QueryView } from '../../components/QueryView';
import { Time } from '../../components/Time';
import { paths, schemas } from '../../lib/api';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';

function Counter({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] text-dim" title={title}>
        {label}
      </dt>
      <dd className="font-mono">{children}</dd>
    </div>
  );
}

function IngestionCounters({ ingestion }: { ingestion: DiagnosticsDto['ingestion'] }) {
  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4"
      data-testid="ingestion-counters"
    >
      <Counter label="Polls (since start)">{formatCount(ingestion.scheduler.polls)}</Counter>
      <Counter label="Poll errors" title="Adapter polls that failed; other adapters still ran">
        {formatCount(ingestion.scheduler.pollErrors)}
      </Counter>
      <Counter label="Last poll">
        <Time iso={ingestion.scheduler.lastPollAt} fallback="not yet" />
      </Counter>
      <Counter
        label="Failed batches / invalid events"
        title="Batches rolled back (their checkpoint did not move) / events that failed validation and were not stored"
      >
        {formatCount(ingestion.pipeline.batchesFailed)} /{' '}
        {formatCount(ingestion.pipeline.eventsInvalid)}
      </Counter>
    </dl>
  );
}

function AdapterSection({ adapter }: { adapter: AdapterDiagnosticsDto }) {
  return (
    <div data-testid={`adapter-diagnostics-${adapter.provider}`} className="flex flex-col gap-1">
      <div className="text-[11px] font-semibold text-dim">
        {adapter.provider}: {formatCount(adapter.parseErrors)} line
        {adapter.parseErrors === 1 ? '' : 's'} skipped as unparseable (since start)
      </div>
      {adapter.fileIssues.length > 0 ? (
        <div>
          <div className="text-[11px] text-dim">Files not read (latest scan)</div>
          <ul className="font-mono text-[11px]" data-testid="file-issues">
            {adapter.fileIssues.map((f) => (
              <li key={`${f.path}\u0000${f.reason}`}>
                {f.path}: {f.reason}
                {f.detail === null ? '' : ` (${f.detail})`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {adapter.ignoredRecords.length > 0 ? (
        <div>
          <div
            className="text-[11px] text-dim"
            title="Record types the adapter knows and skips on purpose because they carry nothing the control plane uses. Not stored as events."
          >
            Known record types, skipped (counted, not stored)
          </div>
          <ul className="font-mono text-[11px]" data-testid="ignored-records">
            {adapter.ignoredRecords.map((r) => (
              <li key={r.recordType}>
                {r.recordType}: {formatCount(r.count)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ingestion health: per-source parse errors, unrecognized record types, conflict counters, what
 * each adapter skipped (ADR-0011) and the server's own poll and pipeline counters.
 */
export function DiagnosticsPanel() {
  const diagnostics = useApiQuery(paths.diagnostics(), schemas.diagnostics);
  return (
    <Panel title="Ingestion diagnostics">
      <QueryView query={diagnostics}>
        {(d) => {
          const parseErrors = d.sources.reduce((n, s) => n + s.parseErrors, 0);
          const withErrors = d.sources.filter((s) => s.parseErrors > 0);
          return (
            <div className="flex flex-col gap-2 text-xs">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
                <Counter label="Sources tracked">{formatCount(d.sources.length)}</Counter>
                <Counter label="Parse errors">{formatCount(parseErrors)}</Counter>
                <Counter
                  label="Edge conflicts"
                  title="Two sources claimed different parents for one child; the edge was not changed"
                >
                  {formatCount(d.edgeConflictCount)}
                </Counter>
                <Counter
                  label="Usage conflicts"
                  title="Observations of one message disagreed on a non-output category"
                >
                  {formatCount(d.usageConflictCount)}
                </Counter>
              </dl>
              <IngestionCounters ingestion={d.ingestion} />
              {withErrors.length > 0 ? (
                <ul className="font-mono text-[11px]">
                  {withErrors.slice(0, 10).map((s) => (
                    <li key={s.sourcePath}>
                      {s.sourcePath}: {formatCount(s.parseErrors)} parse error
                      {s.parseErrors === 1 ? '' : 's'} (updated <Time iso={s.updatedAt} />)
                    </li>
                  ))}
                </ul>
              ) : null}
              {d.unrecognized.length > 0 ? (
                <div>
                  <div className="text-[11px] text-dim">
                    Unrecognized records (unknown type; kept, not interpreted)
                  </div>
                  <ul className="font-mono text-[11px]" data-testid="unrecognized-records">
                    {d.unrecognized.map((u, i) => (
                      <li key={i}>
                        {u.recordType ?? '(no type)'} @ {u.providerVersion ?? 'unknown version'}:{' '}
                        {formatCount(u.count)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {d.adapters.map((a) => (
                <AdapterSection key={a.provider} adapter={a} />
              ))}
            </div>
          );
        }}
      </QueryView>
    </Panel>
  );
}
