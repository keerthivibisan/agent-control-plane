import type { SessionKey } from '../sessions/session.js';
import { sessionKeyToString } from '../sessions/session-key.js';
import { compareStrings, compareTimestampsNullLast } from './ordering.js';
import type { UsageObservation, UsageSelection } from './selection.js';
import { assertSingleMessage, isSyntheticObservation, selectUsage } from './selection.js';

/**
 * The session a message's usage belongs to (docs/usage-accounting.md §5.2): the session of the
 * earliest observation (null `occurredAt` sorts last), ties broken by lexical canonical SessionKey.
 *
 * Why earliest: forks copy earlier messages into a new file under a new session id, so the same
 * message id appears in both. The original session saw it first; attributing to it keeps fork
 * copies from double-counting. The rule depends only on the set of observations, never on
 * ingestion order.
 *
 * Synthetic observations are excluded, matching `selectUsage`. Returns null when nothing remains.
 * Throws `UsageObservationGroupError` if the observations span more than one `(provider, messageId)`.
 */
export function attributeUsage(observations: readonly UsageObservation[]): SessionKey | null {
  assertSingleMessage(observations);
  let best: UsageObservation | undefined;
  let bestKey = '';
  for (const o of observations) {
    if (isSyntheticObservation(o)) continue;
    const key = sessionKeyToString(o.session);
    if (best === undefined) {
      best = o;
      bestKey = key;
      continue;
    }
    const byTime = compareTimestampsNullLast(o.occurredAt, best.occurredAt);
    if (byTime < 0 || (byTime === 0 && compareStrings(key, bestKey) < 0)) {
      best = o;
      bestKey = key;
    }
  }
  return best === undefined ? null : { ...best.session };
}

/** A UsageRecord projection row before persistence: the selection plus its attributed session. */
export interface UsageRecordDraft extends UsageSelection {
  session: SessionKey;
}

/**
 * Selection and attribution for one `(provider, messageId)` group. Returns null when the group holds
 * only synthetic observations (no record is created).
 */
export function buildUsageRecord(
  observations: readonly UsageObservation[],
): UsageRecordDraft | null {
  const selection = selectUsage(observations);
  const session = attributeUsage(observations);
  if (selection === null || session === null) return null;
  return { ...selection, session };
}
