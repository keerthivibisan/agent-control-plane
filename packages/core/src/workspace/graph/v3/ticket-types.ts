import type { TicketType } from '../../workspace.js';
import type {
  WorkflowEdgeV3,
  WorkflowGraphV3,
  WorkflowNodeId,
  WorkflowNodeV3,
} from '../../workflow-graph.js';
import { isCheckBlockAt } from '../check-blocks.js';
import { deriveRoles } from './roles.js';
import { arrowIdFor } from './templates.js';

/**
 * ADR-0039: an Agent block may run only for some ticket types (`ticketTypes`). A run starts from
 * the graph its ticket's type runs, so the engine, the lead's brief and the live graph only ever
 * see the blocks that run. Pure and deterministic; a graph with no `ticketTypes` comes back as is.
 */

/** Whether a block runs for tickets of `type` (gates, Checks and the lead always do). */
export function runsForTicket(node: WorkflowNodeV3, type: TicketType): boolean {
  return node.type !== 'agent' || node.ticketTypes === undefined || node.ticketTypes.includes(type);
}

/** The ticket types some block leaves out, in the schema's order. */
export function skippingTicketTypes(graph: Pick<WorkflowGraphV3, 'nodes'>): TicketType[] {
  const out = new Set<TicketType>();
  for (const node of graph.nodes) {
    if (node.type !== 'agent' || node.ticketTypes === undefined) continue;
    for (const type of ALL_TYPES) if (!node.ticketTypes.includes(type)) out.add(type);
  }
  return ALL_TYPES.filter((t) => out.has(t));
}

const ALL_TYPES: readonly TicketType[] = ['feature', 'bug', 'chore', 'harness'];

export interface SpecialisedGraph {
  graph: WorkflowGraphV3;
  /** The blocks left out, in graph order: the ones set to other types, then those that lost
   *  their role or input with them (a researcher of a skipped block, its change reviewer). */
  skipped: WorkflowNodeV3[];
}

/**
 * The graph a ticket of `type` runs:
 * 1. the agents whose `ticketTypes` leave the type out are removed with their arrows;
 * 2. a removed block in a chain of `flow`/`test` steps (the final chain after the ticket merge) is
 *    stepped over: its one step in is joined to its one step out, as a `test` arrow when the next
 *    block is a tester, else the next block's own step type, `flow` into a gate;
 * 3. then, until nothing changes, an agent that had a role and lost it (a researcher whose target
 *    went, a change reviewer with no change left to review) and a Checks block on the change that
 *    lost every input go too;
 * 4. when every planner went, the plan path is redrawn through the lead (Ticket → Lead → Plan
 *    approval, without Plan approval → Lead), as a workflow without planners draws it.
 * When arrows from or to a removed block go with it, so that failure goes to the lead.
 */
export function specialiseForTicket(graph: WorkflowGraphV3, type: TicketType): SpecialisedGraph {
  let nodes = graph.nodes;
  let edges = graph.edges;
  const skipped = new Set<WorkflowNodeId>();
  let drop = nodes.filter((n) => !runsForTicket(n, type)).map((n) => n.id);
  if (drop.length === 0) return { graph, skipped: [] };
  const hadRole = new Set([...deriveRoles(graph)].filter(([, r]) => r.ok).map(([id]) => id));
  const hadPlanner = [...deriveRoles(graph).values()].some((r) => r.claims.includes('planner'));
  const usedIds = new Set(edges.map((e) => e.id));
  while (drop.length > 0) {
    for (const id of drop) {
      edges = stepOver(nodes, edges, id, usedIds);
      edges = edges.filter((e) => e.from !== id && e.to !== id);
      nodes = nodes.filter((n) => n.id !== id);
      skipped.add(id);
    }
    const roles = deriveRoles({ nodes, edges });
    drop = nodes
      .filter((n) => {
        if (n.type === 'agent') return hadRole.has(n.id) && roles.get(n.id)?.ok !== true;
        return isCheckBlockAt(n, 'change') && !edges.some((e) => e.to === n.id);
      })
      .map((n) => n.id);
  }
  const roles = deriveRoles({ nodes, edges });
  if (hadPlanner && ![...roles.values()].some((r) => r.claims.includes('planner'))) {
    edges = redrawPlanPath(nodes, edges, usedIds);
  }
  return {
    graph: { ...graph, nodes, edges },
    skipped: graph.nodes.filter((n) => skipped.has(n.id)),
  };
}

const isStep = (e: WorkflowEdgeV3) => e.type === 'flow' || e.type === 'test';

function stepOver(
  nodes: readonly WorkflowNodeV3[],
  edges: readonly WorkflowEdgeV3[],
  id: WorkflowNodeId,
  usedIds: Set<string>,
): WorkflowEdgeV3[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const into = edges.filter((e) => isStep(e) && e.to === id);
  const out = edges.filter((e) => isStep(e) && e.from === id);
  const before = into[0];
  const after = out[0];
  if (into.length !== 1 || out.length !== 1 || before === undefined || after === undefined) {
    return [...edges];
  }
  const next = byId.get(after.to);
  // The next block keeps the role its step in gave it: a tester stays a tester.
  const stepType = next?.type === 'agent' && after.type === 'test' ? 'test' : 'flow';
  if (edges.some((e) => e.from === before.from && e.to === after.to && e.type === stepType)) {
    return [...edges];
  }
  const edgeId = freshId(stepType, before.from, after.to, usedIds);
  return [...edges, { type: stepType, id: edgeId, from: before.from, to: after.to }];
}

function redrawPlanPath(
  nodes: readonly WorkflowNodeV3[],
  edges: WorkflowEdgeV3[],
  usedIds: Set<string>,
): WorkflowEdgeV3[] {
  const lead = nodes.find((n) => n.type === 'lead');
  const ticket = nodes.find((n) => n.type === 'ticket');
  const gate = nodes.find((n) => n.type === 'plan-approval');
  if (lead === undefined || ticket === undefined || gate === undefined) return edges;
  // With a planner, Plan approval flows on to the lead; without one, the lead flows to it.
  const out = edges.filter((e) => !(e.type === 'flow' && e.from === gate.id && e.to === lead.id));
  for (const [from, to] of [
    [ticket.id, lead.id],
    [lead.id, gate.id],
  ] as const) {
    if (!out.some((e) => e.type === 'flow' && e.from === from && e.to === to)) {
      out.push({ type: 'flow', id: freshId('flow', from, to, usedIds), from, to });
    }
  }
  return out;
}

function freshId(
  type: WorkflowEdgeV3['type'],
  from: WorkflowNodeId,
  to: WorkflowNodeId,
  usedIds: Set<string>,
): string {
  const base = arrowIdFor(type, from, to);
  let id = base;
  for (let n = 2; usedIds.has(id); n += 1) id = `${base.slice(0, 36)}-${n}`;
  usedIds.add(id);
  return id;
}
