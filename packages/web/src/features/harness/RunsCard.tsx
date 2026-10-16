import type { CheckRunDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { HarnessIcon } from '../../components/icons';
import { Pill, type PillTone } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import type { ApiError } from '../../lib/api';
import { CHECK_STATUS_COPY, HARNESS_PAGE_COPY } from '../../lib/copy';
import { formatDuration, formatRelative } from '../../lib/format';
import type { QueryState } from '../../lib/query-store';
import { StatusWord } from '../control/bits';
import { RequiredPill } from './ChecksCard';
import { groupMainRuns, runErrorText, summarize, type MainRun, type RunSummary } from './logic';
import type { MainCheckAttempt } from './main-check-runs';

const C = HARNESS_PAGE_COPY.runs;

function summaryTone(s: RunSummary): PillTone {
  if (s.requiredFailed.length > 0) return 'danger';
  return s.passed < s.total ? 'warning' : 'success';
}

/** One check's result: status, required or optional, duration, and its output tail behind Details. */
function CheckResult({ run }: { run: CheckRunDto }) {
  return (
    <li className="flex flex-col gap-2 py-3" data-check={run.checkId} data-status={run.status}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{run.name}</span>
        <RequiredPill required={run.required} />
        <StatusWord status={CHECK_STATUS_COPY[run.status]} value={run.status} />
        <span className="ml-auto text-caption text-dim tabular-nums">
          {C.duration(formatDuration(run.durationMs))} · {C.exitCode(run.exitCode)}
        </span>
      </div>
      {/* A failed check's output is what the owner came for: open it. */}
      <Details summary={C.output} defaultOpen={run.status !== 'passed' && run.status !== 'skipped'}>
        {run.outputTail.length > 0 ? (
          <pre className="max-h-72 overflow-auto rounded-control bg-sunken p-3 font-mono text-caption whitespace-pre-wrap">
            {run.outputTail}
          </pre>
        ) : (
          <p className="text-dim">{C.noOutput}</p>
        )}
      </Details>
    </li>
  );
}

/**
 * What the card lists: a run started from this page that is still going or was refused (only this
 * app session knows those), and the runs the server stored, grouped from its history.
 */
type Entry =
  | { kind: 'running'; id: string; startedAt: string }
  | { kind: 'error'; id: string; startedAt: string; error: ApiError }
  | { kind: 'results'; id: string; startedAt: string; results: CheckRunDto[] };

function entries(attempts: readonly MainCheckAttempt[], stored: readonly MainRun[]): Entry[] {
  const runs: Entry[] = stored.map((r) => ({ kind: 'results', ...r }));
  const newest = attempts[0];
  if (newest === undefined) return runs;
  if (newest.state === 'running') {
    return [{ kind: 'running', id: newest.id, startedAt: newest.startedAt }, ...runs];
  }
  if (newest.error !== null) {
    return [
      { kind: 'error', id: newest.id, startedAt: newest.startedAt, error: newest.error },
      ...runs,
    ];
  }
  // Just finished: shown from its own answer until the history is read again.
  const results = newest.results ?? [];
  const known = new Set(stored.flatMap((r) => r.results.map((c) => c.id)));
  if (results.length === 0 || results.some((c) => !known.has(c.id))) {
    return [{ kind: 'results', id: newest.id, startedAt: newest.startedAt, results }, ...runs];
  }
  return runs;
}

function EntryBody({ entry }: { entry: Entry }) {
  if (entry.kind === 'running') {
    return (
      <p role="status" className="flex items-center gap-2 text-dim">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 animate-pulse rounded-full bg-status-active ring-3 ring-status-active/20"
        />
        <span>
          <span className="font-medium text-ink">{C.running}</span> {C.runningText}
        </span>
      </p>
    );
  }
  if (entry.kind === 'error') {
    return (
      <div className="flex flex-col gap-1.5">
        <p
          role="alert"
          data-code={entry.error.code ?? undefined}
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
        >
          {runErrorText(entry.error)}
        </p>
        <Details>
          <ErrorNotice error={entry.error} />
        </Details>
      </div>
    );
  }
  if (entry.results.length === 0) {
    return <EmptyState compact title={C.noResults} text={C.noResultsText} />;
  }
  return (
    <ul aria-label={C.resultsLabel} className="flex flex-col divide-y divide-line">
      {entry.results.map((r) => (
        <CheckResult key={r.id} run={r} />
      ))}
    </ul>
  );
}

function SummaryPill({ entry }: { entry: Entry }) {
  if (entry.kind !== 'results' || entry.results.length === 0) return null;
  const s = summarize(entry.results);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Pill tone={summaryTone(s)} testId="run-summary">
        {C.summary(s.passed, s.total)}
      </Pill>
      {s.requiredFailed.length > 0 ? (
        <span className="text-caption text-danger">
          {C.requiredFailed(s.requiredFailed.length)}
        </span>
      ) : null}
    </span>
  );
}

function earlierSummary(e: Entry, now: Date): string {
  const when = formatRelative(e.startedAt, now);
  if (e.kind === 'running') return `${when} · ${C.running}`;
  if (e.kind === 'error') return `${when} · ${C.failed}`;
  if (e.results.length === 0) return `${when} · ${C.noResults}`;
  const s = summarize(e.results);
  return `${when} · ${C.summary(s.passed, s.total)}`;
}

const entryState = (e: Entry) =>
  e.kind === 'running' ? 'running' : e.kind === 'error' ? 'failed' : 'finished';

/**
 * Runs on the main branch, newest first (`GET /projects/:id/harness/checks`, grouped into runs):
 * the latest in full, the earlier ones collapsed. A run started here shows while it is going.
 */
export function RunsCard({
  attempts,
  history,
  runnable,
  now = () => new Date(),
  className = '',
}: {
  attempts: readonly MainCheckAttempt[];
  history: QueryState<CheckRunDto[]>;
  runnable: boolean;
  now?: () => Date;
  className?: string;
}) {
  const list = entries(attempts, groupMainRuns(history.data ?? []));
  const [latest, ...earlier] = list;
  const loading = history.data === undefined && history.error === null;
  return (
    <Card
      title={C.title}
      tip={C.tip}
      description={C.description}
      className={className}
      testId="harness-runs"
    >
      {latest === undefined ? (
        loading ? (
          <p className="text-dim">{C.loading}</p>
        ) : (
          <EmptyState
            compact
            icon={<HarnessIcon size={18} />}
            title={C.empty}
            text={runnable ? C.emptyText : C.unavailable}
          />
        )
      ) : (
        <div className="flex flex-col gap-8">
          <section aria-label={C.latest} data-testid="latest-run" data-state={entryState(latest)}>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="font-semibold">{C.latest}</h3>
              <span className="text-caption text-dim">
                {C.started} <RelativeTime iso={latest.startedAt} now={now} />
              </span>
              <span className="ml-auto">
                <SummaryPill entry={latest} />
              </span>
            </div>
            <EntryBody entry={latest} />
          </section>
          {earlier.length > 0 ? (
            <section aria-label={C.earlier} className="flex flex-col gap-2">
              <h3 className="font-semibold">{C.earlier}</h3>
              <ul className="flex flex-col gap-2">
                {earlier.map((e) => (
                  <li key={e.id} data-state={entryState(e)}>
                    <Details summary={earlierSummary(e, now())}>
                      <EntryBody entry={e} />
                    </Details>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
      {history.error !== null ? (
        <div className="mt-4">
          <ErrorNotice error={history.error} />
        </div>
      ) : null}
    </Card>
  );
}
