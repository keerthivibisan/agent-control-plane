import { randomUUID } from 'node:crypto';
import {
  DbError,
  MAX_ORCHESTRATOR_MESSAGE_LENGTH,
  createOrchestrationRepositories,
  createRedesignRepositories,
  createReviewLoopRepositories,
  createWorkspaceRepositories,
  withTransaction,
  type AcpDatabase,
  type OrchestrationRepositories,
  type RedesignRepositories,
  type ReviewLoopRepositories,
  type StoredRunSnapshot,
  type WorkspaceChange,
  type WorkspaceRepositories,
  type WorkspaceRow,
} from '@acp/db';
import {
  DEFAULT_RUN_LIMITS,
  EMPTY_LEDGER,
  isLiveAgentStatus,
  type EngineAgent,
  type EngineApproval,
  type EngineChange,
  type EngineEffect,
  type RunState,
} from '@acp/orchestrator';
import type { OrchestrationRun, TicketPlan } from '@acp/core';
import { hasReviewableChange } from './roles.js';

/**
 * Persists engine states (orchestration-lifecycle §1: every transition is persisted before its
 * effects run). The engine owns ids for runs, agents and approvals; the repositories normally make
 * their own, so each insert is handed the engine's id through a one-shot id slot.
 */
export interface RunStore {
  readonly repos: OrchestrationRepositories;
  /** Ticket plans are written with the run state (ADR-0016: the lead's plans are stored). */
  readonly workspaceRepos: WorkspaceRepositories;
  /**
   * Writes the difference between `prev` (null for a new run) and `next` in one transaction,
   * together with the chat lines, session links and reviewer comments among `effects` (they are
   * data, not actions).
   * Throws, and writes nothing, if any write fails.
   */
  commit(prev: RunState | null, next: RunState, effects: readonly EngineEffect[]): void;
  /** Migration 0004 columns: approval deciders, the run snapshot, agent stages (R-G). */
  readonly redesignRepos: RedesignRepositories;
  /**
   * Migration 0006 (ADR-0021): ticket branches, change review rounds, the change columns of
   * workspaces, check commits and approval allow rules.
   */
  readonly loopRepos: ReviewLoopRepositories;
  /**
   * Rebuilds an engine state from the database (restart, or a run not held in memory). Plans, the
   * run snapshot (limits, workflow, held stages), each agent's stage and each approval's
   * `decidedBy` come back with the run (migration 0004; rows written before it have no snapshot,
   * so they keep the Phase 3 defaults, and no decider). `awaitingHelpers`, `leadBrief` and
   * `reviewPosts` are kept with the live run only: after a restart no agent is live. Live runs are
   * never reloaded while the server runs, and after a restart nothing is relaunched.
   */
  load(runId: string): RunState | undefined;
}

export interface RunStoreDeps {
  db: AcpDatabase;
  now: () => Date;
}

/**
 * A loop run's change as stored (ADR-0021): state, rounds and commit come back; everything else
 * lived with the run only and starts empty (after a restart every undecided change is the
 * owner's, `recoverAfterRestart`).
 */
function changeOf(
  stored: WorkspaceChange | undefined,
  workspace: WorkspaceRow | undefined,
): Pick<EngineAgent, 'change'> {
  if (stored === undefined || stored.changeState === null) return {};
  return {
    change: {
      state: stored.changeState,
      round: stored.reworkRounds,
      verdict: null,
      reviewer: null,
      reviewerAgentRunId: null,
      headCommit: stored.headCommit,
      changedFiles: workspace?.changedFiles ?? null,
      readyAt: null,
      checks: null,
      conflictFiles: [],
      merging: false,
      turnFailed: false,
    },
  };
}

/** `EngineAgent.stage` is optional: absent (not undefined) for agents without one. */
function withStage(stage: EngineAgent['stage'] | null): Pick<EngineAgent, 'stage'> {
  return stage === null || stage === undefined ? {} : { stage };
}

export function createRunStore(deps: RunStoreDeps): RunStore {
  const ids: string[] = [];
  const repoOptions = { now: deps.now, newId: () => ids.shift() ?? randomUUID() };
  const repos = createOrchestrationRepositories(deps.db, repoOptions);
  const workspaceRepos = createWorkspaceRepositories(deps.db, repoOptions);
  const redesignRepos = createRedesignRepositories(deps.db, repoOptions);
  const loopRepos = createReviewLoopRepositories(deps.db, repoOptions);

  /** Runs one insert with the engine's id; the slot is always empty again afterwards. */
  function withId<T>(id: string, insert: () => T): T {
    ids.length = 0;
    ids.push(id);
    try {
      return insert();
    } finally {
      ids.length = 0;
    }
  }

  /**
   * What `orchestration_runs.limits` holds for a state: the limits (ADR-0013 amendment), the
   * workflow snapshot (ADR-0019) and the held-stages flag. Null when there is none of them (a
   * Phase 3 run). A workflow without limits stores the Phase 3 defaults, which is what the engine
   * applies to such a run anyway.
   */
  function snapshotOf(state: RunState): StoredRunSnapshot | null {
    if (
      state.limits === undefined &&
      state.workflow === undefined &&
      state.stagesHeld !== true &&
      state.integration === undefined &&
      state.approvalPolicy === undefined
    ) {
      return null;
    }
    const limits = state.limits ?? DEFAULT_RUN_LIMITS;
    const snapshot: StoredRunSnapshot = {
      maxConcurrentHelpers: limits.maxConcurrentHelpers,
      maxDepth: limits.maxDepth,
    };
    if (state.workflow !== undefined) snapshot.workflow = state.workflow;
    // Stored so a second restart cannot start a held stage by itself (`continueStages` only).
    if (state.stagesHeld === true) snapshot.stagesHeld = true;
    // ADR-0021: the approval policy and the review loop are snapshotted with the run.
    if (state.approvalPolicy !== undefined) snapshot.approvals = state.approvalPolicy;
    if (state.integration !== undefined) snapshot.integration = { ...state.integration };
    return snapshot;
  }

  function syncSnapshot(prev: RunState | null, next: RunState): void {
    const after = snapshotOf(next);
    const before = prev === null ? null : snapshotOf(prev);
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    redesignRepos.runAudit.setRunSnapshot(next.run.id, after);
  }

  /** The agent's primary Claude Code session id (provider id), or `fallback` without one. */
  function providerSession(agentRunId: string, fallback: string | null): string | null {
    const link = repos.agentRunSessions
      .listForAgentRun(agentRunId)
      .find((l) => l.provider === 'claude-code' && l.relation === 'primary');
    return link?.providerSessionId ?? fallback;
  }

  function syncRun(prev: OrchestrationRun | null, next: OrchestrationRun): void {
    if (prev === null) {
      withId(next.id, () =>
        repos.runs.insert({
          projectId: next.projectId,
          ticketId: next.ticketId,
          title: next.title,
          budget: next.budget,
          status: next.status,
        }),
      );
      return;
    }
    if (prev.status !== next.status || prev.endedAt !== next.endedAt) {
      // The `from` guard catches a second writer: memory and database must agree before a change.
      repos.runs.setStatus(next.id, next.status, { from: [prev.status], endedAt: next.endedAt });
    }
    if (
      prev.budget.maxTokensPerAgent !== next.budget.maxTokensPerAgent ||
      prev.budget.softCostUsdPerRun !== next.budget.softCostUsdPerRun
    ) {
      repos.runs.setBudget(next.id, next.budget);
    }
  }

  function syncAgent(prev: EngineAgent | undefined, next: EngineAgent): void {
    if (prev === undefined) {
      withId(next.id, () =>
        repos.agentRuns.insert({
          runId: next.runId,
          kind: next.kind,
          parentAgentRunId: next.parentAgentRunId,
          role: next.role,
          task: next.task,
          budgetTokensLimit: next.budgetLimit,
          status: next.status,
        }),
      );
      if (next.endedAt !== null) {
        repos.agentRuns.setStatus(next.id, next.status, { endedAt: next.endedAt });
      }
      if (next.budgetTokensUsed !== 0) {
        repos.agentRuns.setBudgetTokensUsed(next.id, next.budgetTokensUsed);
      }
      if (next.stage !== undefined) redesignRepos.runAudit.setAgentStage(next.id, next.stage);
      return;
    }
    if (prev.stage !== next.stage) {
      redesignRepos.runAudit.setAgentStage(next.id, next.stage ?? null);
    }
    if (prev.status !== next.status || prev.endedAt !== next.endedAt) {
      repos.agentRuns.setStatus(next.id, next.status, {
        from: [prev.status],
        endedAt: next.endedAt,
      });
    }
    if (prev.budgetTokensUsed !== next.budgetTokensUsed) {
      repos.agentRuns.setBudgetTokensUsed(next.id, next.budgetTokensUsed);
    }
    if (prev.budgetLimit !== next.budgetLimit) {
      repos.agentRuns.setBudgetTokensLimit(next.id, next.budgetLimit);
    }
    if (next.review !== null && prev.review !== next.review) {
      const ws = repos.workspaces.getByAgentRun(next.id);
      if (ws !== undefined) repos.workspaces.setReview(ws.id, { reviewState: next.review });
    }
    syncChange(next.id, prev.change, next.change);
  }

  /**
   * The persisted part of a change (ADR-0021): its state, rounds used and commit, on the agent's
   * workspace row. An agent without a workspace (it never got one) has nothing to store: its
   * change can only be empty.
   */
  function syncChange(
    agentRunId: string,
    prev: EngineChange | undefined,
    next: EngineChange | undefined,
  ): void {
    if (next === undefined) return;
    if (
      prev !== undefined &&
      prev.state === next.state &&
      prev.round === next.round &&
      prev.headCommit === next.headCommit
    ) {
      return;
    }
    loopRepos.workspaceChanges.set(agentRunId, {
      changeState: next.state,
      reworkRounds: next.round,
      headCommit: next.headCommit,
    });
  }

  function syncApproval(prev: EngineApproval | undefined, next: EngineApproval): void {
    if (prev === undefined) {
      withId(next.id, () =>
        repos.approvals.insert({
          runId: next.runId,
          agentRunId: next.agentRunId,
          kind: next.kind,
          toolName: next.toolName,
          summary: next.summary,
        }),
      );
    }
    if (next.status !== 'pending' && prev?.status !== next.status) {
      repos.approvals.decide(next.id, next.status, next.decidedAt ?? undefined);
    }
    // Who decided (ApprovalDto.decidedBy). Written when it is first known or changes; the engine
    // leaves it null when it closed the approval because the agent or run stopped.
    const decidedBy = next.decidedBy ?? null;
    if (decidedBy !== (prev?.decidedBy ?? null)) {
      redesignRepos.runAudit.setApprovalDecidedBy(next.id, decidedBy);
    }
    // ADR-0021: which rule let it run without asking (approvals decided by `allowlist`).
    const allowRule = next.allowRule ?? null;
    if (allowRule !== (prev?.allowRule ?? null)) loopRepos.approvalRules.set(next.id, allowRule);
  }

  /** The `change_reviews` row of (agent, round), creating it when the round is new. */
  function roundRow(
    runId: string,
    agentRunId: string,
    round: number,
    reviewer: { kind: 'agent' | 'lead' | 'owner'; agentRunId: string | null },
  ) {
    // The latest row of the round: a round the lead passed to the owner gets a second row.
    const existing = loopRepos.changeReviews
      .listForAgentRun(agentRunId)
      .filter((r) => r.round === round)
      .at(-1);
    if (existing !== undefined) return existing;
    return loopRepos.changeReviews.insert({
      runId,
      agentRunId,
      round,
      reviewer: reviewer.kind,
      reviewerAgentRunId: reviewer.agentRunId,
    });
  }

  /**
   * Plan versions (ADR-0016). Decisions on existing plans are written before new versions, so the
   * database never holds two proposed plans for a run. The engine numbers versions the same way
   * the repository does; a mismatch means memory and database disagree, and the commit fails.
   */
  function syncPlans(prev: readonly TicketPlan[], next: readonly TicketPlan[]): void {
    const before = new Map(prev.map((p) => [p.id, p]));
    for (const plan of next) {
      const old = before.get(plan.id);
      if (old === undefined || old.status === plan.status) continue;
      const at = plan.decidedAt ?? undefined;
      if (plan.status === 'approved' || plan.status === 'changes-requested') {
        workspaceRepos.plans.decide(plan.id, plan.status, at);
      } else if (plan.status === 'superseded') {
        workspaceRepos.plans.supersedeProposed(plan.runId, at);
      }
    }
    for (const plan of next) {
      if (before.has(plan.id)) continue;
      const stored = withId(plan.id, () =>
        workspaceRepos.plans.insert({
          ticketId: plan.ticketId,
          runId: plan.runId,
          summary: plan.summary,
          steps: [...plan.steps],
        }),
      );
      if (stored.version !== plan.version) {
        throw new DbError('conflict', 'stored plan version differs from the engine state');
      }
    }
  }

  function applyDataEffects(next: RunState, effects: readonly EngineEffect[]): void {
    const runId = next.run.id;
    for (const effect of effects) {
      if (effect.type === 'review-comment') {
        // ADR-0019: a reviewer finding is a ticket comment (ADR-0016's stored scope). The engine
        // already redacted it and capped it at the comment limit.
        const ticketId = next.run.ticketId;
        if (ticketId === null)
          throw new DbError('invalid_input', 'a review comment needs a ticket');
        const comment = workspaceRepos.comments.insert({
          ticketId,
          runId,
          planId: null,
          author: 'reviewer',
          body: effect.body,
        });
        // ADR-0021 §6: a change reviewer's findings; its round row points at the comment.
        if (effect.changeOf !== undefined && effect.round !== undefined) {
          const row = roundRow(runId, effect.changeOf, effect.round, {
            kind: 'agent',
            agentRunId: effect.agentRunId,
          });
          if (effect.verdict !== undefined) {
            loopRepos.changeReviews.setVerdict(row.id, effect.verdict, comment.id);
          } else {
            loopRepos.changeReviews.setComment(row.id, comment.id);
          }
        }
        continue;
      }
      if (effect.type === 'change-round') {
        // ADR-0021 §3: one row per review round and decision; no text (notes are comments).
        let row = roundRow(runId, effect.agentRunId, effect.round, {
          kind: effect.reviewer,
          agentRunId: effect.reviewerAgentRunId,
        });
        if (effect.verdict !== null && row.verdict !== effect.verdict) {
          row = loopRepos.changeReviews.setVerdict(row.id, effect.verdict, null) ?? row;
        }
        if (effect.decision !== null && effect.decidedBy !== null) {
          if (row.decision !== null && row.decision !== effect.decision) {
            // A second decision on the round (the owner's, after the lead asked): its own row.
            row = loopRepos.changeReviews.insert({
              runId,
              agentRunId: effect.agentRunId,
              round: effect.round,
              reviewer: effect.decidedBy === 'owner' ? 'owner' : effect.reviewer,
            });
          }
          if (row.decision === null) {
            loopRepos.changeReviews.decide(row.id, {
              decision: effect.decision,
              decidedBy: effect.decidedBy,
            });
          }
        }
        continue;
      }
      if (effect.type === 'change-comment') {
        // ADR-0021 §6: the lead's or owner's rework comments, discard reason or question, kept as
        // a ticket comment by that author and linked from the round's row.
        const ticketId = next.run.ticketId;
        if (ticketId === null) throw new DbError('invalid_input', 'a change note needs a ticket');
        const comment = workspaceRepos.comments.insert({
          ticketId,
          runId,
          planId: null,
          author: effect.author,
          body: effect.body,
        });
        const row = roundRow(runId, effect.agentRunId, effect.round, {
          kind: effect.author,
          agentRunId: null,
        });
        loopRepos.changeReviews.setComment(row.id, comment.id);
        continue;
      }
      if (effect.type === 'chat-message') {
        // ADR-0015: owner messages and lead replies only. A reply longer than the column allows
        // is cut rather than losing the whole transition.
        repos.messages.insert({
          runId,
          role: effect.role,
          text: effect.text.slice(0, MAX_ORCHESTRATOR_MESSAGE_LENGTH),
        });
      } else if (effect.type === 'link-session') {
        try {
          repos.agentRunSessions.link({
            agentRunId: effect.agentRunId,
            provider: 'claude-code',
            providerSessionId: effect.providerSessionId,
            relation: 'primary',
          });
        } catch (error) {
          // A second `started` with another session id: keep the first link (it is evidence).
          if (!(error instanceof DbError && error.code === 'conflict')) throw error;
        }
      }
    }
  }

  return {
    repos,
    workspaceRepos,
    redesignRepos,
    loopRepos,
    commit(prev, next, effects) {
      withTransaction(deps.db, () => {
        syncRun(prev?.run ?? null, next.run);
        syncSnapshot(prev, next);
        const prevAgents = new Map(prev?.agents.map((a) => [a.id, a]));
        for (const agent of next.agents) syncAgent(prevAgents.get(agent.id), agent);
        const prevApprovals = new Map(prev?.approvals.map((a) => [a.id, a]));
        for (const approval of next.approvals) {
          syncApproval(prevApprovals.get(approval.id), approval);
        }
        syncPlans(prev?.plans ?? [], next.plans ?? []);
        applyDataEffects(next, effects);
      });
    },
    load(runId) {
      const run = repos.runs.getById(runId);
      if (run === undefined) return undefined;
      const workspaces = new Map<string, WorkspaceRow>(
        repos.workspaces.listForRun(runId).map((w) => [w.agentRunId, w]),
      );
      const stages = redesignRepos.runAudit.agentStagesForRun(runId);
      const snapshot = redesignRepos.runAudit.getRunSnapshot(runId);
      const loop = snapshot?.integration !== undefined;
      const changes = new Map(
        loop ? loopRepos.workspaceChanges.listForRun(runId).map((c) => [c.agentRunId, c]) : [],
      );
      const agents: EngineAgent[] = repos.agentRuns.listForRun(runId).map((a) => ({
        id: a.id,
        runId: a.runId,
        parentAgentRunId: a.parentAgentRunId,
        kind: a.kind,
        role: a.role,
        task: a.task,
        status: a.status,
        // ADR-0021 (RL-A notes): a loop helper's rework resumes its provider session, which the
        // engine keeps in `sessionId` while live; after a reload it comes from the session link.
        sessionId:
          loop && hasReviewableChange(a.kind) ? providerSession(a.id, a.sessionId) : a.sessionId,
        budgetTokensUsed: a.budgetTokensUsed,
        createdAt: a.createdAt,
        endedAt: a.endedAt,
        budgetLimit: a.budgetTokensLimit,
        // Kept in memory only (content-free, but not part of the audit trail).
        latestActivity: null,
        review:
          !hasReviewableChange(a.kind) || isLiveAgentStatus(a.status)
            ? null
            : (workspaces.get(a.id)?.reviewState ?? (loop ? 'no-changes' : 'pending')),
        reportedCostUsd: null,
        ...withStage(stages.get(a.id) ?? null),
        ...changeOf(changes.get(a.id), workspaces.get(a.id)),
      }));
      const deciders = redesignRepos.runAudit.approvalDecidersForRun(runId);
      const rules = loopRepos.approvalRules.forRun(runId);
      const approvals: EngineApproval[] = repos.approvals.listForRun(runId).map((a) => {
        const rule = rules.get(a.id) ?? null;
        return {
          ...a,
          // The SDK's tool-use id is only needed while the callback is parked; it is not stored.
          toolUseId: null,
          decidedBy: deciders.get(a.id) ?? null,
          ...(rule !== null && { allowRule: rule }),
        };
      });
      // Usage is only accounted while agents are live; after a restart they never are again.
      const state: RunState = { run, agents, approvals, ledger: EMPTY_LEDGER };
      if (snapshot !== null) {
        state.limits = {
          maxConcurrentHelpers: snapshot.maxConcurrentHelpers,
          maxDepth: snapshot.maxDepth,
        };
        if (snapshot.workflow !== undefined) state.workflow = snapshot.workflow;
        if (snapshot.stagesHeld === true) state.stagesHeld = true;
        if (snapshot.approvals !== undefined) state.approvalPolicy = snapshot.approvals;
        if (snapshot.integration !== undefined) state.integration = { ...snapshot.integration };
      }
      if (run.ticketId !== null) state.plans = workspaceRepos.plans.listForRun(runId);
      return state;
    },
  };
}
