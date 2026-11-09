import type { ApprovalMode } from '../../workspace.js';
import type {
  AgentNode,
  AnyWorkflowGraph,
  LegacyWorkflowV1,
  StoredWorkflowJson,
  WorkflowEdge,
  WorkflowEdgeV3,
  WorkflowGraph,
  WorkflowGraphV3,
  WorkflowNode,
  WorkflowNodeV3,
} from '../../workflow-graph.js';
import { migrateWorkflowV1 } from '../migrate.js';
import { deriveRoles } from './roles.js';

/**
 * Version 2 to version 3 and back (ADR-0037 §6). Node ids, edge ids, order, labels, positions and
 * every launch field are kept, so stored agent runs, run snapshots and edge references keep
 * meaning the same blocks.
 */

/** A version 2 agent block's launch fields, only those it has (no `undefined` keys). */
function agentConfig(node: Extract<WorkflowNode, { model: string | null }>) {
  return {
    model: node.model,
    skills: [...node.skills],
    agent: node.agent,
    ...(node.effort !== undefined ? { effort: node.effort } : {}),
    ...(node.provider !== undefined ? { provider: node.provider } : {}),
  };
}

function base(node: WorkflowNode) {
  return {
    id: node.id,
    label: node.label,
    ...(node.position !== undefined ? { position: { ...node.position } } : {}),
  };
}

function nodeV3(node: WorkflowNode): WorkflowNodeV3 {
  switch (node.type) {
    case 'planner':
    case 'reviewer':
      // A reviewer's scope is read back from its arrows: a review arrow in (change) or the final
      // chain's flow in (final).
      return { type: 'agent', ...base(node), ...agentConfig(node) };
    case 'helper-pool':
      return {
        type: 'agent',
        ...base(node),
        ...agentConfig(node),
        approvalMode: node.approvalMode,
        canStartHelpers: node.canStartHelpers,
        pool: true,
      };
    case 'helper':
      return {
        type: 'agent',
        ...base(node),
        ...agentConfig(node),
        approvalMode: node.approvalMode,
        description: node.description,
        maxInstances: node.maxInstances,
        canStartHelpers: node.canStartHelpers,
      };
    case 'tester':
      return {
        type: 'agent',
        ...base(node),
        ...agentConfig(node),
        approvalMode: node.approvalMode,
      };
    case 'lead':
      return { type: 'lead', ...base(node), ...agentConfig(node) };
    case 'checks':
      return JSON.parse(JSON.stringify(node)) as WorkflowNodeV3;
    default:
      return { ...node, ...base(node) };
  }
}

/**
 * - `assigns` becomes `implement`;
 * - a planner's flow into Plan approval becomes its `plan` arrow;
 * - a flow into a tester (the final chain) becomes a `test` arrow;
 * - every other edge keeps its type (and a rework edge its rounds).
 */
function edgeV3(edge: WorkflowEdge, nodes: ReadonlyMap<string, WorkflowNode>): WorkflowEdgeV3 {
  const ends = { id: edge.id, from: edge.from, to: edge.to };
  switch (edge.type) {
    case 'assigns':
      return { type: 'implement', ...ends };
    case 'rework':
      return { type: 'rework', ...ends, maxRounds: edge.maxRounds };
    case 'flow': {
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      if (from?.type === 'planner' && to?.type === 'plan-approval')
        return { type: 'plan', ...ends };
      if (to?.type === 'tester') return { type: 'test', ...ends };
      return { type: 'flow', ...ends };
    }
    default:
      return { type: edge.type, ...ends };
  }
}

function copyLegacy(graph: { legacyV1?: LegacyWorkflowV1 | undefined }) {
  return graph.legacyV1 === undefined
    ? {}
    : { legacyV1: JSON.parse(JSON.stringify(graph.legacyV1)) as LegacyWorkflowV1 };
}

/**
 * A version 2 graph as version 3 (ADR-0037 §6). Pure and lossless for every graph the version 2
 * validator accepts: the result validates and compiles to the same program, and
 * `downgradeWorkflowV3` gives the input back. The helper pool becomes an agent with `pool: true`.
 */
export function migrateWorkflowV2(graph: WorkflowGraph): WorkflowGraphV3 {
  const nodes = new Map<string, WorkflowNode>();
  for (const node of graph.nodes) if (!nodes.has(node.id)) nodes.set(node.id, node);
  return {
    version: 3,
    template: graph.template,
    nodes: graph.nodes.map(nodeV3),
    edges: graph.edges.map((e) => edgeV3(e, nodes)),
    ...copyLegacy(graph),
  };
}

/** Any saved graph as version 3: a version 2 graph migrated, a version 3 graph as it is. */
export function toWorkflowGraphV3(graph: AnyWorkflowGraph): WorkflowGraphV3 {
  return graph.version === 3 ? graph : migrateWorkflowV2(graph);
}

/** A version 1 workflow as a version 3 graph: `migrateWorkflowV1`, then `migrateWorkflowV2`. */
export function migrateWorkflowV1ToV3(
  v1: LegacyWorkflowV1,
  opts: { projectMode: ApprovalMode },
): WorkflowGraphV3 {
  return migrateWorkflowV2(migrateWorkflowV1(v1, opts));
}

/**
 * What a project stores (`StoredWorkflowJsonSchema`), as a version 3 graph: a version 3 graph as
 * it is, a version 2 graph migrated, a version 1 workflow migrated with the project's mode.
 */
export function storedWorkflowGraphV3(
  json: StoredWorkflowJson,
  opts: { projectMode: ApprovalMode },
): WorkflowGraphV3 {
  if (!('version' in json)) return migrateWorkflowV1ToV3(json, opts);
  return json.version === 3 ? json.graph : migrateWorkflowV2(json.graph);
}

export type DowngradeResult = { ok: true; graph: WorkflowGraph } | { ok: false; reason: string };

function agentFields(node: Pick<AgentNode, 'model' | 'skills' | 'agent' | 'effort' | 'provider'>) {
  return {
    model: node.model,
    skills: [...node.skills],
    agent: node.agent,
    ...(node.effort !== undefined ? { effort: node.effort } : {}),
    ...(node.provider !== undefined ? { provider: node.provider } : {}),
  };
}

/**
 * A version 3 graph as version 2, for the consumers that still read version 2 until AR-4 and AR-5
 * move them (the editor and the API). The exact inverse of `migrateWorkflowV2` for every graph it
 * produced from a valid version 2 graph; refused (`ok: false`) for a graph version 2 cannot say:
 * an agent without one role, researchers, custom arrows, more than one planner, a review fan-out,
 * or arrow labels and purposes.
 */
export function downgradeWorkflowV3(graph: WorkflowGraphV3): DowngradeResult {
  const roles = deriveRoles(graph);
  const nodes: WorkflowNode[] = [];
  let planners = 0;
  for (const node of graph.nodes) {
    const ends = {
      id: node.id,
      label: node.label,
      ...(node.position !== undefined ? { position: { ...node.position } } : {}),
    };
    if (node.type !== 'agent') {
      nodes.push(
        node.type === 'lead'
          ? { type: 'lead', ...ends, ...agentFields(node) }
          : (JSON.parse(JSON.stringify(node)) as WorkflowNode),
      );
      continue;
    }
    const result = roles.get(node.id);
    if (result?.ok !== true) {
      return { ok: false, reason: `"${node.label}" has no single role` };
    }
    const role = result.role;
    switch (role.role) {
      case 'planner':
        planners++;
        nodes.push({ type: 'planner', ...ends, ...agentFields(node) });
        break;
      case 'worker':
        nodes.push(
          role.pool
            ? {
                type: 'helper-pool',
                ...ends,
                ...agentFields(node),
                approvalMode: node.approvalMode ?? null,
                canStartHelpers: node.canStartHelpers ?? false,
              }
            : {
                type: 'helper',
                ...ends,
                ...agentFields(node),
                approvalMode: node.approvalMode ?? null,
                description: node.description ?? '',
                maxInstances: node.maxInstances ?? 1,
                canStartHelpers: node.canStartHelpers ?? false,
              },
        );
        break;
      case 'reviewer':
        nodes.push({ type: 'reviewer', ...ends, ...agentFields(node), scope: role.scope });
        break;
      case 'tester':
        nodes.push({
          type: 'tester',
          ...ends,
          ...agentFields(node),
          approvalMode: node.approvalMode ?? null,
        });
        break;
      case 'researcher':
      case 'lead':
        return { ok: false, reason: `"${node.label}" is a ${role.role}` };
    }
  }
  if (planners > 1) return { ok: false, reason: 'the workflow has more than one planner' };
  const edges: WorkflowEdge[] = [];
  const reviewsFrom = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.label !== undefined || edge.purpose !== undefined) {
      return { ok: false, reason: `the link "${edge.id}" has a label or purpose` };
    }
    const ends = { id: edge.id, from: edge.from, to: edge.to };
    switch (edge.type) {
      case 'research':
      case 'custom':
        return { ok: false, reason: `the workflow has a ${edge.type} link` };
      case 'implement':
        edges.push({ type: 'assigns', ...ends });
        break;
      case 'plan':
      case 'test':
        edges.push({ type: 'flow', ...ends });
        break;
      case 'rework':
        edges.push({ type: 'rework', ...ends, maxRounds: edge.maxRounds });
        break;
      case 'review':
        if (reviewsFrom.has(edge.from)) {
          return { ok: false, reason: 'a change goes to more than one reviewer' };
        }
        reviewsFrom.add(edge.from);
        edges.push({ type: 'review', ...ends });
        break;
      default:
        edges.push({ type: edge.type, ...ends });
    }
  }
  return {
    ok: true,
    graph: { version: 2, template: graph.template, nodes, edges, ...copyLegacy(graph) },
  };
}
