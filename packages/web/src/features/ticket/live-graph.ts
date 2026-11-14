import {
  FAILURE_EVENT_NAMES,
  type ApprovalMode,
  type NodePosition,
  type WorkflowEdgeTypeV3,
  type WorkflowEdgeV3,
  type WorkflowGraphV3,
  type WorkflowNodeId,
  type WorkflowNodeV3,
  type WorkflowStageId,
} from '@acp/core';
import type {
  AgentRunDto,
  ChangeReviewDto,
  RunDetailDto,
  RunWorkflowGraphDto,
  WorkflowStageState,
} from '@acp/core/api';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { FINISH_COPY, HARNESS_BLOCKS_COPY, WORKFLOW_LIVE_COPY } from '../../lib/copy';
import { isAgentLive } from '../control/run-state';
import { reworkRoundsBy } from '../review-loop/logic';
import { checkPlaceOf, isChecksNode } from '../workflow/check-blocks';
import { graphRoles, isFinalKind, kindIn, type BlockKind } from '../workflow/editor/roles';
import { finishParts, finishView, type FinishParts } from '../workflow/finish';

const G = WORKFLOW_LIVE_COPY.graph;

/*
 * The ticket page's live graph of a run's own workflow (ADR-0023, WG-E): the graph the run
 * snapshotted at start (`GET /api/runs/:id/workflow-graph`), read-only, with each block's state,
 * its agents, the mode each editing block runs with and the rework counts on the rework links.
 * Pure, so it is tested without a canvas. Blocks are square and links differ by their dashes,
 * never by the accent (DESIGN.md, "Agent views"); the same look as the Workflow page's editor.
 * The end of the flow is one Finish block (ADR-0028 §3, `features/workflow/finish.ts`): your merge
 * stands for the ticket merge and Done too, with the run's real target branch. The graph is version
 * 3 (ADR-0037): an agent block is drawn as its derived role (`kind`), researchers included, and an
 * arrow shows the owner's label.
 */

// ---------------------------------------------------------------- layout

export const AGENT_W = 240;
/** Room for the kind, the name, the model, the skills, the mode and the agents. */
export const AGENT_H = 156;
export const GATE_W = 156;
export const GATE_H = 72;
/** Ticket and Done are pills: they are not agents. */
export const END_W = 120;
export const END_H = 44;
export const CHECKS_W = 204;
/** The Finish block: "Finish", "Merge into <target> or open a pull request", then Done. */
export const FINISH_W = 300;
export const FINISH_H = 76;
const COL_GAP = 44;
const ROW_GAP = 76;
/** Room between stacked blocks for a rework link's label. */
const STACK_GAP = 40;

export function isGateNode(node: WorkflowNodeV3): boolean {
  return (
    node.type === 'ticket' ||
    node.type === 'plan-approval' ||
    node.type === 'checks' ||
    node.type === 'ticket-merge' ||
    node.type === 'owner-merge' ||
    node.type === 'done' ||
    // ADR-0038 §4: a routing block with no agent of its own.
    node.type === 'author'
  );
}

export function blockSize(node: WorkflowNodeV3): { width: number; height: number } {
  if (node.type === 'ticket' || node.type === 'done') return { width: END_W, height: END_H };
  if (node.type === 'owner-merge') return { width: FINISH_W, height: FINISH_H };
  // A Checks block names its place ("Checks before merge"), so it is wider than the other steps.
  if (node.type === 'checks') return { width: CHECKS_W, height: GATE_H };
  if (isGateNode(node)) return { width: GATE_W, height: GATE_H };
  return { width: AGENT_W, height: AGENT_H };
}

/** A block's kind: an agent block's derived role (ADR-0037), else its type. */
export function liveKind(graph: WorkflowGraphV3, node: WorkflowNodeV3): BlockKind {
  return kindIn(graphRoles(graph), node);
}

/**
 * The final reviewers and testers in chain order (flow and test links from the ticket merge),
 * then the rest.
 */
function finalChain(graph: WorkflowGraphV3): WorkflowNodeV3[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const isFinalStage = (n: WorkflowNodeV3) => isFinalKind(liveKind(graph, n));
  const out: WorkflowNodeV3[] = [];
  const seen = new Set<WorkflowNodeId>();
  let current: WorkflowNodeV3 | undefined = graph.nodes.find((n) => n.type === 'ticket-merge');
  while (current !== undefined) {
    const from: WorkflowNodeId = current.id;
    const next: WorkflowNodeV3 | undefined = graph.edges
      .filter((e) => (e.type === 'flow' || e.type === 'test') && e.from === from)
      .map((e) => byId.get(e.to))
      .find((n): n is WorkflowNodeV3 => n !== undefined && isFinalStage(n) && !seen.has(n.id));
    if (next === undefined) break;
    seen.add(next.id);
    out.push(next);
    current = next;
  }
  return [...out, ...graph.nodes.filter((n) => isFinalStage(n) && !seen.has(n.id))];
}

/**
 * Where each block is drawn: where the owner put it in the editor, else in three rows that read
 * like lines of text (the editor's automatic layout):
 *
 *   Ticket → (researchers →) (planners →) Plan approval   (each stacked)
 *   Lead → helpers (stacked) → change reviewers (stacked)
 *   Checks → final reviewers and testers → Finish
 *
 * The steps the Finish block stands for (the ticket merge and Done) take its position.
 */
export function layoutLiveGraph(graph: WorkflowGraphV3): Map<WorkflowNodeId, NodePosition> {
  const of = (kind: BlockKind) => graph.nodes.filter((n) => liveKind(graph, n) === kind);
  const finish = finishParts(graph);
  const rows: WorkflowNodeV3[][][] = [
    [of('ticket'), of('researcher'), of('planner'), of('plan-approval')],
    [of('lead'), [...of('helper'), ...of('helper-pool')], of('reviewer-change'), of('author')],
    finish === null
      ? [
          of('checks'),
          of('ticket-merge'),
          ...finalChain(graph).map((n) => [n]),
          [...of('owner-merge'), ...of('done')],
        ]
      : [of('checks'), ...finalChain(graph).map((n) => [n]), of('owner-merge')],
  ].map((row) => row.filter((cell) => cell.length > 0));
  const positions = new Map<WorkflowNodeId, NodePosition>();
  let top = 0;
  for (const row of rows) {
    // The first block of every cell sits on one line; a stack continues below it.
    const lineH = Math.max(0, ...row.map((cell) => (cell[0] ? blockSize(cell[0]).height : 0)));
    let rowH = 0;
    row.forEach((cell, c) => {
      const first = cell[0];
      let y = top + (first === undefined ? 0 : (lineH - blockSize(first).height) / 2);
      for (const node of cell) {
        const { width, height } = blockSize(node);
        positions.set(
          node.id,
          node.position ?? { x: c * (AGENT_W + COL_GAP) + (AGENT_W - width) / 2, y },
        );
        rowH = Math.max(rowH, y + height - top);
        y += height + STACK_GAP;
      }
    });
    if (row.length > 0) top += rowH + ROW_GAP;
  }
  const at = finish === null ? undefined : positions.get(finish.ownerMerge);
  graph.nodes.forEach((node, i) => {
    if (at !== undefined && (node.id === finish?.ticketMerge || node.id === finish?.done)) {
      positions.set(node.id, at);
    } else if (!positions.has(node.id)) {
      positions.set(node.id, node.position ?? { x: i * (AGENT_W + COL_GAP), y: top });
    }
  });
  return positions;
}

/**
 * The Finish block's state from its three steps: done once Done is reached; else your merge's
 * state while it has one (waiting for you, working, failed); else a failed ticket merge; else
 * waiting.
 */
export function finishState(
  parts: FinishParts,
  states: ReadonlyMap<WorkflowNodeId, { state: WorkflowStageState }>,
): WorkflowStageState {
  const of = (id: WorkflowNodeId) => states.get(id)?.state ?? 'waiting';
  if (of(parts.done) === 'done') return 'done';
  const owner = of(parts.ownerMerge);
  if (owner !== 'waiting' && owner !== 'off') return owner;
  return of(parts.ticketMerge) === 'failed' ? 'failed' : 'waiting';
}

// ---------------------------------------------------------------- blocks

export interface LiveBlockData {
  [key: string]: unknown;
  node: WorkflowNodeV3;
  /** What the block is: an agent block's derived role (ADR-0037), else its type. */
  kind: BlockKind;
  state: WorkflowStageState;
  /** This block's agents, in the run's order. */
  agents: readonly AgentRunDto[];
  /** Editing blocks: the mode this run gives them (after the ticket's and run's limits). */
  mode: ApprovalMode | null;
  sandbox: boolean;
  /** A change reviewer that sends changes back to its helpers itself (review route "direct"). */
  direct: boolean;
  /** The Finish block's target branch (the run's), null while not known. */
  target: string | null;
}

export type LiveBlock = Node<LiveBlockData, 'agent' | 'gate' | 'finish'>;

export interface LiveLinkData {
  [key: string]: unknown;
  type: WorkflowEdgeTypeV3;
  /** The owner's words on the arrow (ADR-0037 §2): what flows and why. */
  purpose: string | null;
  /** A rework link from a change reviewer: its rounds go straight back to the helper. */
  direct: boolean;
  /** Rework links: rounds sent back along this link so far. */
  reworks: number;
}

export type LiveLink = Edge<LiveLinkData>;

export interface LiveGraph {
  nodes: LiveBlock[];
  edges: LiveLink[];
  /** The laid-out size, so the canvas can take the graph's shape. */
  width: number;
  height: number;
}

/** A rework link's source is a review agent (not the lead or a Checks block). */
function isReviewerNode(graph: WorkflowGraphV3, node: WorkflowNodeV3 | undefined): boolean {
  if (node === undefined) return false;
  const kind = liveKind(graph, node);
  return kind === 'reviewer-change' || kind === 'reviewer-final';
}

/** A change reviewer with a rework link reworks those helpers directly (route "direct"). */
function directReviewers(graph: WorkflowGraphV3): Set<WorkflowNodeId> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return new Set(
    graph.edges
      .filter((e) => e.type === 'rework' && isReviewerNode(graph, byId.get(e.from)))
      .map((e) => e.from),
  );
}

/**
 * Rounds sent back along each rework link: a change reviewer's link counts the rounds the review
 * agent sent straight back to that helper's changes, the lead's link the lead's own. The owner's
 * extra rounds are on the change cards, not on a link.
 */
export function reworkCounts(
  graph: WorkflowGraphV3,
  nodes: RunWorkflowGraphDto['nodes'],
  changes: readonly ChangeReviewDto[],
): Map<string, number> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodeOfAgent = new Map<string, WorkflowNodeId>();
  for (const n of nodes) {
    // The Author block lists fixers that belong to their own helper block (ADR-0038 §4).
    if (byId.get(n.nodeId)?.type === 'author') continue;
    for (const id of n.agentRunIds) nodeOfAgent.set(id, n.nodeId);
  }
  const out = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.type !== 'rework') continue;
    const decider = isReviewerNode(graph, byId.get(e.from)) ? 'reviewer' : 'lead';
    const n = changes
      .filter((c) => nodeOfAgent.get(c.agentRunId) === e.to)
      .reduce((sum, c) => sum + reworkRoundsBy(c, decider), 0);
    out.set(e.id, n);
  }
  return out;
}

// ---------------------------------------------------------------- links

const LINK_LOOK: Readonly<
  Record<WorkflowEdgeTypeV3, { stroke: string; width: number; dash?: string }>
> = {
  flow: { stroke: 'var(--color-dim)', width: 1.75 },
  plan: { stroke: 'var(--color-dim)', width: 1.75 },
  test: { stroke: 'var(--color-dim)', width: 1.75 },
  implement: { stroke: 'var(--color-ink)', width: 1.5 },
  review: { stroke: 'var(--color-dim)', width: 1.5, dash: '6 4' },
  findings: { stroke: 'var(--color-dim)', width: 1.5, dash: '2 4' },
  rework: { stroke: 'var(--color-ink)', width: 1.5, dash: '7 5' },
  merge: { stroke: 'var(--color-ink)', width: 2.25 },
  // ADR-0037: as on the Workflow page, dash-dotted research and dash-dot-dotted hand-offs.
  research: { stroke: 'var(--color-dim)', width: 1.75, dash: '10 3 1 3' },
  custom: { stroke: 'var(--color-ink)', width: 1.5, dash: '8 3 1 3 1 3' },
  // ADR-0038: failure routing, red and dashed as in the editor.
  when: { stroke: 'var(--color-danger)', width: 1.5, dash: '5 4' },
};

/**
 * Which sides a link leaves and enters by: the links going back to a reviewer (findings, a review
 * sent to the lead) loop over the top and rework underneath, so they never sit on the forward
 * links; a forward link to the right joins side to side, one to the next row goes down.
 */
function handlesFor(
  e: WorkflowEdgeV3,
  byId: ReadonlyMap<string, WorkflowNodeV3>,
  positions: ReadonlyMap<string, NodePosition>,
): { sourceHandle: string; targetHandle: string } {
  const to = byId.get(e.to);
  if (e.type === 'findings' || (e.type === 'review' && to?.type === 'lead')) {
    return { sourceHandle: 'out-top', targetHandle: 'in-top' };
  }
  if (e.type === 'rework') return { sourceHandle: 'out-bottom', targetHandle: 'in-bottom' };
  const from = byId.get(e.from);
  const a = positions.get(e.from);
  const b = positions.get(e.to);
  if (from === undefined || a === undefined || b === undefined) {
    return { sourceHandle: 'out', targetHandle: 'in' };
  }
  if (b.x >= a.x + blockSize(from).width) return { sourceHandle: 'out', targetHandle: 'in' };
  if (b.y > a.y) return { sourceHandle: 'out-bottom', targetHandle: 'in-top' };
  return { sourceHandle: 'out-top', targetHandle: 'in-bottom' };
}

// ---------------------------------------------------------------- the graph

/** The run's graph as React Flow blocks and links. */
export function buildLiveGraph(
  dto: RunWorkflowGraphDto,
  run: Pick<RunDetailDto, 'agents'> & Partial<Pick<RunDetailDto, 'changes' | 'ticketBranch'>>,
): LiveGraph {
  const { graph } = dto;
  const positions = layoutLiveGraph(graph);
  const states = new Map(dto.nodes.map((n) => [n.nodeId, n]));
  const direct = directReviewers(graph);
  const counts = reworkCounts(graph, dto.nodes, run.changes ?? []);
  // As drawn: the Finish block in place of the end steps.
  const view = finishView(graph);
  const byId = new Map(view.graph.nodes.map((n) => [n.id, n]));
  const target = run.ticketBranch?.baseBranch ?? null;

  const nodes = view.graph.nodes.map((node): LiveBlock => {
    const live = states.get(node.id);
    const ids = new Set(live?.agentRunIds ?? []);
    const { width, height } = blockSize(node);
    const finish = view.finish !== null && node.id === view.finish.ownerMerge;
    const kind = liveKind(graph, node);
    return {
      id: node.id,
      type: finish ? 'finish' : isGateNode(node) ? 'gate' : 'agent',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      width,
      height,
      draggable: false,
      connectable: false,
      selectable: false,
      ariaLabel: finish ? FINISH_COPY.label(target) : `${kindWord(node, kind)}: ${node.label}`,
      data: {
        node,
        kind,
        // A block the server does not list has not been reached.
        state:
          finish && view.finish !== null
            ? finishState(view.finish, states)
            : (live?.state ?? 'waiting'),
        agents: run.agents.filter((a) => ids.has(a.id)),
        mode: live?.approvalMode ?? null,
        sandbox: live?.sandbox === true,
        direct: direct.has(node.id),
        target,
      },
    };
  });

  const edges = view.graph.edges.map((e): LiveLink => {
    const look = LINK_LOOK[e.type];
    const isDirect = e.type === 'rework' && isReviewerNode(graph, byId.get(e.from));
    const reworks = counts.get(e.id) ?? 0;
    // A rework link shows its rounds; a When link its events and rounds (ADR-0038 §4); any other
    // link the owner's label (ADR-0037 §2).
    const label =
      e.type === 'rework'
        ? isDirect
          ? G.directRework(reworks)
          : G.rework(reworks)
        : e.type === 'when'
          ? whenLabel(e)
          : (e.label ?? undefined);
    const purpose = e.purpose ?? null;
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      ...handlesFor(e, byId, positions),
      // `LiveGraphNodes.liveLinkTypes`: a step line whose purpose is its hover text.
      type: 'link',
      selectable: false,
      focusable: false,
      ariaLabel: G.linkName(
        e.label ?? G.links[e.type],
        labelOf(byId, e.from),
        labelOf(byId, e.to),
        purpose,
      ),
      className: `live-link-${e.type}${isDirect ? ' live-link-direct' : ''}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: look.stroke, width: 16, height: 16 },
      style: {
        stroke: look.stroke,
        strokeWidth: look.width,
        ...(look.dash !== undefined ? { strokeDasharray: look.dash } : {}),
      },
      ...(label !== undefined
        ? {
            label,
            labelStyle: { fill: 'var(--color-ink)', fontSize: 12 },
            labelBgStyle: { fill: 'var(--color-panel)' },
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 2,
          }
        : {}),
      data: { type: e.type, purpose, direct: isDirect, reworks },
    };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + (n.width ?? 0));
    maxY = Math.max(maxY, n.position.y + (n.height ?? 0));
  }
  return {
    nodes,
    edges,
    width: minX === Infinity ? 0 : maxX - minX,
    height: minY === Infinity ? 0 : maxY - minY,
  };
}

/** A When link's words: the owner's label first, then its events and rounds. */
function whenLabel(e: Extract<WorkflowEdgeV3, { type: 'when' }>): string {
  const words = G.when(
    e.on.map((ev) => FAILURE_EVENT_NAMES[ev]),
    e.maxRounds,
  );
  return e.label === undefined ? words : `${e.label} · ${words}`;
}

/** A block's name in a link's spoken name: the Finish block by its title. */
function labelOf(byId: ReadonlyMap<string, WorkflowNodeV3>, id: string): string {
  const node = byId.get(id);
  if (node === undefined) return id;
  return node.type === 'owner-merge' ? FINISH_COPY.title : node.label;
}

/** The word for a block's kind ("Change reviewer", "Researcher", "You", "Checks before merge"). */
export function kindWord(node: WorkflowNodeV3, kind: BlockKind): string {
  if (isChecksNode(node)) return HARNESS_BLOCKS_COPY.kinds[checkPlaceOf(node)];
  return G.kinds[kind];
}

/** The agent a click on a block shows: the one working now, else the newest. */
export function agentToShow(agents: readonly AgentRunDto[]): AgentRunDto | undefined {
  return agents.find((a) => isAgentLive(a.status)) ?? agents[agents.length - 1];
}

/**
 * The version 1 stage nearest to a block, for the side panel: a change reviewer's agent opens on
 * its change (`review`), every other block on its agent. A researcher has no version 1 stage: it
 * opens on its agent, as the lead's does.
 */
export function stageOfBlock(kind: BlockKind): WorkflowStageId {
  switch (kind) {
    case 'planner':
      return 'plan';
    case 'reviewer-change':
      return 'review';
    case 'reviewer-final':
      return 'code-review';
    case 'tester':
      return 'unit-tests';
    case 'helper':
    case 'helper-pool':
      return 'helpers';
    default:
      return 'orchestrate';
  }
}

/**
 * A final reviewer or tester a restart held (ADR-0021): the run waits in REVIEW, the block waits
 * for the owner and none of its agents works. The tester's own change is decided elsewhere, so a
 * tester that already ran is not held.
 */
export function heldBlock(
  dto: Pick<RunWorkflowGraphDto, 'graph' | 'nodes'>,
  run: Pick<RunDetailDto, 'status' | 'agents'>,
): WorkflowNodeV3 | null {
  if (run.status !== 'REVIEW') return null;
  const states = new Map(dto.nodes.map((n) => [n.nodeId, n]));
  for (const node of finalChain(dto.graph)) {
    const live = states.get(node.id);
    if (live?.state !== 'needs-you') continue;
    const agents = run.agents.filter((a) => live.agentRunIds.includes(a.id));
    if (liveKind(dto.graph, node) === 'tester' && agents.length > 0) continue;
    if (agents.some((a) => isAgentLive(a.status))) continue;
    return node;
  }
  return null;
}
