import { HARD_MAX_HELPERS } from '../../workspace.js';
import {
  NODE_CAPABILITIES,
  WORKFLOW_TEMPLATE_IDS,
  type CheckFailureRoute,
  type CheckSelection,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeId,
} from '../../workflow-graph.js';
import { workflowTemplate } from '../templates.js';
import {
  addEdge,
  addMergeBlock,
  addNode,
  blockInputs,
  chainIds,
  changeBlockOf,
  changeBlocks,
  changeReviewers,
  checkBlocksAt,
  dropOrphanCheckBlocks,
  editorNodes,
  firstOfType,
  freshId,
  hasEdge,
  helperNodes,
  leadId,
  mergeBlock,
  nodesOfType,
  pickOptional,
  randomAgentConfig,
  randomMode,
  removeEdges,
  removeMergeBlock,
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
  return dropOrphanCheckBlocks(dropUnusedReviewers(removeNode(graph, pool.id)));
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
  // A Checks block's rework links follow its failure route (`setCheckFailureRoute`).
  const blocks = new Set(changeBlocks(graph).map((n) => n.id));
  const reworks = graph.edges.filter((e) => e.type === 'rework' && !blocks.has(e.from));
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
  return dropOrphanCheckBlocks(dropUnusedReviewers(g));
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

// ---------------------------------------------------------------- Checks blocks (ADR-0027 §5)

const SELECTIONS: readonly CheckSelection[] = [
  { kind: 'required' },
  { kind: 'ids', ids: ['lint'] },
  { kind: 'ids', ids: ['lint', 'unit'] },
  { kind: 'labels', labels: ['fast'] },
  { kind: 'labels', labels: ['fast', 'full'] },
];

/** The optional fields of a `checks` node, left out when undefined (exact optional types). */
function blockFields(
  select: CheckSelection | undefined,
  onFailure: CheckFailureRoute | undefined,
): { select?: CheckSelection; onFailure?: CheckFailureRoute } {
  return {
    ...(select !== undefined ? { select } : {}),
    ...(onFailure !== undefined ? { onFailure } : {}),
  };
}

/** Rework links from a change block to each node it checks, when its route is the helper. */
function withBlockReworks(
  graph: WorkflowGraph,
  blockId: WorkflowNodeId,
  rng: GraphRng,
): WorkflowGraph {
  let g = removeEdges(graph, (e) => e.type === 'rework' && e.from === blockId);
  const block = g.nodes.find((n) => n.id === blockId);
  if (block?.type !== 'checks' || block.onFailure !== 'helper') return g;
  for (const input of blockInputs(g, blockId)) {
    g = addEdge(g, { type: 'rework', from: blockId, to: input, maxRounds: rng.int(6) });
  }
  return g;
}

/** A change block on an editing node without one: a new block, or one another node uses. */
const addChangeChecks: Move = (graph, rng) => {
  const free = editorNodes(graph).filter((n) => changeBlockOf(graph, n.id) === undefined);
  if (free.length === 0) return null;
  const editor = rng.pick(free);
  const existing = changeBlocks(graph);
  if (existing.length > 0 && rng.bool(0.3)) {
    const block = rng.pick(existing);
    const g = addEdge(graph, { type: 'flow', from: editor.id, to: block.id });
    return withBlockReworks(g, block.id, rng);
  }
  const id = freshId(graph, 'change-checks');
  const onFailure = pickOptional<CheckFailureRoute>(rng, ['lead', 'owner', 'helper']);
  let g = addNode(graph, {
    type: 'checks',
    id,
    label: 'Fast checks',
    place: 'change',
    ...blockFields(pickOptional(rng, SELECTIONS), onFailure),
  });
  g = addEdge(g, { type: 'flow', from: editor.id, to: id });
  return withBlockReworks(g, id, rng);
};

const removeChangeChecks: Move = (graph, rng) => {
  const blocks = changeBlocks(graph);
  return blocks.length === 0 ? null : removeNode(graph, rng.pick(blocks).id);
};

const setCheckFailureRoute: Move = (graph, rng) => {
  const blocks = changeBlocks(graph);
  if (blocks.length === 0) return null;
  const block = rng.pick(blocks);
  const onFailure = rng.pick<CheckFailureRoute>(['lead', 'owner', 'helper']);
  const g = updateNode(graph, block.id, (n) => (n.type === 'checks' ? { ...n, onFailure } : n));
  return withBlockReworks(g, block.id, rng);
};

const setCheckSelection: Move = (graph, rng) => {
  const blocks = nodesOfType(graph, 'checks');
  if (blocks.length === 0) return null;
  const select = rng.pick(SELECTIONS);
  return updateNode(graph, rng.pick(blocks).id, (n) =>
    n.type === 'checks' ? { ...n, select } : n,
  );
};

/** The block before the merge: today's default fields, or `merge` and a route spelled out. */
const setMergeChecks: Move = (graph, rng) => {
  const block = mergeBlock(graph);
  if (block === undefined) return null;
  const onFailure = pickOptional<CheckFailureRoute>(rng, ['lead', 'owner']);
  return updateNode(graph, block.id, (n) =>
    n.type === 'checks'
      ? {
          type: 'checks',
          id: n.id,
          label: n.label,
          ...(n.position !== undefined ? { position: n.position } : {}),
          ...(rng.bool() ? { place: 'merge' as const } : {}),
          ...blockFields(n.select, onFailure),
        }
      : n,
  );
};

const addBranchChecks: Move = (graph, rng) => {
  if (checkBlocksAt(graph, 'branch').length > 0) return null;
  const chain = chainIds(graph);
  const at = rng.int(chain.length - 1);
  const before = chain[at];
  const after = chain[at + 1];
  if (before === undefined || after === undefined) return null;
  const id = freshId(graph, 'branch-checks');
  let g = removeEdges(graph, (e) => e.type === 'flow' && e.from === before && e.to === after);
  g = addNode(g, {
    type: 'checks',
    id,
    label: 'Full checks',
    place: 'branch',
    ...blockFields(pickOptional(rng, SELECTIONS), pickOptional<CheckFailureRoute>(rng, ['owner'])),
  });
  g = addEdge(g, { type: 'flow', from: before, to: id });
  return addEdge(g, { type: 'flow', from: id, to: after });
};

const removeBranchChecks: Move = (graph) => {
  const block = checkBlocksAt(graph, 'branch')[0];
  if (block === undefined) return null;
  const before = graph.edges.find((e) => e.type === 'flow' && e.to === block.id)?.from;
  const after = graph.edges.find((e) => e.type === 'flow' && e.from === block.id)?.to;
  if (before === undefined || after === undefined) return null;
  return addEdge(removeNode(graph, block.id), { type: 'flow', from: before, to: after });
};

/** The Checks block moves, used only with `checkBlocks: true`. */
const CHECK_BLOCK_MOVES: Readonly<Record<string, Move>> = Object.freeze({
  'add change checks': addChangeChecks,
  'remove change checks': removeChangeChecks,
  'set check failure route': setCheckFailureRoute,
  'set check selection': setCheckSelection,
  'set merge checks': setMergeChecks,
  'add branch checks': addBranchChecks,
  'remove branch checks': removeBranchChecks,
});

// ---------------------------------------------------------------- optional checks (ADR-0028 §2)

/** No block before the merge: the lead merges straight into the ticket merge. */
const removeMergeChecks: Move = (graph) => removeMergeBlock(graph);

/** A block before the merge again, on a graph without one. */
const addMergeChecks: Move = (graph, rng) =>
  addMergeBlock(graph, {
    type: 'checks',
    id: freshId(graph, 'merge-checks'),
    label: 'Checks',
    ...(rng.bool() ? { place: 'merge' as const } : {}),
    ...blockFields(
      pickOptional(rng, SELECTIONS),
      pickOptional<CheckFailureRoute>(rng, ['lead', 'owner']),
    ),
  });

/** The optional-checks moves, used only with `optionalChecks: true`. */
const OPTIONAL_CHECK_MOVES: Readonly<Record<string, Move>> = Object.freeze({
  'remove merge checks': removeMergeChecks,
  'add merge checks': addMergeChecks,
});

const BASE_MOVES: Readonly<Record<string, Move>> = Object.freeze({
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

/** Every legal move, by name, so a failure can say which moves built the graph. */
export const LEGAL_GRAPH_MOVES: Readonly<Record<string, Move>> = Object.freeze({
  ...BASE_MOVES,
  ...CHECK_BLOCK_MOVES,
  ...OPTIONAL_CHECK_MOVES,
});
// Each list keeps the order it had before the later moves were added, so a seed's graph is the
// same as before them for the options it was generated with.
const MOVE_NAMES = Object.keys(BASE_MOVES);
const MOVE_NAMES_WITH_CHECKS = [...MOVE_NAMES, ...Object.keys(CHECK_BLOCK_MOVES)];
const MOVE_NAMES_WITH_OPTIONAL_CHECKS = [
  ...MOVE_NAMES_WITH_CHECKS,
  ...Object.keys(OPTIONAL_CHECK_MOVES),
];

export interface GenerateGraphOptions {
  /** Exactly this many moves (default: a random number from 0 to `maxMoves`). */
  moves?: number;
  /** The most moves when `moves` is not given (default 12). */
  maxMoves?: number;
  /**
   * Also use the Checks block moves (ADR-0027 §5): change blocks, failure routes, selections, the
   * block on the ticket branch. Off by default, so a seed's graph stays the one it was before them.
   */
  checkBlocks?: boolean;
  /**
   * Also remove and add the block before the lead's merge (ADR-0028 §2), with every Checks block
   * move (implies `checkBlocks`). Off by default, so a seed's graph stays the one it was before.
   */
  optionalChecks?: boolean;
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
  const names =
    opts.optionalChecks === true
      ? MOVE_NAMES_WITH_OPTIONAL_CHECKS
      : opts.checkBlocks === true
        ? MOVE_NAMES_WITH_CHECKS
        : MOVE_NAMES;
  for (let i = 0; i < moves; i++) {
    const move = LEGAL_GRAPH_MOVES[rng.pick(names)];
    const next = move?.(graph, rng) ?? null;
    if (next !== null) graph = { ...next, template: 'custom' };
  }
  return graph;
}
