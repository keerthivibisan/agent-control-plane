import type { CapabilitiesDto, DiagnosticsDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { CheckIcon } from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';
import { RelativeTime } from '../../components/RelativeTime';
import { fileIssueText, HEALTH_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import type { HealthSummary } from './health-summary';

const H = HEALTH_COPY;

/** Not in the shared icon set: a triangle with "!" for things that need a look. */
function AlertIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17h.01" />
    </svg>
  );
}

/** A calm "nothing to report" line inside a card. */
function AllClear({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-dim">
      <CheckIcon size={16} className="shrink-0 text-success" />
      {children}
    </p>
  );
}

/** The verdict first: all good, or which things need a look. */
export function HealthVerdict({ summary }: { summary: HealthSummary }) {
  const attention = summary.state === 'attention';
  const title =
    summary.state === 'attention'
      ? H.attention(summary.problems.length)
      : summary.state === 'first-read'
        ? H.firstRead
        : H.allGood(summary.filesRead);
  const text =
    summary.state === 'attention'
      ? H.attentionText
      : summary.state === 'first-read'
        ? H.firstReadText
        : H.allGoodText;
  return (
    <section
      aria-label={H.summaryLabel}
      data-testid="health-summary"
      data-state={summary.state}
      className={`flex gap-4 rounded-card border px-5 py-4 shadow-card ${
        attention ? 'border-warning/40 bg-warning-soft' : 'border-line bg-panel'
      }`}
    >
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
          attention ? 'bg-warning/15 text-warning' : 'bg-success/10 text-success'
        }`}
      >
        {attention ? <AlertIcon size={20} /> : <CheckIcon size={20} />}
      </span>
      <div className="min-w-0">
        <p className="text-title font-semibold">{title}</p>
        <p className="text-dim">{text}</p>
        {attention ? (
          <ul className="mt-2 flex list-disc flex-col gap-0.5 pl-5" data-testid="health-problems">
            {summary.problems.map((p) => (
              <li key={p.key} data-problem={p.key}>
                {p.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export function FileProblemsCard({ adapters }: { adapters: DiagnosticsDto['adapters'] }) {
  const issues = adapters.flatMap((a) => a.fileIssues);
  return (
    <Card title={H.files.title} description={H.files.description} testId="health-files">
      {issues.length === 0 ? (
        <AllClear>{H.files.none}</AllClear>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="file-issues">
          {issues.map((f) => (
            <li key={`${f.path}\u0000${f.reason}`} data-reason={f.reason}>
              <div>{fileIssueText(f.reason)}</div>
              <div className="font-mono text-caption break-all text-dim">{f.path}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CountList({
  rows,
  testId,
}: {
  rows: readonly { key: string; name: ReactNode; count: number }[];
  testId: string;
}) {
  return (
    <ul className="flex flex-col" data-testid={testId}>
      {rows.map((r) => (
        <li
          key={r.key}
          className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0"
        >
          <span className="min-w-0 break-words">{r.name}</span>
          <span className="shrink-0 text-dim tabular-nums">{H.skipped.count(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

export function SkippedCard({ adapters }: { adapters: DiagnosticsDto['adapters'] }) {
  const rows = adapters.flatMap((a) =>
    a.ignoredRecords.map((r) => ({
      key: `${a.provider}:${r.recordType}`,
      name: <code className="font-mono text-caption">{r.recordType}</code>,
      count: r.count,
    })),
  );
  return (
    <Card
      title={H.skipped.title}
      tip={H.skipped.tip}
      description={H.skipped.description}
      testId="health-skipped"
    >
      {rows.length === 0 ? (
        <AllClear>{H.skipped.none}</AllClear>
      ) : (
        <CountList rows={rows} testId="ignored-records" />
      )}
    </Card>
  );
}

export function UnknownCard({ unrecognized }: { unrecognized: DiagnosticsDto['unrecognized'] }) {
  const rows = unrecognized.map((u, i) => ({
    key: String(i),
    name: (
      <span>
        {u.recordType === null ? (
          H.unknown.noType
        ) : (
          <code className="font-mono text-caption">{u.recordType}</code>
        )}{' '}
        <span className="text-caption text-dim">({H.unknown.version(u.providerVersion)})</span>
      </span>
    ),
    count: u.count,
  }));
  return (
    <Card
      title={H.unknown.title}
      tip={H.unknown.tip}
      description={H.unknown.description}
      testId="health-unknown"
    >
      {rows.length === 0 ? (
        <AllClear>{H.unknown.none}</AllClear>
      ) : (
        <CountList rows={rows} testId="unrecognized-records" />
      )}
    </Card>
  );
}

export function ParseErrorsCard({ d }: { d: DiagnosticsDto }) {
  const files = d.sources.filter((s) => s.parseErrors > 0);
  const adapters = d.adapters.filter((a) => a.parseErrors > 0);
  const none = files.length === 0 && adapters.length === 0;
  return (
    <Card title={H.parse.title} description={H.parse.description} testId="health-parse">
      {none ? (
        <AllClear>{H.parse.none}</AllClear>
      ) : (
        <div className="flex flex-col gap-3">
          {adapters.map((a) => (
            <p key={a.provider} data-testid={`adapter-parse-${a.provider}`}>
              {H.parse.bySource(H.capabilities.providerName(a.provider), a.parseErrors)}
            </p>
          ))}
          {files.length > 0 ? (
            <ul className="flex flex-col gap-2" data-testid="parse-error-files">
              {files.slice(0, 10).map((s) => (
                <li key={s.sourcePath}>
                  <div>{H.problems.parseErrors(s.parseErrors)}</div>
                  <div className="text-caption text-dim">
                    <span className="font-mono break-all">{s.sourcePath}</span> ·{' '}
                    {H.parse.fileChanged} <RelativeTime iso={s.updatedAt} />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function Counter({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-dim">
        <span>{label}</span>
        {tip ? <InfoTip tip={tip} label={label} /> : null}
      </dt>
      <dd className="mt-0.5 text-title font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

export function ReadingCard({ d }: { d: DiagnosticsDto }) {
  const R = H.reading;
  const { scheduler, pipeline } = d.ingestion;
  return (
    <Card title={R.title} description={R.description} testId="health-reading">
      <dl
        className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4"
        data-testid="ingestion-counters"
      >
        <Counter label={R.lastPoll}>
          <RelativeTime iso={scheduler.lastPollAt} fallback={R.notYet} />
        </Counter>
        <Counter label={R.polls}>{formatCount(scheduler.polls)}</Counter>
        <Counter label={R.pollErrors}>{formatCount(scheduler.pollErrors)}</Counter>
        <Counter label={R.filesTracked}>{formatCount(d.sources.length)}</Counter>
        <Counter label={R.failedBatches} tip={R.failedBatchesTip}>
          {formatCount(pipeline.batchesFailed)}
        </Counter>
        <Counter label={R.invalidEvents}>{formatCount(pipeline.eventsInvalid)}</Counter>
        <Counter label={R.edgeConflicts} tip={R.edgeConflictsTip}>
          {formatCount(d.edgeConflictCount)}
        </Counter>
        <Counter label={R.usageConflicts} tip={R.usageConflictsTip}>
          {formatCount(d.usageConflictCount)}
        </Counter>
      </dl>
    </Card>
  );
}

const OBSERVATIONS = Object.keys(
  H.capabilities.observation,
) as (keyof typeof H.capabilities.observation)[];

export function CapabilitiesCard({ caps }: { caps: CapabilitiesDto }) {
  const C = H.capabilities;
  return (
    <Card title={C.title} description={C.description} testId="health-capabilities">
      <div className="flex flex-col gap-6">
        {caps.providers.map((p) => (
          <div key={p.provider} data-provider={p.provider} className="flex flex-col gap-4">
            <h3 className="font-semibold">{C.providerName(p.provider)}</h3>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2">
              {OBSERVATIONS.map((k) => (
                <li key={k} className="flex items-center gap-2" data-observation={k}>
                  {p.observation[k] ? (
                    <CheckIcon size={16} className="shrink-0 text-success" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="inline-block w-4 shrink-0 text-center text-dim"
                    >
                      –
                    </span>
                  )}
                  <span>{C.observation[k]}</span>
                  <span className="sr-only">: {p.observation[k] ? C.yes : C.no}</span>
                </li>
              ))}
              <li className="flex items-center gap-2">
                {caps.hooks.receivedAny ? (
                  <CheckIcon size={16} className="shrink-0 text-success" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="inline-block w-4 shrink-0 text-center text-dim"
                  >
                    –
                  </span>
                )}
                <span>
                  {C.hooksReceived}: {caps.hooks.receivedAny ? C.yes : C.no}
                </span>
              </li>
            </ul>
            <p className="text-dim">
              {C.versions}:{' '}
              {p.providerVersionsSeen.length > 0 ? (
                <span className="text-ink">{p.providerVersionsSeen.join(', ')}</span>
              ) : (
                C.noVersions
              )}
            </p>
            {p.limitations.length > 0 ? (
              <Details summary={C.limitationsCount(p.limitations.length)}>
                <ul
                  className="flex list-disc flex-col gap-1.5 pl-5 text-dim"
                  data-testid="limitations"
                >
                  {p.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </Details>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
