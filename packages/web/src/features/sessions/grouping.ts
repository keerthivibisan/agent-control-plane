import type { SessionEdgeDto, SessionSummaryDto } from '@acp/core/api';

export interface GroupedRow {
  session: SessionSummaryDto;
  /** 0 for a top-level row; 1 for a helper agent shown under its parent, and so on. */
  depth: number;
}

/**
 * Orders a page of sessions so helper agents sit right under the session that started them.
 * Nesting comes ONLY from `subagent` edges (from `/sessions/:id/tree`, i.e. verified evidence),
 * and only when both ends are on this page. A helper whose parent is not on the page, or that no
 * edge names, stays a top-level row. Every input session appears exactly once.
 *
 * Top-level rows keep the API order (latest activity first); helpers under one parent are in the
 * order they started.
 */
export function groupSessions(
  sessions: readonly SessionSummaryDto[],
  edges: readonly SessionEdgeDto[],
): GroupedRow[] {
  const onPage = new Map(sessions.map((s) => [s.id, s]));
  const parentOf = new Map<string, string>();
  for (const e of edges) {
    if (e.kind !== 'subagent' || e.parentId === e.childId) continue;
    if (!onPage.has(e.parentId) || !onPage.has(e.childId)) continue;
    // One parent per child; the first edge wins, so duplicates from several trees are harmless.
    if (!parentOf.has(e.childId)) parentOf.set(e.childId, e.parentId);
  }
  const children = new Map<string, SessionSummaryDto[]>();
  for (const [child, parent] of parentOf) {
    const s = onPage.get(child) as SessionSummaryDto; // parentOf keys are on the page
    children.set(parent, [...(children.get(parent) ?? []), s]);
  }
  const byStart = (a: SessionSummaryDto, b: SessionSummaryDto) =>
    a.firstSeenAt < b.firstSeenAt ? -1 : a.firstSeenAt > b.firstSeenAt ? 1 : a.id < b.id ? -1 : 1;

  const out: GroupedRow[] = [];
  const placed = new Set<string>();
  const place = (s: SessionSummaryDto, depth: number) => {
    if (placed.has(s.id)) return;
    placed.add(s.id);
    out.push({ session: s, depth });
    for (const c of [...(children.get(s.id) ?? [])].sort(byStart)) place(c, depth + 1);
  };
  for (const s of sessions) if (!parentOf.has(s.id)) place(s, 0);
  // Only reachable with a cycle in the edges: keep every session visible, flat.
  for (const s of sessions) place(s, 0);
  return out;
}
