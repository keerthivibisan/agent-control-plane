import type { SessionEdge, SessionKey } from '../sessions/session.js';
import { sessionKeyToString } from '../sessions/session-key.js';
import type { TokenCategory } from './selection.js';
import { TOKEN_CATEGORIES } from './selection.js';
import type { TokenCounts } from './usage.js';

/**
 * Per-category usage sum (docs/usage-accounting.md §6).
 * A category is null when no contributing record reported it: unavailable, never 0.
 * `recordsWithUnavailable` counts records whose category was null, so the UI can say "partial".
 */
export interface UsageTotals {
  tokens: TokenCounts;
  recordCount: number;
  recordsWithUnavailable: Record<TokenCategory, number>;
}

export function emptyUsageTotals(): UsageTotals {
  return {
    tokens: { input: null, output: null, cacheCreation: null, cacheRead: null },
    recordCount: 0,
    recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
  };
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/** Null-preserving sum of per-record token counts. */
export function sumTokenCounts(records: readonly TokenCounts[]): UsageTotals {
  const totals = emptyUsageTotals();
  for (const record of records) {
    totals.recordCount += 1;
    for (const category of TOKEN_CATEGORIES) {
      const value = record[category];
      if (value === null) totals.recordsWithUnavailable[category] += 1;
      totals.tokens[category] = addNullable(totals.tokens[category], value);
    }
  }
  return totals;
}

/** Combines two totals; null + null stays null, null + n is n. */
export function addUsageTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  const sum = emptyUsageTotals();
  sum.recordCount = a.recordCount + b.recordCount;
  for (const category of TOKEN_CATEGORIES) {
    sum.tokens[category] = addNullable(a.tokens[category], b.tokens[category]);
    sum.recordsWithUnavailable[category] =
      a.recordsWithUnavailable[category] + b.recordsWithUnavailable[category];
  }
  return sum;
}

/**
 * Direct usage per session: the sum of the usage records attributed to it, keyed by
 * `sessionKeyToString`. Sessions without records are absent.
 */
export function directUsageBySession(
  records: readonly { session: SessionKey; tokens: TokenCounts }[],
): Map<string, UsageTotals> {
  const bySession = new Map<string, TokenCounts[]>();
  for (const record of records) {
    const k = sessionKeyToString(record.session);
    const list = bySession.get(k);
    if (list === undefined) bySession.set(k, [record.tokens]);
    else list.push(record.tokens);
  }
  const result = new Map<string, UsageTotals>();
  for (const [k, list] of bySession) result.set(k, sumTokenCounts(list));
  return result;
}

export interface AggregateUsage extends UsageTotals {
  /** Sessions whose direct usage is included: the root plus reachable subagent descendants. */
  sessionCount: number;
  /**
   * A subagent edge pointed back to a session already on the current path. Edges are
   * evidence-backed and should form a tree, so this indicates bad input; the looping edge is
   * ignored and the condition is surfaced for diagnostics.
   */
  cycleDetected: boolean;
}

/**
 * Aggregate usage of `root`: its direct usage plus that of every descendant over `subagent` edges
 * (docs/usage-accounting.md §6).
 *
 * Continuation edges are skipped on purpose: a fork is a separate session, and the messages it
 * copied are already attributed to the original (§5.2), so following them would double-count.
 * Each session is counted once even if it is reachable along several paths.
 */
export function aggregateUsage(
  root: SessionKey,
  directByKey: ReadonlyMap<string, UsageTotals>,
  edges: readonly SessionEdge[],
): AggregateUsage {
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== 'subagent') continue;
    const parentKey = sessionKeyToString(edge.parent);
    const list = children.get(parentKey);
    const childKey = sessionKeyToString(edge.child);
    if (list === undefined) children.set(parentKey, [childKey]);
    else list.push(childKey);
  }

  // Iterative DFS: an explicit stack avoids recursion limits on long (or malformed) chains.
  const rootKey = sessionKeyToString(root);
  const visited = new Set<string>([rootKey]);
  const onPath = new Set<string>([rootKey]);
  const stack: { key: string; next: number }[] = [{ key: rootKey, next: 0 }];
  let cycleDetected = false;
  let totals = directByKey.get(rootKey) ?? emptyUsageTotals();

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const kids = children.get(frame.key) ?? [];
    const child = kids[frame.next];
    if (child === undefined) {
      onPath.delete(frame.key);
      stack.pop();
      continue;
    }
    frame.next += 1;
    if (onPath.has(child)) {
      cycleDetected = true;
      continue;
    }
    if (visited.has(child)) continue;
    visited.add(child);
    onPath.add(child);
    totals = addUsageTotals(totals, directByKey.get(child) ?? emptyUsageTotals());
    stack.push({ key: child, next: 0 });
  }

  return { ...totals, sessionCount: visited.size, cycleDetected };
}
