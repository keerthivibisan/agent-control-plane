import { DEFAULT_APPROVAL_MODE } from '../../workspace.js';
import { DEFAULT_MAX_REWORK_ROUNDS, defaultProjectWorkflow } from '../../workflow.js';
import type {
  AgentNode,
  WorkflowEdgeTypeV3,
  WorkflowEdgeV3,
  WorkflowGraphV3,
  WorkflowNodeId,
  WorkflowNodeV3,
  WorkflowTemplateId,
} from '../../workflow-graph.js';
import { DEFAULT_LABELS, GATE_IDS, STAGE_NODE_IDS } from '../build.js';
import type { WorkflowTemplateOptions } from '../templates.js';
import { migrateWorkflowV1ToV3 } from './migrate.js';

/** Small constructors for version 3 graphs: templates and the test generators. Internal. */

/** A deterministic arrow id from its ends: `<type>-<from>-<to>`, cut to the 40-character limit. */
export function arrowIdFor(
  type: WorkflowEdgeTypeV3,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): string {
  return `${type}-${from}-${to}`.slice(0, 40).replace(/-+$/, '');
}

export function arrow(
  type: Exclude<WorkflowEdgeTypeV3, 'rework'>,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
  id: string = arrowIdFor(type, from, to),
): WorkflowEdgeV3 {
  return { type, id, from, to };
}

export function reworkArrow(
  from: WorkflowNodeId,
  to: WorkflowNodeId,
  maxRounds: number,
  id: string = arrowIdFor('rework', from, to),
): WorkflowEdgeV3 {
  return { type: 'rework', id, from, to, maxRounds };
}

/** The six gates with their default ids and labels; the plan gate asks unless `planAuto`. */
export function gateNodesV3(planAuto: boolean) {
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
  } satisfies Record<string, WorkflowNodeV3>;
}

function agent(
  id: string,
  label: string,
  extra: Omit<Partial<AgentNode>, 'type' | 'id' | 'label'> = {},
): AgentNode {
  return { type: 'agent', id, label, model: null, skills: [], agent: null, ...extra };
}

/** Ticket, planner or lead, plan gate, lead, pool and the gates every template shares. */
function base(planner: boolean): {
  nodes: WorkflowNodeV3[];
  edges: WorkflowEdgeV3[];
  tail: WorkflowNodeV3[];
} {
  const gates = gateNodesV3(false);
  const ids = STAGE_NODE_IDS;
  const nodes: WorkflowNodeV3[] = [gates.ticket];
  if (planner) nodes.push(agent(ids.planner, DEFAULT_LABELS.planner));
  nodes.push(
    gates.planApproval,
    {
      type: 'lead',
      id: ids.lead,
      label: DEFAULT_LABELS.lead,
      model: null,
      skills: [],
      agent: null,
    },
    agent(ids.pool, DEFAULT_LABELS.pool, { approvalMode: null, canStartHelpers: true, pool: true }),
  );
  const plan: WorkflowEdgeV3[] = planner
    ? [
        arrow('flow', GATE_IDS.ticket, ids.planner),
        arrow('plan', ids.planner, GATE_IDS.planApproval),
        arrow('flow', GATE_IDS.planApproval, ids.lead),
      ]
    : [arrow('flow', GATE_IDS.ticket, ids.lead), arrow('flow', ids.lead, GATE_IDS.planApproval)];
  return {
    nodes,
    edges: [...plan, arrow('implement', ids.lead, ids.pool)],
    tail: [gates.checks, gates.ticketMerge, gates.ownerMerge, gates.done],
  };
}

function mergeArrows(): WorkflowEdgeV3[] {
  return [
    arrow('merge', STAGE_NODE_IDS.lead, GATE_IDS.checks),
    arrow('flow', GATE_IDS.checks, GATE_IDS.ticketMerge),
    arrow('flow', GATE_IDS.ticketMerge, GATE_IDS.ownerMerge),
    arrow('flow', GATE_IDS.ownerMerge, GATE_IDS.done),
  ];
}

/**
 * A template as a version 3 graph (README §1, ADR-0037). The same workflows as version 2's
 * `workflowTemplate`, drawn with the version 3 arrows (the planner's `plan` arrow, the lead's
 * `implement` arrow to the pool), so each compiles to the same program:
 * - `lead-only`: the lead reviews every change of the pool and may send it back (2 rounds);
 * - `todays-setup`: today's default workflow, migrated from version 1;
 * - `reviewer-helper-loop`: a change reviewer reworks the pool's changes directly (2 rounds) and
 *   sends its findings to the lead, which merges.
 */
export function workflowTemplateV3(
  id: WorkflowTemplateId,
  opts: WorkflowTemplateOptions = {},
): WorkflowGraphV3 {
  const planner = opts.planner ?? false;
  const ids = STAGE_NODE_IDS;
  switch (id) {
    case 'todays-setup': {
      const v1 = defaultProjectWorkflow('template', '1970-01-01T00:00:00.000Z');
      const graph = migrateWorkflowV1ToV3(
        { plannerMode: planner ? 'separate' : 'lead', stages: v1.stages },
        { projectMode: DEFAULT_APPROVAL_MODE },
      );
      return { version: 3, template: 'todays-setup', nodes: graph.nodes, edges: graph.edges };
    }
    case 'lead-only': {
      const b = base(planner);
      return {
        version: 3,
        template: 'lead-only',
        nodes: [...b.nodes, ...b.tail],
        edges: [
          ...b.edges,
          arrow('review', ids.pool, ids.lead),
          reworkArrow(ids.lead, ids.pool, DEFAULT_MAX_REWORK_ROUNDS),
          ...mergeArrows(),
        ],
      };
    }
    case 'reviewer-helper-loop': {
      const b = base(planner);
      return {
        version: 3,
        template: 'reviewer-helper-loop',
        nodes: [...b.nodes, agent(ids.changeReviewer, DEFAULT_LABELS.changeReviewer), ...b.tail],
        edges: [
          ...b.edges,
          arrow('review', ids.pool, ids.changeReviewer),
          reworkArrow(ids.changeReviewer, ids.pool, DEFAULT_MAX_REWORK_ROUNDS),
          arrow('findings', ids.changeReviewer, ids.lead),
          ...mergeArrows(),
        ],
      };
    }
  }
}
