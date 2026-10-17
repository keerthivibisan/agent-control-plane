import type { ReviewActionRequestSchema, TicketBranchReviewDto } from '@acp/core/api';
import { TicketBranchActionRequestSchema } from '@acp/core/api';
import type { WorkspaceRow } from '@acp/db';
import {
  beginChangeMerge,
  cancelRun,
  changeMergeBlocked,
  changeSealed,
  checkChangeAction,
  checksFinished,
  checkTicketBranchAction,
  recordChangeDecision,
  recordTicketBranchDecision,
  requestTicketChanges,
  ticketBranchCreated,
  type EngineContext,
  type EngineEffect,
  type EngineResult,
  type MergeBlocked,
  type Refusal,
  type RunState,
} from '@acp/orchestrator';
import type { z } from 'zod';
import { HttpError } from '../errors.js';
import { errorFields, type Logger } from '../logger.js';
import { WorkspaceError, type Workspace, type WorkspaceManager } from '../workspace/index.js';
import { refusalError, workspaceError } from './errors.js';
import { toTicketBranchDto } from './review-loop-dto.js';
import type { RunStore } from './store.js';

/**
 * The server half of the review loop (ADR-0021 §3–§4, docs/review-loop/README.md §6). The engine
 * decides; this module carries out its git effects with the workspace manager and reports back:
 *
 * - `seal-change`: commit the helper's worktree, then `changeSealed`; the sealed commit's checks
 *   start at once;
 * - `create-ticket-branch`: `acp/<KEY>` (or `-r<n>`) at plan approval, then `ticketBranchCreated`;
 * - `merge-change`: seal → integrate with the ticket tip (no difference: no-changes; a conflict:
 *   refused with the file names) → the required checks on that commit (or start them) → advance
 *   the ticket branch by compare-and-swap → `recordChangeDecision`, and release the worktree;
 * - `discard-change`: release the worktree;
 * - the owner's actions on one change and on the ticket branch (merge into the base branch once,
 *   merge anyway, request changes, discard, update from the base).
 *
 * Logs carry ids, codes and counts only: never a diff, a finding or chat text.
 */

/** What one `merge-change` came to; `reply` is the engine's text for the decider. */
export type MergeOutcome =
  | { kind: 'merged' | 'no-changes'; reply: string; overridden: readonly string[] }
  | { kind: 'blocked'; reply: string; blocked: MergeBlocked }
  | { kind: 'refused'; reply: string };

/** The parts of the control service's live run this module uses. */
export interface LoopLive {
  state: RunState;
  workspaces: Map<string, Workspace>;
  /** The merge under way per agent; the lead's `merge_change` and the owner's merge await it. */
  merges: Map<string, Promise<MergeOutcome>>;
  /** Merges of one run go one at a time: each integrates with the tip the previous one left. */
  mergeChain: Promise<unknown>;
  /** The latest commit whose checks were started per agent; only its result is reported. */
  checkTargets: Map<string, string>;
}

type Applied<T> = { ok: true; value: T } | { ok: false; refusal: Refusal };

/** The commit-checks hooks (the board's check service, ADR-0021 checks per commit). */
export interface CommitChecksHooks {
  gate(
    runId: string,
    agentRunId: string | null,
    commit: string,
  ): Promise<{
    passed: boolean;
    failedRequired: readonly string[];
    missing: readonly string[];
    running: boolean;
  }>;
  start(
    runId: string,
    agentRunId: string | null,
    commit: string,
    onFinished: (result: {
      commit: string;
      requiredPassed: boolean;
      failed: readonly string[];
    }) => void,
  ): void;
}

export interface ReviewLoopContext {
  store: RunStore;
  projectRoot(projectId: string): string | undefined;
  workspaces: WorkspaceManager;
  logger: Logger;
  commitChecks(): CommitChecksHooks | undefined;
  apply<T>(
    live: LoopLive,
    command: (state: RunState, c: EngineContext) => EngineResult<T>,
  ): Applied<T>;
  workspaceFor(live: LoopLive, row: WorkspaceRow): Promise<Workspace>;
  /** Awaited before a worktree goes, so its transcript is ingested first. */
  flushIngestion?: () => Promise<void>;
  track(promise: Promise<unknown>): void;
  countDiagnostic(code: string): void;
}

/** The change reviewer's brief holds at most this much diff (ADR-0021 §3; sent, never stored). */
export const REVIEWER_DIFF_MAX_BYTES = 64 * 1024;
/** `view_change`: the engine caps the whole reply at 32 KiB (`viewChangeReply`). */
export const VIEW_DIFF_MAX_BYTES = 32 * 1024;

type ReviewAction = z.infer<typeof ReviewActionRequestSchema>;

const BLOCKED_HTTP: Readonly<Record<MergeBlocked['reason'], [number, string]>> = {
  'merge-conflict': [409, 'merge_conflict'],
  'checks-pending': [409, 'checks_running'],
  'checks-failed': [409, 'checks_failed'],
  failed: [409, 'merge_failed'],
};

function codeOf(error: unknown): string {
  return error instanceof WorkspaceError ? error.code : errorFields(error).errorName;
}

export function createReviewLoop(ctx: ReviewLoopContext) {
  const { store, logger } = ctx;
  const loop = store.loopRepos;

  function projectRootOf(live: LoopLive): string {
    const root = ctx.projectRoot(live.state.run.projectId);
    if (root === undefined) throw new WorkspaceError('not-a-git-repo', 'The project is gone');
    return root;
  }

  function roleOf(live: LoopLive, agentRunId: string): string | undefined {
    return live.state.agents.find((a) => a.id === agentRunId)?.role;
  }

  async function activeWorkspace(live: LoopLive, agentRunId: string): Promise<Workspace | null> {
    const row = store.repos.workspaces.getByAgentRun(agentRunId);
    if (row === undefined || row.state !== 'active' || row.runId !== live.state.run.id) return null;
    return ctx.workspaceFor(live, row);
  }

  /** Removes a decided change's worktree and branch; the change's record stays. */
  async function release(live: LoopLive, agentRunId: string): Promise<void> {
    const runId = live.state.run.id;
    const row = store.repos.workspaces.getByAgentRun(agentRunId);
    if (row === undefined || row.state !== 'active') return;
    try {
      const ws = await ctx.workspaceFor(live, row);
      await ctx.flushIngestion?.().catch(() => undefined);
      await ctx.workspaces.discard(ws);
      store.repos.workspaces.markRemoved(row.id);
      live.workspaces.delete(agentRunId);
      logger.log('info', 'change worktree released', { runId, agentRunId });
    } catch (error) {
      logger.log('warn', 'change worktree release failed', {
        runId,
        agentRunId,
        code: codeOf(error),
      });
    }
  }

  /** Starts the required checks on `commit`; only the latest started commit's result reports. */
  function startChecks(live: LoopLive, agentRunId: string | null, commit: string): void {
    const checks = ctx.commitChecks();
    if (checks === undefined) return;
    const runId = live.state.run.id;
    if (agentRunId !== null) live.checkTargets.set(agentRunId, commit);
    checks.start(runId, agentRunId, commit, (result) => {
      if (agentRunId === null) return; // the ticket tip: the owner sees it with the branch
      if (live.checkTargets.get(agentRunId) !== commit) return; // superseded by a newer commit
      live.checkTargets.delete(agentRunId);
      const applied = ctx.apply(live, (s, c) => checksFinished(s, agentRunId, result, c));
      if (!applied.ok) {
        logger.log('info', 'checks result not recorded', {
          runId,
          agentRunId,
          code: applied.refusal.code,
        });
      }
    });
  }

  // ------------------------------------------------------------------ effects

  function sealChange(live: LoopLive, agentRunId: string): void {
    const runId = live.state.run.id;
    ctx.track(
      (async () => {
        let result: { changed: boolean; headCommit: string | null; changedFiles: number | null };
        try {
          const ws = await activeWorkspace(live, agentRunId);
          if (ws === null) {
            // It never got a worktree: there is nothing to review.
            result = { changed: false, headCommit: null, changedFiles: null };
          } else {
            const role = roleOf(live, agentRunId);
            const sealed = await ctx.workspaces.seal(ws, role === undefined ? {} : { role });
            const row = store.repos.workspaces.getByAgentRun(agentRunId);
            if (row !== undefined) {
              store.repos.workspaces.setReview(row.id, {
                reviewState: row.reviewState,
                changedFiles: sealed.changedFiles,
              });
            }
            result = sealed.changed
              ? { changed: true, headCommit: sealed.headCommit, changedFiles: sealed.changedFiles }
              : { changed: false, headCommit: null, changedFiles: 0 };
          }
        } catch (error) {
          // The work is there but could not be committed: the owner looks at it.
          logger.log('warn', 'change seal failed', { runId, agentRunId, code: codeOf(error) });
          result = { changed: true, headCommit: null, changedFiles: null };
        }
        const applied = ctx.apply(live, (s, c) => changeSealed(s, agentRunId, result, c));
        if (!applied.ok) {
          logger.log('info', 'change seal not recorded', {
            runId,
            agentRunId,
            code: applied.refusal.code,
          });
          return;
        }
        logger.log('info', 'change sealed', {
          runId,
          agentRunId,
          changed: result.changed,
          files: result.changedFiles,
        });
        if (!result.changed) await release(live, agentRunId);
        else if (result.headCommit !== null) startChecks(live, agentRunId, result.headCommit);
      })(),
    );
  }

  function createTicketBranch(live: LoopLive, ticketKey: string): void {
    const runId = live.state.run.id;
    ctx.track(
      (async () => {
        let branch: string;
        const existing = loop.ticketBranches.getByRun(runId);
        if (existing !== undefined) {
          branch = existing.branch;
        } else {
          try {
            const created = await ctx.workspaces.createTicketBranch(
              projectRootOf(live),
              ticketKey,
              // An open ticket branch of another run keeps its name, even if git lost it.
              (name) => loop.ticketBranches.getOpenByBranch(name) !== undefined,
            );
            loop.ticketBranches.insert({
              runId,
              projectId: live.state.run.projectId,
              branch: created.branch,
              baseBranch: created.baseBranch,
              baseCommit: created.baseCommit,
              headCommit: created.baseCommit,
            });
            branch = created.branch;
          } catch (error) {
            // No helper can start without it, and the engine has no command for a failed
            // creation (RL-A notes): the run is stopped, and the reason is in the log.
            ctx.countDiagnostic('ticket-branch-failed');
            logger.log('warn', 'ticket branch not created; run stopped', {
              runId,
              code: codeOf(error),
            });
            ctx.apply(live, cancelRun);
            return;
          }
        }
        const applied = ctx.apply(live, (s, c) => ticketBranchCreated(s, branch, c));
        if (!applied.ok) {
          logger.log('info', 'ticket branch not recorded', { runId, code: applied.refusal.code });
          return;
        }
        logger.log('info', 'ticket branch created', { runId });
      })(),
    );
  }

  function mergeChange(
    live: LoopLive,
    effect: Extract<EngineEffect, { type: 'merge-change' }>,
  ): void {
    const id = effect.agentRunId;
    const run = live.mergeChain.catch(() => undefined).then(() => doMerge(live, effect));
    live.mergeChain = run;
    live.merges.set(id, run);
    ctx.track(
      run.finally(() => {
        if (live.merges.get(id) === run) live.merges.delete(id);
      }),
    );
  }

  async function doMerge(
    live: LoopLive,
    effect: Extract<EngineEffect, { type: 'merge-change' }>,
  ): Promise<MergeOutcome> {
    const runId = live.state.run.id;
    const id = effect.agentRunId;
    const blocked = (b: MergeBlocked): MergeOutcome => {
      const r = ctx.apply(live, (s, c) => changeMergeBlocked(s, id, b, c));
      logger.log('info', 'change merge blocked', { runId, agentRunId: id, code: b.reason });
      return { kind: 'blocked', reply: r.ok ? r.value : r.refusal.message, blocked: b };
    };
    try {
      const ws = await activeWorkspace(live, id);
      const branch = loop.ticketBranches.getByRun(runId);
      if (ws === null || branch === undefined || branch.state !== 'open') {
        return blocked({ reason: 'failed' });
      }
      const ref = { projectRoot: projectRootOf(live), branch: branch.branch };
      const role = roleOf(live, id);
      // A stopped helper's unsealed work is sealed first; a sealed change is unchanged.
      await ctx.workspaces.seal(ws, role === undefined ? {} : { role });
      const tip = branch.headCommit;
      let integrated;
      try {
        integrated = await ctx.workspaces.integrate(ws, tip);
      } catch (error) {
        if (error instanceof WorkspaceError && error.code === 'merge-conflict') {
          return blocked({ reason: 'merge-conflict', files: error.conflictFiles });
        }
        throw error;
      }
      const decision = effect.anyway ? 'merge-anyway' : 'merge';
      if (integrated.outcome === 'no-changes') {
        const r = ctx.apply(live, (s, c) =>
          recordChangeDecision(s, id, { decision, by: effect.by, outcome: 'no-changes' }, c),
        );
        if (!r.ok) return { kind: 'refused', reply: r.refusal.message };
        await release(live, id);
        logger.log('info', 'change had no new work', { runId, agentRunId: id });
        return { kind: 'no-changes', reply: r.value, overridden: [] };
      }
      const commit = integrated.commit;
      const gate = (await ctx.commitChecks()?.gate(runId, id, commit)) ?? {
        passed: true,
        failedRequired: [],
        missing: [],
        running: false,
      };
      if (gate.running) return blocked({ reason: 'checks-pending' });
      if (gate.missing.length > 0) {
        // The required checks must pass on this very commit: start them; the lead hears back.
        startChecks(live, id, commit);
        return blocked({ reason: 'checks-pending' });
      }
      if (gate.failedRequired.length > 0 && !effect.anyway) {
        return blocked({ reason: 'checks-failed', failed: gate.failedRequired });
      }
      await ctx.workspaces.advanceTicketBranch(ref, tip, commit);
      if (loop.ticketBranches.advance(runId, tip, commit) === undefined) {
        // Git moved; the record did not: never claim a merge the record does not show.
        logger.log('error', 'ticket branch record not advanced', { runId, agentRunId: id });
        return blocked({ reason: 'failed' });
      }
      const r = ctx.apply(live, (s, c) =>
        recordChangeDecision(
          s,
          id,
          { decision, by: effect.by, outcome: 'merged', headCommit: commit },
          c,
        ),
      );
      if (!r.ok) {
        logger.log('error', 'change merge not recorded', { runId, code: r.refusal.code });
        return { kind: 'refused', reply: r.refusal.message };
      }
      logger.log('info', 'change merged into the ticket branch', {
        runId,
        agentRunId: id,
        by: effect.by,
        anyway: effect.anyway,
      });
      await release(live, id);
      return { kind: 'merged', reply: r.value, overridden: gate.failedRequired };
    } catch (error) {
      logger.log('warn', 'change merge failed', { runId, agentRunId: id, code: codeOf(error) });
      return blocked({ reason: 'failed' });
    }
  }

  function discardChange(live: LoopLive, agentRunId: string): void {
    ctx.track(release(live, agentRunId));
  }

  /**
   * The helper's change as a diff against the ticket branch tip (`tip...HEAD`), at most
   * `maxBytes`; null when it has no sealed worktree. Sent to an agent, never stored or logged.
   */
  async function changeDiff(
    live: LoopLive,
    agentRunId: string,
    maxBytes: number,
  ): Promise<{ diff: string; truncated: boolean } | null> {
    const runId = live.state.run.id;
    try {
      const ws = await activeWorkspace(live, agentRunId);
      if (ws === null) return null;
      const tip = loop.ticketBranches.getByRun(runId)?.headCommit ?? ws.baseCommit;
      const changes = await ctx.workspaces.changeDiff(ws, tip, { maxDiffBytes: maxBytes });
      return { diff: changes.diff, truncated: changes.diffTruncated };
    } catch (error) {
      logger.log('warn', 'change diff unavailable', { runId, agentRunId, code: codeOf(error) });
      return null;
    }
  }

  // ------------------------------------------------------------------ the owner's actions

  /** The owner's merge, merge anyway, discard or rework of one change (loop runs). */
  async function ownerChangeAction(
    live: LoopLive,
    input: ReviewAction,
    mergedAnyway: (failedChecks: readonly string[]) => void,
  ): Promise<void> {
    const id = input.agentRunId;
    const refusal = checkChangeAction(live.state, id, input.action, 'owner');
    if (refusal !== null) throw refusalError(refusal);
    if (input.action === 'discard' || input.action === 'rework') {
      const comments = input.action === 'rework' ? input.comment : input.reason;
      const r = ctx.apply(live, (s, c) =>
        recordChangeDecision(
          s,
          id,
          {
            decision: input.action === 'rework' ? 'rework' : 'discard',
            by: 'owner',
            ...(comments !== undefined && { comments }),
          },
          c,
        ),
      );
      if (!r.ok) throw refusalError(r.refusal);
      return;
    }
    const anyway = input.action === 'merge-anyway';
    const begun = ctx.apply(live, (s, c) => beginChangeMerge(s, id, { by: 'owner', anyway }, c));
    if (!begun.ok) throw refusalError(begun.refusal);
    const outcome = await live.merges.get(id);
    if (outcome === undefined)
      throw new HttpError(500, 'internal_error', 'The merge did not start');
    if (outcome.kind === 'blocked') {
      const [status, code] = BLOCKED_HTTP[outcome.blocked.reason];
      throw new HttpError(status, code, outcome.reply);
    }
    if (outcome.kind === 'refused') throw new HttpError(409, 'merge_refused', outcome.reply);
    if (anyway && outcome.kind === 'merged') mergedAnyway(outcome.overridden);
  }

  /** GET `/api/runs/:id/ticket-branch`: the combined change the owner merges once. */
  async function ticketBranchReview(live: LoopLive): Promise<TicketBranchReviewDto> {
    const runId = live.state.run.id;
    if (live.state.integration === undefined) {
      throw new HttpError(404, 'no_ticket_branch', 'This run has no ticket branch');
    }
    const row = loop.ticketBranches.getByRun(runId);
    if (row === undefined) {
      throw new HttpError(
        404,
        'no_ticket_branch',
        'The ticket branch is made when the plan is approved',
      );
    }
    const checks = loop.checkCommits.latestForCommit(runId, null, row.headCommit);
    const base = { runId, ticketBranch: toTicketBranchDto(row), checks };
    if (row.state !== 'open') {
      return { ...base, files: [], diff: '', diffTruncated: false, baseMoved: false };
    }
    try {
      const review = await ctx.workspaces.reviewTicketBranch({
        projectRoot: projectRootOf(live),
        branch: row.branch,
        baseBranch: row.baseBranch,
      });
      if (review.tip !== row.headCommit) {
        logger.log('warn', 'ticket branch moved outside the app', { runId });
      }
      return {
        ...base,
        files: review.files,
        diff: review.diff,
        diffTruncated: review.diffTruncated,
        baseMoved: review.baseMoved,
      };
    } catch (error) {
      if (error instanceof WorkspaceError) throw workspaceError(error);
      throw error;
    }
  }

  /** Every worktree of the run still on disk is released (the ticket branch was settled). */
  async function releaseAll(live: LoopLive): Promise<void> {
    for (const row of store.repos.workspaces.listForRun(live.state.run.id)) {
      if (row.state === 'active') await release(live, row.agentRunId);
    }
  }

  /** POST `/api/runs/:id/ticket-branch` (ADR-0021 §4). */
  async function ticketBranchAction(
    live: LoopLive,
    body: unknown,
    notes: {
      ownerComment: (text: string) => void;
    },
  ): Promise<void> {
    const input = TicketBranchActionRequestSchema.parse(body);
    const runId = live.state.run.id;
    const check = checkTicketBranchAction(live.state, input.action);
    if (check !== null) throw refusalError(check);
    const row = loop.ticketBranches.getByRun(runId);
    if (input.action === 'request-changes') {
      const comment = input.comment ?? '';
      const r = ctx.apply(live, (s, c) => requestTicketChanges(s, comment, c));
      if (!r.ok) throw refusalError(r.refusal);
      notes.ownerComment(comment);
      logger.log('info', 'ticket branch changes requested', { runId });
      return;
    }
    if (row === undefined || row.state !== 'open') {
      throw new HttpError(409, 'no_ticket_branch', 'This run has no open ticket branch');
    }
    const ref = {
      projectRoot: projectRootOf(live),
      branch: row.branch,
      baseBranch: row.baseBranch,
    };
    try {
      switch (input.action) {
        case 'discard': {
          await ctx.workspaces.discardTicketBranch(ref);
          loop.ticketBranches.markDiscarded(runId);
          const r = ctx.apply(live, (s, c) => recordTicketBranchDecision(s, 'discarded', c));
          if (!r.ok) throw refusalError(r.refusal);
          await releaseAll(live);
          logger.log('info', 'ticket branch discarded', { runId });
          return;
        }
        case 'update-from-base': {
          const updated = await ctx.workspaces.updateTicketFromBase(
            { ...ref, runId },
            row.headCommit,
          );
          if (updated.headCommit !== row.headCommit) {
            if (
              loop.ticketBranches.advance(runId, row.headCommit, updated.headCommit) === undefined
            ) {
              throw new HttpError(
                409,
                'ticket_branch_moved',
                'The ticket branch changed meanwhile',
              );
            }
            // The merged result is new code: its checks run again before the owner merges.
            startChecks(live, null, updated.headCommit);
          }
          logger.log('info', 'ticket branch updated from base', { runId });
          return;
        }
        case 'merge':
        case 'merge-anyway': {
          const gate = (await ctx.commitChecks()?.gate(runId, null, row.headCommit)) ?? {
            passed: true,
            failedRequired: [],
            missing: [],
            running: false,
          };
          if (gate.running) {
            throw new HttpError(
              409,
              'checks_running',
              'The checks are still running on the ticket branch',
            );
          }
          if (gate.missing.length > 0) {
            startChecks(live, null, row.headCommit);
            throw new HttpError(
              409,
              'checks_running',
              'The checks had not run on the ticket branch tip; they are running now',
            );
          }
          const failed = gate.failedRequired;
          if (input.action === 'merge' && failed.length > 0) {
            throw new HttpError(
              409,
              'checks_failed',
              `A required check did not pass (${failed.join(', ')}); fix it, or merge anyway with a reason`,
            );
          }
          if (input.action === 'merge-anyway' && failed.length === 0) {
            throw new HttpError(
              409,
              'merge_anyway_unavailable',
              'There are no failed checks to override; use merge instead',
            );
          }
          const merged = await ctx.workspaces.mergeTicketBranch(ref, row.headCommit);
          loop.ticketBranches.markMerged(runId, merged.commit);
          const r = ctx.apply(live, (s, c) => recordTicketBranchDecision(s, 'merged', c));
          if (!r.ok) throw refusalError(r.refusal);
          if (input.action === 'merge-anyway') {
            notes.ownerComment(
              `Merged ${row.branch} although required checks did not pass (${failed.join(', ')}). Reason: ${input.reason ?? ''}`,
            );
          }
          await releaseAll(live);
          logger.log('info', 'ticket branch merged', {
            runId,
            anyway: input.action === 'merge-anyway',
            branchDeleted: merged.branchDeleted,
          });
          return;
        }
      }
    } catch (error) {
      if (error instanceof WorkspaceError) {
        logger.log('info', 'ticket branch action refused', { runId, code: error.code });
        throw workspaceError(error);
      }
      throw error;
    }
  }

  return {
    sealChange,
    createTicketBranch,
    mergeChange,
    discardChange,
    changeDiff,
    ownerChangeAction,
    ticketBranchReview,
    ticketBranchAction,
  };
}

export type ReviewLoop = ReturnType<typeof createReviewLoop>;
