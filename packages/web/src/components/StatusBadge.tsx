import type { SessionStatus } from '@acp/core';
import type { SessionStatusDto } from '@acp/core/api';
import { STATUS_COPY } from '../lib/copy';
import { formatExactTime } from '../lib/format';
import { InfoTip } from './InfoTip';

/** Dot styles: color plus shape (filled / hollow / dashed), so color is never the only signal. */
const DOT: Record<SessionStatus, string> = {
  active: 'bg-status-active ring-3 ring-status-active/20',
  idle: 'bg-status-idle',
  stale: 'border-2 border-status-stale bg-transparent',
  ended: 'bg-status-ended',
  unknown: 'border-2 border-dashed border-status-unknown bg-transparent',
};

/** The status tip, plus the evidence it was derived from when the full DTO is available. */
export function statusTip(status: SessionStatusDto | SessionStatus): string {
  if (typeof status === 'string') return STATUS_COPY[status].tip;
  const { tip } = STATUS_COPY[status.value];
  const b = status.basis;
  const last = b.lastEventAt
    ? ` Last activity: ${formatExactTime(b.lastEventAt)}.`
    : ' No activity seen yet.';
  const ended = b.endedAt ? ` Ended: ${formatExactTime(b.endedAt)}.` : '';
  return `${tip}${last}${ended}`;
}

/**
 * A session's status as a dot + word (+ ⓘ tip). Replaces StatusPill. There is no "completed":
 * the five statuses and their words come from STATUS_COPY.
 */
export function StatusBadge({
  status,
  withTip = true,
}: {
  status: SessionStatusDto | SessionStatus;
  /** False in dense lists where the tip would repeat on every row. */
  withTip?: boolean;
}) {
  const value = typeof status === 'string' ? status : status.value;
  const { word } = STATUS_COPY[value];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" data-status={value}>
      <span
        aria-hidden="true"
        className={`inline-block size-2 shrink-0 rounded-full ${DOT[value]}`}
      />
      <span>{word}</span>
      {withTip ? <InfoTip tip={statusTip(status)} label={`status ${word}`} /> : null}
    </span>
  );
}
