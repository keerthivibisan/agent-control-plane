import type { SessionSummaryDto, SessionTreeDto, UsageTotalsDto } from '@acp/core/api';

export interface FamilyMember {
  session: SessionSummaryDto;
  aggregateUsage: UsageTotalsDto;
  /** True when no edge in the tree points at this session ("No known parent"). */
  noKnownParent: boolean;
  /** Helper agents it started (`subagent` edges), in start order, nested. */
  helpers: FamilyMember[];
  /** Sessions it was continued as (`continuation` edges), drawn as dashed siblings. */
  continuedAs: FamilyMember[];
}

const byStart = (a: SessionSummaryDto, b: SessionSummaryDto) =>
  a.firstSeenAt < b.firstSeenAt ? -1 : a.firstSeenAt > b.firstSeenAt ? 1 : a.id < b.id ? -1 : 1;

/**
 * Turns a session tree into a family tree to read top-down: the top-level session first, its
 * helper agents nested beneath it, and the sessions it was continued as next to it. Built ONLY
 * from `tree.edges` (verified, with evidence); edges to sessions missing from `nodes` are dropped.
 * Each session appears once; a session no edge points at starts its own branch and is marked
 * "No known parent".
 */
export function buildFamily(tree: SessionTreeDto): FamilyMember[] {
  const byId = new Map(tree.nodes.map((n) => [n.session.id, n]));
  const edges = tree.edges.filter(
    (e) => byId.has(e.parentId) && byId.has(e.childId) && e.parentId !== e.childId,
  );
  const incoming = new Set(edges.map((e) => e.childId));
  const kids = (id: string, kind: 'subagent' | 'continuation') =>
    [...new Set(edges.filter((e) => e.parentId === id && e.kind === kind).map((e) => e.childId))]
      .map((c) => byId.get(c)?.session)
      .filter((s): s is SessionSummaryDto => s !== undefined)
      .sort(byStart);

  const placed = new Set<string>();
  const member = (id: string): FamilyMember | null => {
    const n = byId.get(id);
    if (!n || placed.has(id)) return null;
    placed.add(id);
    const helpers = kids(id, 'subagent')
      .map((s) => member(s.id))
      .filter((m): m is FamilyMember => m !== null);
    const continuedAs = kids(id, 'continuation')
      .map((s) => member(s.id))
      .filter((m): m is FamilyMember => m !== null);
    return {
      session: n.session,
      aggregateUsage: n.aggregateUsage,
      noKnownParent: !incoming.has(id),
      helpers,
      continuedAs,
    };
  };

  const starts = [
    tree.rootId,
    ...[...byId.values()]
      .map((n) => n.session)
      .filter((s) => s.id !== tree.rootId && !incoming.has(s.id))
      .sort(byStart)
      .map((s) => s.id),
  ];
  const out: FamilyMember[] = [];
  for (const id of starts) {
    const m = member(id);
    if (m) out.push(m);
  }
  // Only reachable through a cycle: still shown, never hidden.
  for (const s of [...byId.values()].map((n) => n.session).sort(byStart)) {
    const m = member(s.id);
    if (m) out.push(m);
  }
  return out;
}
