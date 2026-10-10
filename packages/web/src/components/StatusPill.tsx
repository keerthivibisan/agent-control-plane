import type { SessionStatus } from '@acp/core';
import type { SessionStatusDto } from '@acp/core/api';
import { formatTime } from '../lib/format';

/*
 * Superseded by ./StatusBadge and STATUS_COPY in ../lib/copy (DESIGN.md status words). Kept until
 * phase 2 moves the remaining screens over.
 */

/**
 * Display labels. There is no "completed": observation mode only knows a session ended when the
 * provider said so, and silence is "stale", not done (docs/domain-model.md, Session status).
 */
export const STATUS_LABELS: Record<SessionStatus, string> = {
  active: 'active',
  idle: 'idle',
  stale: 'stale (no recent activity)',
  ended: 'ended',
  unknown: 'unknown',
};

const STYLES: Record<SessionStatus, string> = {
  active: 'border-emerald-600/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  idle: 'border-sky-600/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  stale: 'border-amber-600/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  ended: 'border-line bg-sunken text-dim',
  unknown: 'border-dashed border-line text-dim',
};

export function statusLabel(s: SessionStatus): string {
  return STATUS_LABELS[s];
}

function basisTitle(status: SessionStatusDto): string {
  const b = status.basis;
  const parts = [`Derived status, evaluated ${formatTime(b.evaluatedAt)}`];
  parts.push(b.lastEventAt ? `last event ${formatTime(b.lastEventAt)}` : 'no events observed');
  if (b.endedAt) parts.push(`provider reported end ${formatTime(b.endedAt)}`);
  return parts.join('; ');
}

export function StatusPill({ status }: { status: SessionStatusDto | SessionStatus }) {
  const value = typeof status === 'string' ? status : status.value;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 text-[11px] leading-4 whitespace-nowrap ${STYLES[value]}`}
      title={typeof status === 'string' ? undefined : basisTitle(status)}
      data-status={value}
    >
      {STATUS_LABELS[value]}
    </span>
  );
}
