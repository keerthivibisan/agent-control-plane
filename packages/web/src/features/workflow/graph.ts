import type {
  ChangeReviewerMode,
  ProjectAgentSetup,
  ProjectWorkflow,
  SkillName,
  WorkflowStageId,
} from '@acp/core';
import type { RunWorkflowDto } from '@acp/core/api';
import { MarkerType, type Edge, type Node } from '@xyflow/react';

/**
 * The Workflow page's process graph (docs/history/redesign/README.md §4.2, ADR-0019), built only
 * from data: the project's workflow (stages on or off, planner mode, models, skills, agent files)
 * and its agent setup (helpers, depth, budget, allowlist). Nothing here is hardcoded per project,
 * so the ticket page's live graph and a later editable workflow (README §7a) can reuse the same
 * nodes and edges.
 *
 * Layout: three rows that read left to right, like lines of text, so the graph stays readable at
 * 1024px without zooming far out:
 *
 *   Ticket → Plan → You approve (⟲ changes)
 *   Orchestrate → Helpers ×N → Review & merge
 *   Final code review → Unit tests → Done
 *
 * The flow wraps from the end of one row to the start of the next. A stage that is off is dimmed;
 * the edges that touch it are faint, and a dashed "off" edge carries the flow around it.
 */

/** The agent stages with their own panel settings (every stage but `review`). */
export type AgentStageId = Exclude<WorkflowStageId, 'review'>;
export const AGENT_STAGES: readonly AgentStageId[] = [
  'plan',
  'orchestrate',
  'helpers',
  'code-review',
  'unit-tests',
];
export const OPTIONAL_STAGES: readonly AgentStageId[] = ['code-review', 'unit-tests'];

/** The agent role each node shows (README §4.2 table). `helper` is `worker` in the engine. */
export type WorkflowRole = 'planner' | 'lead' | 'helper' | 'reviewer' | 'tester';
/** Where the agent works: read-only in your project, or in its own git worktree. */
export type AgentWorkspace = 'read-only' | 'own-worktree';

/** What the graph needs from the workflow; a draft that isn't saved yet works too. */
export type WorkflowShape = Pick<ProjectWorkflow, 'plannerMode' | 'stages'>;
/** What the graph needs from the agent setup. */
export type SetupShape = Pick<
  ProjectAgentSetup,
  'maxConcurrentHelpers' | 'maxDepth' | 'defaultBudgetTokensPerAgent' | 'model' | 'allowlist'
>;

/** The agent part of a stage node. */
export type StageAgent = {
  role: WorkflowRole;
  workspace: AgentWorkspace;
  /** The stage's own model; null means the project default. */
  model: string | null;
  /** The project default (`setup.model`); null means Claude Code's default. */
  projectModel: string | null;
  skill: SkillName | null;
  /** The mapped skill isn't among the project's skills; the agent starts without it (ADR-0019 §4). */
  skillMissing: boolean;
  /** The stage's agent file (`.claude/agents/<name>.md`, ADR-0019 §6); null when it has none. */
  agent: SkillName | null;
  /** The named agent file isn't among the project's agent files; the agent starts without it. */
  agentMissing: boolean;
  /**
   * The agent file's own model, which the stage uses when it has none of its own (stage > file >
   * project). Undefined when the project's agent files aren't known to the caller.
   */
  agentModel: string | null | undefined;
};

/** What the graph needs from one project agent file (`AgentDefinitionSummaryDto`). */
export interface AgentFileRef {
  name: string;
  model: string | null;
}

export type AgentNodeData = StageAgent & {
  stage: Exclude<AgentStageId, 'helpers'>;
  /** Always true for plan and orchestrate. */
  enabled: boolean;
  optional: boolean;
  /**
   * `plannerMode: 'lead'`: Plan and Orchestrate are one lead agent. This names the other stage
   * that agent covers; null when the stage has an agent of its own.
   */
  sameAgentAs: 'plan' | 'orchestrate' | null;
};

export type HelpersNodeData = StageAgent & {
  stage: 'helpers';
  maxHelpers: number;
  maxDepth: number;
  budgetTokensPerAgent: number;
  allowlist: SetupShape['allowlist'];
};

export interface HelperNodeData {
  [key: string]: unknown;
  /** 1-based. */
  index: number;
  /** `maxDepth` 2: this helper may start its own helpers. */
  nested: boolean;
}

export interface GateNodeData {
  [key: string]: unknown;
  /**
   * `plan-approval`: the owner's plan approval, part of the plan stage, with no settings of its
   * own. `owner-merge` (ADR-0021 §4): the owner's one merge of the ticket branch into main, just
   * before Done.
   */
  gate: 'plan-approval' | 'owner-merge';
}

/**
 * The review loop (ADR-0021 §3), when the graph shows it: who reviews each change and the rework
 * limit; on the ticket page also the run's counts. Absent for a run from before the loop, whose
 * graph stays as it always was.
 */
export interface ReviewLoopShape {
  reviewer: ChangeReviewerMode;
  maxReworkRounds: number;
  /** The run's changes per part of the loop (`RunWorkflowDto.review`); absent on the Workflow page. */
  counts?: NonNullable<RunWorkflowDto['review']> | undefined;
  /** The label of the "rework" edge from Review back to Helpers. */
  reworkLabel: string;
}

export interface ReviewNodeData {
  [key: string]: unknown;
  stage: 'review';
  requireChecks: true;
  loop?: Omit<ReviewLoopShape, 'reworkLabel'>;
}

export interface TerminalNodeData {
  [key: string]: unknown;
  terminal: 'ticket' | 'done';
}

export type AgentNode = Node<AgentNodeData, 'agent'>;
export type HelpersNode = Node<HelpersNodeData, 'helpers'>;
export type HelperNode = Node<HelperNodeData, 'helper'>;
export type GateNode = Node<GateNodeData, 'gate'>;
export type ReviewNode = Node<ReviewNodeData, 'review'>;
export type TerminalNode = Node<TerminalNodeData, 'terminal'>;
export type WorkflowNode =
  AgentNode | HelpersNode | HelperNode | GateNode | ReviewNode | TerminalNode;
export type WorkflowNodeType = NonNullable<WorkflowNode['type']>;

/**
 * - `flow`: the path a ticket takes;
 * - `loop`: "ask for changes" sends the plan back;
 * - `off`: touches a stage that is off (faint, never taken);
 * - `bypass`: the flow around stages that are off (dashed, labelled "off").
 */
export type WorkflowEdgeKind = 'flow' | 'loop' | 'off' | 'bypass';
export type WorkflowEdge = Edge<{ kind: WorkflowEdgeKind }>;

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** The laid-out size, so the page can give the canvas the graph's aspect ratio. */
  width: number;
  height: number;
}

/** Node ids. Agent stages and `review` use their stage id, so a selection maps straight back. */
export const NODE_IDS = {
  ticket: 'ticket',
  approve: 'approve',
  /** The owner's merge of the ticket branch (review loop only). */
  ownerMerge: 'owner-merge',
  done: 'done',
  helper: (i: number) => `helper-${i}`,
} as const;

/** The stage a click on this node configures; null for nodes without settings. */
export function stageOfNode(id: string): WorkflowStageId | null {
  if (id.startsWith('helper-')) return 'helpers';
  return (
    (['plan', 'orchestrate', 'helpers', 'review', 'code-review', 'unit-tests'] as const).find(
      (s) => s === id,
    ) ?? null
  );
}

// --- Layout ----------------------------------------------------------------------------------

export const NODE_W = 232;
export const COL_GAP = 56;
export const ROW_GAP = 80;
export const AGENT_H = 128;
export const GATE_H = 104;
export const TERMINAL_W = 120;
export const TERMINAL_H = 44;
/** The Helpers box: its header (role, limits, model, skill), then one row per helper. */
export const HELPERS_HEADER_H = 136;
export const HELPER_H = 36;
export const HELPER_GAP = 8;
export const HELPERS_PAD = 12;
/** Room above the first row for the "changes" loop and its label. */
export const TOP_MARGIN = 48;
/** With the review loop, Done sits under the owner's merge, this far below the last row. */
export const DONE_GAP = 32;

const colX = (col: number) => col * (NODE_W + COL_GAP);
export const GRAPH_WIDTH = colX(2) + NODE_W;

export function helpersHeight(n: number): number {
  return HELPERS_HEADER_H + n * HELPER_H + (n - 1) * HELPER_GAP + HELPERS_PAD;
}

/** Theme colors only (index.css), so both themes work; dashes tell kinds apart without color. */
export const EDGE_STYLE: Record<
  WorkflowEdgeKind,
  { stroke: string; width: number; dash?: string; opacity?: number }
> = {
  flow: { stroke: 'var(--color-dim)', width: 1.75 },
  // The ink, not the accent: it marks only what is working or selected (DESIGN.md).
  loop: { stroke: 'var(--color-ink)', width: 1.75 },
  off: { stroke: 'var(--color-line-strong)', width: 1.25, dash: '2 4', opacity: 0.9 },
  bypass: { stroke: 'var(--color-dim)', width: 1.5, dash: '7 5' },
};

/** Handle ids rendered by every node view (WorkflowNodes.tsx). */
export type HandleId =
  'in-left' | 'out-right' | 'in-top' | 'out-bottom' | 'out-top' | 'in-bottom' | 'out-top-loop';

export interface EdgeLabels {
  loop: string;
  bypass: string;
}

const DEFAULT_LABELS: EdgeLabels = { loop: 'Changes', bypass: 'Off: skipped' };

/**
 * Builds the graph. `skills` is the project's skill list (`ProjectWorkflowDto.skills`) and
 * `agentFiles` its agent files (`GET …/agents`); without one, nothing of that kind is flagged as
 * missing, because there is nothing to compare against.
 */
export function buildWorkflowGraph(
  workflow: WorkflowShape,
  setup: SetupShape,
  skills?: readonly string[],
  labels: EdgeLabels = DEFAULT_LABELS,
  agentFiles?: readonly AgentFileRef[],
  loop?: ReviewLoopShape | null,
): WorkflowGraph {
  const withLoop = loop !== undefined && loop !== null;
  const s = workflow.stages;
  const known = skills === undefined ? null : new Set(skills);
  const files =
    agentFiles === undefined ? null : new Map(agentFiles.map((f) => [f.name, f.model] as const));
  const agent = (
    role: WorkflowRole,
    workspace: AgentWorkspace,
    stage: { model: string | null; skill: SkillName | null; agent?: SkillName | null | undefined },
  ): StageAgent => {
    const file = stage.agent ?? null;
    return {
      role,
      workspace,
      model: stage.model,
      projectModel: setup.model,
      skill: stage.skill,
      skillMissing: stage.skill !== null && known !== null && !known.has(stage.skill),
      agent: file,
      agentMissing: file !== null && files !== null && !files.has(file),
      // A missing file has no model; an unknown list leaves it unknown.
      agentModel: file === null ? null : files === null ? undefined : (files.get(file) ?? null),
    };
  };
  const leadMode = workflow.plannerMode === 'lead';
  const helpers = Math.max(1, setup.maxConcurrentHelpers);
  const helpersH = helpersHeight(helpers);

  // Rows: y of the top and the height of each.
  const rowH = [AGENT_H, Math.max(AGENT_H, helpersH), AGENT_H] as const;
  const rowY = [
    TOP_MARGIN,
    TOP_MARGIN + rowH[0] + ROW_GAP,
    TOP_MARGIN + rowH[0] + ROW_GAP + rowH[1] + ROW_GAP,
  ] as const;
  /** Top-left of a node of height `h` (and width `w`) centred in its row and column. */
  const at = (row: 0 | 1 | 2, col: number, h: number, w = NODE_W) => ({
    x: colX(col) + (NODE_W - w) / 2,
    y: rowY[row] + (rowH[row] - h) / 2,
  });
  const sized = { width: NODE_W, height: AGENT_H };
  const fixed = { draggable: false, connectable: false } as const;

  const nodes: WorkflowNode[] = [
    {
      id: NODE_IDS.ticket,
      type: 'terminal',
      position: at(0, 0, TERMINAL_H, TERMINAL_W),
      width: TERMINAL_W,
      height: TERMINAL_H,
      selectable: false,
      ...fixed,
      data: { terminal: 'ticket' },
    },
    {
      id: 'plan',
      type: 'agent',
      position: at(0, 1, AGENT_H),
      ...sized,
      ...fixed,
      data: {
        stage: 'plan',
        ...agent(leadMode ? 'lead' : 'planner', 'read-only', s.plan),
        enabled: true,
        optional: false,
        sameAgentAs: leadMode ? 'orchestrate' : null,
      },
    },
    {
      id: NODE_IDS.approve,
      type: 'gate',
      position: at(0, 2, GATE_H),
      width: NODE_W,
      height: GATE_H,
      selectable: false,
      ...fixed,
      data: { gate: 'plan-approval' },
    },
    {
      id: 'orchestrate',
      type: 'agent',
      position: at(1, 0, AGENT_H),
      ...sized,
      ...fixed,
      data: {
        stage: 'orchestrate',
        ...agent('lead', 'read-only', s.orchestrate),
        enabled: true,
        optional: false,
        sameAgentAs: leadMode ? 'plan' : null,
      },
    },
    {
      id: 'helpers',
      type: 'helpers',
      position: at(1, 1, helpersH),
      width: NODE_W,
      height: helpersH,
      ...fixed,
      data: {
        stage: 'helpers',
        ...agent('helper', 'own-worktree', s.helpers),
        maxHelpers: setup.maxConcurrentHelpers,
        maxDepth: setup.maxDepth,
        budgetTokensPerAgent: setup.defaultBudgetTokensPerAgent,
        allowlist: setup.allowlist,
      },
    },
  ];
  for (let i = 1; i <= helpers; i += 1) {
    nodes.push({
      id: NODE_IDS.helper(i),
      type: 'helper',
      parentId: 'helpers',
      extent: 'parent',
      position: { x: HELPERS_PAD, y: HELPERS_HEADER_H + (i - 1) * (HELPER_H + HELPER_GAP) },
      width: NODE_W - 2 * HELPERS_PAD,
      height: HELPER_H,
      ...fixed,
      data: { index: i, nested: setup.maxDepth >= 2 },
    });
  }
  nodes.push(
    {
      id: 'review',
      type: 'review',
      position: at(1, 2, AGENT_H),
      ...sized,
      ...fixed,
      data: {
        stage: 'review',
        requireChecks: s.review.requireChecks,
        ...(withLoop
          ? {
              loop: {
                reviewer: loop.reviewer,
                maxReworkRounds: loop.maxReworkRounds,
                ...(loop.counts === undefined ? {} : { counts: loop.counts }),
              },
            }
          : {}),
      },
    },
    {
      id: 'code-review',
      type: 'agent',
      position: at(2, 0, AGENT_H),
      ...sized,
      ...fixed,
      data: {
        stage: 'code-review',
        ...agent('reviewer', 'read-only', s['code-review']),
        enabled: s['code-review'].enabled,
        optional: true,
        sameAgentAs: null,
      },
    },
    {
      id: 'unit-tests',
      type: 'agent',
      position: at(2, 1, AGENT_H),
      ...sized,
      ...fixed,
      data: {
        stage: 'unit-tests',
        ...agent('tester', 'own-worktree', s['unit-tests']),
        enabled: s['unit-tests'].enabled,
        optional: true,
        sameAgentAs: null,
      },
    },
  );
  // The review loop: the owner's merge takes Done's place, and Done moves under it.
  const doneY = rowY[2] + rowH[2] + DONE_GAP;
  if (withLoop) {
    nodes.push({
      id: NODE_IDS.ownerMerge,
      type: 'gate',
      position: at(2, 2, GATE_H),
      width: NODE_W,
      height: GATE_H,
      selectable: false,
      ...fixed,
      data: { gate: 'owner-merge' },
    });
  }
  nodes.push({
    id: NODE_IDS.done,
    type: 'terminal',
    position: withLoop
      ? { x: colX(2) + (NODE_W - TERMINAL_W) / 2, y: doneY }
      : at(2, 2, TERMINAL_H, TERMINAL_W),
    width: TERMINAL_W,
    height: TERMINAL_H,
    selectable: false,
    ...fixed,
    data: { terminal: 'done' },
  });

  // Grid cells of the spine nodes, to pick handles: neighbours in a row join side to side; a step
  // down a row joins bottom to top; a jump along a row (a bypass) runs underneath.
  const cell: Record<string, [row: number, col: number]> = {
    [NODE_IDS.ticket]: [0, 0],
    plan: [0, 1],
    [NODE_IDS.approve]: [0, 2],
    orchestrate: [1, 0],
    helpers: [1, 1],
    review: [1, 2],
    'code-review': [2, 0],
    'unit-tests': [2, 1],
    ...(withLoop
      ? { [NODE_IDS.ownerMerge]: [2, 2], [NODE_IDS.done]: [3, 2] }
      : { [NODE_IDS.done]: [2, 2] }),
  };
  const handles = (a: string, b: string): { sourceHandle: HandleId; targetHandle: HandleId } => {
    const [ra, ca] = cell[a] ?? [0, 0];
    const [rb, cb] = cell[b] ?? [0, 0];
    if (ra === rb && cb === ca + 1) return { sourceHandle: 'out-right', targetHandle: 'in-left' };
    // A bypass along the last row into the owner's merge: underneath, then in from the left,
    // since Done hangs under the merge.
    if (ra === rb && b === NODE_IDS.ownerMerge) {
      return { sourceHandle: 'out-bottom', targetHandle: 'in-left' };
    }
    if (ra === rb) return { sourceHandle: 'out-bottom', targetHandle: 'in-bottom' };
    return { sourceHandle: 'out-bottom', targetHandle: 'in-top' };
  };
  const edge = (
    kind: WorkflowEdgeKind,
    source: string,
    target: string,
    h: { sourceHandle: HandleId; targetHandle: HandleId } = handles(source, target),
    label?: string,
  ): WorkflowEdge => {
    const st = EDGE_STYLE[kind];
    return {
      id: `${kind}:${source}->${target}`,
      source,
      target,
      ...h,
      // Straight segments with square corners, as in the logo's connectors.
      type: 'step',
      className: `edge-${kind}`,
      selectable: false,
      focusable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: st.stroke, width: 16, height: 16 },
      style: {
        stroke: st.stroke,
        strokeWidth: st.width,
        ...(st.dash ? { strokeDasharray: st.dash } : {}),
        ...(st.opacity !== undefined ? { opacity: st.opacity } : {}),
      },
      ...(label
        ? {
            label,
            labelStyle: { fill: 'var(--color-dim)', fontSize: 12 },
            labelBgStyle: { fill: 'var(--color-panel)' },
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 6,
          }
        : {}),
      data: { kind },
    };
  };

  const edges: WorkflowEdge[] = [
    edge('flow', NODE_IDS.ticket, 'plan'),
    edge('flow', 'plan', NODE_IDS.approve),
    edge(
      'loop',
      NODE_IDS.approve,
      'plan',
      { sourceHandle: 'out-top', targetHandle: 'in-top' },
      labels.loop,
    ),
    edge('flow', NODE_IDS.approve, 'orchestrate'),
  ];
  for (let i = 1; i <= helpers; i += 1) {
    const side = { sourceHandle: 'out-right', targetHandle: 'in-left' } as const;
    edges.push(edge('flow', 'orchestrate', NODE_IDS.helper(i), side));
    edges.push(edge('flow', NODE_IDS.helper(i), 'review', side));
  }
  // The review loop: a change sent back for rework returns to its helper.
  if (withLoop) {
    edges.push(
      edge(
        'loop',
        'review',
        'helpers',
        { sourceHandle: 'out-top-loop', targetHandle: 'in-top' },
        loop.reworkLabel,
      ),
    );
  }

  // After the merge: a chain where any stage may be off. Generic over the chain, so more optional
  // stages (or a user-defined order, README §7a) need no new edge rules.
  const chain: { id: string; on: boolean }[] = [
    { id: 'review', on: true },
    { id: 'code-review', on: s['code-review'].enabled },
    { id: 'unit-tests', on: s['unit-tests'].enabled },
    ...(withLoop ? [{ id: NODE_IDS.ownerMerge, on: true }] : []),
    { id: NODE_IDS.done, on: true },
  ];
  let lastOn = chain[0]?.id ?? 'review';
  for (let i = 1; i < chain.length; i += 1) {
    const prev = chain[i - 1];
    const cur = chain[i];
    if (prev === undefined || cur === undefined) continue;
    edges.push(edge(prev.on && cur.on ? 'flow' : 'off', prev.id, cur.id));
    if (cur.on) {
      if (lastOn !== prev.id) {
        edges.push(edge('bypass', lastOn, cur.id, handles(lastOn, cur.id), labels.bypass));
      }
      lastOn = cur.id;
    }
  }

  return {
    nodes,
    edges,
    width: GRAPH_WIDTH,
    height: withLoop ? doneY + TERMINAL_H : rowY[2] + rowH[2],
  };
}
