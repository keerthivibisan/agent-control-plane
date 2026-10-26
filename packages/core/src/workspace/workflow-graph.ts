import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';
import { WorkflowNodeIdSchema, type WorkflowNodeId } from './node-id.js';
import type { AgentRoleKind } from '../orchestration/orchestration.js';
import { ApprovalModeSchema, HARD_MAX_HELPERS, type ApprovalMode } from './workspace.js';
import {
  MAX_REWORK_ROUNDS,
  ProjectWorkflowSchema,
  ReworkRoundsSchema,
  SkillNameSchema,
} from './workflow.js';

/**
 * Editable workflow graphs (ADR-0023, docs/workflow-graph/README.md). A project's workflow is a
 * graph of building blocks: agent nodes whose capabilities are fixed by their type, gate nodes,
 * and typed edges. The owner chooses and wires blocks; `validateWorkflowGraph` decides which
 * graphs may run and `compileWorkflow` turns a valid one into the engine's program. No graph can
 * switch off a safety rule: the engine, server and adapter still enforce every one of them.
 *
 * A graph migrated from a version 1 workflow keeps the old stage ids as its node ids (`plan`,
 * `orchestrate`, `helpers`, `review`, `code-review`, `unit-tests`), so stored agent runs and run
 * snapshots keep parsing.
 */

// ---------------------------------------------------------------- ids and limits

export { WorkflowNodeIdSchema, type WorkflowNodeId } from './node-id.js';
export const WorkflowEdgeIdSchema = WorkflowNodeIdSchema;
export type WorkflowEdgeId = z.infer<typeof WorkflowEdgeIdSchema>;

export const MAX_GRAPH_NODES = 40;
export const MAX_GRAPH_EDGES = 120;
/** Most skills one agent node uses. */
export const MAX_NODE_SKILLS = 3;
export const MAX_NODE_LABEL = 40;
export const MAX_NODE_DESCRIPTION = 500;

// ---------------------------------------------------------------- nodes

export const WorkflowNodeTypeSchema = z.enum([
  // agents
  'planner',
  'lead',
  'helper-pool',
  'helper',
  'reviewer',
  'tester',
  // gates
  'ticket',
  'plan-approval',
  'checks',
  'ticket-merge',
  'owner-merge',
  'done',
]);
export type WorkflowNodeType = z.infer<typeof WorkflowNodeTypeSchema>;
export const WORKFLOW_NODE_TYPES = WorkflowNodeTypeSchema.options;

/** Where the editor drew a node. Optional: a node without one is laid out automatically. */
export const NodePositionSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
});
export type NodePosition = z.infer<typeof NodePositionSchema>;

const NodeBase = {
  id: WorkflowNodeIdSchema,
  /** What the editor and the ticket page call the node. */
  label: z.string().trim().min(1).max(MAX_NODE_LABEL),
  position: NodePositionSchema.optional(),
};

/**
 * What every agent node can set. Null `model`: the agent file's model, else the project's, else
 * the provider default. `agent`: a project agent file whose instructions are added and whose tools
 * can only narrow the node's tools (ADR-0019 amendment). There is no free-text prompt: extra
 * instructions go in the agent file.
 */
/**
 * How much reasoning an agent applies (ADR-0028 §1; the Agent SDK's `effort`). Absent: the model's
 * default. Models without effort support ignore it.
 */
export const AgentEffortSchema = z.enum(['low', 'medium', 'high']);
export type AgentEffort = z.infer<typeof AgentEffortSchema>;
export const AGENT_EFFORTS = AgentEffortSchema.options;

const AgentConfig = {
  model: z.string().trim().min(1).max(100).nullable(),
  skills: z.array(SkillNameSchema).max(MAX_NODE_SKILLS),
  agent: SkillNameSchema.nullable(),
  /** ADR-0028 §1. Absent on graphs saved before it: the model's default. */
  effort: AgentEffortSchema.optional(),
};

/**
 * The approval mode of a node that edits (helpers and the tester). Null: the project's mode
 * (`ProjectApprovals.mode`). A ticket's or run's mode can only tighten it (`tightenMode`). Read-only
 * nodes have no mode at all, so a graph cannot give one to them.
 */
const EditorConfig = { approvalMode: ApprovalModeSchema.nullable() };

export const PlannerNodeSchema = z.object({
  type: z.literal('planner'),
  ...NodeBase,
  ...AgentConfig,
});
export const LeadNodeSchema = z.object({ type: z.literal('lead'), ...NodeBase, ...AgentConfig });
/** Generic helpers: the lead starts them for any step no named helper takes. */
export const HelperPoolNodeSchema = z.object({
  type: z.literal('helper-pool'),
  ...NodeBase,
  ...AgentConfig,
  ...EditorConfig,
  /** Depth 2: helpers from this node may start their own helpers (within the project's depth). */
  canStartHelpers: z.boolean(),
});
/** A named helper, e.g. "Frontend helper": plan steps and `start_agent` can name it. */
export const HelperNodeSchema = z.object({
  type: z.literal('helper'),
  ...NodeBase,
  ...AgentConfig,
  ...EditorConfig,
  /** What the helper is for; the lead and planner see it in their brief. Owner text. */
  description: z.string().trim().max(MAX_NODE_DESCRIPTION),
  /** Most helpers of this node at once (the project's helper limit still applies on top). */
  maxInstances: z.number().int().min(1).max(HARD_MAX_HELPERS),
  canStartHelpers: z.boolean(),
});
/**
 * A read-only review agent. `change`: reviews each helper's or tester's change before the lead
 * decides (`submit_review`). `final`: reads the merged ticket branch and posts findings as ticket
 * comments (`post_review`).
 */
export const ReviewerScopeSchema = z.enum(['change', 'final']);
export type ReviewerScope = z.infer<typeof ReviewerScopeSchema>;
export const ReviewerNodeSchema = z.object({
  type: z.literal('reviewer'),
  ...NodeBase,
  ...AgentConfig,
  scope: ReviewerScopeSchema,
});
/** Writes unit tests in its own worktree from the ticket branch; its change is reviewed too. */
export const TesterNodeSchema = z.object({
  type: z.literal('tester'),
  ...NodeBase,
  ...AgentConfig,
  ...EditorConfig,
});

export const TicketGateSchema = z.object({ type: z.literal('ticket'), ...NodeBase });
/**
 * The owner approves the plan before any helper starts (plan-first, ADR-0016). `auto`: the plan is
 * approved without asking, unless the ticket's or run's approval mode is tighter than Full auto.
 */
export const PlanApprovalGateSchema = z.object({
  type: z.literal('plan-approval'),
  ...NodeBase,
  auto: z.boolean(),
});
/**
 * Where a Checks block runs (ADR-0027 §5):
 * - `change`: on a helper's or tester's sealed change, before its review (wired from it with a
 *   `flow` edge);
 * - `merge`: on the change integrated with the ticket tip, before the lead's merge (one per graph,
 *   mandatory: the block before ADR-0027);
 * - `branch`: on the ticket branch tip after every change, before the owner's merge (in the final
 *   chain).
 */
export const CheckBlockPlaceSchema = z.enum(['change', 'merge', 'branch']);
export type CheckBlockPlace = z.infer<typeof CheckBlockPlaceSchema>;

const checkSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/** Which of the harness file's checks a block runs: the required ones, a list, or labels. */
export const CheckSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('required') }),
  z.object({ kind: z.literal('ids'), ids: z.array(checkSlug).min(1).max(20) }),
  z.object({ kind: z.literal('labels'), labels: z.array(checkSlug).min(1).max(5) }),
]);
export type CheckSelection = z.infer<typeof CheckSelectionSchema>;

/**
 * Where a failed block sends the work (ADR-0027 §5): the lead decides, the owner is asked, or the
 * helper reworks it (a `rework` edge from the block to that helper, `maxRounds`).
 */
export const CheckFailureRouteSchema = z.enum(['lead', 'owner', 'helper']);
export type CheckFailureRoute = z.infer<typeof CheckFailureRouteSchema>;

/** The failure routes each place allows; the first is the default. */
export const CHECK_FAILURE_ROUTES: Readonly<Record<CheckBlockPlace, readonly CheckFailureRoute[]>> =
  Object.freeze({
    change: ['lead', 'owner', 'helper'],
    merge: ['lead', 'owner'],
    branch: ['owner'],
  });

/**
 * The project's harness checks (ADR-0017, ADR-0027). Absent fields mean the block before ADR-0027:
 * before the lead's merge, every required check, the lead decides.
 */
export const ChecksGateSchema = z.object({
  type: z.literal('checks'),
  ...NodeBase,
  place: CheckBlockPlaceSchema.optional(),
  select: CheckSelectionSchema.optional(),
  onFailure: CheckFailureRouteSchema.optional(),
});
/** Every change is decided and the ticket branch holds the merged work. */
export const TicketMergeGateSchema = z.object({ type: z.literal('ticket-merge'), ...NodeBase });
/** The owner merges the ticket branch into the base branch, once. */
export const OwnerMergeGateSchema = z.object({ type: z.literal('owner-merge'), ...NodeBase });
export const DoneGateSchema = z.object({ type: z.literal('done'), ...NodeBase });

export const WorkflowNodeSchema = z.discriminatedUnion('type', [
  PlannerNodeSchema,
  LeadNodeSchema,
  HelperPoolNodeSchema,
  HelperNodeSchema,
  ReviewerNodeSchema,
  TesterNodeSchema,
  TicketGateSchema,
  PlanApprovalGateSchema,
  ChecksGateSchema,
  TicketMergeGateSchema,
  OwnerMergeGateSchema,
  DoneGateSchema,
]);
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowNodeOf<T extends WorkflowNodeType> = Extract<WorkflowNode, { type: T }>;
export type AgentWorkflowNode = WorkflowNodeOf<
  'planner' | 'lead' | 'helper-pool' | 'helper' | 'reviewer' | 'tester'
>;
export type EditorWorkflowNode = WorkflowNodeOf<'helper-pool' | 'helper' | 'tester'>;

// ---------------------------------------------------------------- capabilities

/**
 * What each node type is, fixed by its type (ADR-0023 §2). The engine, server and adapter derive
 * an agent's tools, worktree and approval handling from `kind`, never from the graph's wiring.
 */
export interface NodeCapabilities {
  /** The agent role kind, or null for a gate. */
  kind: AgentRoleKind | null;
  /** Edits files in its own worktree (and so has an approval mode and a reviewable change). */
  edits: boolean;
  /** At most this many nodes of the type in one graph. */
  maxPerGraph: number;
  /** At least this many nodes of the type in one graph. */
  minPerGraph: number;
}

export const NODE_CAPABILITIES: Readonly<Record<WorkflowNodeType, NodeCapabilities>> =
  Object.freeze({
    planner: { kind: 'planner', edits: false, minPerGraph: 0, maxPerGraph: 1 },
    lead: { kind: 'lead', edits: false, minPerGraph: 1, maxPerGraph: 1 },
    'helper-pool': { kind: 'worker', edits: true, minPerGraph: 0, maxPerGraph: 1 },
    helper: { kind: 'worker', edits: true, minPerGraph: 0, maxPerGraph: HARD_MAX_HELPERS },
    reviewer: { kind: 'reviewer', edits: false, minPerGraph: 0, maxPerGraph: 8 },
    tester: { kind: 'tester', edits: true, minPerGraph: 0, maxPerGraph: 2 },
    ticket: { kind: null, edits: false, minPerGraph: 1, maxPerGraph: 1 },
    'plan-approval': { kind: null, edits: false, minPerGraph: 1, maxPerGraph: 1 },
    // ADR-0028 §2: every Checks block is optional; at most one before the lead's merge (the
    // validator counts the blocks by place).
    checks: { kind: null, edits: false, minPerGraph: 0, maxPerGraph: 1 },
    'ticket-merge': { kind: null, edits: false, minPerGraph: 1, maxPerGraph: 1 },
    'owner-merge': { kind: null, edits: false, minPerGraph: 1, maxPerGraph: 1 },
    done: { kind: null, edits: false, minPerGraph: 1, maxPerGraph: 1 },
  });

export function isAgentNode(node: WorkflowNode): node is AgentWorkflowNode {
  return NODE_CAPABILITIES[node.type].kind !== null;
}
export function isEditorNode(node: WorkflowNode): node is EditorWorkflowNode {
  return NODE_CAPABILITIES[node.type].edits;
}

// ---------------------------------------------------------------- edges

/**
 * - `flow`: the order of steps (ticket → planner → plan approval → lead; checks → ticket merge →
 *   final reviewers and testers → owner merge → done);
 * - `assigns`: the lead may start helpers of this node;
 * - `review`: who first reviews this node's change (a change reviewer or the lead);
 * - `findings`: a change reviewer passes its verdict and findings to the lead;
 * - `rework`: this reviewer or the lead may send the change back, at most `maxRounds` times. A
 *   change reviewer with a rework edge to a helper reworks it directly and passes only approved
 *   changes (or changes out of rounds) to the lead (review route "direct");
 * - `merge`: the lead merges changes, through the Checks block before the merge, or straight into
 *   the ticket merge when the workflow has none (ADR-0028 §2).
 */
export const WorkflowEdgeTypeSchema = z.enum([
  'flow',
  'assigns',
  'review',
  'findings',
  'rework',
  'merge',
]);
export type WorkflowEdgeType = z.infer<typeof WorkflowEdgeTypeSchema>;
export const WORKFLOW_EDGE_TYPES = WorkflowEdgeTypeSchema.options;

const EdgeBase = { id: WorkflowEdgeIdSchema, from: WorkflowNodeIdSchema, to: WorkflowNodeIdSchema };

export const WorkflowEdgeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('flow'), ...EdgeBase }),
  z.object({ type: z.literal('assigns'), ...EdgeBase }),
  z.object({ type: z.literal('review'), ...EdgeBase }),
  z.object({ type: z.literal('findings'), ...EdgeBase }),
  z.object({ type: z.literal('rework'), ...EdgeBase, maxRounds: ReworkRoundsSchema }),
  z.object({ type: z.literal('merge'), ...EdgeBase }),
]);
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowEdgeOf<T extends WorkflowEdgeType> = Extract<WorkflowEdge, { type: T }>;

// ---------------------------------------------------------------- the graph

export const WorkflowTemplateIdSchema = z.enum([
  'lead-only',
  'todays-setup',
  'reviewer-helper-loop',
]);
export type WorkflowTemplateId = z.infer<typeof WorkflowTemplateIdSchema>;
export const WORKFLOW_TEMPLATE_IDS = WorkflowTemplateIdSchema.options;

/** The version 1 settings a migrated graph came from, kept for "Restore my earlier setup". */
export const LegacyWorkflowV1Schema = ProjectWorkflowSchema.pick({
  plannerMode: true,
  stages: true,
});
export type LegacyWorkflowV1 = z.infer<typeof LegacyWorkflowV1Schema>;

/**
 * The shape only: ids, types and field ranges. Whether a graph may run is
 * `validateWorkflowGraph`'s answer, which the editor, the PUT and the run start all share.
 */
export const WorkflowGraphSchema = z.object({
  version: z.literal(2),
  /** The template the graph started from; `custom` once built or changed by hand, or migrated. */
  template: z.union([WorkflowTemplateIdSchema, z.literal('custom')]),
  nodes: z.array(WorkflowNodeSchema).min(1).max(MAX_GRAPH_NODES),
  edges: z.array(WorkflowEdgeSchema).max(MAX_GRAPH_EDGES),
  legacyV1: LegacyWorkflowV1Schema.optional(),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

/** A project's stored version 2 workflow. */
export const ProjectWorkflowGraphSchema = z.object({
  projectId: z.string().min(1),
  graph: WorkflowGraphSchema,
  updatedAt: IsoTimestampSchema,
});
export type ProjectWorkflowGraph = z.infer<typeof ProjectWorkflowGraphSchema>;

/**
 * What `project_workflow.workflow` may hold: a version 2 graph, or a version 1 workflow saved
 * before ADR-0023 (no `version` field), which the server migrates when it reads it.
 */
export const StoredWorkflowJsonSchema = z.union([
  z.object({ version: z.literal(2), graph: WorkflowGraphSchema }),
  LegacyWorkflowV1Schema,
]);
export type StoredWorkflowJson = z.infer<typeof StoredWorkflowJsonSchema>;

// ---------------------------------------------------------------- validation results

/** Stable codes, so tests, the editor and the API agree on why a graph is refused. */
export const GraphIssueCodeSchema = z.enum([
  // shape
  'duplicate-node-id',
  'duplicate-edge-id',
  'edge-unknown-node',
  'duplicate-edge',
  'self-edge',
  // counts
  'missing-node',
  'too-many-nodes',
  'no-helpers',
  'too-many-helpers',
  'duplicate-helper-label',
  'reserved-helper-label',
  // edge rules
  'edge-not-allowed',
  // paths
  'plan-path',
  'no-review-route',
  'many-review-routes',
  'reviewer-no-findings',
  'reviewer-unused',
  'rework-without-review',
  'merge-path',
  'final-chain',
  'cycle',
  'unreachable',
  'not-assigned',
  // Checks blocks (ADR-0027 §5)
  'check-block-input',
  'many-check-blocks',
  'check-failure-route',
  'check-rework',
  // warnings
  'missing-skill',
  'missing-agent-file',
  'full-auto-plan-manual',
  'plan-auto-without-full-auto',
  'instances-over-limit',
  // warnings about a block's selection against the harness file (ADR-0027 §4, §5)
  'unknown-check',
  'unknown-check-label',
  'no-checks-selected',
  'merge-skips-required',
  // ADR-0028 §2: the workflow has no Checks block at all
  'no-checks',
]);
export type GraphIssueCode = z.infer<typeof GraphIssueCodeSchema>;

export const GraphIssueSchema = z.object({
  code: GraphIssueCodeSchema,
  /** `error`: the graph cannot be saved or run. `warning`: it can, but the owner should know. */
  severity: z.enum(['error', 'warning']),
  /** Plain words for the owner, naming the blocks by their labels. */
  message: z.string().min(1).max(500),
  nodeId: WorkflowNodeIdSchema.optional(),
  edgeId: WorkflowEdgeIdSchema.optional(),
});
export type GraphIssue = z.infer<typeof GraphIssueSchema>;

// ---------------------------------------------------------------- approval modes per node

/** From the most careful to the least: a lower rank asks more. */
const MODE_RANK: Readonly<Record<ApprovalMode, number>> = Object.freeze({
  manual: 0,
  'auto-edits': 1,
  auto: 2,
  'full-auto': 3,
});

/** The more careful of two modes. */
export function stricterMode(a: ApprovalMode, b: ApprovalMode): ApprovalMode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b;
}

/** True when `mode` asks at least as much as `limit`. */
export function isModeWithin(mode: ApprovalMode, limit: ApprovalMode): boolean {
  return MODE_RANK[mode] <= MODE_RANK[limit];
}

/** A node's mode for one run, and whether its commands run in the operating-system sandbox. */
export interface EffectiveNodeMode {
  mode: ApprovalMode;
  /**
   * The node is configured as Full auto (ADR-0022), so its commands run in the sandbox even when a
   * ticket or run tightens the mode: tightening never removes a protection.
   */
  sandbox: boolean;
}

/**
 * The mode an editing node runs with: its own mode (or the project's, when it has none), tightened
 * by the ticket's and the run's mode when they are set. A ticket or run can never loosen a node.
 */
export function tightenMode(
  nodeMode: ApprovalMode | null,
  projectMode: ApprovalMode,
  ...ceilings: (ApprovalMode | undefined)[]
): EffectiveNodeMode {
  const configured = nodeMode ?? projectMode;
  const mode = ceilings.reduce<ApprovalMode>(
    (m, ceiling) => (ceiling === undefined ? m : stricterMode(m, ceiling)),
    configured,
  );
  return { mode, sandbox: configured === 'full-auto' };
}

/** The most rework rounds an edge may allow, the same as the version 1 limit. */
export const MAX_EDGE_REWORK_ROUNDS = MAX_REWORK_ROUNDS;

// ---------------------------------------------------------------- the compiled program

/**
 * Who reviews an editing node's change, compiled from its `review`, `findings` and `rework` edges:
 * - `lead` (scenario a): the lead reviews and decides;
 * - `agent` then `lead` (scenario b): a change reviewer's verdict and findings go to the lead, who
 *   decides;
 * - `agent` then `direct` (scenario c): the reviewer sends the change back to its helper itself,
 *   up to `reviewerRounds` times, telling the lead each round; an approved change, or one out of
 *   rounds, goes to the lead, who merges or decides.
 * `leadRounds` is how often the lead may send it back (its rework edge; 0 without one).
 */
export type ReviewRoute =
  | { by: 'lead'; leadRounds: number }
  | { by: 'agent'; reviewer: WorkflowNodeId; then: 'lead'; leadRounds: number }
  | {
      by: 'agent';
      reviewer: WorkflowNodeId;
      then: 'direct';
      reviewerRounds: number;
      leadRounds: number;
    };

/** An agent node as the engine launches it. Model, skill and agent-file precedence is unchanged. */
export interface ProgramAgentNode {
  id: WorkflowNodeId;
  type: AgentWorkflowNode['type'];
  kind: AgentRoleKind;
  label: string;
  model: string | null;
  skills: readonly z.infer<typeof SkillNameSchema>[];
  agent: z.infer<typeof SkillNameSchema> | null;
  /** ADR-0028 §1: absent means the model's default. */
  effort?: AgentEffort;
}

export interface ProgramHelperNode extends ProgramAgentNode {
  type: 'helper-pool' | 'helper';
  /** Empty for the pool. */
  description: string;
  /** The pool: the project's helper limit. */
  maxInstances: number;
  canStartHelpers: boolean;
  mode: EffectiveNodeMode;
  review: ReviewRoute;
}

export interface ProgramTesterNode extends ProgramAgentNode {
  type: 'tester';
  mode: EffectiveNodeMode;
  review: ReviewRoute;
}

export interface ProgramFinalReviewerNode extends ProgramAgentNode {
  type: 'reviewer';
}

/** What `compileWorkflow` needs besides the graph: the project's settings and the run's choices. */
export interface CompileContext {
  /** The project's approval mode, used by editing nodes without their own. */
  projectMode: ApprovalMode;
  /** The ticket's and the run's approval modes, when set. Each can only tighten. */
  approvalCeilings: readonly ApprovalMode[];
  /** The ticket's or run's reviewer: `lead` sends every change to the lead (scenario a). */
  reviewer?: 'agent' | 'lead';
  /** The ticket's or run's rework rounds: replaces every rework edge's rounds for this run. */
  maxReworkRounds?: number;
  /** The project's helper limit, the pool's `maxInstances`. */
  maxConcurrentHelpers: number;
}

/**
 * A Checks block as the engine runs it (ADR-0027 §5), its settings with the defaults filled in
 * (`checkBlockOf`). Which checks it runs is `checksForBlock(manifest, select)`, against the harness
 * file of the checkout it runs in.
 */
export interface ProgramCheckBlock {
  nodeId: WorkflowNodeId;
  label: string;
  select: CheckSelection;
  onFailure: CheckFailureRoute;
}

/** The block before the lead's merge: at most one per graph; `onFailure` is `lead` or `owner`. */
export interface ProgramMergeCheckBlock extends ProgramCheckBlock {
  place: 'merge';
}

/** The block on the ticket branch, before the owner's merge; `onFailure` is `owner`. */
export interface ProgramBranchCheckBlock extends ProgramCheckBlock {
  place: 'branch';
  /**
   * How many of `finalStages` come before it on the final chain: it runs on the tip after the
   * last change and after `finalStages[0 .. afterStages - 1]`, before the rest.
   */
  afterStages: number;
}

/** A block on an editing node's sealed change, before its review. */
export interface ProgramChangeCheckBlock extends ProgramCheckBlock {
  place: 'change';
  /**
   * `onFailure: 'helper'`: how often the block may send the change back (its rework edge's rounds,
   * not replaced by the run's review rounds); null for the other routes.
   */
  maxRounds: number | null;
}

/** Every Checks block of a run (ADR-0027 §5). */
export interface ProgramCheckBlocks {
  /**
   * Old graphs: the `checks` node with `{ kind: 'required' }` and `lead`. Null without a block
   * before the lead's merge (ADR-0028 §2): the lead merges a change after its review, with no
   * checks.
   */
  merge: ProgramMergeCheckBlock | null;
  /** Null without a block on the ticket branch (every old graph). */
  branch: ProgramBranchCheckBlock | null;
  /** Each editing node's change block, by the editing node's id; absent for a node without one. */
  change: Readonly<Record<WorkflowNodeId, ProgramChangeCheckBlock>>;
}

/**
 * A valid graph compiled for one run (ADR-0023 §4). Built in memory when a run is created or
 * loaded, from the run's snapshot of the graph, and never stored.
 */
export interface WorkflowProgram {
  lead: ProgramAgentNode;
  /** Null: the lead writes the plan itself. */
  planner: ProgramAgentNode | null;
  /** The plan is approved without asking the owner (the plan gate's `auto`, not tightened). */
  planAutoApprove: boolean;
  /** Named helpers in graph order, then the pool when there is one. */
  helpers: readonly ProgramHelperNode[];
  changeReviewers: readonly ProgramAgentNode[];
  /** What runs after the last change is merged, in order, each at most once. */
  finalStages: readonly (ProgramFinalReviewerNode | ProgramTesterNode)[];
  /** Every editing node's mode for this run. */
  nodeModes: Readonly<Record<WorkflowNodeId, EffectiveNodeMode>>;
  /** The Checks blocks (ADR-0027 §5). */
  checkBlocks: ProgramCheckBlocks;
}
