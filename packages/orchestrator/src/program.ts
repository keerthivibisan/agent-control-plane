import {
  compileWorkflow,
  defaultProjectWorkflow,
  isModeWithin,
  migrateWorkflowV1,
} from '@acp/core';
import type {
  AgentRoleKind,
  ApprovalMode,
  CompileContext,
  EffectiveNodeMode,
  ProgramAgentNode,
  ProgramFinalReviewerNode,
  ProgramHelperNode,
  ProgramTesterNode,
  ProjectApprovals,
  ProjectWorkflow,
  ReviewRoute,
  WorkflowGraph,
  WorkflowNodeId,
  WorkflowProgram,
} from '@acp/core';
import { runLimits } from './limits.js';
import type { EngineAgent, RunIntegration, RunLimits } from './state.js';

/**
 * The run's compiled workflow program (ADR-0023 §4, docs/workflow-graph/README.md §3). Every
 * stage decision of the engine reads it: who plans, which helper nodes exist with their launch
 * fields, modes and review routes, and the final stages in order.
 *
 * A run with a graph snapshot (`RunState.graph`) compiles it with its `graphContext`. A version 1
 * run (no graph) migrates its workflow snapshot with `migrateWorkflowV1`, with the run's own
 * review settings (`RunState.integration`, the ticket's overrides already applied) put into the
 * review stage first, and compiles that. The program is built in memory and never stored; it is
 * memoized per snapshot object, so a command's draft and its state share one compile.
 */

/** The parts of a run the program is compiled from (`RunState` and `Draft` both fit). */
export interface ProgramView {
  readonly workflow?: ProjectWorkflow | undefined;
  readonly graph?: WorkflowGraph | undefined;
  readonly graphContext?: CompileContext | undefined;
  readonly integration?: RunIntegration | undefined;
  readonly approvalPolicy?: ProjectApprovals | undefined;
  readonly limits?: RunLimits | undefined;
}

interface Compiled {
  graph: WorkflowGraph;
  context: CompileContext;
  program: WorkflowProgram;
}

/** The workflow of a run without one (Phase 3 and early Phase 4 runs): the default stages. */
const DEFAULT_WORKFLOW: ProjectWorkflow = defaultProjectWorkflow(
  'default',
  '1970-01-01T00:00:00.000Z',
);

const cache = new WeakMap<object, Map<string, Compiled>>();

function memo(key: object, sub: string, build: () => Compiled): Compiled {
  let byContext = cache.get(key);
  if (byContext === undefined) {
    byContext = new Map();
    cache.set(key, byContext);
  }
  const hit = byContext.get(sub);
  if (hit !== undefined) return hit;
  const built = build();
  byContext.set(sub, built);
  return built;
}

/**
 * The context a version 1 run compiles with: the run's mode as the project mode (a v1 ticket mode
 * replaced the project's, so there is no ceiling), and its helper limit.
 */
function v1Context(view: ProgramView): CompileContext {
  return {
    projectMode: view.approvalPolicy?.mode ?? 'manual',
    approvalCeilings: [],
    maxConcurrentHelpers: runLimits(view).maxConcurrentHelpers,
  };
}

function compiled(view: ProgramView): Compiled {
  const graph = view.graph;
  if (graph !== undefined) {
    const context = view.graphContext ?? v1Context(view);
    return memo(graph, JSON.stringify(context), () => ({
      graph,
      context,
      program: compileWorkflow(graph, context),
    }));
  }
  const base = view.workflow ?? DEFAULT_WORKFLOW;
  const loop = view.integration;
  const context = v1Context(view);
  const sub = JSON.stringify([loop?.reviewer, loop?.maxReworkRounds, context]);
  return memo(base, sub, () => {
    // The run's review settings, which the server resolved from the ticket's overrides, replace
    // the review stage's, so the migrated routes are the ones this run uses.
    const workflow: ProjectWorkflow =
      loop === undefined
        ? base
        : {
            ...base,
            stages: {
              ...base.stages,
              review: {
                ...base.stages.review,
                reviewer: loop.reviewer,
                maxReworkRounds: loop.maxReworkRounds,
              },
            },
          };
    const migrated = migrateWorkflowV1(workflow, { projectMode: context.projectMode });
    return { graph: migrated, context, program: compileWorkflow(migrated, context) };
  });
}

/** The run's compiled program (memoized; throws only for a stored graph the validator refuses). */
export function programOf(view: ProgramView): WorkflowProgram {
  return compiled(view).program;
}

/** The graph the run follows: its snapshot, or its version 1 workflow migrated. */
export function runGraphOf(view: ProgramView): WorkflowGraph {
  return compiled(view).graph;
}

// ------------------------------------------------------------------ nodes of agents

/** The node an agent was started for, by its recorded stage, or by its role for old rows. */
const ROLE_NODE_FALLBACK: Readonly<Record<AgentRoleKind, WorkflowNodeId>> = Object.freeze({
  planner: 'plan',
  lead: 'orchestrate',
  worker: 'helpers',
  reviewer: 'code-review',
  tester: 'unit-tests',
});

export function agentNodeId(agent: Pick<EngineAgent, 'kind' | 'stage'>): WorkflowNodeId {
  return agent.stage ?? ROLE_NODE_FALLBACK[agent.kind];
}

/** The helper node of a worker: its recorded node, else the pool, else the first helper node. */
export function helperNodeOf(
  program: WorkflowProgram,
  agent: Pick<EngineAgent, 'kind' | 'stage'>,
): ProgramHelperNode | undefined {
  const id = agentNodeId(agent);
  return (
    program.helpers.find((h) => h.id === id) ??
    program.helpers.find((h) => h.type === 'helper-pool') ??
    program.helpers[0]
  );
}

export function testerNodeOf(
  program: WorkflowProgram,
  agent: Pick<EngineAgent, 'kind' | 'stage'>,
): ProgramTesterNode | undefined {
  const id = agentNodeId(agent);
  const testers = program.finalStages.filter((s): s is ProgramTesterNode => s.type === 'tester');
  return testers.find((t) => t.id === id) ?? testers[0];
}

/** The editing node (helper or tester) whose change this agent makes. */
export function editingNodeOf(
  program: WorkflowProgram,
  agent: Pick<EngineAgent, 'kind' | 'stage'>,
): ProgramHelperNode | ProgramTesterNode | undefined {
  if (agent.kind === 'worker') return helperNodeOf(program, agent);
  if (agent.kind === 'tester') return testerNodeOf(program, agent);
  return undefined;
}

/** Who reviews this helper's or tester's change (ADR-0023 §4). */
export function reviewRouteOf(
  program: WorkflowProgram,
  agent: Pick<EngineAgent, 'kind' | 'stage'>,
): ReviewRoute {
  return editingNodeOf(program, agent)?.review ?? { by: 'lead', leadRounds: 0 };
}

/** A program agent node by id (lead, planner, helpers, change reviewers, final stages). */
export function programNode(
  program: WorkflowProgram,
  id: WorkflowNodeId,
): ProgramAgentNode | undefined {
  if (program.lead.id === id) return program.lead;
  if (program.planner?.id === id) return program.planner;
  return (
    program.helpers.find((n) => n.id === id) ??
    program.changeReviewers.find((n) => n.id === id) ??
    program.finalStages.find((n) => n.id === id)
  );
}

/** The final stage (final reviewer or tester) of an id. */
export function finalStageNode(
  program: WorkflowProgram,
  id: WorkflowNodeId,
): ProgramFinalReviewerNode | ProgramTesterNode | undefined {
  return program.finalStages.find((n) => n.id === id);
}

/** True when the graph has named helpers (not just the pool): briefs then list them. */
export function hasNamedHelpers(program: WorkflowProgram): boolean {
  return program.helpers.some((h) => h.type === 'helper');
}

// ------------------------------------------------------------------ named helpers

/** One helper node as a brief or a refusal names it. */
function nodeLine(h: ProgramHelperNode): string {
  const what = h.type === 'helper-pool' ? 'any step no named helper takes' : h.description;
  return `- ${h.label} (helper "${h.id}")${what.length > 0 ? `: ${what}` : ''}`;
}

/** The list of helper nodes, one line each, for briefs and refusals. */
export function helperNodeLines(program: WorkflowProgram): string[] {
  return program.helpers.map(nodeLine);
}

function sameLabel(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(a) === norm(b);
}

export type HelperResolution =
  { ok: true; node: ProgramHelperNode } | { ok: false; message: string };

/**
 * Which helper node takes a step or a `start_agent` (ADR-0023 §7): the explicit `helper` id, else
 * the named helper whose label equals the role (trimmed, ignoring case and repeated spaces), else
 * the pool. Otherwise a plain refusal listing the helper nodes.
 */
export function resolveHelper(
  program: WorkflowProgram,
  input: { helper?: string | undefined; role: string },
): HelperResolution {
  const list = helperNodeLines(program).join('\n');
  if (input.helper !== undefined) {
    const node = program.helpers.find((h) => h.id === input.helper);
    if (node !== undefined) return { ok: true, node };
    return {
      ok: false,
      message: `There is no helper "${input.helper}" in this workflow. The helper nodes are:\n${list}`,
    };
  }
  const named = program.helpers.find((h) => h.type === 'helper' && sameLabel(h.label, input.role));
  if (named !== undefined) return { ok: true, node: named };
  const pool = program.helpers.find((h) => h.type === 'helper-pool');
  if (pool !== undefined) return { ok: true, node: pool };
  return {
    ok: false,
    message: `No helper node takes the role "${input.role.trim()}" and this workflow has no helper pool. Name one of the helper nodes (helper id, or its label as the role):\n${list}`,
  };
}

// ------------------------------------------------------------------ approval modes per agent

/** The run's mode for one editing node, after tightening (`nodeModes`). */
export function nodeModeOf(
  program: WorkflowProgram,
  nodeId: WorkflowNodeId,
): EffectiveNodeMode | undefined {
  return Object.hasOwn(program.nodeModes, nodeId) ? program.nodeModes[nodeId] : undefined;
}

interface ModeView extends ProgramView {
  readonly approvalPolicy?: ProjectApprovals | undefined;
}

/**
 * The approval mode one agent runs with (ADR-0023 §5): its editing node's mode for this run, else
 * the run's mode. Undefined for the lead, the planner and reviewers, which are read-only and
 * always run in Claude Code's `default` mode (the lead never approves anything), and for runs
 * without an approval policy (the legacy allowlist decides).
 */
export function effectiveMode(
  view: ModeView,
  agent: Pick<EngineAgent, 'kind' | 'stage'>,
): ApprovalMode | undefined {
  const policy = view.approvalPolicy;
  if (policy === undefined) return undefined;
  if (agent.kind !== 'worker' && agent.kind !== 'tester') return undefined;
  const node = editingNodeOf(programOf(view), agent);
  const mode = node === undefined ? undefined : nodeModeOf(programOf(view), node.id)?.mode;
  return mode ?? policy.mode;
}

/**
 * How one agent's process is launched (ADR-0022, ADR-0023 §5), for the server's `ManagedAgentSpec`:
 * - `mode`: its approval mode (`effectiveMode`), absent for read-only agents and legacy runs;
 * - `autoMode`: it runs in Claude Code's auto mode (its mode is Full auto);
 * - `sandbox`: its commands run in the operating-system sandbox. True for a node configured as
 *   Full auto even when a ticket or run tightened its mode, since tightening never removes a
 *   protection.
 */
export interface AgentLaunchMode {
  mode?: ApprovalMode;
  autoMode: boolean;
  sandbox: boolean;
}

export function agentLaunchMode(
  view: ModeView,
  agent: Pick<EngineAgent, 'kind' | 'stage'>,
): AgentLaunchMode {
  const mode = effectiveMode(view, agent);
  if (mode === undefined) return { autoMode: false, sandbox: false };
  const node = editingNodeOf(programOf(view), agent);
  const configured = node === undefined ? undefined : nodeModeOf(programOf(view), node.id);
  return {
    mode,
    autoMode: mode === 'full-auto',
    sandbox: mode === 'full-auto' || configured?.sandbox === true,
  };
}

/** Every editing node runs Full auto: the owner is asked nothing during the run (ADR-0022). */
export function programFullAuto(program: WorkflowProgram): boolean {
  const modes = Object.values(program.nodeModes);
  return modes.length > 0 && modes.every((m) => m.mode === 'full-auto');
}

/** True when `mode` is within (asks at least as much as) the node's mode for this run. */
export function modeWithinNode(
  program: WorkflowProgram,
  nodeId: WorkflowNodeId,
  mode: ApprovalMode,
): boolean {
  const node = nodeModeOf(program, nodeId);
  return node === undefined || isModeWithin(mode, node.mode);
}
