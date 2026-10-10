import { Panel } from '../../components/Panel';
import { QueryView } from '../../components/QueryView';
import { Time } from '../../components/Time';
import { paths, schemas } from '../../lib/api';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';

/** Ingestion health: per-source parse errors, unrecognized record types, and conflict counters. */
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
                <div>
                  <dt className="text-[11px] text-dim">Sources tracked</dt>
                  <dd className="font-mono">{formatCount(d.sources.length)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-dim">Parse errors</dt>
                  <dd className="font-mono">{formatCount(parseErrors)}</dd>
                </div>
                <div>
                  <dt
                    className="text-[11px] text-dim"
                    title="Two sources claimed different parents for one child; the edge was not changed"
                  >
                    Edge conflicts
                  </dt>
                  <dd className="font-mono">{formatCount(d.edgeConflictCount)}</dd>
                </div>
                <div>
                  <dt
                    className="text-[11px] text-dim"
                    title="Observations of one message disagreed on a non-output category"
                  >
                    Usage conflicts
                  </dt>
                  <dd className="font-mono">{formatCount(d.usageConflictCount)}</dd>
                </div>
              </dl>
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
                    Unrecognized records (kept, not interpreted)
                  </div>
                  <ul className="font-mono text-[11px]">
                    {d.unrecognized.map((u, i) => (
                      <li key={i}>
                        {u.recordType ?? '(no type)'} @ {u.providerVersion ?? 'unknown version'}:{' '}
                        {formatCount(u.count)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        }}
      </QueryView>
    </Panel>
  );
}
