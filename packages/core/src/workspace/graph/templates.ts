import { DEFAULT_APPROVAL_MODE } from '../workspace.js';
import { DEFAULT_MAX_REWORK_ROUNDS, defaultProjectWorkflow } from '../workflow.js';
import type {
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowTemplateId,
} from '../workflow-graph.js';
import {
  DEFAULT_LABELS,
  GATE_IDS,
  STAGE_NODE_IDS,
  edge,
  finalChainEdges,
  gateNodes,
  planPathEdges,
  rework,
} from './build.js';
import { migrateWorkflowV1 } from './migrate.js';

/** What the template picker shows for each template, in the owner's words. */
export interface WorkflowTemplateInfo {
  id: WorkflowTemplateId;
  name: string;
  description: string;
}

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplateInfo[] = Object.freeze([
  {
    id: 'lead-only',
    name: 'Lead only',
    description:
      'The lead plans, starts helpers and reviews every change itself before merging it. The simplest setup.',
  },
  {
    id: 'todays-setup',
    name: 'Today’s setup',
    description:
      'A review agent reads each helper’s change and sends its findings to the lead, who decides. The setup projects had before workflows could be drawn.',
  },
  {
    id: 'reviewer-helper-loop',
    name: 'Reviewer ↔ helper loop',
    description:
      'A review agent sends each change straight back to its helper until it is right (up to 2 rounds), keeping the lead informed; the lead then merges.',
  },
]);

export interface WorkflowTemplateOptions {
  /** Add a separate planner that writes the plan (the lead then only runs the helpers). */
  planner?: boolean;
}

function noConfig(): { model: null; skills: string[]; agent: null } {
  return { model: null, skills: [], agent: null };
}

/** Ticket, planner or lead, plan gate, lead, pool and the gates every template shares. */
function base(planner: boolean): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  tail: WorkflowNode[];
} {
  const gates = gateNodes(false);
  const ids = STAGE_NODE_IDS;
  const nodes: WorkflowNode[] = [gates.ticket];
  if (planner) {
    nodes.push({ type: 'planner', id: ids.planner, label: DEFAULT_LABELS.planner, ...noConfig() });
  }
  nodes.push(
    gates.planApproval,
    { type: 'lead', id: ids.lead, label: DEFAULT_LABELS.lead, ...noConfig() },
    {
      type: 'helper-pool',
      id: ids.pool,
      label: DEFAULT_LABELS.pool,
      ...noConfig(),
      approvalMode: null,
      canStartHelpers: true,
    },
  );
  const edges = [
    ...planPathEdges(
      GATE_IDS.ticket,
      planner ? ids.planner : null,
      GATE_IDS.planApproval,
      ids.lead,
    ),
    edge('assigns', ids.lead, ids.pool),
  ];
  return { nodes, edges, tail: [gates.checks, gates.ticketMerge, gates.ownerMerge, gates.done] };
}

function mergeEdges(): WorkflowEdge[] {
  return [
    edge('merge', STAGE_NODE_IDS.lead, GATE_IDS.checks),
    edge('flow', GATE_IDS.checks, GATE_IDS.ticketMerge),
    ...finalChainEdges(GATE_IDS.ticketMerge, [], GATE_IDS.ownerMerge, GATE_IDS.done),
  ];
}

/**
 * A template's graph (README §1). Every template validates with no errors and, in a project
 * whose mode is not Full auto, no warnings. Node ids are the version 1 stage ids.
 * - `lead-only`: route (a): the pool's changes go to the lead, which may send them back
 *   (2 rounds, today's default);
 * - `todays-setup`: today's default workflow, migrated (`migrateWorkflowV1`), as a template;
 * - `reviewer-helper-loop`: route (c): a change reviewer reworks the pool's changes directly
 *   (2 rounds) and sends its findings to the lead, which merges.
 */
export function workflowTemplate(
  id: WorkflowTemplateId,
  opts: WorkflowTemplateOptions = {},
): WorkflowGraph {
  const planner = opts.planner ?? false;
  const ids = STAGE_NODE_IDS;
  switch (id) {
    case 'todays-setup': {
      const v1 = defaultProjectWorkflow('template', '1970-01-01T00:00:00.000Z');
      const graph = migrateWorkflowV1(
        { plannerMode: planner ? 'separate' : 'lead', stages: v1.stages },
        { projectMode: DEFAULT_APPROVAL_MODE },
      );
      return { version: 2, template: 'todays-setup', nodes: graph.nodes, edges: graph.edges };
    }
    case 'lead-only': {
      const b = base(planner);
      return {
        version: 2,
        template: 'lead-only',
        nodes: [...b.nodes, ...b.tail],
        edges: [
          ...b.edges,
          edge('review', ids.pool, ids.lead),
          rework(ids.lead, ids.pool, DEFAULT_MAX_REWORK_ROUNDS),
          ...mergeEdges(),
        ],
      };
    }
    case 'reviewer-helper-loop': {
      const b = base(planner);
      const reviewer: WorkflowNode = {
        type: 'reviewer',
        id: ids.changeReviewer,
        label: DEFAULT_LABELS.changeReviewer,
        scope: 'change',
        ...noConfig(),
      };
      return {
        version: 2,
        template: 'reviewer-helper-loop',
        nodes: [...b.nodes, reviewer, ...b.tail],
        edges: [
          ...b.edges,
          edge('review', ids.pool, ids.changeReviewer),
          rework(ids.changeReviewer, ids.pool, DEFAULT_MAX_REWORK_ROUNDS),
          edge('findings', ids.changeReviewer, ids.lead),
          ...mergeEdges(),
        ],
      };
    }
  }
}
