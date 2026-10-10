import type { ProviderId } from '../domain/provider.js';
import type { SessionKey } from '../sessions/session.js';
import { compareTimestampsNullLast } from './ordering.js';
import type { TokenCounts } from './usage.js';

/**
 * One `usage.reported` event as stored (docs/domain-model.md, UsageObservation).
 * `eventId` is the monotonic event row id; it is the final, always-unique selection tie-break.
 */
export interface UsageObservation {
  eventId: number;
  messageId: string;
  session: SessionKey;
  occurredAt: string | null;
  requestId: string | null;
  model: string | null;
  tokens: TokenCounts;
}

export type TokenCategory = keyof TokenCounts;

export const TOKEN_CATEGORIES = [
  'input',
  'output',
  'cacheCreation',
  'cacheRead',
] as const satisfies readonly TokenCategory[];

/** Claude Code's placeholder model for locally generated messages. Never counted as usage (§5.3). */
export const SYNTHETIC_MODEL = '<synthetic>';

/** The usage chosen for one `(provider, messageId)` (docs/usage-accounting.md §5.1). */
export interface UsageSelection {
  provider: ProviderId;
  messageId: string;
  /** Event row id of the observation whose values were taken. */
  selectedEventId: number;
  requestId: string | null;
  model: string | null;
  /** All four categories come from the selected observation, never mixed across observations. */
  tokens: TokenCounts;
  /** Non-synthetic observations considered. */
  observationCount: number;
  /** A non-output category reported different values across observations. */
  conflict: boolean;
}

/** Thrown when observations for different messages are passed to one selection. */
export class UsageObservationGroupError extends Error {
  override readonly name = 'UsageObservationGroupError';
}

export function isSyntheticObservation(o: Pick<UsageObservation, 'model'>): boolean {
  return o.model === SYNTHETIC_MODEL;
}

/** Group key for `(provider, messageId)`, the usage dedup identity (usage-accounting §4). */
export function usageMessageKey(o: Pick<UsageObservation, 'messageId' | 'session'>): string {
  return JSON.stringify([o.session.provider, o.messageId]);
}

/** Groups observations by `(provider, messageId)`. Groups keep input order; callers must not rely on it. */
export function groupObservationsByMessage(
  observations: readonly UsageObservation[],
): Map<string, UsageObservation[]> {
  const groups = new Map<string, UsageObservation[]>();
  for (const o of observations) {
    const key = usageMessageKey(o);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [o]);
    else group.push(o);
  }
  return groups;
}

/** Throws `UsageObservationGroupError` unless every observation shares one `(provider, messageId)`. */
export function assertSingleMessage(observations: readonly UsageObservation[]): void {
  const first = observations[0];
  if (first === undefined) return;
  const key = usageMessageKey(first);
  for (const o of observations) {
    if (usageMessageKey(o) !== key) {
      throw new UsageObservationGroupError(
        'usage observations must share one (provider, messageId); group them first',
      );
    }
  }
}

/** Descending output with null ranked lowest; then earliest occurredAt (null last); then lowest eventId. */
function compareForSelection(a: UsageObservation, b: UsageObservation): number {
  const ao = a.tokens.output;
  const bo = b.tokens.output;
  if (ao !== bo) {
    if (ao === null) return 1;
    if (bo === null) return -1;
    return bo - ao;
  }
  const byTime = compareTimestampsNullLast(a.occurredAt, b.occurredAt);
  if (byTime !== 0) return byTime;
  return a.eventId - b.eventId;
}

/**
 * Picks the one usage record for a message (docs/usage-accounting.md §5).
 *
 * Max output wins because Claude Code writes one transcript line per content block with a growing
 * output count: "first wins" undercounts and "sum" double-counts. The other categories are taken
 * from the same observation so a record never mixes values from different lines.
 *
 * Returns null when there are no non-synthetic observations. Throws `UsageObservationGroupError` if
 * the observations belong to more than one `(provider, messageId)`.
 */
export function selectUsage(observations: readonly UsageObservation[]): UsageSelection | null {
  assertSingleMessage(observations);
  const candidates = observations.filter((o) => !isSyntheticObservation(o));
  let selected: UsageObservation | undefined;
  for (const o of candidates) {
    if (selected === undefined || compareForSelection(o, selected) < 0) selected = o;
  }
  if (selected === undefined) return null;

  return {
    provider: selected.session.provider,
    messageId: selected.messageId,
    selectedEventId: selected.eventId,
    requestId: selected.requestId,
    model: selected.model,
    tokens: { ...selected.tokens },
    observationCount: candidates.length,
    conflict: hasNonOutputConflict(candidates),
  };
}

/** Whether any non-output category has two different reported (non-null) values. */
function hasNonOutputConflict(observations: readonly UsageObservation[]): boolean {
  for (const category of TOKEN_CATEGORIES) {
    if (category === 'output') continue;
    const seen = new Set<number>();
    for (const o of observations) {
      const value = o.tokens[category];
      if (value !== null) seen.add(value);
    }
    if (seen.size > 1) return true;
  }
  return false;
}
