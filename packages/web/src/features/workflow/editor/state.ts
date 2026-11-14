import {
  DEFAULT_MAX_REWORK_ROUNDS,
  DEFAULT_WHEN_ROUNDS,
  HARD_MAX_HELPERS,
  MAX_GRAPH_NODES,
  canConnectV3,
  type AgentEffort,
  type ApprovalMode,
  type CheckBlockPlace,
  type CheckFailureRoute,
  type CheckSelection,
  type ManagedProviderId,
  type NodePosition,
  type SkillName,
  type WorkflowEdgeTypeV3,
  type WorkflowEdgeV3,
  type WorkflowGraphV3,
  type WorkflowNodeId,
  type WorkflowNodeV3,
  type WorkflowNodeV3Of,
} from '@acp/core';
import { HARNESS_BLOCKS_COPY, WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import {
  blocksWithoutChangeChecks,
  checkFailureOf,
  checkPlaceOf,
  checkedBlocks,
  checksBlocks,
  editingIds,
  failureRoutes,
  isChangeBlockLink,
  isChecksNode,
  type ChecksNode,
} from '../check-blocks';
import { finishParts } from '../finish';
import { EDITOR_COPY, type PresetKey } from './copy';
import { blockKind, graphRoles, isEditingKind, isFinalKind, type BlockKind } from './roles';

/**
 * The graph editor's state (ADR-0023, ADR-0037; docs/arrows/README.md "Web editor"): the version 3
 * graph being edited, what is selected, and the last refused link. A pure reducer, so every editing
 * rule is tested without React Flow. Whether an arrow may exist is always core's `canConnectV3`,
 * the same check the validator runs, so the editor can never draw an arrow core would refuse.
 *
 * There is one Agent block: its role comes from its arrows (`roles.ts`). The "Add block" menu's
 * presets are an agent with its arrow already drawn, and they keep the forced wiring out of the
 * owner's way where there is only one valid way to do it:
 * - adding the first planner rewires the plan path (`ticket → planner → plan approval → lead`), a
 *   further planner joins it (`ticket → planner`, `planner → plan approval`), and removing the last
 *   one puts `ticket → lead → plan approval` back;
 * - a final reviewer or tester is added just before your merge on the final chain, and removing
 *   one joins the chain around it;
 * - a researcher researches for the first planner, else the lead; a helper gets the lead's
 *   `implement` arrow; a change reviewer reviews the selected (else the first) helper or tester
 *   and sends its findings to the lead.
 * Everything else (custom hand-offs, review routes, rework) is the owner's choice.
 */

export type Selection = { kind: 'node'; id: WorkflowNodeId } | { kind: 'edge'; id: string } | null;

type Graph = WorkflowGraphV3;
type GraphNode = WorkflowNodeV3;
type GraphEdge = WorkflowEdgeV3;
type EdgeType = WorkflowEdgeTypeV3;
type AgentBlock = WorkflowNodeV3Of<'agent'>;

export interface EditorState {
  graph: Graph;
  selection: Selection;
  /** The last refused link, in the owner's words; cleared by the next change. */
  refusal: string | null;
}

/** What the "Add block" menu adds, in its order: the Agent block, then the presets. */
export const PRESET_ITEMS: readonly PresetKey[] = [
  'agent',
  'researcher',
  'planner',
  'helper',
  'change-reviewer',
  'final-reviewer',
  'tester',
];

/** The fields the node panel can change; each is applied only to the blocks that have it. */
export interface NodePatch {
  label?: string;
  model?: string | null;
  skills?: SkillName[];
  agent?: SkillName | null;
  approvalMode?: ApprovalMode | null;
  description?: string;
  maxInstances?: number;
  canStartHelpers?: boolean;
  /** A helper is the helper pool (ADR-0037; at most one per workflow). */
  pool?: boolean;
  auto?: boolean;
  /** A Checks block's selection (ADR-0027 §5); its place and failure route have their own actions. */
  select?: CheckSelection;
  /** An agent block's effort (ADR-0028 §1); null: the model's default (the field is dropped). */
  effort?: AgentEffort | null;
  /** An agent block's provider (ADR-0031); null: the project's default (the field is dropped). */
  provider?: ManagedProviderId | null;
}

/** An arrow's words (ADR-0037 §2): empty text drops the field. */
export interface EdgePatch {
  label?: string;
  purpose?: string;
}

/**
 * The Checks blocks the menu adds (ADR-0028 §2: every one is optional, so each place can be added
 * back when the workflow has none there).
 */
export type CheckBlockItem = CheckBlockPlace;
/** The places a block can move between; the block before the lead's merge stays there. */
export type MovableCheckPlace = Exclude<CheckBlockPlace, 'merge'>;

export type EditorAction =
  /** Load a graph (first load, a template, "restore my earlier setup", a save's answer). */
  | { type: 'replace'; graph: Graph }
  /** Adds the Agent block or a preset; `near` is the selected block (a change reviewer reviews it). */
  | { type: 'add'; item: PresetKey; near?: WorkflowNodeId | undefined }
  | { type: 'remove-node'; id: WorkflowNodeId }
  | { type: 'update-node'; id: WorkflowNodeId; patch: NodePatch }
  | { type: 'update-edge'; id: string; patch: EdgePatch }
  | { type: 'move-node'; id: WorkflowNodeId; position: NodePosition }
  | { type: 'connect'; from: WorkflowNodeId; to: WorkflowNodeId; edgeType: EdgeType }
  /**
   * Moves an end of a link (v0.3.1 P-C): the link `id` becomes `from → to` of `edgeType`, checked
   * with `canConnectV3` on the graph without it; refused, the link stays where it was.
   */
  | { type: 'reconnect'; id: string; from: WorkflowNodeId; to: WorkflowNodeId; edgeType: EdgeType }
  /** Tidy layout (P-C): every block back in the automatic layout (the saved positions go). */
  | { type: 'tidy' }
  | { type: 'refuse'; message: string }
  | { type: 'dismiss-refusal' }
  | { type: 'remove-edge'; id: string }
  | { type: 'set-rounds'; id: string; maxRounds: number }
  /** Adds a Checks block on a change (linked from `near` when it may be) or on the branch. */
  | { type: 'add-checks'; place: CheckBlockItem; near?: WorkflowNodeId | undefined }
  /** Moves a Checks block between a change and the branch, rewiring it; never the merge block. */
  | { type: 'set-check-place'; id: WorkflowNodeId; place: MovableCheckPlace }
  /** A Checks block's failure route; "back to the helper" adds the rework link, others drop it. */
  | { type: 'set-check-failure'; id: WorkflowNodeId; onFailure: CheckFailureRoute }
  | { type: 'select'; selection: Selection }
  /** Clears the selection only when it is still `id` (React Flow sends deselects separately). */
  | { type: 'deselect'; id: string };

export function initialEditorState(graph: Graph): EditorState {
  return { graph, selection: null, refusal: null };
}

// ---------------------------------------------------------------- reading the graph

const ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

function nodeOf(graph: Graph, id: WorkflowNodeId): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function single(graph: Graph, type: GraphNode['type']): GraphNode | undefined {
  const all = graph.nodes.filter((n) => n.type === type);
  return all.length === 1 ? all[0] : undefined;
}

function kindOf(graph: Graph, id: WorkflowNodeId): BlockKind | undefined {
  const node = nodeOf(graph, id);
  return node === undefined ? undefined : blockKind(graph, node);
}

/**
 * Every agent block can be removed, and every Checks block (ADR-0028 §2: none is mandatory); the
 * lead and the steps are in every workflow.
 */
export function isRemovable(node: GraphNode): boolean {
  return node.type === 'agent' || isChecksNode(node);
}

/** A block on the final chain between the ticket merge and your merge (branch checks too). */
function isFinalStage(graph: Graph, node: GraphNode | undefined): boolean {
  if (node === undefined) return false;
  if (isChecksNode(node)) return checkPlaceOf(node) === 'branch';
  return isFinalKind(blockKind(graph, node));
}

function countKinds(graph: Graph, kinds: readonly BlockKind[]): number {
  return graph.nodes.filter((n) => kinds.includes(blockKind(graph, n))).length;
}

/** How many blocks of the preset's role the graph has, and the most it may have (core's counts). */
function countFor(graph: Graph, item: PresetKey): { count: number; max: number } {
  switch (item) {
    case 'helper':
      return { count: countKinds(graph, ['helper']), max: HARD_MAX_HELPERS };
    case 'change-reviewer':
    case 'final-reviewer':
      // Both scopes share the reviewer limit.
      return { count: countKinds(graph, ['reviewer-change', 'reviewer-final']), max: 8 };
    case 'tester':
      return { count: countKinds(graph, ['tester']), max: 2 };
    default:
      return { count: 0, max: MAX_GRAPH_NODES };
  }
}

/** Whether the menu may add a Checks block in this place, and why not (in plain sight). */
export function checksAvailability(
  graph: Graph,
  place: CheckBlockItem,
): { ok: true } | { ok: false; reason: string } {
  const H = HARNESS_BLOCKS_COPY.palette;
  if (graph.nodes.length >= MAX_GRAPH_NODES) {
    return { ok: false, reason: WORKFLOW_GRAPH_COPY.palette.tooManyBlocks(MAX_GRAPH_NODES) };
  }
  if (place === 'branch' || place === 'merge') {
    return checksBlocks(graph).some((b) => checkPlaceOf(b) === place)
      ? { ok: false, reason: place === 'branch' ? H.branchFull : H.mergeFull }
      : { ok: true };
  }
  if (editingIds(graph).size === 0) return { ok: false, reason: H.noEditors };
  return blocksWithoutChangeChecks(graph).length === 0
    ? { ok: false, reason: H.allChecked }
    : { ok: true };
}

/** Whether the menu may add the item, and why not (shown under it). */
export function paletteAvailability(
  graph: Graph,
  item: PresetKey,
): { ok: true } | { ok: false; reason: string } {
  const P = WORKFLOW_GRAPH_COPY.palette;
  if (graph.nodes.length >= MAX_GRAPH_NODES) {
    return { ok: false, reason: P.tooManyBlocks(MAX_GRAPH_NODES) };
  }
  const { count, max } = countFor(graph, item);
  if (count >= max) return { ok: false, reason: P.full(EDITOR_COPY.palette.items[item], max) };
  return { ok: true };
}

const EDGE_TYPE_ORDER: readonly EdgeType[] = [
  'implement',
  'research',
  'plan',
  'review',
  'findings',
  'rework',
  'test',
  'merge',
  'flow',
  'custom',
];

/** The arrow types `canConnectV3` allows from `from` to `to` in `graph`, in a fixed order. */
export function allowedEdgeTypes(
  graph: Graph,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): EdgeType[] {
  return EDGE_TYPE_ORDER.filter((t) => canConnectV3(graph, from, to, t).ok);
}

/** A link the owner draws on the canvas, as it is stored (the Finish block's steps resolved). */
export interface LinkOption {
  from: WorkflowNodeId;
  to: WorkflowNodeId;
  types: EdgeType[];
}

/**
 * The stored ends a link drawn on the canvas stands for (ADR-0028 §3, `finish.ts`): a link to
 * the Finish block ends on the ticket merge when that is allowed, else on your merge; a link from
 * the block that feeds the ticket merge may start at the ticket merge (the next step after it).
 * The first pair core allows wins; null when none is allowed.
 */
export function resolveLink(
  graph: Graph,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): LinkOption | null {
  const parts = finishParts(graph);
  const tos = parts !== null && to === parts.ownerMerge ? [parts.ticketMerge, to] : [to];
  const feeds =
    parts !== null && graph.edges.some((e) => e.from === from && e.to === parts.ticketMerge);
  const froms = feeds && parts !== null ? [from, parts.ticketMerge] : [from];
  for (const f of froms) {
    for (const t of tos) {
      if (f === t) continue;
      const types = allowedEdgeTypes(graph, f, t);
      if (types.length > 0) return { from: f, to: t, types };
    }
  }
  return null;
}

/** The block a refusal names for a link drawn to `to` (the ticket merge for the Finish block). */
export function refusalTarget(graph: Graph, to: WorkflowNodeId): WorkflowNodeId {
  const parts = finishParts(graph);
  return parts !== null && to === parts.ownerMerge ? parts.ticketMerge : to;
}

/** The arrows a block of this kind can start, most likely first (for a refusal's words). */
function outgoingTypes(kind: BlockKind | undefined): readonly EdgeType[] {
  switch (kind) {
    case 'lead':
      return ['implement', 'merge', 'rework', 'flow'];
    case 'researcher':
      return ['research', 'custom'];
    case 'planner':
      return ['plan', 'custom'];
    case 'helper':
    case 'helper-pool':
      return ['review', 'custom'];
    case 'reviewer-change':
      return ['findings', 'rework', 'custom'];
    case 'reviewer-final':
      return ['flow', 'custom'];
    case 'tester':
      return ['review', 'flow', 'custom'];
    case 'agent':
      return ['research', 'plan', 'review', 'custom'];
    case 'mixed':
      return ['custom'];
    default:
      return ['flow'];
  }
}

/**
 * Why no arrow fits from `from` to `to`: core's own message for the kind of arrow the source block
 * most likely meant (a duplicate first, since that is the plainest reason).
 */
export function refusalFor(graph: Graph, from: WorkflowNodeId, to: WorkflowNodeId): string {
  const results = outgoingTypes(kindOf(graph, from)).map((t) => canConnectV3(graph, from, to, t));
  const duplicate = results.find((r) => !r.ok && r.code === 'duplicate-edge');
  const first = duplicate ?? results.find((r) => !r.ok);
  return first !== undefined && !first.ok ? first.message : '';
}

// ---------------------------------------------------------------- building blocks

/** A free id: `base`, else `base-2`, `base-3`…; `numbered` always adds the number. */
function freeId(graph: Graph, base: string, numbered = false): WorkflowNodeId {
  const taken = new Set<string>(graph.nodes.map((n) => n.id));
  if (!numbered && !taken.has(base)) return base;
  for (let i = numbered ? 1 : 2; ; i += 1) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
}

/** The first label `make(n)` gives that no block has yet. */
function freeLabel(graph: Graph, make: (n: number) => string, first = 1): string {
  const taken = new Set(graph.nodes.map((n) => n.label.trim().toLowerCase()));
  for (let i = first; ; i += 1) {
    const label = make(i);
    if (!taken.has(label.toLowerCase())) return label;
  }
}

/** "Planner", then "Planner 2", "Planner 3"… */
function numbered(word: string): (n: number) => string {
  return (n) => (n === 1 ? word : `${word} ${n}`);
}

/** A deterministic, unique link id from its ends (ids match `^[a-z][a-z0-9-]{0,39}$`). */
export function edgeIdFor(
  graph: Graph,
  type: EdgeType,
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
  graph: Graph,
  type: EdgeType,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): GraphEdge {
  const id = edgeIdFor(graph, type, from, to);
  if (type === 'rework') return { type, id, from, to, maxRounds: DEFAULT_MAX_REWORK_ROUNDS };
  // ADR-0038: the editor does not offer When links yet (FR-6, not in EDGE_TYPE_ORDER); one made
  // here starts with a tester's event, which the owner then changes.
  if (type === 'when') {
    return { type, id, from, to, on: ['tests-failed'], maxRounds: DEFAULT_WHEN_ROUNDS };
  }
  return { type, id, from, to };
}

/** Adds an arrow when `canConnectV3` allows it, else leaves the graph as it is. */
function link(graph: Graph, type: EdgeType, from: WorkflowNodeId, to: WorkflowNodeId): Graph {
  if (!canConnectV3(graph, from, to, type).ok) return graph;
  return { ...graph, edges: [...graph.edges, makeEdge(graph, type, from, to)] };
}

function unlink(graph: Graph, keep: (e: GraphEdge) => boolean): Graph {
  return { ...graph, edges: graph.edges.filter(keep) };
}

function isFlow(e: GraphEdge, from: string, to: string): boolean {
  return e.type === 'flow' && e.from === from && e.to === to;
}

const NO_CONFIG = { model: null, skills: [] as SkillName[], agent: null };

/** The new agent block for a menu item, with a free id and label and no position (laid out). */
function newAgent(graph: Graph, item: PresetKey): AgentBlock {
  const L = EDITOR_COPY.palette.newLabels;
  const base = (id: string, label: string): AgentBlock => ({
    type: 'agent',
    id,
    label,
    ...NO_CONFIG,
  });
  switch (item) {
    case 'agent':
      return base(
        freeId(graph, 'agent', true),
        freeLabel(graph, (n) => `${L.agent} ${n}`),
      );
    case 'researcher':
      return base(freeId(graph, 'research'), freeLabel(graph, numbered(L.researcher)));
    case 'planner':
      return base(freeId(graph, 'plan'), freeLabel(graph, numbered(L.planner)));
    case 'helper':
      return {
        ...base(freeId(graph, 'helper', true), freeLabel(graph, L.helper)),
        approvalMode: null,
        description: '',
        maxInstances: 1,
        canStartHelpers: false,
      };
    case 'change-reviewer':
      return base(freeId(graph, 'review'), freeLabel(graph, numbered(L['change-reviewer'])));
    case 'final-reviewer':
      return base(freeId(graph, 'code-review'), freeLabel(graph, numbered(L['final-reviewer'])));
    case 'tester':
      return {
        ...base(freeId(graph, 'unit-tests'), freeLabel(graph, numbered(L.tester))),
        approvalMode: null,
      };
  }
}

// ---------------------------------------------------------------- the forced wiring

function hasPlanner(graph: Graph): boolean {
  return [...graphRoles(graph).kinds.values()].includes('planner');
}

/**
 * Makes `planner` a planner on the plan path: its `plan` arrow to Plan approval and the ticket's
 * flow into it; the first planner also replaces the lead's plan path with `plan approval → lead`.
 */
function wirePlanner(graph: Graph, planner: WorkflowNodeId): Graph {
  const ticket = single(graph, 'ticket');
  const gate = single(graph, 'plan-approval');
  const lead = single(graph, 'lead');
  if (ticket === undefined || gate === undefined || lead === undefined) return graph;
  let g = unlink(graph, (e) => !isFlow(e, ticket.id, lead.id) && !isFlow(e, lead.id, gate.id));
  g = link(g, 'plan', planner, gate.id);
  g = link(g, 'flow', ticket.id, planner);
  if (g.edges.some((e) => isFlow(e, gate.id, lead.id))) return g;
  return link(g, 'flow', gate.id, lead.id);
}

/** Without a planner: `ticket → lead → plan approval`, the lead writes the plan. */
function unwirePlanner(graph: Graph): Graph {
  const ticket = single(graph, 'ticket');
  const gate = single(graph, 'plan-approval');
  const lead = single(graph, 'lead');
  if (ticket === undefined || gate === undefined || lead === undefined) return graph;
  let g = unlink(graph, (e) => !isFlow(e, gate.id, lead.id));
  if (!g.edges.some((e) => isFlow(e, ticket.id, lead.id))) g = link(g, 'flow', ticket.id, lead.id);
  if (!g.edges.some((e) => isFlow(e, lead.id, gate.id))) g = link(g, 'flow', lead.id, gate.id);
  return g;
}

/** A researcher researches for the first planner, else for the lead. */
function wireResearcher(graph: Graph, researcher: WorkflowNodeId): Graph {
  const roles = graphRoles(graph);
  const planner = graph.nodes.find((n) => roles.kinds.get(n.id) === 'planner');
  const target = planner ?? single(graph, 'lead');
  return target === undefined ? graph : link(graph, 'research', researcher, target.id);
}

/** The lead gives the new helper work. */
function wireHelper(graph: Graph, helper: WorkflowNodeId): Graph {
  const lead = single(graph, 'lead');
  return lead === undefined ? graph : link(graph, 'implement', lead.id, helper);
}

/**
 * A change reviewer reviews `near` when it is a helper or tester, else the first one, and sends its
 * findings to the lead. The change no longer goes to the lead first (a change goes to the lead or
 * to reviewers, never both), so its review arrow to the lead goes.
 */
function wireChangeReviewer(graph: Graph, reviewer: WorkflowNodeId, near?: WorkflowNodeId): Graph {
  const lead = single(graph, 'lead');
  const editing = editingIds(graph);
  const author =
    near !== undefined && editing.has(near)
      ? near
      : graph.nodes.find((n) => n.id !== reviewer && editing.has(n.id))?.id;
  if (lead === undefined || author === undefined) return graph;
  const reviewed = link(graph, 'review', author, reviewer);
  if (reviewed === graph) return graph;
  const g = unlink(
    reviewed,
    (e) => !(e.type === 'review' && e.from === author && e.to === lead.id),
  );
  return link(g, 'findings', reviewer, lead.id);
}

/**
 * Puts a new final stage just before your merge: `last → stage → owner merge`, the arrow in of
 * `inType` (`test` makes a tester, `flow` a final reviewer or a branch Checks block).
 */
function insertFinalStage(graph: Graph, stage: WorkflowNodeId, inType: EdgeType = 'flow'): Graph {
  const ownerMerge = single(graph, 'owner-merge');
  if (ownerMerge === undefined) return graph;
  const into = graph.edges.find(
    (e) =>
      e.type === 'flow' &&
      e.to === ownerMerge.id &&
      (nodeOf(graph, e.from)?.type === 'ticket-merge' ||
        isFinalStage(graph, nodeOf(graph, e.from))),
  );
  if (into === undefined) return graph;
  const g = unlink(graph, (e) => e.id !== into.id);
  const first = link(g, inType, into.from, stage);
  const both = link(first, 'flow', stage, ownerMerge.id);
  // Only when both links are allowed: a half-made chain would break your merge's path.
  return both.edges.length === g.edges.length + 2 ? both : graph;
}

/** A block's arrows onward on the final chain (a tester's link to its change block is not). */
function chainLinksFrom(graph: Graph, id: WorkflowNodeId): GraphEdge[] {
  return graph.edges.filter(
    (e) =>
      (e.type === 'flow' || e.type === 'test') && e.from === id && !isChangeBlockLink(graph, e),
  );
}

/** The arrows into a block on the final chain. */
function chainLinksInto(graph: Graph, id: WorkflowNodeId): GraphEdge[] {
  return graph.edges.filter((e) => (e.type === 'flow' || e.type === 'test') && e.to === id);
}

/** Joins the final chain around a block that left it: `prev → next`, with the next one's type. */
function rejoinChain(
  graph: Graph,
  before: readonly GraphEdge[],
  after: readonly GraphEdge[],
): Graph {
  const prev = before.length === 1 ? before[0] : undefined;
  const next = after.length === 1 ? after[0] : undefined;
  if (prev === undefined || next === undefined) return graph;
  return link(graph, next.type === 'test' ? 'test' : 'flow', prev.from, next.to);
}

/**
 * Takes a block off the graph's links (keeps the block): every link to or from it goes, and a
 * final stage's neighbours on the chain are joined again, as when it is removed.
 */
function detach(graph: Graph, id: WorkflowNodeId): Graph {
  const final = isFinalStage(graph, nodeOf(graph, id));
  const before = chainLinksInto(graph, id);
  const after = chainLinksFrom(graph, id);
  const g = unlink(graph, (e) => e.from !== id && e.to !== id);
  return final ? rejoinChain(g, before, after) : g;
}

/** Links a change block from an editing block without one: `near` when it may, else the first. */
function wireChangeBlock(graph: Graph, block: WorkflowNodeId, near?: WorkflowNodeId): Graph {
  const free = blocksWithoutChangeChecks(graph);
  const from = free.find((n) => n.id === near) ?? free[0];
  return from === undefined ? graph : link(graph, 'flow', from.id, block);
}

/** A new Checks block: every required check, the place's default failure route. */
function newChecksNode(graph: Graph, place: CheckBlockItem): ChecksNode {
  const L = HARNESS_BLOCKS_COPY.newLabels;
  return {
    type: 'checks',
    id: freeId(graph, `${place}-checks`),
    label: freeLabel(graph, (n) => (n === 1 ? L[place] : `${L[place]} ${n}`)),
    place,
    select: { kind: 'required' },
    onFailure: failureRoutes(place)[0] ?? 'lead',
  };
}

/**
 * Puts a block before the lead's merge: `lead → block → ticket merge`, in place of the lead's
 * merge straight into the ticket branch. Only when both links are allowed, as for a final stage.
 */
function insertMergeBlock(graph: Graph, block: WorkflowNodeId): Graph {
  const lead = single(graph, 'lead');
  const ticketMerge = single(graph, 'ticket-merge');
  if (lead === undefined || ticketMerge === undefined) return graph;
  const g = unlink(graph, (e) => !(e.from === lead.id && e.to === ticketMerge.id));
  const first = link(g, 'merge', lead.id, block);
  const both = link(first, 'flow', block, ticketMerge.id);
  return both.edges.length === g.edges.length + 2 ? both : graph;
}

/**
 * Without a block before the lead's merge, the lead merges straight into the ticket branch: the
 * link is added when core allows it (ADR-0028 §2), else the problems list says what is missing.
 */
function rejoinLeadMerge(graph: Graph): Graph {
  const lead = single(graph, 'lead');
  const ticketMerge = single(graph, 'ticket-merge');
  if (lead === undefined || ticketMerge === undefined) return graph;
  if (graph.edges.some((e) => e.from === lead.id && e.to === ticketMerge.id)) return graph;
  return link(graph, 'merge', lead.id, ticketMerge.id);
}

function addChecks(
  graph: Graph,
  place: CheckBlockItem,
  near?: WorkflowNodeId,
): { graph: Graph; id: string } {
  const node = newChecksNode(graph, place);
  const g: Graph = { ...graph, nodes: [...graph.nodes, node] };
  return {
    graph:
      place === 'branch'
        ? insertFinalStage(g, node.id)
        : place === 'merge'
          ? insertMergeBlock(g, node.id)
          : wireChangeBlock(g, node.id, near),
    id: node.id,
  };
}

function replaceNode(graph: Graph, node: GraphNode): Graph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === node.id ? node : n)) };
}

/** Moves a change or branch block to the other place, with the other place's wiring. */
function setCheckPlace(graph: Graph, id: WorkflowNodeId, place: MovableCheckPlace): Graph {
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
function setCheckFailure(graph: Graph, id: WorkflowNodeId, onFailure: CheckFailureRoute): Graph {
  const node = nodeOf(graph, id);
  if (!isChecksNode(node) || !failureRoutes(checkPlaceOf(node)).includes(onFailure)) return graph;
  let g = replaceNode(graph, { ...node, onFailure });
  if (onFailure === 'helper') {
    // A rework link back to every block it checks (core's `check-rework`).
    for (const helper of checkedBlocks(g, node)) g = link(g, 'rework', id, helper.id);
  } else {
    g = unlink(g, (e) => !(e.type === 'rework' && e.from === id));
  }
  return g;
}

/** Removes a block and its links; a final stage's neighbours on the chain are joined again. */
function removeNode(graph: Graph, id: WorkflowNodeId): Graph {
  const node = nodeOf(graph, id);
  if (node === undefined || !isRemovable(node)) return graph;
  const kind = blockKind(graph, node);
  const final = isFinalStage(graph, node);
  const before = chainLinksInto(graph, id);
  const after = chainLinksFrom(graph, id);
  let g: Graph = {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
  };
  if (isEditingKind(kind)) {
    // Its change checks block checked only it: it goes too, rather than staying unlinked.
    const orphans = checksBlocks(graph).filter((b) => {
      const checked = checkedBlocks(graph, b);
      return checkPlaceOf(b) === 'change' && checked.length === 1 && checked[0]?.id === id;
    });
    for (const b of orphans) g = removeNode(g, b.id);
  }
  if (kind === 'planner' && !hasPlanner(g)) {
    g = unwirePlanner(g);
  } else if (isChecksNode(node) && checkPlaceOf(node) === 'merge') {
    g = rejoinLeadMerge(g);
  } else if (final) {
    g = rejoinChain(g, before, after);
  }
  return g;
}

function addNode(
  graph: Graph,
  item: PresetKey,
  near?: WorkflowNodeId,
): { graph: Graph; id: string } {
  const node = newAgent(graph, item);
  const g: Graph = { ...graph, nodes: [...graph.nodes, node] };
  switch (item) {
    case 'agent':
      return { graph: g, id: node.id };
    case 'researcher':
      return { graph: wireResearcher(g, node.id), id: node.id };
    case 'planner':
      return { graph: wirePlanner(g, node.id), id: node.id };
    case 'helper':
      return { graph: wireHelper(g, node.id), id: node.id };
    case 'change-reviewer':
      return { graph: wireChangeReviewer(g, node.id, near), id: node.id };
    case 'final-reviewer':
      return { graph: insertFinalStage(g, node.id, 'flow'), id: node.id };
    case 'tester':
      return { graph: insertFinalStage(g, node.id, 'test'), id: node.id };
  }
}

// ---------------------------------------------------------------- node fields

type LaunchNode = WorkflowNodeV3Of<'agent' | 'lead'>;

/** A launch field set, or dropped when null (the project's or model's default). */
function withOptional<N extends LaunchNode, K extends 'effort' | 'provider'>(
  node: N,
  key: K,
  value: N[K] | null | undefined,
): N {
  if (value === undefined) return node;
  const copy = { ...node };
  delete copy[key];
  return value === null ? copy : { ...copy, [key]: value };
}

/** The launch fields every agent and the lead have. */
function patchLaunch<N extends LaunchNode>(node: N, patch: NodePatch): N {
  const next: N = {
    ...node,
    label: patch.label ?? node.label,
    model: patch.model !== undefined ? patch.model : node.model,
    skills: patch.skills ?? node.skills,
    agent: patch.agent !== undefined ? patch.agent : node.agent,
  };
  return withOptional(withOptional(next, 'effort', patch.effort), 'provider', patch.provider);
}

/** Applies the patch's fields that the node has; the others are ignored. */
export function patchNode(node: GraphNode, patch: NodePatch): GraphNode {
  switch (node.type) {
    case 'lead':
      return patchLaunch(node, patch);
    case 'agent': {
      const next: AgentBlock = {
        ...patchLaunch(node, patch),
        ...(patch.approvalMode !== undefined ? { approvalMode: patch.approvalMode } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.maxInstances !== undefined ? { maxInstances: patch.maxInstances } : {}),
        ...(patch.canStartHelpers !== undefined ? { canStartHelpers: patch.canStartHelpers } : {}),
      };
      if (patch.pool === undefined) return next;
      // The pool flag is stored only when set, as core's migration writes it.
      const { pool: _old, ...rest } = next;
      return patch.pool ? { ...rest, pool: true } : rest;
    }
    case 'plan-approval':
      return { ...node, auto: patch.auto ?? node.auto };
    case 'checks':
      return {
        ...node,
        label: patch.label ?? node.label,
        ...(patch.select !== undefined ? { select: patch.select } : {}),
      };
    default:
      // The other steps have nothing the owner sets.
      return node;
  }
}

/** An arrow with the patch's words: set as typed, or dropped when empty. */
export function patchEdge(edge: GraphEdge, patch: EdgePatch): GraphEdge {
  let next: GraphEdge = edge;
  for (const key of ['label', 'purpose'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    const copy = { ...next };
    delete copy[key];
    next = value.trim() === '' ? copy : { ...copy, [key]: value };
  }
  return next;
}

// ---------------------------------------------------------------- the reducer

/** The selection, while what it names is still in the graph. */
export function stillThere(graph: Graph, selection: Selection): Selection {
  if (selection === null) return null;
  const exists =
    selection.kind === 'node'
      ? graph.nodes.some((n) => n.id === selection.id)
      : graph.edges.some((e) => e.id === selection.id);
  return exists ? selection : null;
}

/** A change by hand makes the graph `custom` (`WorkflowGraph.template`); moving a block doesn't. */
function custom(graph: Graph): Graph {
  return graph.template === 'custom' ? graph : { ...graph, template: 'custom' };
}

/** The graph with every block in the automatic layout: the same blocks and links, no positions. */
export function tidyGraph(graph: Graph): Graph {
  if (!graph.nodes.some((n) => n.position !== undefined)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.position === undefined) return n;
      const copy = { ...n };
      delete copy.position;
      return copy;
    }),
  };
}

/**
 * Moves a link's ends: the same place in the list, a fresh id for its new ends, its rounds and its
 * label and purpose kept.
 */
function reconnect(
  graph: Graph,
  id: string,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
  edgeType: EdgeType,
): { graph: Graph; edge: GraphEdge } | { refusal: string } | null {
  const old = graph.edges.find((e) => e.id === id);
  if (old === undefined) return null;
  const without = unlink(graph, (e) => e.id !== id);
  const result = canConnectV3(without, from, to, edgeType);
  if (!result.ok) return { refusal: result.message };
  const made = makeEdge(without, edgeType, from, to);
  const rounds =
    made.type === 'rework' && old.type === 'rework' ? { ...made, maxRounds: old.maxRounds } : made;
  const edge: GraphEdge = {
    ...rounds,
    ...(old.label !== undefined ? { label: old.label } : {}),
    ...(old.purpose !== undefined ? { purpose: old.purpose } : {}),
  };
  return { graph: { ...graph, edges: graph.edges.map((e) => (e.id === id ? edge : e)) }, edge };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const g = state.graph;
  switch (action.type) {
    case 'replace':
      return { graph: action.graph, selection: null, refusal: null };
    case 'add': {
      if (!paletteAvailability(g, action.item).ok) return state;
      const added = addNode(g, action.item, action.near);
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
      // At most one helper pool: a second one is not made.
      if (
        action.patch.pool === true &&
        g.nodes.some((n) => n.id !== action.id && n.type === 'agent' && n.pool === true)
      ) {
        return state;
      }
      const next = patchNode(node, action.patch);
      return {
        ...state,
        graph: custom({ ...g, nodes: g.nodes.map((n) => (n.id === action.id ? next : n)) }),
        refusal: null,
      };
    }
    case 'update-edge': {
      if (!g.edges.some((e) => e.id === action.id)) return state;
      return {
        ...state,
        graph: custom({
          ...g,
          edges: g.edges.map((e) => (e.id === action.id ? patchEdge(e, action.patch) : e)),
        }),
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
      const result = canConnectV3(g, action.from, action.to, action.edgeType);
      if (!result.ok) return { ...state, refusal: result.message };
      const edge = makeEdge(g, action.edgeType, action.from, action.to);
      return {
        graph: custom({ ...g, edges: [...g.edges, edge] }),
        selection: { kind: 'edge', id: edge.id },
        refusal: null,
      };
    }
    case 'reconnect': {
      const r = reconnect(g, action.id, action.from, action.to, action.edgeType);
      if (r === null) return state;
      if ('refusal' in r) return { ...state, refusal: r.refusal };
      return {
        graph: custom(r.graph),
        selection: { kind: 'edge', id: r.edge.id },
        refusal: null,
      };
    }
    case 'tidy': {
      const next = tidyGraph(g);
      return next === g ? state : { ...state, graph: next };
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
export function sameGraph(a: Graph, b: Graph): boolean {
  return stable(a) === stable(b);
}
