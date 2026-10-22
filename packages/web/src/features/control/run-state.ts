import type { AgentRunStatus, RunStatus } from '@acp/core';
import type { AgentRunDto, ApprovalDto, RunDetailDto } from '@acp/core/api';

/**
 * Pure rules the control panel reads from a run (orchestration-lifecycle §0). The server decides
 * what is allowed; these only decide which buttons to offer, so a refused action still shows the
 * server's reason.
 */

const LIVE_AGENT: ReadonlySet<AgentRunStatus> = new Set([
  'QUEUED',
  'STARTING',
  'RUNNING',
  'WAITING_APPROVAL',
  'BLOCKED',
]);

/** Runs that can still do work, so Stop all is offered. */
const LIVE_RUN: ReadonlySet<RunStatus> = new Set(['QUEUED', 'RUNNING', 'BLOCKED']);

/** Runs that have ended for good: no chat, no stopping. */
const ENDED_RUN: ReadonlySet<RunStatus> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function isAgentLive(status: AgentRunStatus): boolean {
  return LIVE_AGENT.has(status);
}

export function isRunLive(status: RunStatus): boolean {
  return LIVE_RUN.has(status);
}

/** The lead keeps listening while the owner reviews; a stopping or ended run doesn't. */
export function canChat(status: RunStatus): boolean {
  return !ENDED_RUN.has(status) && status !== 'CANCELLING';
}

/**
 * True when the engine, not the owner or a timeout, closed this agent as `CANCELLED` after the
 * work went well (R-R visual): it ends the lead in the same step that starts the reviewer or the
 * tester, and every agent still open in the step that completes the run, so the end time is the
 * same instant as that agent's start or the run's end. An owner's Stop has its own time, and a
 * timeout is `TIMED_OUT`, so both still read "Stopped" / "Timed out". The status is unchanged.
 */
export function closedByEngine(
  agent: Pick<AgentRunDto, 'status' | 'endedAt'>,
  run: Pick<RunDetailDto, 'status' | 'endedAt'> & {
    agents: readonly Pick<AgentRunDto, 'kind' | 'createdAt'>[];
  },
): boolean {
  if (agent.status !== 'CANCELLED' || agent.endedAt === null) return false;
  if (run.status === 'COMPLETED' && run.endedAt === agent.endedAt) return true;
  if (run.status !== 'REVIEW' && run.status !== 'COMPLETED') return false;
  return run.agents.some(
    (a) => (a.kind === 'reviewer' || a.kind === 'tester') && a.createdAt === agent.endedAt,
  );
}

export interface AgentNode {
  agent: AgentRunDto;
  children: AgentNode[];
}

const byCreated = (a: AgentRunDto, b: AgentRunDto) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;

/**
 * The run's agents as a tree, from `parentAgentRunId` only (recorded by the engine when the lead
 * started the agent). Agents without a parent, or whose parent is missing from the run, start
 * their own branch, leads first; every agent appears exactly once, none is hidden.
 */
export function buildAgentTree(agents: readonly AgentRunDto[]): AgentNode[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const placed = new Set<string>();
  const node = (a: AgentRunDto): AgentNode | null => {
    if (placed.has(a.id)) return null;
    placed.add(a.id);
    const children = agents
      .filter((c) => c.parentAgentRunId === a.id && c.id !== a.id)
      .sort(byCreated)
      .map(node)
      .filter((n): n is AgentNode => n !== null);
    return { agent: a, children };
  };
  const roots = agents
    .filter((a) => a.parentAgentRunId === null || !byId.has(a.parentAgentRunId))
    .sort((a, b) => (a.kind === b.kind ? byCreated(a, b) : a.kind === 'lead' ? -1 : 1));
  const out: AgentNode[] = [];
  for (const a of [...roots, ...[...agents].sort(byCreated)]) {
    const n = node(a);
    if (n) out.push(n);
  }
  return out;
}

/** Waiting approvals first-come first-served; the rest newest first. */
export function splitApprovals(approvals: readonly ApprovalDto[]): {
  pending: ApprovalDto[];
  decided: ApprovalDto[];
} {
  const pending = approvals
    .filter((a) => a.status === 'pending')
    .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : 1));
  const decided = approvals
    .filter((a) => a.status !== 'pending')
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  return { pending, decided };
}

/** Whether any helper agent has changes to look at (so the review is worth fetching). */
export function hasReview(run: Pick<RunDetailDto, 'agents'>): boolean {
  return run.agents.some((a) => a.review !== null);
}

export interface BudgetView {
  /** 0–100, for the bar's width. */
  percent: number;
  /** Budget tokens past the limit (soft cap, ADR-0014), or 0 when within it. */
  over: number;
  level: 'ok' | 'near' | 'over';
}

/** Budget bar state. A zero limit with any use counts as full. */
export function budgetView(budget: AgentRunDto['budget']): BudgetView {
  const { used, limit } = budget;
  const ratio = limit > 0 ? used / limit : used > 0 ? Infinity : 0;
  const over = Math.max(0, used - limit);
  return {
    percent: Math.min(100, Math.round(ratio * 1000) / 10),
    over,
    level: ratio >= 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok',
  };
}
