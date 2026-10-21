import type {
  WorkflowEdge,
  WorkflowEdgeType,
  WorkflowNode,
  WorkflowNodeId,
} from '../workflow-graph.js';

/** Small constructors for templates, migration and the test generators. Internal. */

/** Gate node ids, the same in every graph the app builds (templates and migration). */
export const GATE_IDS = Object.freeze({
  ticket: 'ticket',
  planApproval: 'plan-approval',
  checks: 'checks',
  ticketMerge: 'ticket-merge',
  ownerMerge: 'owner-merge',
  done: 'done',
});

/** Agent node ids equal to the version 1 stage ids, so stored agent runs keep parsing. */
export const STAGE_NODE_IDS = Object.freeze({
  planner: 'plan',
  lead: 'orchestrate',
  pool: 'helpers',
  changeReviewer: 'review',
  finalReviewer: 'code-review',
  tester: 'unit-tests',
});

/** The labels the app gives the blocks it creates. */
export const DEFAULT_LABELS = Object.freeze({
  ticket: 'Ticket',
  planner: 'Planner',
  planApproval: 'Plan approval',
  lead: 'Lead',
  pool: 'Helpers',
  changeReviewer: 'Change reviewer',
  checks: 'Checks',
  ticketMerge: 'Ticket branch',
  finalReviewer: 'Code reviewer',
  tester: 'Tester',
  ownerMerge: 'Your merge',
  done: 'Done',
});

/** A deterministic edge id from its ends: `<type>-<from>-<to>`, cut to the 40-character limit. */
export function edgeIdFor(
  type: WorkflowEdgeType,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): string {
  return `${type}-${from}-${to}`.slice(0, 40).replace(/-+$/, '');
}

export function edge(
  type: Exclude<WorkflowEdgeType, 'rework'>,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
  id: string = edgeIdFor(type, from, to),
): WorkflowEdge {
  return { type, id, from, to };
}

export function rework(
  from: WorkflowNodeId,
  to: WorkflowNodeId,
  maxRounds: number,
  id: string = edgeIdFor('rework', from, to),
): WorkflowEdge {
  return { type: 'rework', id, from, to, maxRounds };
}

/** The six gates with their default ids and labels; the plan gate asks unless `planAuto`. */
export function gateNodes(planAuto: boolean): {
  ticket: WorkflowNode;
  planApproval: WorkflowNode;
  checks: WorkflowNode;
  ticketMerge: WorkflowNode;
  ownerMerge: WorkflowNode;
  done: WorkflowNode;
} {
  return {
    ticket: { type: 'ticket', id: GATE_IDS.ticket, label: DEFAULT_LABELS.ticket },
    planApproval: {
      type: 'plan-approval',
      id: GATE_IDS.planApproval,
      label: DEFAULT_LABELS.planApproval,
      auto: planAuto,
    },
    checks: { type: 'checks', id: GATE_IDS.checks, label: DEFAULT_LABELS.checks },
    ticketMerge: {
      type: 'ticket-merge',
      id: GATE_IDS.ticketMerge,
      label: DEFAULT_LABELS.ticketMerge,
    },
    ownerMerge: { type: 'owner-merge', id: GATE_IDS.ownerMerge, label: DEFAULT_LABELS.ownerMerge },
    done: { type: 'done', id: GATE_IDS.done, label: DEFAULT_LABELS.done },
  };
}

/** The plan path flow edges: with a planner `ticket → planner → gate → lead`, else `ticket → lead → gate`. */
export function planPathEdges(
  ticket: WorkflowNodeId,
  planner: WorkflowNodeId | null,
  gate: WorkflowNodeId,
  lead: WorkflowNodeId,
): WorkflowEdge[] {
  return planner === null
    ? [edge('flow', ticket, lead), edge('flow', lead, gate)]
    : [edge('flow', ticket, planner), edge('flow', planner, gate), edge('flow', gate, lead)];
}

/** The flow edges of the final chain: ticket merge → stages… → owner merge → done. */
export function finalChainEdges(
  ticketMerge: WorkflowNodeId,
  stages: readonly WorkflowNodeId[],
  ownerMerge: WorkflowNodeId,
  done: WorkflowNodeId,
): WorkflowEdge[] {
  const chain = [ticketMerge, ...stages, ownerMerge];
  const edges: WorkflowEdge[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const from = chain[i];
    const to = chain[i + 1];
    if (from !== undefined && to !== undefined) edges.push(edge('flow', from, to));
  }
  edges.push(edge('flow', ownerMerge, done));
  return edges;
}
