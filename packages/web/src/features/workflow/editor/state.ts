import {
  DEFAULT_MAX_REWORK_ROUNDS,
  HARD_MAX_HELPERS,
  MAX_GRAPH_NODES,
  NODE_CAPABILITIES,
  canConnect,
  type ApprovalMode,
  type CheckBlockPlace,
  type CheckFailureRoute,
  type CheckSelection,
  type NodePosition,
  type ReviewerScope,
  type SkillName,
  type WorkflowEdge,
  type WorkflowEdgeType,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeId,
} from '@acp/core';
import { HARNESS_BLOCKS_COPY, WORKFLOW_GRAPH_COPY, type PaletteItemKey } from '../../../lib/copy';
import {
  blocksWithoutChangeChecks,
  checkFailureOf,
  checkPlaceOf,
  checkedBlock,
  checksBlocks,
  failureRoutes,
  isChecksNode,
  isEditingBlock,
  type ChecksNode,
} from '../check-blocks';

/**
 * The graph editor's state (ADR-0023, docs/workflow-graph/README.md §5): the graph being edited,
 * what is selected, and the last refused link. A pure reducer, so every editing rule is tested
 * without React Flow. Whether a link may exist is always core's `canConnect`, the same check the
 * validator and the server run, so the editor can never draw a link the server would refuse.
 *
 * Two conveniences keep the forced wiring out of the owner's way, because there is only one valid
 * way to do it:
 * - adding or removing the planner rewires the plan path (`ticket → planner → plan approval → lead`
 *   with one, `ticket → lead → plan approval` without);
 * - a final reviewer or tester is added just before your merge on the final chain, and removing
 *   one joins the chain around it.
 * Everything else (assigns, review routes, findings, rework) is the owner's choice.
 */

export type Selection = { kind: 'node'; id: WorkflowNodeId } | { kind: 'edge'; id: string } | null;

export interface EditorState {
  graph: WorkflowGraph;
  selection: Selection;
  /** The last refused link, in the owner's words; cleared by the next change. */
  refusal: string | null;
}

/** What a palette item adds, in palette order. */
export const PALETTE_ITEMS: readonly PaletteItemKey[] = [
  'planner',
  'helper',
  'helper-pool',
  'change-reviewer',
  'final-reviewer',
  'tester',
];

/** The fields the node panel can change; each is applied only to the kinds that have it. */
export interface NodePatch {
  label?: string;
  model?: string | null;
  skills?: SkillName[];
  agent?: SkillName | null;
  approvalMode?: ApprovalMode | null;
  description?: string;
  maxInstances?: number;
  canStartHelpers?: boolean;
  scope?: ReviewerScope;
  auto?: boolean;
  /** A Checks block's selection (ADR-0027 §5); its place and failure route have their own actions. */
  select?: CheckSelection;
}

/** The Checks blocks the menu adds (ADR-0027 §5); the one before the lead's merge is fixed. */
export type CheckBlockItem = Exclude<CheckBlockPlace, 'merge'>;

export type EditorAction =
  /** Load a graph (first load, a template, "restore my earlier setup", a save's answer). */
  | { type: 'replace'; graph: WorkflowGraph }
  | { type: 'add'; item: PaletteItemKey }
  | { type: 'remove-node'; id: WorkflowNodeId }
  | { type: 'update-node'; id: WorkflowNodeId; patch: NodePatch }
  | { type: 'move-node'; id: WorkflowNodeId; position: NodePosition }
  | { type: 'connect'; from: WorkflowNodeId; to: WorkflowNodeId; edgeType: WorkflowEdgeType }
  | { type: 'refuse'; message: string }
  | { type: 'dismiss-refusal' }
  | { type: 'remove-edge'; id: string }
  | { type: 'set-rounds'; id: string; maxRounds: number }
  /** Adds a Checks block on a change (linked from `near` when it may be) or on the branch. */
  | { type: 'add-checks'; place: CheckBlockItem; near?: WorkflowNodeId | undefined }
  /** Moves a Checks block between a change and the branch, rewiring it; never the merge block. */
  | { type: 'set-check-place'; id: WorkflowNodeId; place: CheckBlockItem }
  /** A Checks block's failure route; "back to the helper" adds the rework link, others drop it. */
  | { type: 'set-check-failure'; id: WorkflowNodeId; onFailure: CheckFailureRoute }
  | { type: 'select'; selection: Selection }
  /** Clears the selection only when it is still `id` (React Flow sends deselects separately). */
  | { type: 'deselect'; id: string };

export function initialEditorState(graph: WorkflowGraph): EditorState {
  return { graph, selection: null, refusal: null };
}

// ---------------------------------------------------------------- reading the graph

const ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

function nodeOf(graph: WorkflowGraph, id: WorkflowNodeId): WorkflowNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function single(graph: WorkflowGraph, type: WorkflowNode['type']): WorkflowNode | undefined {
  const all = graph.nodes.filter((n) => n.type === type);
  return all.length === 1 ? all[0] : undefined;
}

/**
 * The blocks the palette adds can be removed; the lead and the steps are in every workflow, and so
 * is the Checks block before the lead's merge (ADR-0027 §5: mandatory).
 */
export function isRemovable(node: WorkflowNode): boolean {
  if (isChecksNode(node)) return checkPlaceOf(node) !== 'merge';
  return (
    node.type === 'planner' ||
    node.type === 'helper' ||
    node.type === 'helper-pool' ||
    node.type === 'reviewer' ||
    node.type === 'tester'
  );
}

/** A block on the final chain between the ticket merge and your merge (branch checks too). */
function isFinalStage(node: WorkflowNode | undefined): boolean {
  return (
    node !== undefined &&
    ((node.type === 'reviewer' && node.scope === 'final') ||
      node.type === 'tester' ||
      (isChecksNode(node) && checkPlaceOf(node) === 'branch'))
  );
}

/** How many blocks of the item's kind the graph has, and the most it may have. */
function countFor(graph: WorkflowGraph, item: PaletteItemKey): { count: number; max: number } {
  switch (item) {
    case 'planner':
      return {
        count: graph.nodes.filter((n) => n.type === 'planner').length,
        max: NODE_CAPABILITIES.planner.maxPerGraph,
      };
    case 'helper':
      return {
        count: graph.nodes.filter((n) => n.type === 'helper').length,
        max: Math.min(NODE_CAPABILITIES.helper.maxPerGraph, HARD_MAX_HELPERS),
      };
    case 'helper-pool':
      return {
        count: graph.nodes.filter((n) => n.type === 'helper-pool').length,
        max: NODE_CAPABILITIES['helper-pool'].maxPerGraph,
      };
    case 'change-reviewer':
    case 'final-reviewer':
      // Both scopes are one node type: they share the reviewer limit.
      return {
        count: graph.nodes.filter((n) => n.type === 'reviewer').length,
        max: NODE_CAPABILITIES.reviewer.maxPerGraph,
      };
    case 'tester':
      return {
        count: graph.nodes.filter((n) => n.type === 'tester').length,
        max: NODE_CAPABILITIES.tester.maxPerGraph,
      };
  }
}

/** Whether the menu may add a Checks block in this place, and why not (in plain sight). */
export function checksAvailability(
  graph: WorkflowGraph,
  place: CheckBlockItem,
): { ok: true } | { ok: false; reason: string } {
  const H = HARNESS_BLOCKS_COPY.palette;
  if (graph.nodes.length >= MAX_GRAPH_NODES) {
    return { ok: false, reason: WORKFLOW_GRAPH_COPY.palette.tooManyBlocks(MAX_GRAPH_NODES) };
  }
  if (place === 'branch') {
    return checksBlocks(graph).some((b) => checkPlaceOf(b) === 'branch')
      ? { ok: false, reason: H.branchFull }
      : { ok: true };
  }
  if (!graph.nodes.some(isEditingBlock)) return { ok: false, reason: H.noEditors };
  return blocksWithoutChangeChecks(graph).length === 0
    ? { ok: false, reason: H.allChecked }
    : { ok: true };
}

/** Whether the palette may add the item, and why not (the palette's tooltip). */
export function paletteAvailability(
  graph: WorkflowGraph,
  item: PaletteItemKey,
): { ok: true } | { ok: false; reason: string } {
  const P = WORKFLOW_GRAPH_COPY.palette;
  if (graph.nodes.length >= MAX_GRAPH_NODES) {
    return { ok: false, reason: P.tooManyBlocks(MAX_GRAPH_NODES) };
  }
  const { count, max } = countFor(graph, item);
  if (count >= max) return { ok: false, reason: P.full(P.items[item], max) };
  return { ok: true };
}

/** The edge types `canConnect` allows from `from` to `to` in `graph`, in a fixed order. */
export function allowedEdgeTypes(
  graph: WorkflowGraph,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): WorkflowEdgeType[] {
  return EDGE_TYPE_ORDER.filter((t) => canConnect(graph, from, to, t).ok);
}

const EDGE_TYPE_ORDER: readonly WorkflowEdgeType[] = [
  'assigns',
  'review',
  'findings',
  'rework',
  'merge',
  'flow',
];

/** The link kinds a block of this type can start, most likely first (for a refusal's words). */
function outgoingTypes(node: WorkflowNode): readonly WorkflowEdgeType[] {
  switch (node.type) {
    case 'lead':
      return ['assigns', 'merge', 'rework', 'flow'];
    case 'helper':
    case 'helper-pool':
      return ['review'];
    case 'reviewer':
      return node.scope === 'change' ? ['findings', 'rework'] : ['flow'];
    case 'tester':
      return ['review', 'flow'];
    default:
      return ['flow'];
  }
}

/**
 * Why no link fits from `from` to `to`: `canConnect`'s own message for the kind of link the
 * source block most likely meant (a duplicate first, since that is the plainest reason).
 */
export function refusalFor(graph: WorkflowGraph, from: WorkflowNodeId, to: WorkflowNodeId): string {
  const source = nodeOf(graph, from);
  const kinds = source === undefined ? (['flow'] as const) : outgoingTypes(source);
  const results = kinds.map((t) => canConnect(graph, from, to, t));
  const duplicate = results.find((r) => !r.ok && r.code === 'duplicate-edge');
  const first = duplicate ?? results.find((r) => !r.ok);
  return first !== undefined && !first.ok ? first.message : '';
}

// ---------------------------------------------------------------- building blocks

/** A free id: `base`, else `base-2`, `base-3`…; `numbered` always adds the number. */
function freeId(graph: WorkflowGraph, base: string, numbered = false): WorkflowNodeId {
  const taken = new Set<string>(graph.nodes.map((n) => n.id));
  if (!numbered && !taken.has(base)) return base;
  for (let i = numbered ? 1 : 2; ; i += 1) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
}

/** The first label `make(n)` gives that no block has yet. */
function freeLabel(graph: WorkflowGraph, make: (n: number) => string, first = 1): string {
  const taken = new Set(graph.nodes.map((n) => n.label.trim().toLowerCase()));
  for (let i = first; ; i += 1) {
    const label = make(i);
    if (!taken.has(label.toLowerCase())) return label;
  }
}

/** A deterministic, unique link id from its ends (ids match `^[a-z][a-z0-9-]{0,39}$`). */
export function edgeIdFor(
  graph: WorkflowGraph,
  type: WorkflowEdgeType,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): string {
  const taken = new Set(graph.edges.map((e) => e.id));
  const base = `${type}-${from}-${to}`.slice(0, 40).replace(/-+$/, '');
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const suffix = `-${i}`;
    const id = `${base.slice(0, 40 - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(id) && ID_PATTERN.test(id)) return id;
  }
}

function makeEdge(
  graph: WorkflowGraph,
  type: WorkflowEdgeType,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): WorkflowEdge {
  const id = edgeIdFor(graph, type, from, to);
  return type === 'rework'
    ? { type, id, from, to, maxRounds: DEFAULT_MAX_REWORK_ROUNDS }
    : { type, id, from, to };
}

/** Adds a link when `canConnect` allows it, else leaves the graph as it is. */
function link(
  graph: WorkflowGraph,
  type: WorkflowEdgeType,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): WorkflowGraph {
  if (!canConnect(graph, from, to, type).ok) return graph;
  return { ...graph, edges: [...graph.edges, makeEdge(graph, type, from, to)] };
}

function unlink(graph: WorkflowGraph, keep: (e: WorkflowEdge) => boolean): WorkflowGraph {
  return { ...graph, edges: graph.edges.filter(keep) };
}

function isFlow(e: WorkflowEdge, from: string, to: string): boolean {
  return e.type === 'flow' && e.from === from && e.to === to;
}

const NO_CONFIG = { model: null, skills: [] as SkillName[], agent: null };

/** The new block for a palette item, with a free id and label and no position (laid out). */
function newNode(graph: WorkflowGraph, item: PaletteItemKey): WorkflowNode {
  const L = WORKFLOW_GRAPH_COPY.newLabels;
  switch (item) {
    case 'planner':
      return { type: 'planner', id: freeId(graph, 'plan'), label: L.planner, ...NO_CONFIG };
    case 'helper':
      return {
        type: 'helper',
        id: freeId(graph, 'helper', true),
        label: freeLabel(graph, L.helper),
        ...NO_CONFIG,
        approvalMode: null,
        description: '',
        maxInstances: 1,
        canStartHelpers: false,
      };
    case 'helper-pool':
      return {
        type: 'helper-pool',
        id: freeId(graph, 'helpers'),
        label: L['helper-pool'],
        ...NO_CONFIG,
        approvalMode: null,
        canStartHelpers: true,
      };
    case 'change-reviewer':
      return {
        type: 'reviewer',
        id: freeId(graph, 'review'),
        label: freeLabel(graph, (n) =>
          n === 1 ? L['change-reviewer'] : `${L['change-reviewer']} ${n}`,
        ),
        scope: 'change',
        ...NO_CONFIG,
      };
    case 'final-reviewer':
      return {
        type: 'reviewer',
        id: freeId(graph, 'code-review'),
        label: freeLabel(graph, (n) =>
          n === 1 ? L['final-reviewer'] : `${L['final-reviewer']} ${n}`,
        ),
        scope: 'final',
        ...NO_CONFIG,
      };
    case 'tester':
      return {
        type: 'tester',
        id: freeId(graph, 'unit-tests'),
        label: freeLabel(graph, (n) => (n === 1 ? L.tester : `${L.tester} ${n}`)),
        ...NO_CONFIG,
        approvalMode: null,
      };
  }
}

// ---------------------------------------------------------------- the forced wiring

/** With a planner: `ticket → planner → plan approval → lead`, replacing the lead's plan path. */
function wirePlanner(graph: WorkflowGraph, planner: WorkflowNodeId): WorkflowGraph {
  const ticket = single(graph, 'ticket');
  const gate = single(graph, 'plan-approval');
  const lead = single(graph, 'lead');
  if (ticket === undefined || gate === undefined || lead === undefined) return graph;
  let g = unlink(graph, (e) => !isFlow(e, ticket.id, lead.id) && !isFlow(e, lead.id, gate.id));
  g = link(g, 'flow', ticket.id, planner);
  g = link(g, 'flow', planner, gate.id);
  return link(g, 'flow', gate.id, lead.id);
}

/** Without a planner: `ticket → lead → plan approval`, the lead writes the plan. */
function unwirePlanner(graph: WorkflowGraph): WorkflowGraph {
  const ticket = single(graph, 'ticket');
  const gate = single(graph, 'plan-approval');
  const lead = single(graph, 'lead');
  if (ticket === undefined || gate === undefined || lead === undefined) return graph;
  let g = unlink(graph, (e) => !isFlow(e, gate.id, lead.id));
  if (!g.edges.some((e) => isFlow(e, ticket.id, lead.id))) g = link(g, 'flow', ticket.id, lead.id);
  if (!g.edges.some((e) => isFlow(e, lead.id, gate.id))) g = link(g, 'flow', lead.id, gate.id);
  return g;
}

/** Puts a new final stage just before your merge: `last → stage → owner merge`. */
function insertFinalStage(graph: WorkflowGraph, stage: WorkflowNodeId): WorkflowGraph {
  const ownerMerge = single(graph, 'owner-merge');
  if (ownerMerge === undefined) return graph;
  const into = graph.edges.find(
    (e) =>
      e.type === 'flow' &&
      e.to === ownerMerge.id &&
      (nodeOf(graph, e.from)?.type === 'ticket-merge' || isFinalStage(nodeOf(graph, e.from))),
  );
  if (into === undefined) return graph;
  const g = unlink(graph, (e) => e.id !== into.id);
  const first = link(g, 'flow', into.from, stage);
  const both = link(first, 'flow', stage, ownerMerge.id);
  // Only when both links are allowed: a half-made chain would break your merge's path.
  return both.edges.length === g.edges.length + 2 ? both : graph;
}

/**
 * Takes a block off the graph's links (keeps the block): every link to or from it goes, and a
 * final stage's neighbours on the chain are joined again, as when it is removed.
 */
function detach(graph: WorkflowGraph, id: WorkflowNodeId): WorkflowGraph {
  const node = nodeOf(graph, id);
  const before = graph.edges.filter((e) => e.type === 'flow' && e.to === id);
  const after = graph.edges.filter((e) => e.type === 'flow' && e.from === id);
  let g = unlink(graph, (e) => e.from !== id && e.to !== id);
  if (isFinalStage(node)) {
    const prev = before.length === 1 ? before[0] : undefined;
    const next = after.length === 1 ? after[0] : undefined;
    if (prev !== undefined && next !== undefined) g = link(g, 'flow', prev.from, next.to);
  }
  return g;
}

/** Links a change block from an editing block without one: `near` when it may, else the first. */
function wireChangeBlock(
  graph: WorkflowGraph,
  block: WorkflowNodeId,
  near?: WorkflowNodeId,
): WorkflowGraph {
  const free = blocksWithoutChangeChecks(graph);
  const from = free.find((n) => n.id === near) ?? free[0];
  return from === undefined ? graph : link(graph, 'flow', from.id, block);
}

/** A new Checks block: every required check, the place's default failure route. */
function newChecksNode(graph: WorkflowGraph, place: CheckBlockItem): ChecksNode {
  const L = HARNESS_BLOCKS_COPY.newLabels;
  return {
    type: 'checks',
    id: freeId(graph, place === 'change' ? 'change-checks' : 'branch-checks'),
    label: freeLabel(graph, (n) => (n === 1 ? L[place] : `${L[place]} ${n}`)),
    place,
    select: { kind: 'required' },
    onFailure: failureRoutes(place)[0] ?? 'lead',
  };
}

function addChecks(
  graph: WorkflowGraph,
  place: CheckBlockItem,
  near?: WorkflowNodeId,
): { graph: WorkflowGraph; id: string } {
  const node = newChecksNode(graph, place);
  const g: WorkflowGraph = { ...graph, nodes: [...graph.nodes, node] };
  return {
    graph: place === 'branch' ? insertFinalStage(g, node.id) : wireChangeBlock(g, node.id, near),
    id: node.id,
  };
}

function replaceNode(graph: WorkflowGraph, node: WorkflowNode): WorkflowGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === node.id ? node : n)) };
}

/** Moves a change or branch block to the other place, with the other place's wiring. */
function setCheckPlace(
  graph: WorkflowGraph,
  id: WorkflowNodeId,
  place: CheckBlockItem,
): WorkflowGraph {
  const node = nodeOf(graph, id);
  if (!isChecksNode(node) || checkPlaceOf(node) === 'merge' || checkPlaceOf(node) === place) {
    return graph;
  }
  if (!checksAvailability({ ...graph, nodes: graph.nodes.filter((n) => n.id !== id) }, place).ok) {
    return graph;
  }
  const routes = failureRoutes(place);
  const onFailure = routes.includes(checkFailureOf(node)) ? checkFailureOf(node) : routes[0];
  const moved: ChecksNode = { ...node, place, ...(onFailure !== undefined ? { onFailure } : {}) };
  const g = replaceNode(detach(graph, id), moved);
  return place === 'branch' ? insertFinalStage(g, id) : wireChangeBlock(g, id);
}

/** Sets the failure route; "back to the helper" links the block back to the helper it checks. */
function setCheckFailure(
  graph: WorkflowGraph,
  id: WorkflowNodeId,
  onFailure: CheckFailureRoute,
): WorkflowGraph {
  const node = nodeOf(graph, id);
  if (!isChecksNode(node) || !failureRoutes(checkPlaceOf(node)).includes(onFailure)) return graph;
  let g = replaceNode(graph, { ...node, onFailure });
  if (onFailure === 'helper') {
    const helper = checkedBlock(g, node);
    if (helper !== undefined) g = link(g, 'rework', id, helper.id);
  } else {
    g = unlink(g, (e) => !(e.type === 'rework' && e.from === id));
  }
  return g;
}

/** Removes a block and its links; a final stage's neighbours on the chain are joined again. */
function removeNode(graph: WorkflowGraph, id: WorkflowNodeId): WorkflowGraph {
  const node = nodeOf(graph, id);
  if (node === undefined || !isRemovable(node)) return graph;
  const before = graph.edges.filter((e) => e.type === 'flow' && e.to === id);
  const after = graph.edges.filter((e) => e.type === 'flow' && e.from === id);
  let g: WorkflowGraph = {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
  };
  if (isEditingBlock(node)) {
    // Its change checks block checked only it: it goes too, rather than staying unlinked.
    const orphans = checksBlocks(graph).filter(
      (b) => checkPlaceOf(b) === 'change' && checkedBlock(graph, b)?.id === id,
    );
    for (const b of orphans) g = removeNode(g, b.id);
  }
  if (node.type === 'planner' && !g.nodes.some((n) => n.type === 'planner')) {
    g = unwirePlanner(g);
  } else if (isFinalStage(node)) {
    const prev = before.length === 1 ? before[0] : undefined;
    const next = after.length === 1 ? after[0] : undefined;
    if (prev !== undefined && next !== undefined) g = link(g, 'flow', prev.from, next.to);
  }
  return g;
}

function addNode(graph: WorkflowGraph, item: PaletteItemKey): { graph: WorkflowGraph; id: string } {
  const node = newNode(graph, item);
  let g: WorkflowGraph = { ...graph, nodes: [...graph.nodes, node] };
  if (node.type === 'planner') g = wirePlanner(g, node.id);
  if (isFinalStage(node)) g = insertFinalStage(g, node.id);
  return { graph: g, id: node.id };
}

// ---------------------------------------------------------------- node fields

/** Applies the patch's fields that the node's kind has; the others are ignored. */
export function patchNode(node: WorkflowNode, patch: NodePatch): WorkflowNode {
  const label = patch.label ?? node.label;
  switch (node.type) {
    case 'planner':
    case 'lead':
      return {
        ...node,
        label,
        model: patch.model !== undefined ? patch.model : node.model,
        skills: patch.skills ?? node.skills,
        agent: patch.agent !== undefined ? patch.agent : node.agent,
      };
    case 'reviewer':
      return {
        ...node,
        label,
        model: patch.model !== undefined ? patch.model : node.model,
        skills: patch.skills ?? node.skills,
        agent: patch.agent !== undefined ? patch.agent : node.agent,
        scope: patch.scope ?? node.scope,
      };
    case 'tester':
      return {
        ...node,
        label,
        model: patch.model !== undefined ? patch.model : node.model,
        skills: patch.skills ?? node.skills,
        agent: patch.agent !== undefined ? patch.agent : node.agent,
        approvalMode: patch.approvalMode !== undefined ? patch.approvalMode : node.approvalMode,
      };
    case 'helper-pool':
      return {
        ...node,
        label,
        model: patch.model !== undefined ? patch.model : node.model,
        skills: patch.skills ?? node.skills,
        agent: patch.agent !== undefined ? patch.agent : node.agent,
        approvalMode: patch.approvalMode !== undefined ? patch.approvalMode : node.approvalMode,
        canStartHelpers: patch.canStartHelpers ?? node.canStartHelpers,
      };
    case 'helper':
      return {
        ...node,
        label,
        model: patch.model !== undefined ? patch.model : node.model,
        skills: patch.skills ?? node.skills,
        agent: patch.agent !== undefined ? patch.agent : node.agent,
        approvalMode: patch.approvalMode !== undefined ? patch.approvalMode : node.approvalMode,
        description: patch.description ?? node.description,
        maxInstances: patch.maxInstances ?? node.maxInstances,
        canStartHelpers: patch.canStartHelpers ?? node.canStartHelpers,
      };
    case 'plan-approval':
      return { ...node, auto: patch.auto ?? node.auto };
    case 'checks':
      return { ...node, label, ...(patch.select !== undefined ? { select: patch.select } : {}) };
    default:
      // The other steps have nothing the owner sets.
      return node;
  }
}

// ---------------------------------------------------------------- the reducer

/** The selection, while what it names is still in the graph. */
function stillThere(graph: WorkflowGraph, selection: Selection): Selection {
  if (selection === null) return null;
  const exists =
    selection.kind === 'node'
      ? graph.nodes.some((n) => n.id === selection.id)
      : graph.edges.some((e) => e.id === selection.id);
  return exists ? selection : null;
}

/** A change by hand makes the graph `custom` (`WorkflowGraph.template`); moving a block doesn't. */
function custom(graph: WorkflowGraph): WorkflowGraph {
  return graph.template === 'custom' ? graph : { ...graph, template: 'custom' };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const g = state.graph;
  switch (action.type) {
    case 'replace':
      return { graph: action.graph, selection: null, refusal: null };
    case 'add': {
      if (!paletteAvailability(g, action.item).ok) return state;
      const added = addNode(g, action.item);
      return {
        graph: custom(added.graph),
        selection: { kind: 'node', id: added.id },
        refusal: null,
      };
    }
    case 'remove-node': {
      const node = nodeOf(g, action.id);
      if (node === undefined || !isRemovable(node)) return state;
      const next = removeNode(g, action.id);
      return { graph: custom(next), selection: stillThere(next, state.selection), refusal: null };
    }
    case 'update-node': {
      const node = nodeOf(g, action.id);
      if (node === undefined) return state;
      const next = patchNode(node, action.patch);
      return {
        ...state,
        graph: custom({ ...g, nodes: g.nodes.map((n) => (n.id === action.id ? next : n)) }),
        refusal: null,
      };
    }
    case 'move-node': {
      if (nodeOf(g, action.id) === undefined) return state;
      const position = { x: Math.round(action.position.x), y: Math.round(action.position.y) };
      return {
        ...state,
        graph: { ...g, nodes: g.nodes.map((n) => (n.id === action.id ? { ...n, position } : n)) },
      };
    }
    case 'connect': {
      const result = canConnect(g, action.from, action.to, action.edgeType);
      if (!result.ok) return { ...state, refusal: result.message };
      const edge = makeEdge(g, action.edgeType, action.from, action.to);
      return {
        graph: custom({ ...g, edges: [...g.edges, edge] }),
        selection: { kind: 'edge', id: edge.id },
        refusal: null,
      };
    }
    case 'refuse':
      return { ...state, refusal: action.message };
    case 'dismiss-refusal':
      return { ...state, refusal: null };
    case 'remove-edge': {
      if (!g.edges.some((e) => e.id === action.id)) return state;
      return {
        graph: custom(unlink(g, (e) => e.id !== action.id)),
        selection: state.selection?.id === action.id ? null : state.selection,
        refusal: null,
      };
    }
    case 'set-rounds': {
      const maxRounds = Math.max(0, Math.min(5, Math.round(action.maxRounds)));
      return {
        ...state,
        graph: custom({
          ...g,
          edges: g.edges.map((e) =>
            e.id === action.id && e.type === 'rework' ? { ...e, maxRounds } : e,
          ),
        }),
      };
    }
    case 'add-checks': {
      if (!checksAvailability(g, action.place).ok) return state;
      const added = addChecks(g, action.place, action.near);
      return {
        graph: custom(added.graph),
        selection: { kind: 'node', id: added.id },
        refusal: null,
      };
    }
    case 'set-check-place':
    case 'set-check-failure': {
      const next =
        action.type === 'set-check-place'
          ? setCheckPlace(g, action.id, action.place)
          : setCheckFailure(g, action.id, action.onFailure);
      if (next === g) return state;
      return { ...state, graph: custom(next), refusal: null };
    }
    case 'select':
      return { ...state, selection: action.selection };
    case 'deselect':
      return state.selection?.id === action.id ? { ...state, selection: null } : state;
  }
}

// ---------------------------------------------------------------- comparing graphs

/** JSON with sorted keys, so two graphs built in different orders compare equal. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** True when the two graphs hold the same blocks, links and settings. */
export function sameGraph(a: WorkflowGraph, b: WorkflowGraph): boolean {
  return stable(a) === stable(b);
}
