import type {
  AgentRoleKind,
  CheckRunStatus,
  PlannerMode,
  RunStatus,
  WorkflowStageId,
} from '@acp/core';
import type {
  AgentRunDto,
  ChatMessageDto,
  CheckRunDto,
  ReviewDto,
  RunDetailDto,
  RunFollowUpDto,
  RunSummaryDto,
  RunWorkflowDto,
  TicketCommentDto,
  TicketDetailDto,
  TicketPlanDto,
  WorkflowStageState,
} from '@acp/core/api';
import { isAgentLive as isLiveAgentStatus, type AgentNode } from '../control/run-state';

/**
 * Pure rules the ticket page reads from a `TicketDetailDto` (docs/history/phase-4/README.md §5.3).
 * The server decides what is allowed; these only decide what to show and which buttons to offer, so
 * a refused action still shows the server's reason.
 */

/**
 * Check outcomes that block a plain Merge of a legacy run's change when the check is required
 * (ADR-0017). A check the app's shutdown stopped blocks there too: that gate has no "not run yet"
 * (WG-F3). The review loop's gates count it as not run instead (`checksSummary`).
 */
const FAILING: ReadonlySet<CheckRunStatus> = new Set([
  'failed',
  'timed-out',
  'error',
  'interrupted',
]);

export function isFailing(check: Pick<CheckRunDto, 'status'>): boolean {
  return FAILING.has(check.status);
}

const newestFirst = (a: { startedAt: string }, b: { startedAt: string }) =>
  a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0;

/**
 * One agent's checks: the latest run of each check (required first, then by name) and every
 * earlier run, newest first. A check run again replaces the earlier result; it isn't hidden.
 */
export function agentChecks(
  checks: readonly CheckRunDto[],
  agentRunId: string,
): { latest: CheckRunDto[]; earlier: CheckRunDto[] } {
  const mine = checks.filter((c) => c.agentRunId === agentRunId).sort(newestFirst);
  const seen = new Set<string>();
  const latest: CheckRunDto[] = [];
  const earlier: CheckRunDto[] = [];
  for (const c of mine) {
    if (seen.has(c.checkId)) earlier.push(c);
    else {
      seen.add(c.checkId);
      latest.push(c);
    }
  }
  latest.sort((a, b) =>
    a.required !== b.required ? (a.required ? -1 : 1) : a.name.localeCompare(b.name),
  );
  return { latest, earlier };
}

export type MergeGate =
  /** No check has run on this agent's changes (none in the harness, or not yet). */
  | { kind: 'no-checks' }
  /** Every required check passed (optional ones may have failed: they don't block). */
  | { kind: 'passed'; passed: number; total: number }
  /** A required check failed: Merge is replaced by "Merge anyway" with a reason. */
  | { kind: 'blocked'; failing: CheckRunDto[]; passed: number; total: number };

/** Whether Merge is offered as is, from the latest run of each check. */
export function mergeGate(latest: readonly CheckRunDto[]): MergeGate {
  if (latest.length === 0) return { kind: 'no-checks' };
  const passed = latest.filter((c) => c.status === 'passed').length;
  const failing = latest.filter((c) => c.required && isFailing(c));
  return failing.length > 0
    ? { kind: 'blocked', failing, passed, total: latest.length }
    : { kind: 'passed', passed, total: latest.length };
}

/** A run's plans, newest version first. */
export function plansOfRun(plans: readonly TicketPlanDto[], runId: string): TicketPlanDto[] {
  return plans.filter((p) => p.runId === runId).sort((a, b) => b.version - a.version);
}

/**
 * The plan card replaces the canvas while the run waits for a decision on its newest plan
 * (README §5.3 "Plan review state").
 */
export function planUnderReview(
  run: Pick<RunDetailDto, 'id' | 'status'>,
  plans: readonly TicketPlanDto[],
): TicketPlanDto | null {
  if (run.status !== 'PLAN_REVIEW') return null;
  const newest = plansOfRun(plans, run.id)[0];
  return newest !== undefined && newest.status === 'proposed' ? newest : null;
}

/** Owner and lead comments attached to one plan version (the "request changes" notes). */
export function commentsOnPlan(
  comments: readonly TicketCommentDto[],
  planId: string,
): TicketCommentDto[] {
  return comments
    .filter((c) => c.planId === planId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** The ticket action offered in the header: Start, Re-run, or none while a run is under way. */
export function startAction(detail: Pick<TicketDetailDto, 'ticket'>): 'start' | 'rerun' | null {
  const { ticket } = detail;
  if (ticket.status === 'DONE' || ticket.status === 'CANCELLED') return 'rerun';
  // A failed or stopped run sends the ticket back to Ready (README §6.2).
  if (ticket.stage === 'READY') return ticket.currentRunId === null ? 'start' : 'rerun';
  return null;
}

/** Runs that can still be stopped (Stop all), including while the lead plans. */
const STOPPABLE: ReadonlySet<RunStatus> = new Set([
  'QUEUED',
  'PLANNING',
  'PLAN_REVIEW',
  'RUNNING',
  'BLOCKED',
]);

export function canStopRun(status: RunStatus): boolean {
  return STOPPABLE.has(status);
}

/** Run n of total, counting from the oldest (`runs` is newest first). */
export function runNumber(runs: readonly RunSummaryDto[], runId: string): number | null {
  const i = runs.findIndex((r) => r.id === runId);
  return i === -1 ? null : runs.length - i;
}

/** Budget tokens used by an agent's descendants (their own budgets; display only, ADR-0014). */
export function descendantsBudget(node: AgentNode): number {
  return node.children.reduce((sum, c) => sum + c.agent.budget.used + descendantsBudget(c), 0);
}

/** Budget tokens used by all of a run's agents; budgets are per agent, so nothing counts twice. */
export function runBudgetUsed(agents: readonly AgentRunDto[]): number {
  return agents.reduce((sum, a) => sum + a.budget.used, 0);
}

/** Pending approvals per agent id. */
export function pendingByAgent(run: Pick<RunDetailDto, 'approvals'>): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of run.approvals) {
    if (a.status === 'pending') out.set(a.agentRunId, (out.get(a.agentRunId) ?? 0) + 1);
  }
  return out;
}

/** Why a started ticket is back in Ready: its current run failed or was stopped (README §6.2). */
export function lastRunNote(
  detail: Pick<TicketDetailDto, 'ticket' | 'runs'>,
): 'FAILED' | 'CANCELLED' | null {
  const { ticket, runs } = detail;
  if (ticket.stage !== 'READY' || ticket.currentRunId === null) return null;
  const current = runs.find((r) => r.id === ticket.currentRunId);
  return current !== undefined && (current.status === 'FAILED' || current.status === 'CANCELLED')
    ? current.status
    : null;
}

/**
 * A helper's worktree branch: the agent's own `branch` (set once its workspace exists), else the
 * one its review reports, else null ("no branch yet"). The lead has no worktree.
 */
export function agentBranch(
  agent: Pick<AgentRunDto, 'kind' | 'branch'>,
  review: Pick<ReviewDto['agents'][number], 'branch'> | undefined,
): string | null {
  if (!hasWorktree(agent.kind)) return null;
  return agent.branch ?? review?.branch ?? null;
}

// --- Redesign roles and stages (R-H; ADR-0019) ----------------------------------------------------

/** The id of the Comments tab's thread (v0.3.0 C-B: people's comments and the lead's summary). */
export const COMMENTS_ID = 'ticket-comments';

/**
 * The id of the Conversation tab's timeline (v0.3.0 C-B), so "N findings from the reviewer" can
 * bring it into view.
 */
export const ACTIVITY_ID = 'ticket-activity';

/** The Comments tab's "Waiting for you" part, for the header's "N requests wait for you". */
export const NEEDS_YOU_ID = 'ticket-needs-you';

/** The Comments tab's final-step box, for the final step's main action in the header. */
export const FINAL_STEP_ID = 'ticket-final-step';

/** Roles that work in their own git worktree: helpers and the tester. The rest only read. */
export function hasWorktree(kind: AgentRoleKind): boolean {
  return kind === 'worker' || kind === 'tester';
}

/** Order of the agent tree's roots: the flow's order (plan, orchestrate, review, tests). */
export const ROOT_ORDER: Readonly<Record<AgentRoleKind, number>> = {
  planner: 0,
  lead: 1,
  worker: 2,
  reviewer: 3,
  tester: 4,
};

/** The planner holds the owner's conversation until the plan is approved (ADR-0019). */
const PLANNING: ReadonlySet<RunStatus> = new Set(['QUEUED', 'PLANNING', 'PLAN_REVIEW']);

/**
 * The agent the owner's chat reaches now: the planner while a separate planner plans, else the
 * lead (the engine's `ownerChat`). Null for a run with neither.
 */
export function chatAgent(
  run: Pick<RunDetailDto, 'status' | 'agents'>,
): Pick<AgentRunDto, 'id' | 'kind'> | null {
  const planner = run.agents.find((a) => a.kind === 'planner');
  if (planner !== undefined && PLANNING.has(run.status)) return planner;
  return run.agents.find((a) => a.kind === 'lead') ?? null;
}

/** Agents whose card and panel offer the chat: the lead, and a separate planner. */
export function canHoldChat(kind: AgentRoleKind): boolean {
  return kind === 'lead' || kind === 'planner';
}

export type ChatSpeaker = 'owner' | 'lead' | 'planner' | 'lead-or-planner';

/**
 * Who wrote a chat message the server stores as `lead` (decision C: planner text is published
 * under the lead's voice). Only what the run detail proves:
 * - no planner in the run: the lead;
 * - before the planner ended: the planner (the lead waits, QUEUED, until the plan is approved,
 *   and approving ends the planner);
 * - after the planner ended: the lead;
 * - otherwise (no planner end yet, but the lead is no longer waiting): "Lead or planner".
 */
export function chatSpeaker(
  message: Pick<ChatMessageDto, 'role' | 'createdAt'>,
  agents: readonly Pick<AgentRunDto, 'kind' | 'status' | 'endedAt'>[],
): ChatSpeaker {
  if (message.role === 'owner') return 'owner';
  const planner = agents.find((a) => a.kind === 'planner');
  if (planner === undefined) return 'lead';
  const lead = agents.find((a) => a.kind === 'lead');
  if (planner.endedAt === null) {
    return lead === undefined || lead.status === 'QUEUED' ? 'planner' : 'lead-or-planner';
  }
  if (message.createdAt < planner.endedAt) return 'planner';
  if (message.createdAt > planner.endedAt) return 'lead';
  return 'lead-or-planner';
}

export type PostMergeStage = Extract<WorkflowStageId, 'code-review' | 'unit-tests'>;

/**
 * The post-merge stage a restart held, waiting for the owner's Continue (R-G: shown as
 * `needs-you` with no live agent of that stage while the run is in REVIEW). The tester's own
 * change waiting for review is also `needs-you`, but then a tester exists, so it is not held.
 */
export function heldStage(
  workflow: Pick<RunWorkflowDto, 'stages'> | undefined,
  run: Pick<RunDetailDto, 'status' | 'agents'>,
): PostMergeStage | null {
  if (workflow === undefined || run.status !== 'REVIEW') return null;
  for (const s of workflow.stages) {
    if (s.stage !== 'code-review' && s.stage !== 'unit-tests') continue;
    if (s.state !== 'needs-you') continue;
    const agents = run.agents.filter((a) => s.agentRunIds.includes(a.id));
    if (s.stage === 'unit-tests' && agents.length > 0) continue;
    if (agents.some((a) => isLiveAgentStatus(a.status))) continue;
    return s.stage;
  }
  return null;
}

/** The run's live state per stage; stages the route didn't list read as waiting. */
export function stageStates(
  workflow: Pick<RunWorkflowDto, 'stages'>,
): Readonly<Record<WorkflowStageId, WorkflowStageState>> {
  const out: Record<WorkflowStageId, WorkflowStageState> = {
    plan: 'waiting',
    orchestrate: 'waiting',
    helpers: 'waiting',
    review: 'waiting',
    'code-review': 'waiting',
    'unit-tests': 'waiting',
  };
  for (const s of workflow.stages) out[s.stage] = s.state;
  return out;
}

/** The run's planner mode, from its agents: a planner agent means a separate planner. */
export function runPlannerMode(
  run: Pick<RunDetailDto, 'agents'>,
  fallback: PlannerMode,
): PlannerMode {
  if (run.agents.some((a) => a.kind === 'planner')) return 'separate';
  // A ticket run creates its lead (and planner) at start, so no planner means the lead plans.
  return run.agents.some((a) => a.kind === 'lead') ? 'lead' : fallback;
}

/**
 * The run status word under the header repeats the ticket's stage pill for a current run (plan
 * review read "Plan review" there and "Plan ready for you" here before R-H), so it is shown only
 * for an earlier run, or when it says something the stage doesn't (stopping, interrupted).
 */
export function showRunStatus(isCurrent: boolean, status: RunStatus): boolean {
  return !isCurrent || status === 'CANCELLING' || status === 'NEEDS_REVIEW';
}

// --- The lead's chat after the lead ends (R-J; ADR-0020) -----------------------------------------

/**
 * The follow-up chat on the lead's own panel: the server's state once the lead has ended, or null
 * while the lead is live (the server leaves `followUp` out) and on every other agent's panel, so
 * the chat there works as before. A follow-up turn always resumes the lead, never the planner.
 */
export function leadFollowUp(
  run: Pick<RunDetailDto, 'followUp'>,
  agent: Pick<AgentRunDto, 'kind'>,
): RunFollowUpDto | null {
  return agent.kind === 'lead' ? (run.followUp ?? null) : null;
}
