import { workflowTemplate } from '@acp/core';
import type {
  ApprovalMode,
  CompileContext,
  ProjectApprovals,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from '@acp/core';
import { createRun, decidePlan, leadToolCall, ticketBranchCreated } from '../src/index.js';
import type { EngineResult, RunState } from '../src/index.js';
import { LEAD, PROJECT, REGISTERED, RUN, TICKET, event, makeCtx, ok } from './helpers.js';
import { BRANCH, KEY } from './loop-helpers.js';

/** Workflow-graph test helpers (ADR-0023). Synthetic data only. */

export const FRONTEND = 'frontend';
export const POOL = 'helpers';
export const REVIEWER = 'review';

export interface GraphOptions {
  /** The named helper "Frontend helper" (`frontend`). Default true. */
  named?: boolean;
  /** Keep the template's helper pool (`helpers`). Default true. */
  pool?: boolean;
  /** Both helpers' review route: lead (a), agent then lead (b), direct (c). Default `lead`. */
  route?: 'lead' | 'agent' | 'direct';
  /** Rounds of the lead's rework edges (none when 0 is not wanted: `null`). Default 2. */
  leadRounds?: number | null;
  /** Rounds of the reviewer's rework edges on route c. Default 2. */
  reviewerRounds?: number;
  maxInstances?: number;
  frontendCanStartHelpers?: boolean;
  frontendMode?: ApprovalMode | null;
  poolMode?: ApprovalMode | null;
  planner?: boolean;
  planAuto?: boolean;
  frontendModel?: string;
  frontendSkills?: string[];
  frontendAgent?: string;
  /** Final stages after the ticket merge, in order. */
  finals?: readonly ('final' | 'tester')[];
  testerMode?: ApprovalMode | null;
}

const e = (
  type: Exclude<WorkflowEdge['type'], 'rework'>,
  from: string,
  to: string,
): WorkflowEdge => ({ type, id: `${type}-${from}-${to}`.slice(0, 40), from, to });
const rw = (from: string, to: string, maxRounds: number): WorkflowEdge => ({
  type: 'rework',
  id: `rework-${from}-${to}`.slice(0, 40),
  from,
  to,
  maxRounds,
});

/**
 * A graph from the lead-only template (route a) or the reviewer template (routes b and c), with
 * an optional named helper "Frontend helper" next to (or instead of) the pool.
 */
export function testGraph(o: GraphOptions = {}): WorkflowGraph {
  const route = o.route ?? 'lead';
  const base = workflowTemplate(route === 'lead' ? 'lead-only' : 'reviewer-helper-loop', {
    planner: o.planner ?? false,
  });
  const reviewTarget = route === 'lead' ? 'orchestrate' : REVIEWER;
  const editors: string[] = [];
  let nodes: WorkflowNode[] = base.nodes.map((n) => {
    if (n.type === 'plan-approval') return { ...n, auto: o.planAuto ?? false };
    if (n.type === 'helper-pool') return { ...n, approvalMode: o.poolMode ?? null };
    return n;
  });
  // Drop the template's helper edges; they are rebuilt for every editing node below.
  let edges: WorkflowEdge[] = base.edges.filter(
    (x) => !(x.type === 'review' || x.type === 'rework' || x.type === 'assigns'),
  );
  if (o.pool !== false) editors.push(POOL);
  else nodes = nodes.filter((n) => n.type !== 'helper-pool');
  if (o.named !== false) {
    editors.unshift(FRONTEND);
    nodes.push({
      type: 'helper',
      id: FRONTEND,
      label: 'Frontend helper',
      description: 'Builds the UI.',
      model: o.frontendModel ?? null,
      skills: o.frontendSkills ?? [],
      agent: o.frontendAgent ?? null,
      approvalMode: o.frontendMode ?? null,
      maxInstances: o.maxInstances ?? 2,
      canStartHelpers: o.frontendCanStartHelpers ?? false,
    });
  }
  const finals = o.finals ?? [];
  const finalIds = finals.map((k, i) => (k === 'final' ? `final-${i + 1}` : `tester-${i + 1}`));
  finals.forEach((k, i) => {
    const id = finalIds[i] ?? 'x';
    if (k === 'final') {
      nodes.push({
        type: 'reviewer',
        id,
        label: `Final reviewer ${i + 1}`,
        scope: 'final',
        model: null,
        skills: [],
        agent: null,
      });
    } else {
      nodes.push({
        type: 'tester',
        id,
        label: `Tester ${i + 1}`,
        model: null,
        skills: [],
        agent: null,
        approvalMode: o.testerMode ?? null,
      });
      editors.push(id);
    }
  });
  if (finalIds.length > 0) {
    edges = edges.filter((x) => !(x.type === 'flow' && x.from === 'ticket-merge'));
    const chain = ['ticket-merge', ...finalIds, 'owner-merge'];
    for (let i = 0; i + 1 < chain.length; i++) {
      edges.push(e('flow', chain[i] ?? '', chain[i + 1] ?? ''));
    }
  }
  for (const id of editors) {
    if (!id.startsWith('tester')) edges.push(e('assigns', 'orchestrate', id));
    edges.push(e('review', id, reviewTarget));
    if (o.leadRounds !== null) edges.push(rw('orchestrate', id, o.leadRounds ?? 2));
    if (route === 'direct') edges.push(rw(REVIEWER, id, o.reviewerRounds ?? 2));
  }
  return { version: 2, template: 'custom', nodes, edges };
}

export interface GraphRunOptions {
  approvals?: ProjectApprovals;
  ceilings?: ApprovalMode[];
  reviewer?: 'agent' | 'lead';
  maxReworkRounds?: number;
  limits?: { maxConcurrentHelpers: number; maxDepth: number };
  budget?: number;
  /** A legacy (no review loop) graph run. */
  legacy?: boolean;
}

export function graphContext(o: GraphRunOptions): CompileContext {
  return {
    projectMode: o.approvals?.mode ?? 'manual',
    approvalCeilings: o.ceilings ?? [],
    ...(o.reviewer !== undefined ? { reviewer: o.reviewer } : {}),
    ...(o.maxReworkRounds !== undefined ? { maxReworkRounds: o.maxReworkRounds } : {}),
    maxConcurrentHelpers: o.limits?.maxConcurrentHelpers ?? 3,
  };
}

export const PLANNER_ID = 'id-1';

/** A loop ticket run following `graph` (PLANNING; the planning agent STARTING). */
export function createGraphRun(
  graph: WorkflowGraph,
  o: GraphRunOptions = {},
): EngineResult<RunState> {
  const planner = graph.nodes.some((n) => n.type === 'planner');
  return createRun(
    {
      runId: RUN,
      leadAgentRunId: LEAD,
      projectId: PROJECT,
      title: 'WEB-12 Dark mode',
      budget: { maxTokensPerAgent: o.budget ?? 1000, softCostUsdPerRun: null },
      limits: o.limits ?? { maxConcurrentHelpers: 3, maxDepth: 1 },
      ticket: {
        ticketId: TICKET,
        leadPrompt: planner ? 'Lead brief for WEB-12' : 'Ticket WEB-12: plan first',
        ...(planner ? { plannerPrompt: 'Plan ticket WEB-12' } : {}),
      },
      ...(o.legacy === true
        ? {}
        : { reviewLoop: { ticketKey: KEY, reviewer: o.reviewer ?? 'agent', maxReworkRounds: 2 } }),
      ...(o.approvals !== undefined ? { approvals: o.approvals } : {}),
      graph,
      graphContext: graphContext(o),
      registeredProjectIds: REGISTERED,
    },
    makeCtx(),
  );
}

export const STEPS = [
  { title: 'Toggle', role: 'Frontend helper', detail: 'Add the switch.' },
  { title: 'Store', role: 'Store', detail: 'Persist the theme.' },
];

export function tool(state: RunState, caller: string, name: string, input: unknown, prefix = 't') {
  return leadToolCall(
    state,
    { callerAgentRunId: caller, name, input, registeredProjectIds: REGISTERED },
    makeCtx(1500, prefix),
  );
}

/** Plan approved (or auto-approved), the ticket branch created, the lead RUNNING. */
export function graphRunning(
  graph: WorkflowGraph,
  o: GraphRunOptions = {},
  steps: readonly unknown[] = STEPS,
): RunState {
  const planner = graph.nodes.some((n) => n.type === 'planner');
  const author = planner ? PLANNER_ID : LEAD;
  let s = ok(createGraphRun(graph, o)).state;
  s = ok(
    event(s, author, { type: 'started', providerSessionId: `sess-${author}`, model: null }),
  ).state;
  s = ok(tool(s, author, 'submit_plan', { summary: 'Dark mode.', steps }, 'p')).state;
  const plan = s.plans?.find((p) => p.status === 'proposed');
  if (plan !== undefined) s = ok(decidePlan(s, plan.id, 'approve', makeCtx(1600, 'd'))).state;
  if (planner) {
    s = ok(event(s, LEAD, { type: 'started', providerSessionId: 'sess-lead', model: null })).state;
  }
  if (o.legacy === true) return s;
  return ok(ticketBranchCreated(s, BRANCH, makeCtx(1700))).state;
}
