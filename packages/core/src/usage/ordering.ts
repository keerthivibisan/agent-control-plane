/**
 * Internal ordering helpers shared by usage and session logic. Not part of the public API.
 */

/**
 * Epoch milliseconds for an ISO-8601 timestamp, or null when absent or unparseable.
 * Timestamps are compared as instants, not strings: `…00Z` and `…00.000Z` are the same moment but
 * do not sort together lexically.
 */
export function timestampMs(value: string | null): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Ascending by instant, with null (unknown time) sorted last. */
export function compareTimestampsNullLast(a: string | null, b: string | null): number {
  const am = timestampMs(a);
  const bm = timestampMs(b);
  if (am === null) return bm === null ? 0 : 1;
  if (bm === null) return -1;
  return am - bm;
}

/**
 * Locale-independent string comparison (UTF-16 code units). `localeCompare` is avoided on purpose:
 * its result depends on the runtime's locale data, which would make tie-breaks differ by machine.
 */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
