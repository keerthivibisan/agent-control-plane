import { timestampMs } from '../usage/ordering.js';
import type { SessionStatus } from './session.js';

/** Evidence the pipeline records for a session (docs/provider-adapters.md §7). */
export interface SessionStatusEvidence {
  /** Latest provider timestamp of any event in the session. */
  lastEventAt: string | null;
  /** Time of an observed end (e.g. a SessionEnd hook). Null when no end was observed. */
  endedAt: string | null;
}

export interface SessionStatusThresholds {
  /** Evidence at most this old means `active`. */
  activeWindowMs: number;
  /** Evidence older than this means `stale`; in between is `idle`. */
  staleAfterMs: number;
}

/** Defaults from docs/domain-model.md (`ACP_ACTIVE_WINDOW_MS` / `ACP_STALE_AFTER_MS`). */
export const DEFAULT_SESSION_STATUS_THRESHOLDS: Readonly<SessionStatusThresholds> = Object.freeze({
  activeWindowMs: 120_000,
  staleAfterMs: 1_800_000,
});

/**
 * Derives status from evidence at read time; it is never stored as a guess (docs/domain-model.md).
 *
 * - `ended` needs an observed end with no activity after it. A resume appends to the same
 *   transcript, so later activity makes the session live again.
 * - Without an observed end, an old session is `stale`, never "completed": observation mode cannot
 *   tell a finished session from an abandoned one.
 * - No usable timestamp at all gives `unknown`. Unparseable timestamps count as absent.
 * - Evidence dated after `now` (clock skew) counts as age 0, i.e. `active`.
 *
 * Throws `RangeError` for an invalid `now` or for negative, non-finite, or inverted thresholds.
 */
export function deriveSessionStatus(
  evidence: SessionStatusEvidence,
  now: Date,
  thresholds: SessionStatusThresholds = DEFAULT_SESSION_STATUS_THRESHOLDS,
): SessionStatus {
  const { activeWindowMs, staleAfterMs } = thresholds;
  if (
    !Number.isFinite(activeWindowMs) ||
    !Number.isFinite(staleAfterMs) ||
    activeWindowMs < 0 ||
    staleAfterMs < activeWindowMs
  ) {
    throw new RangeError('status thresholds must satisfy 0 <= activeWindowMs <= staleAfterMs');
  }

  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) throw new RangeError('now must be a valid date');

  const last = timestampMs(evidence.lastEventAt);
  const ended = timestampMs(evidence.endedAt);
  if (ended !== null && (last === null || last <= ended)) return 'ended';
  if (last === null) return 'unknown';

  const age = Math.max(0, nowMs - last);
  if (age <= activeWindowMs) return 'active';
  if (age <= staleAfterMs) return 'idle';
  return 'stale';
}
