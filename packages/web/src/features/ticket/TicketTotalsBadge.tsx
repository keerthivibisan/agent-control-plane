import type { TicketDto, TicketTotalsDto } from '@acp/core/api';
import { useEffect, useState, type ReactNode } from 'react';
import { TokensIcon, type IconProps } from '../../components/icons';
import { Popover } from '../../components/Popover';
import { ticketTotalsPaths, ticketTotalsSchemas } from '../../lib/api';
import { NOT_REPORTED, TICKET_TOTALS_COPY } from '../../lib/copy';
import { formatCount, formatExactTime } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { tokensHref } from '../tokens/tokens-params';
import {
  badgeLabel,
  badgeTime,
  badgeTimeText,
  badgeTokensText,
  formatSpan,
  isPartial,
  type BadgeTime,
} from './ticket-totals';

const T = TICKET_TOTALS_COPY;
/** How often an open ticket's time moves on screen. */
const TICK_MS = 30_000;
const systemNow = () => new Date();

function ClockIcon({ size = 16, ...rest }: IconProps) {
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
      {...rest}
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** Re-renders every 30 seconds while `on`, so an open ticket's time keeps moving. */
function useTick(on: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [on]);
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <>
      <dt className="text-dim">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums" data-testid={testId}>
        {children}
      </dd>
    </>
  );
}

function Count({ value, partial }: { value: number | null; partial: boolean }) {
  if (value === null) return <span className="text-unavailable">{NOT_REPORTED}</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {formatCount(value)}
      {partial ? (
        <span className="text-caption text-warning" title={T.partialTip}>
          {T.partial}
        </span>
      ) : null}
    </span>
  );
}

function Details({
  totals,
  time,
  projectId,
}: {
  totals: TicketTotalsDto;
  time: BadgeTime;
  projectId: string;
}) {
  const u = totals.usage.recordsWithUnavailable;
  const tokens = totals.usage.tokens;
  return (
    <div className="flex flex-col gap-3 text-caption">
      <p className="font-semibold text-ink">{T.title}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <Row label={T.started} testId="totals-started">
          {totals.startedAt === null ? NOT_REPORTED : formatExactTime(totals.startedAt)}
        </Row>
        <Row label={T.finished} testId="totals-finished">
          {totals.finishedAt === null ? T.notFinished : formatExactTime(totals.finishedAt)}
        </Row>
        <Row label={time.kind === 'took' ? T.elapsed : T.elapsedSoFar} testId="totals-elapsed">
          {formatSpan(time.ms)}
        </Row>
      </dl>
      {totals.runs.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink">{T.runs}</p>
          <ol
            className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1"
            data-testid="totals-runs"
          >
            {totals.runs.map((r, i) => (
              <li key={r.runId} className="contents">
                <span className="text-dim">{T.run(i + 1)}</span>
                <span className="text-right tabular-nums">
                  {r.durationMs === null ? T.live : formatSpan(r.durationMs)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="font-medium text-ink">{T.tokenSplit}</p>
        <dl
          className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1"
          data-testid="totals-tokens"
        >
          <Row label={T.input}>
            <Count value={tokens.input} partial={u.input > 0} />
          </Row>
          <Row label={T.output}>
            <Count value={tokens.output} partial={u.output > 0} />
          </Row>
          <Row label={T.cacheWrite}>
            <Count value={tokens.cacheCreation} partial={u.cacheCreation > 0} />
          </Row>
          <Row label={T.cacheRead}>
            <Count value={tokens.cacheRead} partial={u.cacheRead > 0} />
          </Row>
          <Row label={T.total} testId="totals-total">
            <Count value={totals.headline.totalProcessed} partial={isPartial(totals)} />
          </Row>
        </dl>
      </div>
      <p className="text-dim">{T.note}</p>
      <a
        href={tokensHref(projectId, { preset: 'all', by: 'ticket' })}
        className="w-fit font-medium"
        data-testid="totals-open-tokens"
      >
        {T.openTokens}
      </a>
    </div>
  );
}

/**
 * The ticket badge (v0.3.0 T-A), at the right end of the header's state line: how long the
 * ticket took ("Took 1h 12m"; "Running 14m" while a run is live, moving every 30 seconds) and the
 * tokens its agents used, as the Tokens page counts them. A popover has the start, the finish,
 * each run's time, the token split ("partial" when some records didn't report a type) and a link
 * to the Tokens page. No cost. Hidden before the first run and when the server can't tell.
 * Refetched with the ticket's live updates (its path is under /api/tickets).
 */
export function TicketTotalsBadge({
  ticket,
  now = systemNow,
}: {
  ticket: Pick<TicketDto, 'id' | 'projectId'>;
  /** Injected clock (AGENTS.md §6), for tests. */
  now?: () => Date;
}) {
  const q = useApiQuery(ticketTotalsPaths.totals(ticket.id), ticketTotalsSchemas.totals);
  const totals = q.data;
  const ticking = totals !== undefined && totals.startedAt !== null && totals.finishedAt === null;
  useTick(ticking);
  if (totals === undefined) return null;
  const time = badgeTime(totals, now().getTime());
  if (time === null) return null;
  const tokens = badgeTokensText(totals);
  return (
    <span className="ml-auto inline-flex max-w-full" data-testid="ticket-totals">
      <Popover
        label={T.title}
        align="end"
        testId="ticket-totals-details"
        trigger={
          <button
            type="button"
            aria-label={badgeLabel(time, totals)}
            data-kind={time.kind}
            data-testid="ticket-totals-badge"
            className="inline-flex min-h-8 max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-full border border-line bg-subtle px-3 py-1 text-caption font-medium text-ink tabular-nums transition-colors hover:border-line-strong hover:bg-panel focus-visible:outline-offset-2"
          >
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {time.kind === 'running' ? (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full bg-status-active motion-safe:animate-pulse"
                />
              ) : (
                <ClockIcon size={14} className="shrink-0 text-dim" />
              )}
              <span data-testid="ticket-totals-time">{badgeTimeText(time)}</span>
            </span>
            <span aria-hidden="true" className="text-dim">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <TokensIcon size={14} className="shrink-0 text-dim" />
              {tokens === null ? (
                <span data-testid="ticket-totals-tokens" title={T.unavailable}>
                  {T.noTokens}
                  <span className="ml-1 font-normal text-dim">{T.unavailable.toLowerCase()}</span>
                </span>
              ) : (
                <span data-testid="ticket-totals-tokens">{tokens}</span>
              )}
            </span>
          </button>
        }
      >
        <Details totals={totals} time={time} projectId={ticket.projectId} />
      </Popover>
    </span>
  );
}
