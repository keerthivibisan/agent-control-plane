import { HARD_MAX_HELPERS } from '../../workspace.js';
import {
  NODE_CAPABILITIES,
  WORKFLOW_TEMPLATE_IDS,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeId,
} from '../../workflow-graph.js';
import { workflowTemplate } from '../templates.js';
import {
  addEdge,
  addNode,
  chainIds,
  changeReviewers,
  editorNodes,
  firstOfType,
  freshId,
  hasEdge,
  helperNodes,
  leadId,
  nodesOfType,
  randomAgentConfig,
  randomMode,
  removeEdges,
  removeNode,
  reviewTargetOf,
  updateEdge,
  updateNode,
} from './graph-ops.js';
import { createGraphRng, type GraphRng } from './rng.js';

/**
 * Random valid graphs for property tests (README "Graph correctness", layer 3). A graph starts
 * from a template and changes only by legal moves, each of which keeps every validation rule, so
 * the validator must accept every result. A move that does not apply returns null and is skipped.
 */

/** Names for generated named helpers: distinct and never reserved. */
export const GENERATED_HELPER_NAMES: readonly string[] = Object.freeze([
  'Frontend helper',
  'Backend helper',
  'Docs helper',
  'Database helper',
  'Infra helper',
  'Test data helper',
  'Styles helper',
  'API helper',
]);

const MAX_REVIEWERS = NODE_CAPABILITIES.reviewer.maxPerGraph;
const MAX_TESTERS = NODE_CAPABILITIES.tester.maxPerGraph;

type Move = (graph: WorkflowGraph, rng: GraphRng) => WorkflowGraph | null;

/** Removes change reviewers nothing reviews to any more (and their findings and rework edges). */
function dropUnusedReviewers(graph: WorkflowGraph): WorkflowGraph {
  let g = graph;
  for (const r of changeReviewers(g)) {
    if (!g.edges.some((e) => e.type === 'review' && e.to === r.id)) g = removeNode(g, r.id);
  }
  return g;
}

/** Gives an editing node a review route: the lead or a change reviewer, plus optional reworks. */
function addRoute(graph: WorkflowGraph, id: WorkflowNodeId, rng: GraphRng): WorkflowGraph {
  const lead = leadId(graph);
  const reviewers = changeReviewers(graph);
  const target = reviewers.length > 0 && rng.bool(0.6) ? rng.pick(reviewers).id : lead;
  let g = addEdge(graph, { type: 'review', from: id, to: target });
  if (target !== lead && rng.bool()) {
    g = addEdge(g, { type: 'rework', from: target, to: id, maxRounds: rng.int(6) });
  }
  if (rng.bool()) g = addEdge(g, { type: 'rework', from: lead, to: id, maxRounds: rng.int(6) });
  return g;
}

/** Moves a node's review route to `target`, keeping every rule (old reviewer rework goes too). */
function retarget(
  graph: WorkflowGraph,
  id: WorkflowNodeId,
  target: WorkflowNodeId,
  rng: GraphRng,
): WorkflowGraph {
  const old = reviewTargetOf(graph, id);
  let g = removeEdges(
    graph,
    (e) =>
      (e.type === 'review' && e.from === id) ||
      (e.type === 'rework' && e.to === id && e.from === old && e.from !== leadId(graph)),
  );
  g = addEdge(g, { type: 'review', from: id, to: target });
  if (target !== leadId(g) && rng.bool()) {
    g = addEdge(g, { type: 'rework', from: target, to: id, maxRounds: rng.int(6) });
  }
  return dropUnusedReviewers(g);
}

const addNamedHelper: Move = (graph, rng) => {
  const named = nodesOfType(graph, 'helper');
  if (named.length >= HARD_MAX_HELPERS) return null;
  const used = new Set(named.map((n) => n.label));
  const label = rng.pick(GENERATED_HELPER_NAMES.filter((n) => !used.has(n)));
  const id = freshId(graph, 'named');
  let g = addNode(graph, {
    type: 'helper',
    id,
    label,
    ...randomAgentConfig(rng),
    approvalMode: randomMode(rng),
    description: `Works on the ${label.toLowerCase()} parts.`,
    maxInstances: 1 + rng.int(3),
    canStartHelpers: rng.bool(),
  });
  g = addEdge(g, { type: 'assigns', from: leadId(g), to: id });
  return addRoute(g, id, rng);
};

const addPool: Move = (graph, rng) => {
  if (firstOfType(graph, 'helper-pool') !== undefined) return null;
  const id = freshId(graph, 'pool');
  let g = addNode(graph, {
    type: 'helper-pool',
    id,
    label: 'Helpers',
    ...randomAgentConfig(rng),
    approvalMode: randomMode(rng),
    canStartHelpers: rng.bool(),
  });
  g = addEdge(g, { type: 'assigns', from: leadId(g), to: id });
  return addRoute(g, id, rng);
};

const removePool: Move = (graph) => {
  const pool = firstOfType(graph, 'helper-pool');
  if (pool === undefined || nodesOfType(graph, 'helper').length === 0) return null;
  return dropUnusedReviewers(removeNode(graph, pool.id));
};

const addChangeReviewer: Move = (graph, rng) => {
  const editors = editorNodes(graph);
  if (nodesOfType(graph, 'reviewer').length >= MAX_REVIEWERS || editors.length === 0) return null;
  const id = freshId(graph, 'reviewer');
  let g = addNode(graph, {
    type: 'reviewer',
    id,
    label: 'Change reviewer',
    scope: 'change',
    ...randomAgentConfig(rng),
  });
  g = addEdge(g, { type: 'findings', from: id, to: leadId(g) });
  return retarget(g, rng.pick(editors).id, id, rng);
};

const retargetReview: Move = (graph, rng) => {
  const editors = editorNodes(graph);
  if (editors.length === 0) return null;
  const node = rng.pick(editors);
  const current = reviewTargetOf(graph, node.id);
  const targets = [leadId(graph), ...changeReviewers(graph).map((r) => r.id)].filter(
    (t) => t !== current,
  );
  if (targets.length === 0) return null;
  return retarget(graph, node.id, rng.pick(targets), rng);
};

const addRework: Move = (graph, rng) => {
  const lead = leadId(graph);
  const options: [WorkflowNodeId, WorkflowNodeId][] = [];
  for (const n of editorNodes(graph)) {
    if (!hasEdge(graph, 'rework', lead, n.id)) options.push([lead, n.id]);
    const target = reviewTargetOf(graph, n.id);
    if (target !== undefined && target !== lead && !hasEdge(graph, 'rework', target, n.id)) {
      options.push([target, n.id]);
    }
  }
  if (options.length === 0) return null;
  const [from, to] = rng.pick(options);
  return addEdge(graph, { type: 'rework', from, to, maxRounds: rng.int(6) });
};

const removeRework: Move = (graph, rng) => {
  const reworks = graph.edges.filter((e) => e.type === 'rework');
  if (reworks.length === 0) return null;
  const drop = rng.pick(reworks).id;
  return removeEdges(graph, (e) => e.id === drop);
};

const setRounds: Move = (graph, rng) => {
  const reworks = graph.edges.filter((e) => e.type === 'rework');
  if (reworks.length === 0) return null;
  const maxRounds = rng.int(6);
  return updateEdge(graph, rng.pick(reworks).id, (e) =>
    e.type === 'rework' ? { ...e, maxRounds } : e,
  );
};

const addFinalStage: Move = (graph, rng) => {
  const kinds: ('reviewer' | 'tester')[] = [];
  if (nodesOfType(graph, 'reviewer').length < MAX_REVIEWERS) kinds.push('reviewer');
  if (nodesOfType(graph, 'tester').length < MAX_TESTERS) kinds.push('tester');
  if (kinds.length === 0) return null;
  const chain = chainIds(graph);
  const at = rng.int(chain.length - 1);
  const before = chain[at];
  const after = chain[at + 1];
  if (before === undefined || after === undefined) return null;
  const kind = rng.pick(kinds);
  const id = freshId(graph, kind === 'tester' ? 'tester' : 'final');
  const node: WorkflowNode =
    kind === 'tester'
      ? {
          type: 'tester',
          id,
          label: 'Tester',
          ...randomAgentConfig(rng),
          approvalMode: randomMode(rng),
        }
      : { type: 'reviewer', id, label: 'Code reviewer', scope: 'final', ...randomAgentConfig(rng) };
  let g = removeEdges(graph, (e) => e.type === 'flow' && e.from === before && e.to === after);
  g = addNode(g, node);
  g = addEdge(g, { type: 'flow', from: before, to: id });
  g = addEdge(g, { type: 'flow', from: id, to: after });
  return kind === 'tester' ? addRoute(g, id, rng) : g;
};

const removeFinalStage: Move = (graph, rng) => {
  const chain = chainIds(graph);
  const stages = chain.slice(1, -1);
  if (stages.length === 0) return null;
  const at = 1 + rng.int(stages.length);
  const before = chain[at - 1];
  const id = chain[at];
  const after = chain[at + 1];
  if (before === undefined || id === undefined || after === undefined) return null;
  const g = addEdge(removeNode(graph, id), { type: 'flow', from: before, to: after });
  return dropUnusedReviewers(g);
};

const togglePlanner: Move = (graph, rng) => {
  const ticket = firstOfType(graph, 'ticket');
  const gate = firstOfType(graph, 'plan-approval');
  if (ticket === undefined || gate === undefined) return null;
  const lead = leadId(graph);
  const planner = firstOfType(graph, 'planner');
  if (planner !== undefined) {
    let g = removeNode(graph, planner.id);
    g = removeEdges(g, (e) => e.type === 'flow' && e.from === gate.id && e.to === lead);
    g = addEdge(g, { type: 'flow', from: ticket.id, to: lead });
    return addEdge(g, { type: 'flow', from: lead, to: gate.id });
  }
  const id = freshId(graph, 'planner');
  let g = removeEdges(
    graph,
    (e) =>
      e.type === 'flow' &&
      ((e.from === ticket.id && e.to === lead) || (e.from === lead && e.to === gate.id)),
  );
  g = addNode(g, { type: 'planner', id, label: 'Planner', ...randomAgentConfig(rng) });
  g = addEdge(g, { type: 'flow', from: ticket.id, to: id });
  g = addEdge(g, { type: 'flow', from: id, to: gate.id });
  return addEdge(g, { type: 'flow', from: gate.id, to: lead });
};

const setMode: Move = (graph, rng) => {
  const editors = editorNodes(graph);
  if (editors.length === 0) return null;
  const approvalMode = randomMode(rng);
  return updateNode(graph, rng.pick(editors).id, (n) =>
    n.type === 'helper' || n.type === 'helper-pool' || n.type === 'tester'
      ? { ...n, approvalMode }
      : n,
  );
};

const togglePlanAuto: Move = (graph) => {
  const gate = firstOfType(graph, 'plan-approval');
  if (gate === undefined) return null;
  return updateNode(graph, gate.id, (n) =>
    n.type === 'plan-approval' ? { ...n, auto: !n.auto } : n,
  );
};

const setAgentConfig: Move = (graph, rng) => {
  const agents = graph.nodes.filter((n) => NODE_CAPABILITIES[n.type].kind !== null);
  if (agents.length === 0) return null;
  const config = randomAgentConfig(rng);
  return updateNode(graph, rng.pick(agents).id, (n) =>
    NODE_CAPABILITIES[n.type].kind === null ? n : { ...n, ...config },
  );
};

const setHelperOptions: Move = (graph, rng) => {
  const helpers = helperNodes(graph);
  if (helpers.length === 0) return null;
  const canStartHelpers = rng.bool();
  const maxInstances = 1 + rng.int(HARD_MAX_HELPERS);
  return updateNode(graph, rng.pick(helpers).id, (n) =>
    n.type === 'helper'
      ? { ...n, canStartHelpers, maxInstances }
      : n.type === 'helper-pool'
        ? { ...n, canStartHelpers }
        : n,
  );
};

/** Every legal move, by name, so a failure can say which moves built the graph. */
export const LEGAL_GRAPH_MOVES: Readonly<Record<string, Move>> = Object.freeze({
  'add named helper': addNamedHelper,
  'add pool': addPool,
  'remove pool': removePool,
  'add change reviewer': addChangeReviewer,
  'retarget review': retargetReview,
  'add rework': addRework,
  'remove rework': removeRework,
  'set rounds': setRounds,
  'add final stage': addFinalStage,
  'remove final stage': removeFinalStage,
  'toggle planner': togglePlanner,
  'set mode': setMode,
  'toggle plan auto': togglePlanAuto,
  'set agent config': setAgentConfig,
  'set helper options': setHelperOptions,
});
const MOVE_NAMES = Object.keys(LEGAL_GRAPH_MOVES);

export interface GenerateGraphOptions {
  /** Exactly this many moves (default: a random number from 0 to `maxMoves`). */
  moves?: number;
  /** The most moves when `moves` is not given (default 12). */
  maxMoves?: number;
}

/**
 * A random valid graph for `seed`: a random template (planner on or off), then random legal moves.
 * Deterministic for a seed. The validator must report no error for it, and `compileWorkflow` must
 * accept it.
 */
export function generateValidGraph(seed: number, opts: GenerateGraphOptions = {}): WorkflowGraph {
  const rng = createGraphRng(seed);
  let graph = workflowTemplate(rng.pick(WORKFLOW_TEMPLATE_IDS), { planner: rng.bool() });
  const moves = opts.moves ?? rng.int((opts.maxMoves ?? 12) + 1);
  for (let i = 0; i < moves; i++) {
    const move = LEGAL_GRAPH_MOVES[rng.pick(MOVE_NAMES)];
    const next = move?.(graph, rng) ?? null;
    if (next !== null) graph = { ...next, template: 'custom' };
  }
  return graph;
}
