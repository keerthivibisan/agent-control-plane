import type { CheckRunDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { HarnessIcon } from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';
import { Pill, type PillTone } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { CHECK_STATUS_COPY, HARNESS_PAGE_COPY } from '../../lib/copy';
import { formatDuration, formatRelative } from '../../lib/format';
import { StatusWord } from '../control/bits';
import { RequiredPill } from './ChecksCard';
import { runErrorText, summarize, type RunSummary } from './logic';
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
      <Details summary={C.output}>
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

/** A finished, failed or running attempt's body. */
function AttemptBody({ attempt }: { attempt: MainCheckAttempt }) {
  if (attempt.state === 'running') {
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
  if (attempt.error !== null) {
    return (
      <div className="flex flex-col gap-1.5">
        <p
          role="alert"
          data-code={attempt.error.code ?? undefined}
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
        >
          {runErrorText(attempt.error)}
        </p>
        <Details>
          <ErrorNotice error={attempt.error} />
        </Details>
      </div>
    );
  }
  const results = attempt.results ?? [];
  if (results.length === 0) {
    return <EmptyState compact title={C.noResults} text={C.noResultsText} />;
  }
  return (
    <ul aria-label={C.resultsLabel} className="flex flex-col divide-y divide-line">
      {results.map((r) => (
        <CheckResult key={r.id} run={r} />
      ))}
    </ul>
  );
}

function SummaryPill({ attempt }: { attempt: MainCheckAttempt }) {
  if (attempt.state !== 'finished' || attempt.results === null || attempt.results.length === 0) {
    return null;
  }
  const s = summarize(attempt.results);
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

function earlierSummary(a: MainCheckAttempt, now: Date): string {
  const when = formatRelative(a.startedAt, now);
  if (a.error !== null) return `${when} · ${C.failed}`;
  const results = a.results ?? [];
  if (results.length === 0) return `${when} · ${C.noResults}`;
  const s = summarize(results);
  return `${when} · ${C.summary(s.passed, s.total)}`;
}

/**
 * "Run checks now" results on the main branch: the latest attempt in full, then the earlier ones
 * of this app session, collapsed. Older runs are stored by the server but no route lists them yet
 * (R-E blocked part), so the card says where its history starts.
 */
export function RunsCard({
  attempts,
  runnable,
  now = () => new Date(),
  className = '',
}: {
  attempts: readonly MainCheckAttempt[];
  runnable: boolean;
  now?: () => Date;
  className?: string;
}) {
  const [latest, ...earlier] = attempts;
  return (
    <Card
      title={C.title}
      tip={C.tip}
      description={
        <span className="inline-flex items-center gap-1">
          {C.description}
          <InfoTip tip={C.historyTip} label={C.earlier} />
        </span>
      }
      className={className}
      testId="harness-runs"
    >
      {latest === undefined ? (
        <EmptyState
          compact
          icon={<HarnessIcon size={18} />}
          title={C.empty}
          text={runnable ? C.emptyText : C.unavailable}
        />
      ) : (
        <div className="flex flex-col gap-8">
          <section aria-label={C.latest} data-testid="latest-run" data-state={latest.state}>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="font-semibold">{C.latest}</h3>
              <span className="text-caption text-dim">
                {C.started} <RelativeTime iso={latest.startedAt} now={now} />
              </span>
              <span className="ml-auto">
                <SummaryPill attempt={latest} />
              </span>
            </div>
            <AttemptBody attempt={latest} />
          </section>
          {earlier.length > 0 ? (
            <section aria-label={C.earlier} className="flex flex-col gap-2">
              <h3 className="font-semibold">{C.earlier}</h3>
              <ul className="flex flex-col gap-2">
                {earlier.map((a) => (
                  <li key={a.id} data-state={a.state}>
                    <Details summary={earlierSummary(a, now())}>
                      <AttemptBody attempt={a} />
                    </Details>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Card>
  );
}
