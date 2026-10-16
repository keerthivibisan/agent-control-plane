import type { CheckRunStatus, RunStatus } from '@acp/core';
import type {
  AgentRunDto,
  CheckRunDto,
  ReviewDto,
  RunDetailDto,
  RunSummaryDto,
  TicketCommentDto,
  TicketDetailDto,
  TicketPlanDto,
} from '@acp/core/api';
import type { AgentNode } from '../control/run-state';

/**
 * Pure rules the ticket page reads from a `TicketDetailDto` (docs/phase-4/README.md §5.3). The
 * server decides what is allowed; these only decide what to show and which buttons to offer, so a
 * refused action still shows the server's reason.
 */

/** Check outcomes that block a plain Merge when the check is required (ADR-0017). */
const FAILING: ReadonlySet<CheckRunStatus> = new Set(['failed', 'timed-out', 'error']);

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
  if (agent.kind === 'lead') return null;
  return agent.branch ?? review?.branch ?? null;
}
