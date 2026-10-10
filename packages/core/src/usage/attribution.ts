import type { SessionKey } from '../sessions/session.js';
import { sessionKeyToString } from '../sessions/session-key.js';
import { compareStrings, compareTimestampsNullLast } from './ordering.js';
import type { UsageObservation, UsageSelection } from './selection.js';
import { assertSingleMessage, isSyntheticObservation, selectUsage } from './selection.js';

/** Where a message's usage is attributed, and whether that choice is a forced tie-break. */
export interface UsageAttribution {
  session: SessionKey;
  /**
   * The earliest `occurredAt` (as an instant; null when no observation has one) is shared by
   * observations from more than one session, so the true origin is unknown and `session` came from
   * the lexical tie-break (usage-accounting §5.2, tie amendment).
   */
  ambiguous: boolean;
}

/**
 * The session a message's usage belongs to (docs/usage-accounting.md §5.2): the session of the
 * earliest observation (null `occurredAt` sorts last), ties broken by lexical canonical SessionKey.
 *
 * Why earliest: forks copy earlier messages into a new file under a new session id, so the same
 * message id appears in both. Attributing to one session keeps fork copies from double-counting.
 * But fork copies keep the original line's timestamp, so for forked history the earliest time is
 * usually tied across sessions. The record is then still attributed deterministically and counted
 * once, and `ambiguous` tells the UI the origin is unknown. Ties within one session (streaming
 * lines) are not ambiguous. The result depends only on the set of observations, never on order.
 *
 * Synthetic observations are excluded, matching `selectUsage`. Returns null when nothing remains.
 * Throws `UsageObservationGroupError` if the observations span more than one `(provider, messageId)`.
 */
export function attributeUsage(observations: readonly UsageObservation[]): UsageAttribution | null {
  assertSingleMessage(observations);
  let best: UsageObservation | undefined;
  let bestKey = '';
  let ambiguous = false;
  for (const o of observations) {
    if (isSyntheticObservation(o)) continue;
    const key = sessionKeyToString(o.session);
    const byTime =
      best === undefined ? -1 : compareTimestampsNullLast(o.occurredAt, best.occurredAt);
    if (byTime < 0) {
      // A strictly earlier instant: any earlier tie no longer concerns the earliest time.
      best = o;
      bestKey = key;
      ambiguous = false;
    } else if (byTime === 0 && key !== bestKey) {
      ambiguous = true;
      if (compareStrings(key, bestKey) < 0) {
        best = o;
        bestKey = key;
      }
    }
  }
  return best === undefined ? null : { session: { ...best.session }, ambiguous };
}

/** A UsageRecord projection row before persistence: the selection plus its attribution. */
export interface UsageRecordDraft extends UsageSelection {
  session: SessionKey;
  /** See `UsageAttribution.ambiguous`. Counted per session as `ambiguousAttributionCount`. */
  attributionAmbiguous: boolean;
}

/**
 * Selection and attribution for one `(provider, messageId)` group. Returns null when the group holds
 * only synthetic observations (no record is created).
 */
export function buildUsageRecord(
  observations: readonly UsageObservation[],
): UsageRecordDraft | null {
  const selection = selectUsage(observations);
  const attribution = attributeUsage(observations);
  if (selection === null || attribution === null) return null;
  return {
    ...selection,
    session: attribution.session,
    attributionAmbiguous: attribution.ambiguous,
  };
}
