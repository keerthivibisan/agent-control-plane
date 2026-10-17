import type { ApprovalMode, WorkflowEdgeType, WorkflowGraph, WorkflowNode } from '@acp/core';
import { MarkerType, type Edge } from '@xyflow/react';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { isGateType, layoutGraph, sizeOf } from './layout';
import { isRemovable, type Selection } from './state';
import type { EditorIssue } from './IssuesList';
import { kindWord, type BlockNode } from './nodes';

const G = WORKFLOW_GRAPH_COPY;

/**
 * The graph as React Flow nodes and edges (pure, so it is tested without a canvas). Links look
 * different by kind through their dashes and weight, never by the accent (DESIGN.md, "Agent
 * views"): lime marks only the selection. A link the rules refuse is drawn in the danger tone,
 * because it is a real problem the owner has to fix.
 */

export interface LinkData {
  [key: string]: unknown;
  type: WorkflowEdgeType;
  refused: boolean;
}
export type LinkEdge = Edge<LinkData>;

/** What the canvas needs to describe blocks besides the graph. */
export interface BlockContext {
  /** The project's skills and agent files; undefined: unknown, so nothing is flagged. */
  skills: readonly string[] | undefined;
  agents: readonly string[] | undefined;
  /** Agent files' own models, when the list is known (`GET …/agents`). */
  agentModels: ReadonlyMap<string, string | null> | undefined;
  projectModel: string | null;
  projectMode: ApprovalMode | null;
  helperLimit: number;
}

export const EDGE_LOOK: Readonly<
  Record<
    WorkflowEdgeType,
    {
      stroke: string;
      width: number;
      dash?: string;
      sourceHandle: string;
      targetHandle: string;
    }
  >
> = {
  flow: { stroke: 'var(--color-dim)', width: 1.75, sourceHandle: 'out', targetHandle: 'in' },
  assigns: { stroke: 'var(--color-ink)', width: 1.5, sourceHandle: 'out', targetHandle: 'in' },
  review: {
    stroke: 'var(--color-dim)',
    width: 1.5,
    dash: '6 4',
    sourceHandle: 'out',
    targetHandle: 'in',
  },
  // The links that go back: findings over the top, rework underneath.
  findings: {
    stroke: 'var(--color-dim)',
    width: 1.5,
    dash: '2 4',
    sourceHandle: 'out-top',
    targetHandle: 'in-top',
  },
  rework: {
    stroke: 'var(--color-ink)',
    width: 1.5,
    dash: '7 5',
    sourceHandle: 'out-bottom',
    targetHandle: 'in-bottom',
  },
  merge: { stroke: 'var(--color-ink)', width: 2.25, sourceHandle: 'out', targetHandle: 'in' },
};

/** The model a block's agent gets: its own, else its agent file's, else the project's. */
export function blockModel(
  node: WorkflowNode,
  ctx: Pick<BlockContext, 'agentModels' | 'projectModel'>,
): { text: string; own: boolean } {
  if (!('model' in node)) return { text: '', own: false };
  if (node.model !== null) return { text: node.model, own: true };
  const fileModel = node.agent === null ? null : (ctx.agentModels?.get(node.agent) ?? null);
  if (fileModel !== null) return { text: G.fileModel(fileModel), own: true };
  return {
    text: ctx.projectModel === null ? G.projectModel : G.projectModelNamed(ctx.projectModel),
    own: false,
  };
}

export function toFlowNodes(
  graph: WorkflowGraph,
  issues: readonly EditorIssue[],
  selection: Selection,
  ctx: BlockContext,
): BlockNode[] {
  const positions = layoutGraph(graph);
  return graph.nodes.map((node) => {
    const mine = issues.filter((i) => i.nodeId === node.id);
    const { width, height } = sizeOf(node);
    const agent = 'skills' in node;
    return {
      id: node.id,
      type: isGateType(node.type) ? 'gate' : 'agent',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      width,
      height,
      selected: selection?.kind === 'node' && selection.id === node.id,
      deletable: isRemovable(node),
      ariaLabel: `${kindWord(node)}: ${node.label}`,
      data: {
        node,
        problems: mine.filter((i) => i.severity === 'error').length,
        warnings: mine.filter((i) => i.severity === 'warning').length,
        missingSkills:
          agent && ctx.skills !== undefined
            ? node.skills.filter((s) => !(ctx.skills ?? []).includes(s))
            : [],
        agentMissing:
          agent &&
          node.agent !== null &&
          ctx.agents !== undefined &&
          !ctx.agents.includes(node.agent),
        model: blockModel(node, ctx),
        projectMode: ctx.projectMode,
        helperLimit: ctx.helperLimit,
      },
    };
  });
}

export function toFlowEdges(
  graph: WorkflowGraph,
  issues: readonly EditorIssue[],
  selection: Selection,
): LinkEdge[] {
  const labels = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const refusedIds = new Set(
    issues
      .filter(
        (i) =>
          i.edgeId !== undefined &&
          (i.code === 'edge-not-allowed' ||
            i.code === 'duplicate-edge' ||
            i.code === 'self-edge' ||
            i.code === 'edge-unknown-node'),
      )
      .map((i) => i.edgeId),
  );
  const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
  return graph.edges.map((e) => {
    // A review sent to the lead goes back to it, over the top like the findings.
    const look =
      e.type === 'review' && types.get(e.to) === 'lead'
        ? { ...EDGE_LOOK.review, sourceHandle: 'out-top', targetHandle: 'in-top' }
        : EDGE_LOOK[e.type];
    const selected = selection?.kind === 'edge' && selection.id === e.id;
    const refused = refusedIds.has(e.id);
    const stroke = selected ? 'var(--color-accent)' : refused ? 'var(--color-danger)' : look.stroke;
    const label = e.type === 'rework' ? G.rework(e.maxRounds) : undefined;
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      sourceHandle: look.sourceHandle,
      targetHandle: look.targetHandle,
      type: 'step',
      selected,
      ariaLabel: G.edgeName(
        G.edges[e.type],
        labels.get(e.from) ?? e.from,
        labels.get(e.to) ?? e.to,
      ),
      className: `link-${e.type}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      style: {
        stroke,
        strokeWidth: selected ? look.width + 0.75 : look.width,
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
      data: { type: e.type, refused },
    };
  });
}
