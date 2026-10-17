import type {
  ApprovalMode,
  NodePosition,
  WorkflowEdge,
  WorkflowEdgeType,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeId,
  WorkflowStageId,
} from '@acp/core';
import type {
  AgentRunDto,
  ChangeReviewDto,
  RunDetailDto,
  RunWorkflowGraphDto,
  WorkflowStageState,
} from '@acp/core/api';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { WORKFLOW_LIVE_COPY } from '../../lib/copy';
import { isAgentLive } from '../control/run-state';
import { reworkRoundsBy } from '../review-loop/logic';

const G = WORKFLOW_LIVE_COPY.graph;

/*
 * The ticket page's live graph of a run's own workflow (ADR-0023, WG-E): the graph the run
 * snapshotted at start (`GET /api/runs/:id/workflow-graph`), read-only, with each block's state,
 * its agents, the mode each editing block runs with and the rework counts on the rework links.
 * Pure, so it is tested without a canvas. Blocks are square and links differ by their dashes,
 * never by the accent (DESIGN.md, "Agent views"); the same look as the Workflow page's editor.
 */

// ---------------------------------------------------------------- layout

export const AGENT_W = 208;
/** Room for the kind, the name, the model, the skills, the mode and the agents. */
export const AGENT_H = 156;
export const GATE_W = 156;
export const GATE_H = 72;
/** Ticket and Done are pills: they are not agents. */
export const END_W = 120;
export const END_H = 44;
const COL_GAP = 44;
const ROW_GAP = 76;
const STACK_GAP = 28;

export function isGateNode(node: WorkflowNode): boolean {
  return (
    node.type === 'ticket' ||
    node.type === 'plan-approval' ||
    node.type === 'checks' ||
    node.type === 'ticket-merge' ||
    node.type === 'owner-merge' ||
    node.type === 'done'
  );
}

export function blockSize(node: WorkflowNode): { width: number; height: number } {
  if (node.type === 'ticket' || node.type === 'done') return { width: END_W, height: END_H };
  if (isGateNode(node)) return { width: GATE_W, height: GATE_H };
  return { width: AGENT_W, height: AGENT_H };
}

function isFinalStage(node: WorkflowNode): boolean {
  return (node.type === 'reviewer' && node.scope === 'final') || node.type === 'tester';
}

/** The final reviewers and testers in chain order (flow links from the ticket merge), then the rest. */
function finalChain(graph: WorkflowGraph): WorkflowNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: WorkflowNode[] = [];
  const seen = new Set<WorkflowNodeId>();
  let current: WorkflowNode | undefined = graph.nodes.find((n) => n.type === 'ticket-merge');
  while (current !== undefined) {
    const from: WorkflowNodeId = current.id;
    const next: WorkflowNode | undefined = graph.edges
      .filter((e) => e.type === 'flow' && e.from === from)
      .map((e) => byId.get(e.to))
      .find((n): n is WorkflowNode => n !== undefined && isFinalStage(n) && !seen.has(n.id));
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
 *   Ticket → (Planner →) Plan approval
 *   Lead → helpers (stacked) → change reviewers (stacked)
 *   Checks → Ticket branch → final reviewers and testers → Your merge (Done under it)
 */
export function layoutLiveGraph(graph: WorkflowGraph): Map<WorkflowNodeId, NodePosition> {
  const of = (type: WorkflowNode['type']) => graph.nodes.filter((n) => n.type === type);
  const rows: WorkflowNode[][][] = [
    [of('ticket'), of('planner'), of('plan-approval')],
    [
      of('lead'),
      [...of('helper'), ...of('helper-pool')],
      graph.nodes.filter((n) => n.type === 'reviewer' && n.scope === 'change'),
    ],
    [
      of('checks'),
      of('ticket-merge'),
      ...finalChain(graph).map((n) => [n]),
      [...of('owner-merge'), ...of('done')],
    ],
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
  graph.nodes.forEach((node, i) => {
    if (!positions.has(node.id)) {
      positions.set(node.id, node.position ?? { x: i * (AGENT_W + COL_GAP), y: top });
    }
  });
  return positions;
}

// ---------------------------------------------------------------- blocks

export interface LiveBlockData {
  [key: string]: unknown;
  node: WorkflowNode;
  state: WorkflowStageState;
  /** This block's agents, in the run's order. */
  agents: readonly AgentRunDto[];
  /** Editing blocks: the mode this run gives them (after the ticket's and run's limits). */
  mode: ApprovalMode | null;
  sandbox: boolean;
  /** A change reviewer that sends changes back to its helpers itself (review route "direct"). */
  direct: boolean;
}

export type LiveBlock = Node<LiveBlockData, 'agent' | 'gate'>;

export interface LiveLinkData {
  [key: string]: unknown;
  type: WorkflowEdgeType;
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

/** A change reviewer with a rework link reworks those helpers directly (route "direct"). */
function directReviewers(graph: WorkflowGraph): Set<WorkflowNodeId> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return new Set(
    graph.edges
      .filter((e) => e.type === 'rework' && byId.get(e.from)?.type === 'reviewer')
      .map((e) => e.from),
  );
}

/**
 * Rounds sent back along each rework link: a change reviewer's link counts the rounds the review
 * agent sent straight back to that helper's changes, the lead's link the lead's own. The owner's
 * extra rounds are on the change cards, not on a link.
 */
export function reworkCounts(
  graph: WorkflowGraph,
  nodes: RunWorkflowGraphDto['nodes'],
  changes: readonly ChangeReviewDto[],
): Map<string, number> {
  const nodeOfAgent = new Map<string, WorkflowNodeId>();
  for (const n of nodes) for (const id of n.agentRunIds) nodeOfAgent.set(id, n.nodeId);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.type !== 'rework') continue;
    const decider = byId.get(e.from)?.type === 'reviewer' ? 'reviewer' : 'lead';
    const n = changes
      .filter((c) => nodeOfAgent.get(c.agentRunId) === e.to)
      .reduce((sum, c) => sum + reworkRoundsBy(c, decider), 0);
    out.set(e.id, n);
  }
  return out;
}

// ---------------------------------------------------------------- links

const LINK_LOOK: Readonly<
  Record<WorkflowEdgeType, { stroke: string; width: number; dash?: string }>
> = {
  flow: { stroke: 'var(--color-dim)', width: 1.75 },
  assigns: { stroke: 'var(--color-ink)', width: 1.5 },
  review: { stroke: 'var(--color-dim)', width: 1.5, dash: '6 4' },
  findings: { stroke: 'var(--color-dim)', width: 1.5, dash: '2 4' },
  rework: { stroke: 'var(--color-ink)', width: 1.5, dash: '7 5' },
  merge: { stroke: 'var(--color-ink)', width: 2.25 },
};

/**
 * Which sides a link leaves and enters by: the links going back to a reviewer (findings, a review
 * sent to the lead) loop over the top and rework underneath, so they never sit on the forward
 * links; a forward link to the right joins side to side, one to the next row goes down.
 */
function handlesFor(
  e: WorkflowEdge,
  byId: ReadonlyMap<string, WorkflowNode>,
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
  run: Pick<RunDetailDto, 'agents'> & Partial<Pick<RunDetailDto, 'changes'>>,
): LiveGraph {
  const { graph } = dto;
  const positions = layoutLiveGraph(graph);
  const states = new Map(dto.nodes.map((n) => [n.nodeId, n]));
  const direct = directReviewers(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const counts = reworkCounts(graph, dto.nodes, run.changes ?? []);

  const nodes = graph.nodes.map((node): LiveBlock => {
    const live = states.get(node.id);
    const ids = new Set(live?.agentRunIds ?? []);
    const { width, height } = blockSize(node);
    return {
      id: node.id,
      type: isGateNode(node) ? 'gate' : 'agent',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      width,
      height,
      draggable: false,
      connectable: false,
      selectable: false,
      ariaLabel: `${kindWord(node)}: ${node.label}`,
      data: {
        node,
        // A block the server does not list has not been reached.
        state: live?.state ?? 'waiting',
        agents: run.agents.filter((a) => ids.has(a.id)),
        mode: live?.approvalMode ?? null,
        sandbox: live?.sandbox === true,
        direct: direct.has(node.id),
      },
    };
  });

  const edges = graph.edges.map((e): LiveLink => {
    const look = LINK_LOOK[e.type];
    const isDirect = e.type === 'rework' && byId.get(e.from)?.type === 'reviewer';
    const reworks = counts.get(e.id) ?? 0;
    const label =
      e.type === 'rework' ? (isDirect ? G.directRework(reworks) : G.rework(reworks)) : undefined;
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      ...handlesFor(e, byId, positions),
      type: 'step',
      selectable: false,
      focusable: false,
      ariaLabel: G.linkName(
        G.links[e.type],
        byId.get(e.from)?.label ?? e.from,
        byId.get(e.to)?.label ?? e.to,
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
      data: { type: e.type, direct: isDirect, reworks },
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

/** The word for a block's kind ("Change reviewer", "You"). */
export function kindWord(node: WorkflowNode): string {
  if (node.type === 'reviewer') {
    return node.scope === 'change' ? G.kinds['reviewer-change'] : G.kinds['reviewer-final'];
  }
  return G.kinds[node.type];
}

/** The agent a click on a block shows: the one working now, else the newest. */
export function agentToShow(agents: readonly AgentRunDto[]): AgentRunDto | undefined {
  return agents.find((a) => isAgentLive(a.status)) ?? agents[agents.length - 1];
}

/**
 * The version 1 stage nearest to a block, for the side panel: a change reviewer's agent opens on
 * its change (`review`), every other block on its agent.
 */
export function stageOfBlock(node: WorkflowNode): WorkflowStageId {
  switch (node.type) {
    case 'planner':
      return 'plan';
    case 'reviewer':
      return node.scope === 'change' ? 'review' : 'code-review';
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
): WorkflowNode | null {
  if (run.status !== 'REVIEW') return null;
  const states = new Map(dto.nodes.map((n) => [n.nodeId, n]));
  for (const node of finalChain(dto.graph)) {
    const live = states.get(node.id);
    if (live?.state !== 'needs-you') continue;
    const agents = run.agents.filter((a) => live.agentRunIds.includes(a.id));
    if (node.type === 'tester' && agents.length > 0) continue;
    if (agents.some((a) => isAgentLive(a.status))) continue;
    return node;
  }
  return null;
}
