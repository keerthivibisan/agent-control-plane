import type {
  ApprovalMode,
  NodePosition,
  WorkflowEdgeType,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeId,
} from '@acp/core';
import { MarkerType, type Edge } from '@xyflow/react';
import { FINISH_COPY, WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { finishIssues, finishView } from '../finish';
import { linkStroke } from './edges';
import { isGateType, layoutGraph, sizeOf } from './layout';
import { planLinks, type Route } from './routing';
import { isRemovable, resolveLink, type Selection } from './state';
import type { EditorIssue } from './IssuesList';
import { kindWord, type BlockNode, type LinkTarget } from './nodes';

const G = WORKFLOW_GRAPH_COPY;

/**
 * The graph as React Flow nodes and edges (pure, so it is tested without a canvas). Links look
 * different by kind through their dashes and weight, never by the accent (DESIGN.md, "Agent
 * views"): the accent marks only the selection. A link the rules refuse is drawn in the danger tone,
 * because it is a real problem the owner has to fix. Where each link runs is `routing.ts`.
 *
 * The end of the flow is drawn as one Finish block (ADR-0028 §3, `finish.ts`): the functions take
 * the stored graph and draw its Finish view, and a problem with a hidden step shows on the block.
 */

export interface LinkData {
  [key: string]: unknown;
  type: WorkflowEdgeType;
  refused: boolean;
  /** The planned route (its kind and lane), drawn from the handles' live positions. */
  route: Route;
  /** Faded: another block or link is selected, or a link is being dragged. */
  dim: boolean;
}
export type LinkEdge = Edge<LinkData, 'link'>;

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
  /** The project's default target branch for the Finish block's words; null: not known. */
  target?: string | null;
}

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

/**
 * Where a dragged link may end: with `from` the block a link is being dragged from, every other
 * block is a valid target when `canConnect` allows at least one kind of link to it (the same
 * check the drop runs), else invalid. Null while nothing is being dragged.
 */
export function linkTargets(
  graph: WorkflowGraph,
  from: WorkflowNodeId | null,
): ReadonlyMap<WorkflowNodeId, LinkTarget> | null {
  if (from === null || !graph.nodes.some((n) => n.id === from)) return null;
  return new Map(
    finishView(graph).graph.nodes.map((n): [WorkflowNodeId, LinkTarget] => [
      n.id,
      n.id === from ? 'source' : resolveLink(graph, from, n.id) !== null ? 'valid' : 'invalid',
    ]),
  );
}

export function toFlowNodes(
  graph: WorkflowGraph,
  issues: readonly EditorIssue[],
  selection: Selection,
  ctx: BlockContext,
  positions: ReadonlyMap<string, NodePosition> = layoutGraph(graph),
  connectFrom: WorkflowNodeId | null = null,
): BlockNode[] {
  const targets = linkTargets(graph, connectFrom);
  const view = finishView(graph);
  const shown = finishIssues(issues, graph, view);
  const target = ctx.target ?? null;
  return view.graph.nodes.map((node) => {
    const mine = shown.filter((i) => i.nodeId === node.id);
    const { width, height } = sizeOf(node);
    const agent = 'skills' in node;
    const linkTarget = targets?.get(node.id) ?? null;
    const finish = view.finish !== null && node.id === view.finish.ownerMerge;
    return {
      id: node.id,
      type: finish ? 'finish' : isGateType(node.type) ? 'gate' : 'agent',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      width,
      height,
      selected: selection?.kind === 'node' && selection.id === node.id,
      deletable: isRemovable(node),
      ariaLabel: finish ? FINISH_COPY.label(target) : `${kindWord(node)}: ${node.label}`,
      ...(linkTarget === 'valid' ? { className: 'link-target-valid' } : {}),
      data: {
        node,
        problems: mine.filter((i) => i.severity === 'error').length,
        warnings: mine.filter((i) => i.severity === 'warning').length,
        // Errors first, as in the problems list.
        messages: [
          ...mine.filter((i) => i.severity === 'error'),
          ...mine.filter((i) => i.severity === 'warning'),
        ].map((i) => i.message),
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
        linkTarget,
        target,
      },
    };
  });
}

/** The link kinds whose shape makes a refused link: drawn in the danger tone. */
const REFUSED_CODES = new Set([
  'edge-not-allowed',
  'duplicate-edge',
  'self-edge',
  'edge-unknown-node',
]);

export function toFlowEdges(
  graph: WorkflowGraph,
  issues: readonly EditorIssue[],
  selection: Selection,
  positions: ReadonlyMap<string, NodePosition> = layoutGraph(graph),
  connecting = false,
): LinkEdge[] {
  const view = finishView(graph);
  const labels = new Map(
    view.graph.nodes.map((n) => [
      n.id,
      view.finish !== null && n.id === view.finish.ownerMerge ? FINISH_COPY.title : n.label,
    ]),
  );
  const refusedIds = new Set(
    finishIssues(issues, graph, view)
      .filter((i) => i.edgeId !== undefined && REFUSED_CODES.has(i.code))
      .map((i) => i.edgeId),
  );
  const plan = planLinks(view.graph, positions);
  return view.graph.edges.map((e) => {
    const selected = selection?.kind === 'edge' && selection.id === e.id;
    const refused = refusedIds.has(e.id);
    const link = plan.get(e.id);
    // While a block or link is selected, the links that don't touch it fade back.
    const dim =
      connecting ||
      (selection?.kind === 'node' && e.from !== selection.id && e.to !== selection.id) ||
      (selection?.kind === 'edge' && !selected);
    const label = e.type === 'rework' ? G.rework(e.maxRounds) : undefined;
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      sourceHandle: link?.sourceHandle ?? 'out',
      targetHandle: link?.targetHandle ?? 'in',
      type: 'link',
      selected,
      // A selected link is drawn above the others.
      zIndex: selected ? 1 : 0,
      ariaLabel: G.edgeName(
        G.edges[e.type],
        labels.get(e.from) ?? e.from,
        labels.get(e.to) ?? e.to,
      ),
      className: `link-${e.type}`,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: linkStroke(e.type, selected, refused),
        width: 14,
        height: 14,
      },
      ...(label !== undefined ? { label } : {}),
      data: { type: e.type, refused, route: link?.route ?? { kind: 'side', lane: 0 }, dim },
    };
  });
}
