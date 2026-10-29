import type {
  ReviewActionRequestSchema,
  TicketBranchDto,
  TicketBranchReviewDto,
} from '@acp/core/api';
import {
  OpenPullRequestRequestSchema,
  ResetTicketBranchRequestSchema,
  TicketBranchActionRequestSchema,
} from '@acp/core/api';
import type { CheckRun } from '@acp/core';
import type { TicketBranchRow, WorkspaceRow } from '@acp/db';
import {
  CHECK_FAILURE_TAIL_MAX_BYTES,
  beginChangeMerge,
  cancelRun,
  changeChecksFinished,
  changeMergeBlocked,
  changeSealed,
  checkChangeAction,
  checksFinished,
  checkTicketBranchAction,
  recordChangeDecision,
  recordTicketBranchDecision,
  requestTicketChanges,
  programOf,
  ticketBranchCreated,
  type EngineContext,
  type EngineEffect,
  type EngineResult,
  type FailedCheck,
  type MergeBlocked,
  type Refusal,
  type RunState,
  type SealFailure,
} from '@acp/orchestrator';
import type { z } from 'zod';
import {
  CodeHostError,
  codeHostHttpError,
  withPresence,
  type CodeHostService,
} from '../code-host/index.js';
import { HttpError } from '../errors.js';
import {
  branchSpec,
  changeSpec,
  mergeSpec,
  runsNothing,
  type CheckSpec,
} from '../harness/index.js';
import { errorFields, type Logger } from '../logger.js';
import {
  WorkspaceError,
  legacyTicketBranchPlan,
  strategyProtectedNames,
  ticketBranchPlan,
  type TicketBranchPlan,
  type TicketBranchRef,
  type Workspace,
  type WorkspaceManager,
} from '../workspace/index.js';
import { refusalError, workspaceError } from './errors.js';
import { toTicketBranchDto } from './review-loop-dto.js';
import {
  isRunSummaryComment,
  mergeLine,
  pullRequestMergeLine,
  pullRequestOpenedLine,
  tally,
} from './run-summary.js';
import type { RunStore } from './store.js';

/**
 * The server half of the review loop (ADR-0021 §3–§4, docs/history/review-loop/README.md §6). The
 * engine decides; this module carries out its git effects with the workspace manager and
 * reports back:
 *
 * - `seal-change`: commit the helper's worktree, then `changeSealed`; the sealed commit's checks
 *   start at once;
 * - `create-ticket-branch`: at plan approval, named by the ticket or the project's branching
 *   strategy (`acp/<KEY>` without one; `-r<n>` when taken) and created from its target branch
 *   (ADR-0025), then `ticketBranchCreated`;
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

/**
 * The commit-checks hooks (the board's check service, ADR-0021 checks per commit). `spec`
 * (ADR-0027 §5) says which checks run and gate at that place; absent, the merge block's for a
 * change and the ticket branch's for the tip.
 */
export interface CommitChecksHooks {
  gate(
    runId: string,
    agentRunId: string | null,
    commit: string,
    spec?: CheckSpec,
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
      results?: readonly CheckRun[];
    }) => void,
    spec?: CheckSpec,
    options?: { skipPassed?: boolean },
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
  /** ADR-0024 §3 style app comment on the run's ticket (app data only); absent in some tests. */
  appComment?: (live: LoopLive, text: string) => void;
  /** ADR-0025: pushes and pull requests; absent where the server has none (some tests). */
  codeHost?: CodeHostService;
  /** Tells the clients the run's ticket branch changed without an engine transition. */
  notify?: (live: LoopLive) => void;
  /** Awaited before a worktree goes, so its transcript is ingested first. */
  flushIngestion?: () => Promise<void>;
  track(promise: Promise<unknown>): void;
  countDiagnostic(code: string): void;
  /**
   * ADR-0030: the gate for the owner's merge of exactly this tip when a current conflict
   * resolution skipped its checks by the project's policy (only its always-run checks); null
   * keeps the workflow's own gate.
   */
  tipGate?: (runId: string, tip: string) => CheckSpec | null;
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
  'ticket-branch-moved': [409, 'ticket_branch_moved'],
  'ticket-branch-checked-out': [409, 'ticket_branch_checked_out'],
  failed: [409, 'merge_failed'],
};

/**
 * F-2: what the owner reads when their merge of a change could not succeed now. The engine's reply
 * is written for the lead ("do not try the merge again").
 */
const OWNER_BLOCKED: Partial<Record<MergeBlocked['reason'], string>> = {
  'ticket-branch-moved':
    'The ticket branch was changed outside the app, so nothing can be merged into it. Reset it to the last reviewed commit first, or discard it.',
  'ticket-branch-checked-out':
    'The ticket branch is checked out in another folder, so nothing can be merged into it. Switch that folder to another branch first.',
};

/** F-1: the ticket comment when a helper's folder left its branch (after the role's name). */
export const HELPER_BRANCH_CHANGED =
  'The helper switched its folder to another branch, so its work could not be saved. The lead can discard it and start a fresh helper.';

/** F-1: the ticket's app line after the owner reset the ticket branch (app data only). */
export function resetLine(branch: string, recorded: string, from: string): string {
  return `${branch} was reset to ${recorded.slice(0, 7)}, the last reviewed commit, by the owner. It had been changed outside the app (it was at ${from.slice(0, 7)}).`;
}

/** The ticket comment when the ticket branch could not be made (the run is stopped). */
export function ticketBranchFailed(error: WorkspaceError): string {
  return `The ticket branch was not created, so the run was stopped: ${error.message}.`.replace(
    /\.\.$/,
    '.',
  );
}

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

  /**
   * ADR-0025: the ticket branch's name, target and source (§10) from the ticket's own settings
   * and the project's strategy, read now (at plan approval). A run without a ticket, or whose
   * ticket is gone, keeps the legacy plan for its key.
   */
  function planFor(live: LoopLive, ticketKey: string): TicketBranchPlan {
    const ticketId = live.state.run.ticketId;
    const ticket = ticketId === null ? undefined : store.workspaceRepos.tickets.getById(ticketId);
    if (ticket === undefined || ticket.key !== ticketKey) return legacyTicketBranchPlan(ticketKey);
    const strategy = store.workspaceRepos.projectSetup.get(live.state.run.projectId)?.branching;
    const branch = loop.ticketBranchPrefs.get(ticket.id);
    return ticketBranchPlan(strategy, { ...ticket, ...(branch !== undefined && { branch }) });
  }

  /** The recorded ticket branch as the manager's ref, with the project's long-lived names. */
  function refOf(live: LoopLive, row: TicketBranchRow): TicketBranchRef {
    const strategy = store.workspaceRepos.projectSetup.get(live.state.run.projectId)?.branching;
    return {
      projectRoot: projectRootOf(live),
      branch: row.branch,
      baseBranch: row.baseBranch,
      protectedNames: strategyProtectedNames(strategy),
    };
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

  /** The run's compiled program, or null (a stored graph the validator refuses: old defaults). */
  function programFor(live: LoopLive) {
    try {
      return programOf(live.state);
    } catch {
      return null;
    }
  }

  /** ADR-0027 §5: the merge block's checks (`merge_change`, and the early run on a seal). */
  function mergeChecks(live: LoopLive): CheckSpec {
    return mergeSpec(programFor(live));
  }

  /** ADR-0027 §5: the ticket branch's checks (the owner's merge, the branch block). */
  function branchChecks(live: LoopLive): CheckSpec {
    return branchSpec(programFor(live));
  }

  /**
   * Starts the merge block's checks on `commit` (the ticket branch's for the tip); only the
   * latest started commit's result reports.
   */
  function startChecks(
    live: LoopLive,
    agentRunId: string | null,
    commit: string,
    options: { skipPassed?: boolean } = {},
  ): void {
    const checks = ctx.commitChecks();
    if (checks === undefined) return;
    const runId = live.state.run.id;
    const spec = agentRunId === null ? branchChecks(live) : mergeChecks(live);
    // ADR-0028 §2: no Checks block at this place: nothing runs, so nothing reports back either.
    if (runsNothing(spec)) return;
    if (agentRunId !== null) live.checkTargets.set(agentRunId, commit);
    checks.start(
      runId,
      agentRunId,
      commit,
      (result) => {
        if (agentRunId === null) return; // the ticket tip: the owner sees it with the branch
        if (live.checkTargets.get(agentRunId) !== commit) return; // superseded by a newer commit
        live.checkTargets.delete(agentRunId);
        const applied = ctx.apply(live, (s, c) =>
          checksFinished(
            s,
            agentRunId,
            { commit: result.commit, requiredPassed: result.requiredPassed, failed: result.failed },
            c,
          ),
        );
        if (!applied.ok) {
          logger.log('info', 'checks result not recorded', {
            runId,
            agentRunId,
            code: applied.refusal.code,
          });
        }
      },
      spec,
      options,
    );
  }

  /** The last `max` UTF-8 bytes of a check's (already redacted) output. */
  function tailBytes(text: string, max: number): string {
    const buf = Buffer.from(text, 'utf8');
    if (buf.length <= max) return text;
    // Skip continuation bytes so the cut never splits a character.
    let start = buf.length - max;
    while (start < buf.length && ((buf[start] ?? 0) & 0xc0) === 0x80) start++;
    return buf.subarray(start).toString('utf8');
  }

  /**
   * ADR-0027 §5, `run-change-checks`: the change's Checks block on its sealed commit, in the
   * helper's worktree; the result (with each failing check's last 4 KiB) goes to the engine. A
   * pass also starts the merge block's early run on that commit (checks that already passed on it
   * are not run again), as a seal without a block does.
   */
  function runChangeChecks(
    live: LoopLive,
    effect: Extract<EngineEffect, { type: 'run-change-checks' }>,
  ): void {
    const runId = live.state.run.id;
    const id = effect.agentRunId;
    const report = (passed: boolean, failed: FailedCheck[]): void => {
      const applied = ctx.apply(live, (s, c) =>
        changeChecksFinished(s, id, { commit: effect.commit, passed, failed }, c),
      );
      if (!applied.ok) {
        logger.log('info', 'change checks result not recorded', {
          runId,
          agentRunId: id,
          code: applied.refusal.code,
        });
        return;
      }
      logger.log('info', 'change checks finished', { runId, agentRunId: id, passed });
      if (passed) startChecks(live, id, effect.commit, { skipPassed: true });
    };
    const checks = ctx.commitChecks();
    if (checks === undefined) {
      // Without a check service nothing can fail. Reported after this effect is carried out,
      // never from inside the transition that asked for it.
      ctx.track(Promise.resolve().then(() => report(true, [])));
      return;
    }
    checks.start(
      runId,
      id,
      effect.commit,
      (result) => {
        if (result.requiredPassed) {
          report(true, []);
          return;
        }
        const byName = new Map((result.results ?? []).map((r) => [r.name, r]));
        const failed = result.failed.map((name): FailedCheck => {
          const r = byName.get(name);
          return r === undefined
            ? { name, status: 'skipped', exitCode: null, outputTail: 'No result: it did not run.' }
            : {
                name,
                status: r.status,
                exitCode: r.exitCode,
                outputTail: tailBytes(r.outputTail, CHECK_FAILURE_TAIL_MAX_BYTES),
              };
        });
        report(false, failed);
      },
      changeSpec(effect.blockNodeId, effect.select),
    );
  }

  /**
   * ADR-0027 §5, `run-branch-checks`: the Checks block on the ticket branch, on its recorded tip
   * (a fresh checkout, setup first). Nothing waits for it; the owner's merge gate reads it.
   */
  function runBranchChecks(live: LoopLive): void {
    const row = loop.ticketBranches.getByRun(live.state.run.id);
    if (row === undefined || row.state !== 'open') return;
    startChecks(live, null, row.headCommit, { skipPassed: true });
  }

  // ------------------------------------------------------------------ effects

  /**
   * F-1: a helper's worktree left its own branch. Its HEAD is detached where it is (no ref moves),
   * the ticket says why in plain words (app data only), and the change goes to the lead, who can
   * discard it (`changeSealed` with `failure: 'branch-changed'`). Discarding removes the worktree
   * and deletes only the helper's own branch.
   */
  async function branchChanged(live: LoopLive, agentRunId: string): Promise<void> {
    const runId = live.state.run.id;
    ctx.countDiagnostic('helper-branch-changed');
    try {
      const ws = await activeWorkspace(live, agentRunId);
      if (ws !== null && (await ctx.workspaces.detachForeignBranch(ws))) {
        logger.log('info', 'helper worktree detached from a foreign branch', { runId, agentRunId });
      }
    } catch (error) {
      logger.log('warn', 'helper worktree not detached', {
        runId,
        agentRunId,
        code: codeOf(error),
      });
    }
    const role = roleOf(live, agentRunId) ?? 'A helper';
    ctx.appComment?.(live, `${role}: ${HELPER_BRANCH_CHANGED}`);
  }

  function sealChange(live: LoopLive, agentRunId: string): void {
    const runId = live.state.run.id;
    ctx.track(
      (async () => {
        let result: {
          changed: boolean;
          headCommit: string | null;
          changedFiles: number | null;
          failure?: SealFailure;
        };
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
          logger.log('warn', 'change seal failed', { runId, agentRunId, code: codeOf(error) });
          if (error instanceof WorkspaceError && error.code === 'workspace-branch-changed') {
            // F-1: the helper switched its folder to another branch. Nothing is committed; its
            // folder is detached where it is, so it no longer holds that branch (no ref moves).
            await branchChanged(live, agentRunId);
            result = {
              changed: true,
              headCommit: null,
              changedFiles: null,
              failure: 'branch-changed',
            };
          } else {
            // The work is there but could not be committed: the owner looks at it, and the lead
            // may discard it (F-2). `invalid-workspace`: the folder is gone, or it committed files
            // the app never saves (an attachment copy or a setup output).
            const failure: SealFailure =
              error instanceof WorkspaceError && error.code === 'invalid-workspace'
                ? 'invalid-workspace'
                : 'not-saved';
            result = { changed: true, headCommit: null, changedFiles: null, failure };
          }
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
        else if (result.headCommit !== null) {
          // ADR-0027 §5: a change with a Checks block runs it first (`run-change-checks`); the
          // merge block's early run follows its pass.
          const change = live.state.agents.find((a) => a.id === agentRunId)?.change;
          if (change?.blockChecks !== 'pending') startChecks(live, agentRunId, result.headCommit);
        }
      })(),
    );
  }

  /**
   * Creates the run's ticket branch and reports it with `ticketBranchCreated`. Resolves true once
   * the engine has recorded it (the caller then carries out the effects that reach the lead),
   * false when it could not be made (the run is stopped) or recorded.
   */
  function createTicketBranch(live: LoopLive, ticketKey: string): Promise<boolean> {
    const runId = live.state.run.id;
    return (async (): Promise<boolean> => {
      let branch: string;
      const existing = loop.ticketBranches.getByRun(runId);
      if (existing !== undefined) {
        branch = existing.branch;
      } else {
        try {
          const created = await ctx.workspaces.createTicketBranch(
            projectRootOf(live),
            planFor(live, ticketKey),
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
            // ADR-0025 §10: recorded only when the branch did not start from its target.
            ...(created.sourceBranch !== undefined && { sourceBranch: created.sourceBranch }),
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
          // ADR-0025: say why on the ticket (app data only: the workspace manager's message).
          if (error instanceof WorkspaceError) ctx.appComment?.(live, ticketBranchFailed(error));
          ctx.apply(live, cancelRun);
          return false;
        }
      }
      const applied = ctx.apply(live, (s, c) => ticketBranchCreated(s, branch, c));
      if (!applied.ok) {
        logger.log('info', 'ticket branch not recorded', { runId, code: applied.refusal.code });
        return false;
      }
      logger.log('info', 'ticket branch created', { runId });
      return true;
    })();
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
      const ref = refOf(live, branch);
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
      const gate = (await ctx.commitChecks()?.gate(runId, id, commit, mergeChecks(live))) ?? {
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
      // F-2: a ticket branch moved outside the app, or checked out in another folder, does not
      // go away by trying again: the change goes to the owner (F-1's reset frees a moved one).
      if (error instanceof WorkspaceError && error.code === 'ticket-branch-moved') {
        return blocked({ reason: 'ticket-branch-moved' });
      }
      if (error instanceof WorkspaceError && error.code === 'ticket-branch-checked-out') {
        return blocked({ reason: 'ticket-branch-checked-out' });
      }
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
    const agent = live.state.agents.find((a) => a.id === id);
    if (input.action === 'rework' && agent?.status === 'NEEDS_REVIEW') {
      const ws = await activeWorkspace(live, id);
      if (ws === null)
        throw new HttpError(409, 'workspace_unavailable', 'The helper folder is unavailable.');
      try {
        const head = await ctx.workspaces.sealedHead(ws);
        if (head === null || head !== agent.change?.headCommit) {
          throw new HttpError(
            409,
            'workspace_changed',
            'The helper folder changed since its review; it cannot be restarted safely.',
          );
        }
      } catch (error) {
        if (error instanceof WorkspaceError) throw workspaceError(error);
        throw error;
      }
    }
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
      throw new HttpError(status, code, OWNER_BLOCKED[outcome.blocked.reason] ?? outcome.reply);
    }
    if (outcome.kind === 'refused') throw new HttpError(409, 'merge_refused', outcome.reply);
    if (anyway && outcome.kind === 'merged') mergedAnyway(outcome.overridden);
  }

  /**
   * ADR-0025 §9 (G-G): whether the branch still exists in the project and on origin, from local
   * refs only (no network), so the final step can offer Delete branch. Left out when no code
   * host is wired or the refs cannot be read.
   */
  async function withBranchPresence(
    live: LoopLive,
    row: TicketBranchRow,
  ): Promise<TicketBranchDto> {
    const dto = toTicketBranchDto(row);
    if (ctx.codeHost === undefined) return dto;
    try {
      const presence = await ctx.codeHost.ticketBranchPresence(
        projectRootOf(live),
        row.branch,
        'tracking',
      );
      return withPresence(dto, presence);
    } catch {
      return dto;
    }
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
    const base = { runId, ticketBranch: await withBranchPresence(live, row), checks };
    if (row.state !== 'open') {
      // ADR-0026 §5: read-only after a merge (or a discard), from the recorded commits; the
      // diff is computed again on each request and never stored.
      let changes;
      try {
        changes = await ctx.workspaces.diffCommits(
          projectRootOf(live),
          row.baseCommit,
          row.headCommit,
        );
      } catch (error) {
        if (error instanceof WorkspaceError) throw workspaceError(error);
        throw error;
      }
      if (changes === null) {
        throw new HttpError(
          410,
          'diff_unavailable',
          "This branch's commits are no longer in the repository, so its files are no longer available",
        );
      }
      return { ...base, ...changes, baseMoved: false };
    }
    try {
      const review = await ctx.workspaces.reviewTicketBranch(refOf(live, row));
      // F-1: say so on the ticket, with the tip it points at now (the owner can reset it).
      const moved = review.tip !== row.headCommit;
      if (moved) logger.log('warn', 'ticket branch moved outside the app', { runId });
      return {
        ...base,
        ticketBranch: moved
          ? { ...base.ticketBranch, movedOutside: { tip: review.tip } }
          : base.ticketBranch,
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

  /**
   * POST `/api/runs/:id/ticket-branch/reset` (F-1), the owner's "Reset to the last reviewed
   * commit": the open ticket branch, changed outside the app, goes back to the commit the app
   * recorded, by compare-and-swap from the tip the owner saw. Refused while a merge into it is under
   * way, when it is checked out anywhere, or when it moved again. The ticket gets an app line.
   */
  async function resetTicketBranch(live: LoopLive, body: unknown): Promise<void> {
    const input = ResetTicketBranchRequestSchema.parse(body);
    const runId = live.state.run.id;
    const row = loop.ticketBranches.getByRun(runId);
    if (row === undefined || row.state !== 'open') {
      throw new HttpError(409, 'no_ticket_branch', 'This run has no open ticket branch');
    }
    if (live.merges.size > 0) {
      throw new HttpError(
        409,
        'change_busy',
        'A change is being merged into the ticket branch; try again when it is done',
      );
    }
    if (input.from === row.headCommit) {
      throw new HttpError(
        409,
        'ticket_branch_not_moved',
        `${row.branch} is already at the last reviewed commit`,
      );
    }
    try {
      await ctx.workspaces.resetTicketBranch(refOf(live, row), row.headCommit, input.from);
    } catch (error) {
      if (error instanceof WorkspaceError) {
        logger.log('info', 'ticket branch reset refused', { runId, code: error.code });
        throw workspaceError(error);
      }
      throw error;
    }
    logger.log('info', 'ticket branch reset to the recorded commit', { runId });
    ctx.appComment?.(live, resetLine(row.branch, row.headCommit, input.from));
    ctx.notify?.(live);
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
      /** ADR-0024 §3: the app's own line after the owner's merge (author `app`). */
      appComment?: (text: string) => void;
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
    const ref = refOf(live, row);
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
          const gate = (await ctx
            .commitChecks()
            ?.gate(
              runId,
              null,
              row.headCommit,
              ctx.tipGate?.(runId, row.headCommit) ?? branchChecks(live),
            )) ?? {
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
          // Before the run completes, so the board's notice for it already shows the line.
          notes.appComment?.(
            mergeLine(row.branch, row.baseBranch, merged.commit, {
              tipChecks: tally(loop.checkCommits.latestForCommit(runId, null, row.headCommit)),
              anyway: input.action === 'merge-anyway',
            }),
          );
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

  // ------------------------------------------------------------------ pull requests (ADR-0025)

  function codeHostOrThrow(): CodeHostService {
    if (ctx.codeHost === undefined) {
      throw new HttpError(404, 'code_host_unavailable', 'Pull requests are not available here');
    }
    return ctx.codeHost;
  }

  function codeHostFailed(live: LoopLive, error: unknown): never {
    if (error instanceof CodeHostError) {
      ctx.countDiagnostic(`code-host-${error.code}`);
      logger.log('info', 'code host refused', { runId: live.state.run.id, code: error.code });
      throw codeHostHttpError(error);
    }
    if (error instanceof WorkspaceError) throw workspaceError(error);
    throw error;
  }

  /**
   * The pull request's body (ADR-0025 §2): the lead's latest ticket summary (ADR-0026 §2), then the
   * ticket's latest run summary comment (ADR-0024, the facts), this run's first, then one line
   * saying where it came from. The owner sees both on the ticket before clicking.
   */
  function pullRequestBody(live: LoopLive, ticketKey: string, title: string): string {
    const ticketId = live.state.run.ticketId;
    const comments = ticketId === null ? [] : store.workspaceRepos.comments.listForTicket(ticketId);
    const summaries = comments.filter(
      (c) => c.kind === 'run-facts' || (c.kind === null && isRunSummaryComment(c)),
    );
    const summary =
      summaries.filter((c) => c.runId === live.state.run.id).at(-1) ?? summaries.at(-1);
    const ticketSummary = comments.filter((c) => c.kind === 'ticket-summary').at(-1);
    const parts = [ticketSummary?.body.trim(), summary?.body.trim()].filter(
      (p): p is string => p !== undefined && p !== '',
    );
    const text = parts.length === 0 ? `${ticketKey}: ${title}` : parts.join('\n\n');
    return `${text}\n\nOpened from Agent Control Plane`;
  }

  /**
   * POST `/api/tickets/:id/branch/pull-request` (ADR-0025 §4), the owner's Push & open PR: when
   * the owner could merge (REVIEW, every change decided, no agent working), the recorded ticket
   * branch, at its recorded tip, is pushed to `origin` and a pull request is opened against its
   * target (or the open one for it is linked). Clicked again after the branch moved (new changes
   * merged after "Request changes"), it pushes the new tip (fast-forward only, never forced) and
   * returns the same pull request. No checks gate it: the pull request is reviewed on the host;
   * the local merge keeps its gate.
   */
  async function openPullRequest(
    live: LoopLive,
    body: unknown,
    ticket: { key: string; title: string },
  ): Promise<TicketBranchDto> {
    const input = OpenPullRequestRequestSchema.parse(body ?? {});
    const codeHost = codeHostOrThrow();
    const runId = live.state.run.id;
    const check = checkTicketBranchAction(live.state, 'merge');
    if (check !== null) throw refusalError(check);
    const row = loop.ticketBranches.getByRun(runId);
    if (row === undefined || row.state !== 'open') {
      throw new HttpError(409, 'no_ticket_branch', 'This run has no open ticket branch');
    }
    const ref = refOf(live, row);
    let opened;
    try {
      // The recorded branch, never another, and only at the tip the app recorded.
      await ctx.workspaces.verifyTicketBranch(ref, row.headCommit);
      opened = await codeHost.openPullRequest(ref.projectRoot, {
        head: row.branch,
        base: row.baseBranch,
        title: (input.title ?? `${ticket.key}: ${ticket.title}`).slice(0, 200),
        body: pullRequestBody(live, ticket.key, ticket.title),
        draft: input.draft ?? false,
      });
    } catch (error) {
      codeHostFailed(live, error);
    }
    const pr = opened.pullRequest;
    const updated = loop.ticketBranches.setPullRequest(runId, {
      provider: 'github',
      number: pr.number,
      url: pr.url,
      state: pr.state,
      // Verified above: the branch was at the recorded tip when it was pushed.
      pushedCommit: row.headCommit,
    });
    ctx.appComment?.(
      live,
      pullRequestOpenedLine(row.branch, row.baseBranch, pr.number, opened.created),
    );
    logger.log('info', 'pull request opened', {
      runId,
      number: pr.number,
      created: opened.created,
    });
    if (pr.state === 'merged') await settleMergedPullRequest(live, pr.number, pr.mergeCommit);
    ctx.notify?.(live);
    const final = loop.ticketBranches.getByRun(runId) ?? updated;
    if (final === undefined)
      throw new HttpError(500, 'internal_error', 'The ticket branch is gone');
    return toTicketBranchDto(final);
  }

  /**
   * POST `/api/tickets/:id/branch/pull-request/refresh` (ADR-0025 §2): reads the pull request's
   * state now, on the owner's request (nothing polls). When GitHub reports it merged and the run
   * waits for the owner's merge, the ticket branch is recorded as merged and the run completes,
   * so the ticket becomes Done; otherwise only the state is recorded.
   */
  async function refreshPullRequest(live: LoopLive): Promise<TicketBranchDto> {
    const codeHost = codeHostOrThrow();
    const runId = live.state.run.id;
    const row = loop.ticketBranches.getByRun(runId);
    const recorded = row?.pullRequest ?? null;
    if (row === undefined || recorded === null) {
      throw new HttpError(409, 'no_pull_request', 'No pull request was opened for this ticket');
    }
    let pr;
    try {
      pr = await codeHost.view(projectRootOf(live), recorded.number);
    } catch (error) {
      codeHostFailed(live, error);
    }
    loop.ticketBranches.setPullRequest(runId, {
      provider: recorded.provider,
      number: pr.number,
      url: pr.url,
      state: pr.state,
    });
    logger.log('info', 'pull request read', { runId, number: pr.number, state: pr.state });
    if (pr.state === 'merged' && row.state === 'open') {
      await settleMergedPullRequest(live, pr.number, pr.mergeCommit);
    }
    ctx.notify?.(live);
    const final = loop.ticketBranches.getByRun(runId);
    if (final === undefined)
      throw new HttpError(500, 'internal_error', 'The ticket branch is gone');
    return toTicketBranchDto(final);
  }

  /**
   * GitHub merged the pull request: the ticket branch is merged (at the host's merge commit, or
   * the pushed tip) and the run completes, as after the owner's local merge. A run that is not
   * waiting for the owner's merge (changes requested since, or stopped) keeps its branch open;
   * the pull request's state shows what happened.
   */
  async function settleMergedPullRequest(
    live: LoopLive,
    number: number,
    mergeCommit: string | null,
  ): Promise<void> {
    const runId = live.state.run.id;
    const row = loop.ticketBranches.getByRun(runId);
    if (row === undefined || row.state !== 'open') return;
    const check = checkTicketBranchAction(live.state, 'merge');
    if (check !== null) {
      logger.log('info', 'pull request merged; run not waiting for the merge', {
        runId,
        code: check.code,
      });
      return;
    }
    const commit = mergeCommit ?? row.headCommit;
    loop.ticketBranches.markMerged(runId, commit);
    ctx.appComment?.(
      live,
      pullRequestMergeLine(number, row.baseBranch, commit, {
        tipChecks: tally(loop.checkCommits.latestForCommit(runId, null, row.headCommit)),
      }),
    );
    const r = ctx.apply(live, (s, c) => recordTicketBranchDecision(s, 'merged', c));
    if (!r.ok) {
      logger.log('error', 'pull request merge not recorded', { runId, code: r.refusal.code });
      return;
    }
    await releaseAll(live);
    logger.log('info', 'ticket branch merged via pull request', { runId, number });
  }

  return {
    refOf,
    release,
    openPullRequest,
    refreshPullRequest,
    sealChange,
    runChangeChecks,
    runBranchChecks,
    createTicketBranch,
    mergeChange,
    discardChange,
    changeDiff,
    ownerChangeAction,
    ticketBranchReview,
    ticketBranchAction,
    resetTicketBranch,
  };
}

export type ReviewLoop = ReturnType<typeof createReviewLoop>;
