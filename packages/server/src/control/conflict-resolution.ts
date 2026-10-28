import { randomUUID } from 'node:crypto';
import {
  MAX_ASSESSMENT_REASON_CHARS,
  automationOf,
  classifyPaths,
  decideVerification,
  evidenceStaleReason,
  policyFingerprint,
  redact,
  type HarnessManifest,
  type HelperOutcomeKind,
  type ProjectAutomation,
  type VerificationAssessmentInput,
} from '@acp/core';
import {
  MAX_RESOLUTION_ATTEMPT_RECORDS,
  MAX_RESOLUTION_FILES,
  PromoteResolutionRequestSchema,
  isActiveResolutionState,
  type ConflictResolutionDto,
  type ConflictResolutionRecord,
  type ConflictResolutionViewDto,
  type ResolutionAttempt,
} from '@acp/core/api';
import {
  abandonResolver,
  checkTicketBranchAction,
  resolverSealed,
  startResolver,
  stopAgent,
  type EngineContext,
  type EngineResult,
  type ResolverSealOutcome,
  type RunState,
} from '@acp/orchestrator';
import type { TicketBranchRow } from '@acp/db';
import { HttpError } from '../errors.js';
import type { CheckSpec } from '../harness/blocks.js';
import { errorFields, type Logger } from '../logger.js';
import { WorkspaceError } from '../workspace/errors.js';
import type { TicketBranchRef, Workspace, WorkspaceManager } from '../workspace/manager.js';
import { workspaceError } from './errors.js';
import type { CommitChecksHooks } from './review-loop.js';
import type { RunStore } from './store.js';

/**
 * ADR-0030: "Update target / Resolve conflicts" on a run's ticket branch, as one server-owned
 * operation with a persisted record (migration 0012):
 *
 * 1. **Pin** the ticket tip, the target tip, their merge base and the project policy (snapshotted:
 *    later setting changes never widen this operation). One active operation per run.
 * 2. **Candidate:** the server merges the target into the ticket tip in a temporary checkout. A
 *    clean merge is the candidate. A conflict starts a resolver helper (engine `startResolver`) in
 *    a worktree with the merge left in progress; the server concludes and checks its merge
 *    (target contained, no conflict markers). Agents never get git authority.
 * 3. **Assess and gate:** the entire combined change (target..candidate, base..target and the
 *    conflicted files) is classified; the resolver's assessment is advice; `decideVerification`
 *    applies the policy (run checks, skip by policy, unverified by policy, or unavailable).
 * 4. **Verify:** the selected checks run on the exact candidate commit (the check service, with
 *    the harness file of the project's own checkout, so an agent cannot edit its own gate).
 *    A failure retries with a new resolver while attempts remain (counted across replacements),
 *    then waits for the owner.
 * 5. **Promote** by compare-and-swap from the pinned ticket tip, after re-checking that the target
 *    has not moved (else the evidence is stale and the operation stops).
 * 6. **Deliver** only when the policy delegated it, to an allowed target, and the route allows it:
 *    push the new commits to an open pull request, open one (a draft when verification is
 *    unavailable under `draft-pr`), or merge locally (`merge`). The delivery state is recorded
 *    before any network call; a restart turns an unfinished one into `unknown` (never retried).
 */

export interface ResolutionLive {
  state: RunState;
  workspaces: Map<string, Workspace>;
}

type Applied<T> =
  { ok: true; value: T } | { ok: false; refusal: { code: string; message: string } };

export interface ConflictResolutionContext {
  store: RunStore;
  workspaces: WorkspaceManager;
  logger: Logger;
  now: () => Date;
  projectRoot(projectId: string): string | undefined;
  /** The ticket branch as the manager's ref, with the project's long-lived names. */
  refOf(live: ResolutionLive, row: TicketBranchRow): TicketBranchRef;
  /** The harness file of the project's own checkout (trusted); null without a valid one. */
  readManifest(projectId: string): Promise<HarnessManifest | null>;
  commitChecks(): CommitChecksHooks | undefined;
  apply<T>(
    live: ResolutionLive,
    command: (state: RunState, c: EngineContext) => EngineResult<T>,
  ): Applied<T>;
  /** Removes an agent's worktree and its record (the loop's release). */
  release(live: ResolutionLive, agentRunId: string): Promise<void>;
  appComment(live: ResolutionLive, text: string): void;
  ownerComment(live: ResolutionLive, text: string): void;
  notify(live: ResolutionLive): void;
  track(promise: Promise<unknown>): void;
  /** Delegated delivery through the owner's own paths (their refusals come back as HttpError). */
  delivery?: {
    /** Pushes the ticket branch and opens its pull request, or updates the open one. */
    openPullRequest(live: ResolutionLive, draft: boolean): Promise<void>;
    /** The owner's local fast-forward merge into the target (the run then completes). */
    mergeLocally(live: ResolutionLive): Promise<void>;
  };
}

const COMMIT_SHORT = 12;
const short = (c: string) => c.slice(0, COMMIT_SHORT);

/** An owner-facing reason: redacted and capped to the record's limit. */
function reason(text: string): string {
  const clean = redact(text).trim();
  return clean.length <= MAX_ASSESSMENT_REASON_CHARS
    ? clean
    : `${clean.slice(0, MAX_ASSESSMENT_REASON_CHARS - 1).trimEnd()}…`;
}

export function createConflictResolution(ctx: ConflictResolutionContext) {
  const { store, logger } = ctx;
  const repo = store.loopRepos.conflictResolutions;
  /** The resolver's report (outcome, note, assessment) until its seal binds it to a commit. */
  const reports = new Map<
    string,
    { outcome: HelperOutcomeKind; assessment?: VerificationAssessmentInput }
  >();

  const iso = () => ctx.now().toISOString();

  function projectRootOf(live: ResolutionLive): string {
    const root = ctx.projectRoot(live.state.run.projectId);
    if (root === undefined) throw new HttpError(404, 'project_not_found', 'The project is gone');
    return root;
  }

  function policyOf(projectId: string): ProjectAutomation {
    const setup = store.workspaceRepos.projectSetup.get(projectId);
    return automationOf(setup ?? {});
  }

  function openRow(live: ResolutionLive): TicketBranchRow {
    const row = store.loopRepos.ticketBranches.getByRun(live.state.run.id);
    if (row === undefined || row.state !== 'open') {
      throw new HttpError(409, 'no_ticket_branch', 'This run has no open ticket branch');
    }
    return row;
  }

  /** Writes the record when it is still in `from`; a lost race is a 409. */
  function save(
    op: ConflictResolutionRecord,
    from: ConflictResolutionRecord['state'],
  ): ConflictResolutionRecord {
    const next = { ...op, updatedAt: iso() };
    const saved = repo.update(next, from);
    if (saved === undefined) {
      throw new HttpError(409, 'resolution_changed', 'The operation changed meanwhile');
    }
    return saved;
  }

  function finish(
    op: ConflictResolutionRecord,
    from: ConflictResolutionRecord['state'],
    state: 'completed' | 'failed' | 'cancelled' | 'awaiting-owner',
    patch: Partial<ConflictResolutionRecord> = {},
  ): ConflictResolutionRecord {
    const terminal = state !== 'awaiting-owner';
    return save({ ...op, ...patch, state, finishedAt: terminal ? iso() : null }, from);
  }

  function addAttempt(
    op: ConflictResolutionRecord,
    attempt: Omit<ResolutionAttempt, 'at'>,
  ): ResolutionAttempt[] {
    return [...op.attempts, { ...attempt, at: iso() }].slice(-MAX_RESOLUTION_ATTEMPT_RECORDS);
  }

  /** Attempts that count against the budget: every resolver turn and every failed check run. */
  function attemptsUsed(op: ConflictResolutionRecord): number {
    return op.attempts.filter((a) => a.outcome !== 'clean').length;
  }

  // ------------------------------------------------------------------ reads

  async function staleness(
    live: ResolutionLive,
    op: ConflictResolutionRecord,
  ): Promise<string | null> {
    if (!isActiveResolutionState(op.state)) return null;
    let target: string | null;
    try {
      target = await ctx.workspaces.branchTip(projectRootOf(live), op.targetBranch);
    } catch {
      target = null;
    }
    return evidenceStaleReason(
      {
        candidateCommit: op.candidateCommit,
        targetCommit: op.targetCommit,
        policyFingerprint: op.policyFingerprint,
      },
      {
        candidateCommit: op.candidateCommit,
        targetCommit: target,
        policyFingerprint: policyFingerprint(policyOf(op.projectId)),
      },
    );
  }

  async function toDto(
    live: ResolutionLive,
    op: ConflictResolutionRecord,
  ): Promise<ConflictResolutionDto> {
    const stale = await staleness(live, op);
    if (stale === null) return { ...op, stale: null };
    // Shown as stale; nothing earlier authorizes a newer state of the repository.
    return {
      ...op,
      stale: stale.slice(0, 300),
      verification: { ...op.verification, status: 'stale' },
      review:
        op.review.status === 'not-required-by-policy'
          ? op.review
          : { status: 'stale', reason: op.review.reason },
    };
  }

  async function baseMoved(live: ResolutionLive, row: TicketBranchRow): Promise<boolean> {
    try {
      const review = await ctx.workspaces.reviewTicketBranch(
        { ...ctx.refOf(live, row), baseBranch: row.baseBranch },
        { maxDiffBytes: 1 },
      );
      return review.baseMoved;
    } catch {
      return false;
    }
  }

  /** Why a new operation cannot start now, or null. */
  function startBlocked(live: ResolutionLive): string | null {
    const check = checkTicketBranchAction(live.state, 'update-from-base');
    if (check !== null) return check.message;
    const latest = repo.latestForRun(live.state.run.id);
    if (latest !== undefined && isActiveResolutionState(latest.state)) {
      return 'An update of this ticket branch is already under way.';
    }
    return null;
  }

  async function view(live: ResolutionLive): Promise<ConflictResolutionViewDto> {
    const runId = live.state.run.id;
    const row = store.loopRepos.ticketBranches.getByRun(runId);
    const moved = row !== undefined && row.state === 'open' ? await baseMoved(live, row) : false;
    const latest = repo.latestForRun(runId);
    if (moved) maybeAutoStart(live);
    return {
      runId,
      policy: policyOf(live.state.run.projectId),
      baseMoved: moved,
      operation: latest === undefined ? null : await toDto(live, latest),
      startBlocked:
        row?.state === 'open' ? startBlocked(live) : 'This run has no open ticket branch',
    };
  }

  // ------------------------------------------------------------------ start

  async function start(
    live: ResolutionLive,
    trigger: 'owner' | 'auto',
  ): Promise<ConflictResolutionRecord> {
    const runId = live.state.run.id;
    const blocked = startBlocked(live);
    if (blocked !== null) throw new HttpError(409, 'resolution_unavailable', blocked);
    const row = openRow(live);
    const ref = ctx.refOf(live, row);
    const root = projectRootOf(live);
    const target = await ctx.workspaces.branchTip(root, row.baseBranch).catch((error: unknown) => {
      if (error instanceof WorkspaceError) throw workspaceError(error);
      throw error;
    });
    if (target === null) {
      throw new HttpError(409, 'base_branch_changed', `${row.baseBranch} no longer exists`);
    }
    const policy = policyOf(row.projectId);
    const at = iso();
    const op: ConflictResolutionRecord = {
      id: randomUUID(),
      runId,
      projectId: row.projectId,
      trigger,
      state: 'preparing',
      ticketBranch: row.branch,
      targetBranch: row.baseBranch,
      ticketCommit: row.headCommit,
      targetCommit: target,
      mergeBase: null,
      candidateCommit: null,
      conflictFiles: [],
      policy,
      policyFingerprint: policyFingerprint(policy),
      maxAttempts: policy.conflictResolution.maxAttempts,
      attempts: [],
      resolverAgentRunId: null,
      resolution: { status: 'preparing', reason: null },
      verification: {
        status: 'pending',
        route: null,
        classification: null,
        assessedPaths: 0,
        outsideScope: [],
        checkIds: [],
        mandatoryCheckIds: [],
        omitted: [],
        failedChecks: [],
        checkedCommit: null,
        matchedRule: null,
        reason: null,
        assessment: null,
        deliverAs: null,
      },
      review: { status: 'pending-owner', reason: null },
      delivery: {
        status: delegated(policy, row.baseBranch) ? 'waiting' : 'not-delegated',
        reason: delegated(policy, row.baseBranch)
          ? null
          : 'Delivery is not delegated for this target; you merge or open the pull request.',
        commit: null,
        draft: false,
      },
      createdAt: at,
      updatedAt: at,
      finishedAt: null,
    };
    let inserted: ConflictResolutionRecord;
    try {
      inserted = repo.insert(op);
    } catch (error) {
      if ((error as { code?: unknown }).code === 'conflict') {
        throw new HttpError(
          409,
          'resolution_active',
          'An update of this ticket branch is already under way',
        );
      }
      throw error;
    }
    logger.log('info', 'conflict resolution started', { runId, operationId: op.id, trigger });
    let prepared;
    try {
      prepared = await ctx.workspaces.prepareCandidate(
        { ...ref, runId },
        { operationId: op.id, ticketTip: row.headCommit, targetTip: target },
      );
    } catch (error) {
      const message = error instanceof WorkspaceError ? error.message : 'Git could not merge';
      finish(inserted, 'preparing', 'failed', {
        resolution: { status: 'failed', reason: reason(message) },
      });
      ctx.notify(live);
      if (error instanceof WorkspaceError) throw workspaceError(error);
      throw error;
    }
    if (prepared.kind === 'up-to-date') {
      const done = finish(inserted, 'preparing', 'completed', {
        mergeBase: prepared.mergeBase,
        resolution: {
          status: 'up-to-date',
          reason: `${row.baseBranch} is already in ${row.branch}.`,
        },
        delivery: { ...inserted.delivery, status: 'not-delegated', reason: 'Nothing to deliver.' },
      });
      ctx.notify(live);
      return done;
    }
    if (prepared.kind === 'clean') {
      const clean = save(
        {
          ...inserted,
          state: 'verifying',
          mergeBase: prepared.mergeBase,
          candidateCommit: prepared.candidate,
          attempts: addAttempt(inserted, {
            attempt: 1,
            agentRunId: null,
            outcome: 'clean',
            note: null,
          }),
          resolution: { status: 'clean', reason: `${row.baseBranch} merged without conflicts.` },
        },
        'preparing',
      );
      ctx.appComment(
        live,
        `Updating ${row.branch} from ${row.baseBranch} (${short(target)}): merged without conflicts; checking the result by the project's policy.`,
      );
      ctx.notify(live);
      return assessAndVerify(live, clean);
    }
    const conflicted = save(
      {
        ...inserted,
        state: 'resolving',
        mergeBase: prepared.mergeBase,
        conflictFiles: prepared.files.slice(0, MAX_RESOLUTION_FILES),
        resolution: {
          status: 'resolving',
          reason: `${prepared.files.length} file(s) conflict with ${row.baseBranch}.`,
        },
      },
      'preparing',
    );
    ctx.appComment(
      live,
      `Updating ${row.branch} from ${row.baseBranch} (${short(target)}): ${prepared.files.length} file(s) conflict; a resolver helper is merging them.`,
    );
    return launchResolver(live, conflicted, []);
  }

  function delegated(policy: ProjectAutomation, target: string): boolean {
    return policy.delivery.mode !== 'manual' && policy.delivery.allowedTargets.includes(target);
  }

  /** Starts the next resolver attempt, or ends the operation when the budget is used up. */
  function launchResolver(
    live: ResolutionLive,
    op: ConflictResolutionRecord,
    failedChecks: readonly string[],
  ): ConflictResolutionRecord {
    const used = attemptsUsed(op);
    if (used >= op.maxAttempts) {
      const failed = finish(
        op,
        op.state,
        op.candidateCommit === null ? 'failed' : 'awaiting-owner',
        {
          resolution:
            op.candidateCommit === null
              ? {
                  status: 'failed',
                  reason: `No usable resolution after ${used} attempt(s); resolve it yourself or start again.`,
                }
              : op.resolution,
        },
      );
      ctx.appComment(
        live,
        `The update of ${op.ticketBranch} from ${op.targetBranch} stopped after ${used} attempt(s); it waits for you.`,
      );
      ctx.notify(live);
      return failed;
    }
    const attempt = used + 1;
    const r = ctx.apply(live, (s, c) =>
      startResolver(
        s,
        {
          operationId: op.id,
          ticketBranch: op.ticketBranch,
          targetBranch: op.targetBranch,
          ticketCommit: op.ticketCommit,
          targetCommit: op.targetCommit,
          conflictFiles: op.conflictFiles,
          attempt,
          maxAttempts: op.maxAttempts,
          previous: op.attempts.map((a) => ({
            attempt: a.attempt,
            outcome: a.outcome,
            note: a.note,
          })),
          failedChecks,
          helperNode: op.policy.conflictResolution.helper,
        },
        c,
      ),
    );
    if (!r.ok) {
      const failed = finish(op, op.state, 'failed', {
        resolution: {
          status: 'failed',
          reason: reason(`The resolver could not start: ${r.refusal.message}`),
        },
      });
      ctx.notify(live);
      return failed;
    }
    const next = save(
      {
        ...op,
        state: 'resolving',
        resolverAgentRunId: r.value,
        resolution: {
          status: 'resolving',
          reason: `Resolver attempt ${attempt} of ${op.maxAttempts}.`,
        },
      },
      op.state,
    );
    ctx.notify(live);
    return next;
  }

  /** The worktree options for a resolver's `start-agent` (the server's `create`). */
  function workspaceOptions(operationId: string) {
    const op = repo.get(operationId);
    if (op === undefined || op.state !== 'resolving') return undefined;
    return {
      from: { branch: op.ticketBranch, commit: op.ticketCommit },
      mergeTarget: { commit: op.targetCommit },
    };
  }

  // ------------------------------------------------------------------ resolver results

  function onHelperOutcome(
    agentRunId: string,
    outcome: HelperOutcomeKind,
    assessment: VerificationAssessmentInput | undefined,
  ): void {
    reports.set(agentRunId, { outcome, ...(assessment !== undefined && { assessment }) });
  }

  function activeFor(
    agentRunId: string,
    operationId: string,
  ): ConflictResolutionRecord | undefined {
    const op = repo.get(operationId);
    if (op === undefined || op.state !== 'resolving' || op.resolverAgentRunId !== agentRunId) {
      return undefined;
    }
    return op;
  }

  function noteOf(live: ResolutionLive, agentRunId: string): string | null {
    const agent = live.state.agents.find((a) => a.id === agentRunId);
    return agent?.reportedOutcome === undefined ? null : reason(agent.reportedOutcome.note);
  }

  /** `seal-resolution`: commit the resolver's merge, check it, then carry the operation on. */
  function sealResolution(live: ResolutionLive, agentRunId: string, operationId: string): void {
    ctx.track(
      (async () => {
        const op = activeFor(agentRunId, operationId);
        const ws = live.workspaces.get(agentRunId);
        let outcome: ResolverSealOutcome = 'failed';
        let candidate: string | null = null;
        let markers: string[] = [];
        if (op !== undefined && ws !== undefined) {
          try {
            const sealed = await ctx.workspaces.seal(ws, { role: 'Conflict resolver' });
            const check = await ctx.workspaces.checkResolution(projectRootOf(live), {
              commit: sealed.headCommit,
              targetCommit: op.targetCommit,
              files: op.conflictFiles,
            });
            markers = check.markerFiles;
            const reported = reports.get(agentRunId)?.outcome;
            if (!check.containsTarget) outcome = 'failed';
            else if (markers.length > 0) {
              outcome =
                reported === 'no-change' || reported === 'blocked' ? 'no-change' : 'markers-left';
            } else {
              outcome = 'resolved';
              candidate = sealed.headCommit;
              await ctx.workspaces.pinCandidate(projectRootOf(live), op.id, candidate);
            }
          } catch (error) {
            logger.log('warn', 'resolver seal failed', { agentRunId, ...errorFields(error) });
            outcome = 'failed';
          }
        }
        const r = ctx.apply(live, (s, c) => resolverSealed(s, agentRunId, outcome, c));
        if (!r.ok)
          logger.log('warn', 'resolver seal not recorded', { agentRunId, code: r.refusal.code });
        await ctx.release(live, agentRunId).catch(() => undefined);
        if (op === undefined) return;
        const report = reports.get(agentRunId);
        reports.delete(agentRunId);
        const note = noteOf(live, agentRunId);
        const attemptNo = attemptsUsed(op) + 1;
        if (candidate === null) {
          const failedOp = save(
            {
              ...op,
              resolverAgentRunId: null,
              attempts: addAttempt(op, {
                attempt: attemptNo,
                agentRunId,
                outcome:
                  outcome === 'no-change'
                    ? report?.outcome === 'blocked'
                      ? 'blocked'
                      : 'no-change'
                    : outcome,
                note:
                  note ??
                  (markers.length > 0
                    ? reason(`Conflict markers left in ${markers.join(', ')}.`)
                    : null),
              }),
            },
            'resolving',
          );
          launchResolver(live, failedOp, []);
          return;
        }
        const assessment =
          report?.assessment === undefined
            ? null
            : { ...report.assessment, candidateCommit: candidate, targetCommit: op.targetCommit };
        const resolved = save(
          {
            ...op,
            state: 'verifying',
            resolverAgentRunId: null,
            candidateCommit: candidate,
            attempts: addAttempt(op, { attempt: attemptNo, agentRunId, outcome: 'resolved', note }),
            resolution: {
              status: 'resolved',
              reason: `Resolved by the resolver helper on attempt ${attemptNo} of ${op.maxAttempts}.`,
            },
            verification: { ...op.verification, assessment, status: 'pending' },
          },
          'resolving',
        );
        await assessAndVerify(live, resolved);
      })().catch((error: unknown) => {
        logger.log('error', 'resolution seal failed', { operationId, ...errorFields(error) });
      }),
    );
  }

  /** `resolver-ended`: the resolver stopped or failed without a seal; count it and go on. */
  function resolverEnded(live: ResolutionLive, agentRunId: string, operationId: string): void {
    reports.delete(agentRunId);
    const op = activeFor(agentRunId, operationId);
    ctx.track(ctx.release(live, agentRunId).catch(() => undefined));
    if (op === undefined) return;
    const next = save(
      {
        ...op,
        resolverAgentRunId: null,
        attempts: addAttempt(op, {
          attempt: attemptsUsed(op) + 1,
          agentRunId,
          outcome: 'stopped',
          note: noteOf(live, agentRunId),
        }),
      },
      'resolving',
    );
    if (live.state.run.status !== 'REVIEW') {
      finish(next, 'resolving', 'cancelled', {
        resolution: { status: 'cancelled', reason: 'The run stopped.' },
      });
      ctx.notify(live);
      return;
    }
    launchResolver(live, next, []);
  }

  // ------------------------------------------------------------------ assess, gate, verify

  async function assessAndVerify(
    live: ResolutionLive,
    op: ConflictResolutionRecord,
  ): Promise<ConflictResolutionRecord> {
    const candidate = op.candidateCommit;
    if (candidate === null || op.mergeBase === null) return op;
    const root = projectRootOf(live);
    const paths = [
      ...(await ctx.workspaces.combinedPaths(root, {
        mergeBase: op.mergeBase,
        targetCommit: op.targetCommit,
        candidateCommit: candidate,
      })),
      ...op.conflictFiles,
    ];
    const classified = classifyPaths(paths, op.policy.verification.skipScopes);
    const manifest = await ctx.readManifest(op.projectId).catch(() => null);
    const assessment =
      op.verification.assessment !== null &&
      op.verification.assessment.candidateCommit === candidate
        ? op.verification.assessment
        : null;
    const decision = decideVerification({
      policy: op.policy.verification,
      paths: classified,
      assessment,
      checks: manifest?.checks ?? null,
    });
    const verification = {
      ...op.verification,
      route: decision.route,
      classification: decision.classification,
      assessedPaths: new Set(paths).size,
      outsideScope: classified.outsideScope.slice(0, MAX_RESOLUTION_FILES),
      checkIds: decision.checkIds,
      mandatoryCheckIds: decision.mandatoryCheckIds,
      omitted: decision.omitted,
      failedChecks: [],
      matchedRule: decision.matchedRule.slice(0, 300),
      reason: reason(decision.reason),
      deliverAs: decision.deliverAs,
    };
    if (decision.route === 'run-checks') {
      const hooks = ctx.commitChecks();
      if (hooks === undefined) {
        return gateHeld(
          live,
          save(
            {
              ...op,
              verification: {
                ...verification,
                status: 'unavailable',
                reason: 'The check service is not available.',
              },
            },
            op.state,
          ),
        );
      }
      const running = save(
        { ...op, state: 'verifying', verification: { ...verification, status: 'running' } },
        op.state,
      );
      ctx.notify(live);
      const spec: CheckSpec = {
        place: 'branch',
        blockNodeId: null,
        run: [{ kind: 'ids', ids: decision.checkIds }],
        gate: [{ kind: 'ids', ids: decision.checkIds }],
      };
      hooks.start(
        live.state.run.id,
        null,
        candidate,
        (result) => {
          ctx.track(
            checksDone(live, running.id, candidate, result.requiredPassed, result.failed).catch(
              (error: unknown) =>
                logger.log('error', 'resolution checks result failed', errorFields(error)),
            ),
          );
        },
        spec,
        { skipPassed: true },
      );
      return running;
    }
    const status =
      decision.route === 'skipped-by-policy'
        ? 'skipped-by-policy'
        : decision.route === 'unverified-by-policy'
          ? 'unverified-by-policy'
          : 'unavailable';
    const decided = save({ ...op, verification: { ...verification, status } }, op.state);
    if (decision.route === 'unavailable' && decision.deliverAs === 'none')
      return gateHeld(live, decided);
    return promoteAndDeliver(live, decided, 'policy');
  }

  async function checksDone(
    live: ResolutionLive,
    operationId: string,
    candidate: string,
    passed: boolean,
    failed: readonly string[],
  ): Promise<void> {
    const op = repo.get(operationId);
    if (op === undefined || op.state !== 'verifying' || op.candidateCommit !== candidate) return;
    if (passed) {
      const ok = save(
        {
          ...op,
          verification: {
            ...op.verification,
            status: 'passed',
            checkedCommit: candidate,
            failedChecks: [],
          },
        },
        'verifying',
      );
      await promoteAndDeliver(live, ok, 'policy');
      return;
    }
    // The gate reports check names; map them back to the selected ids (the trusted harness file).
    const manifest = await ctx.readManifest(op.projectId).catch(() => null);
    const byName = new Map((manifest?.checks ?? []).map((c) => [c.name, c.id]));
    const ids = op.verification.checkIds.filter((id) =>
      failed.some((f) => f === id || byName.get(f) === id),
    );
    const failedOp = save(
      {
        ...op,
        attempts: addAttempt(op, {
          attempt: attemptsUsed(op) + 1,
          agentRunId: null,
          outcome: 'checks-failed',
          note: reason(`Failed: ${failed.join(', ')}`),
        }),
        verification: {
          ...op.verification,
          status: 'failed',
          checkedCommit: candidate,
          failedChecks: ids,
          reason: reason(
            `Selected checks failed on candidate ${short(candidate)}: ${failed.join(', ')}.`,
          ),
        },
      },
      'verifying',
    );
    ctx.notify(live);
    // Repair automatically while the budget lasts (a resolver on a fresh merge, told what failed).
    if (attemptsUsed(failedOp) < failedOp.maxAttempts && live.state.run.status === 'REVIEW') {
      const retry = save({ ...failedOp, state: 'resolving', candidateCommit: null }, 'verifying');
      await ctx.workspaces.dropCandidate(projectRootOf(live), op.id).catch(() => undefined);
      launchResolver(live, retry, ids);
      return;
    }
    gateHeld(live, failedOp);
  }

  /** The gate held the candidate: the owner decides (apply with a reason, or cancel). */
  function gateHeld(live: ResolutionLive, op: ConflictResolutionRecord): ConflictResolutionRecord {
    const held = finish(op, op.state, 'awaiting-owner', {
      delivery: {
        ...op.delivery,
        status: op.delivery.status === 'not-delegated' ? 'not-delegated' : 'blocked',
        reason:
          op.delivery.status === 'not-delegated'
            ? op.delivery.reason
            : 'Held by the verification policy.',
      },
    });
    ctx.appComment(
      live,
      `The update of ${op.ticketBranch} from ${op.targetBranch} waits for you: ${op.verification.status === 'failed' ? 'its checks failed' : 'verification is unavailable'} (candidate ${short(op.candidateCommit ?? op.ticketCommit)}).`,
    );
    ctx.notify(live);
    return held;
  }

  // ------------------------------------------------------------------ promote and deliver

  async function promote(live: ResolutionLive, op: ConflictResolutionRecord): Promise<void> {
    const row = openRow(live);
    const candidate = op.candidateCommit;
    if (candidate === null) throw new HttpError(409, 'no_candidate', 'There is no result to apply');
    const stale = await staleness(live, op);
    if (stale !== null) throw new HttpError(409, 'resolution_stale', stale);
    if (row.headCommit !== op.ticketCommit) {
      throw new HttpError(
        409,
        'ticket_branch_moved',
        'The ticket branch changed since this update started',
      );
    }
    try {
      await ctx.workspaces.advanceTicketBranch(ctx.refOf(live, row), op.ticketCommit, candidate);
    } catch (error) {
      if (error instanceof WorkspaceError) throw workspaceError(error);
      throw error;
    }
    if (
      store.loopRepos.ticketBranches.advance(live.state.run.id, op.ticketCommit, candidate) ===
      undefined
    ) {
      throw new HttpError(409, 'ticket_branch_moved', 'The ticket branch changed meanwhile');
    }
    await ctx.workspaces.dropCandidate(projectRootOf(live), op.id).catch(() => undefined);
  }

  async function promoteAndDeliver(
    live: ResolutionLive,
    op: ConflictResolutionRecord,
    by: 'policy' | 'owner',
  ): Promise<ConflictResolutionRecord> {
    try {
      await promote(live, op);
    } catch (error) {
      const message =
        error instanceof HttpError ? error.message : 'The ticket branch could not be updated';
      const failed = finish(op, op.state, 'failed', {
        resolution: { ...op.resolution, reason: reason(message) },
        delivery: {
          ...op.delivery,
          status: op.delivery.status === 'not-delegated' ? 'not-delegated' : 'blocked',
          reason: reason(message),
        },
      });
      ctx.notify(live);
      if (by === 'owner') throw error;
      return failed;
    }
    const candidate = op.candidateCommit ?? op.ticketCommit;
    ctx.appComment(
      live,
      `${op.ticketBranch} now includes ${op.targetBranch} (${short(op.targetCommit)}) at ${short(candidate)}. Verification: ${op.verification.status}.`,
    );
    const deliverAs = op.verification.deliverAs ?? 'none';
    const canDeliver =
      by === 'policy' &&
      op.delivery.status === 'waiting' &&
      deliverAs !== 'none' &&
      ctx.delivery !== undefined;
    const review =
      by === 'owner'
        ? { status: 'owner-approved' as const, reason: 'Applied by the owner.' }
        : canDeliver
          ? {
              status: 'not-required-by-policy' as const,
              reason:
                'Delivery is delegated by the project policy; no further review was required.',
            }
          : {
              status: 'pending-owner' as const,
              reason: 'You review the ticket branch at its final step.',
            };
    if (!canDeliver) {
      const done = finish(op, op.state, 'completed', {
        review,
        delivery:
          op.delivery.status === 'waiting'
            ? {
                ...op.delivery,
                status: 'not-delegated',
                reason:
                  by === 'owner'
                    ? 'Applied past the policy gate: deliver it yourself.'
                    : 'Delivery is not allowed for this verification result.',
              }
            : op.delivery,
      });
      ctx.notify(live);
      maybeChainAuto(live);
      return done;
    }
    return deliver(
      live,
      save({ ...op, state: 'delivering', review }, op.state),
      deliverAs === 'draft',
    );
  }

  async function deliver(
    live: ResolutionLive,
    op: ConflictResolutionRecord,
    draft: boolean,
  ): Promise<ConflictResolutionRecord> {
    const delivery = ctx.delivery;
    const candidate = op.candidateCommit ?? op.ticketCommit;
    // Recorded before any network call: a restart turns this into `unknown`, never a retry.
    const pushing = save(
      { ...op, delivery: { status: 'pushing', reason: null, commit: candidate, draft } },
      'delivering',
    );
    ctx.notify(live);
    if (delivery === undefined) return pushing;
    const row = store.loopRepos.ticketBranches.getByRun(live.state.run.id);
    const prOpen = row?.pullRequest?.state === 'open';
    const mode = op.policy.delivery.mode;
    let status: ConflictResolutionRecord['delivery']['status'];
    let why: string;
    try {
      if (prOpen) {
        await delivery.openPullRequest(live, draft);
        status = 'pr-updated';
        why =
          "The new commits were pushed to the open pull request; GitHub's rules decide its merge.";
      } else if (mode === 'merge' && !draft) {
        await delivery.mergeLocally(live);
        status = 'merged';
        why = `Merged into ${op.targetBranch} locally under the project's delivery policy.`;
      } else {
        await delivery.openPullRequest(live, draft);
        status = 'pr-opened';
        why = draft
          ? 'Opened as a draft pull request: verification was unavailable.'
          : "Pull request opened under the project's delivery policy.";
      }
    } catch (error) {
      const message =
        error instanceof HttpError || error instanceof Error ? error.message : 'Delivery failed';
      const timeout = error instanceof HttpError && /timed out|timeout/i.test(error.message);
      const failed = finish(pushing, 'delivering', 'completed', {
        delivery: {
          status: timeout ? 'unknown' : 'blocked',
          reason: reason(
            timeout
              ? `${message} The outcome is unknown: use Refresh on the pull request before trying again.`
              : message,
          ),
          commit: candidate,
          draft,
        },
      });
      logger.log('info', 'delegated delivery refused', {
        runId: live.state.run.id,
        operationId: op.id,
      });
      ctx.notify(live);
      return failed;
    }
    const done = finish(pushing, 'delivering', 'completed', {
      delivery: { status, reason: why, commit: candidate, draft },
    });
    logger.log('info', 'delegated delivery done', {
      runId: live.state.run.id,
      operationId: op.id,
      status,
    });
    ctx.notify(live);
    return done;
  }

  // ------------------------------------------------------------------ owner actions

  async function ownerPromote(
    live: ResolutionLive,
    body: unknown,
  ): Promise<ConflictResolutionRecord> {
    const input = PromoteResolutionRequestSchema.parse(body ?? {});
    const op = repo.latestForRun(live.state.run.id);
    if (op === undefined || op.state !== 'awaiting-owner') {
      throw new HttpError(409, 'resolution_not_waiting', 'No update waits for your decision');
    }
    const needsReason =
      op.verification.status === 'failed' || op.verification.status === 'unavailable';
    if (needsReason && input.reason === undefined) {
      throw new HttpError(
        400,
        'reason_required',
        'Say why you apply it although it was not verified',
      );
    }
    if (input.reason !== undefined) ctx.ownerComment(live, input.reason);
    return promoteAndDeliver(live, op, 'owner');
  }

  async function cancel(live: ResolutionLive): Promise<ConflictResolutionRecord> {
    const op = repo.latestForRun(live.state.run.id);
    if (op === undefined || !isActiveResolutionState(op.state)) {
      throw new HttpError(409, 'resolution_not_active', 'No update is under way');
    }
    if (op.state === 'delivering') {
      throw new HttpError(
        409,
        'delivery_under_way',
        'The delivery is under way and cannot be cancelled',
      );
    }
    const cancelled = finish(op, op.state, 'cancelled', {
      resolverAgentRunId: null,
      resolution: { status: 'cancelled', reason: 'Cancelled by the owner.' },
    });
    if (op.resolverAgentRunId !== null) {
      const id = op.resolverAgentRunId;
      ctx.apply(live, (s, c) => stopAgent(s, id, c));
      ctx.track(ctx.release(live, id).catch(() => undefined));
    }
    await ctx.workspaces.dropCandidate(projectRootOf(live), op.id).catch(() => undefined);
    logger.log('info', 'conflict resolution cancelled', {
      runId: live.state.run.id,
      operationId: op.id,
    });
    ctx.notify(live);
    return cancelled;
  }

  // ------------------------------------------------------------------ automatic start

  /**
   * The policy's automatic start (`conflictResolution.mode: 'auto'`): when the target moved, the
   * run waits for its final step and nothing is under way. Never twice for the same pinned pair of
   * commits, so a failed or held update does not loop.
   */
  function maybeAutoStart(live: ResolutionLive): void {
    const policy = policyOf(live.state.run.projectId);
    if (policy.conflictResolution.mode !== 'auto') return;
    if (startBlocked(live) !== null) return;
    const row = store.loopRepos.ticketBranches.getByRun(live.state.run.id);
    if (row === undefined || row.state !== 'open') return;
    const latest = repo.latestForRun(live.state.run.id);
    ctx.track(
      (async () => {
        const target = await ctx.workspaces.branchTip(projectRootOf(live), row.baseBranch);
        if (target === null) return;
        if (
          latest !== undefined &&
          latest.ticketCommit === row.headCommit &&
          latest.targetCommit === target
        ) {
          return;
        }
        if (!(await baseMoved(live, row))) return;
        await start(live, 'auto');
      })().catch((error: unknown) => {
        if (error instanceof HttpError) {
          logger.log('info', 'automatic resolution not started', { code: error.code });
          return;
        }
        logger.log('warn', 'automatic resolution failed', errorFields(error));
      }),
    );
  }

  /** After a completed update the target may have moved again meanwhile. */
  function maybeChainAuto(live: ResolutionLive): void {
    maybeAutoStart(live);
  }

  // ------------------------------------------------------------------ restart

  /**
   * ADR-0013 §7: nothing is relaunched or republished by itself. An active operation becomes
   * `interrupted`; a delivery under way becomes `unknown` (the owner reconciles with Refresh); an
   * interrupted resolver is discarded so its half-done merge is never merged as a change.
   */
  async function recover(liveOf: (runId: string) => ResolutionLive | undefined): Promise<void> {
    for (const op of repo.listActive()) {
      const live = liveOf(op.runId);
      try {
        if (op.resolverAgentRunId !== null && live !== undefined) {
          const id = op.resolverAgentRunId;
          ctx.apply(live, (s, c) => abandonResolver(s, id, op.id, c));
        }
        save(
          {
            ...op,
            state: 'interrupted',
            finishedAt: iso(),
            resolverAgentRunId: null,
            resolution:
              op.state === 'resolving' || op.state === 'preparing'
                ? { status: 'failed', reason: 'A restart interrupted it; start it again.' }
                : op.resolution,
            delivery:
              op.state === 'delivering'
                ? {
                    ...op.delivery,
                    status: 'unknown',
                    reason:
                      'A restart interrupted the delivery; use Refresh on the pull request to see what happened.',
                  }
                : op.delivery,
          },
          op.state,
        );
        if (live !== undefined) {
          await ctx.workspaces.dropCandidate(projectRootOf(live), op.id).catch(() => undefined);
        }
      } catch (error) {
        logger.log('warn', 'resolution recovery failed', {
          operationId: op.id,
          ...errorFields(error),
        });
      }
    }
  }

  /**
   * The owner's merge gate on the tip (review loop): a current `skipped-by-policy` decision for
   * exactly this tip gates only its always-run checks. Every other route keeps the workflow's own
   * gate (required checks are never removed by this).
   */
  function tipGateOverride(runId: string, tip: string): CheckSpec | null {
    const op = repo.latestForRun(runId);
    if (op === undefined || op.state !== 'completed') return null;
    if (op.candidateCommit !== tip || op.verification.status !== 'skipped-by-policy') return null;
    if (op.policyFingerprint !== policyFingerprint(policyOf(op.projectId))) return null;
    const ids = op.verification.checkIds;
    return {
      place: 'branch',
      blockNodeId: null,
      run: [{ kind: 'ids', ids }],
      gate: [{ kind: 'ids', ids }],
    };
  }

  return {
    view,
    async startByOwner(live: ResolutionLive) {
      return toDto(live, await start(live, 'owner'));
    },
    async promote(live: ResolutionLive, body: unknown) {
      return toDto(live, await ownerPromote(live, body));
    },
    async cancel(live: ResolutionLive) {
      return toDto(live, await cancel(live));
    },
    maybeAutoStart,
    workspaceOptions,
    onHelperOutcome,
    sealResolution,
    resolverEnded,
    recover,
    tipGateOverride,
  };
}

export type ConflictResolution = ReturnType<typeof createConflictResolution>;
