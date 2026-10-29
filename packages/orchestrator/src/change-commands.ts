import { GitCommitSchema, TicketBranchNameSchema } from '@acp/core';
import type { ChangeDecider } from '@acp/core';
import type { TicketBranchActionRequest } from '@acp/core/api';
import { startChangeChecks } from './check-blocks.js';
import { applyCommand } from './commands.js';
import { hasMergeChecks } from './program.js';
import type { Draft } from './draft.js';
import { refusal } from './errors.js';
import type { Refusal } from './errors.js';
import {
  applyDecision,
  branchLabel,
  checkChange,
  isFinalChangeState,
  leadActivity,
  leadCanDecide,
  notifyLead,
  undecidedChanges,
} from './loop.js';
import type { ChangeAction, DecisionInput } from './loop.js';
import { isAgentOverBudget } from './policy.js';
import type { EngineAgent, EngineContext, EngineResult, RunState } from './state.js';
import { isActiveAgentStatus, isLiveAgentStatus, isTerminalRunStatus } from './transitions.js';

/**
 * The review loop's commands for the server (ADR-0021 §3–4, docs/history/review-loop/README.md
 * §5–6). The engine never runs git: the server carries out `seal-change`, `create-ticket-branch`,
 * `merge-change` and `discard-change`, and reports back here. Every command refuses runs without
 * the review loop, which keep the legacy per-change owner review.
 */

type Body<T> = Refusal | { value: T };
const done = { value: undefined } as const;

function noLoop(): Refusal {
  return refusal('legacy-review', 'This run has no review loop; the owner reviews each change.');
}

/** Runs `body` on a loop run's change, refusing unknown agents and agents with no change. */
function onChange<T>(
  state: RunState,
  agentRunId: string,
  ctx: EngineContext,
  body: (d: Draft, agent: EngineAgent) => Body<T>,
): EngineResult<T> {
  return applyCommand(state, ctx, (d) => {
    if (d.integration === undefined) return noLoop();
    const agent = d.agent(agentRunId);
    if (agent?.change === undefined) {
      return refusal('change-not-found', 'No change in this run belongs to that agent.');
    }
    return body(d, agent);
  });
}

/**
 * The server created the ticket branch after `create-ticket-branch` (ADR-0021 §4). Helpers can
 * start from now on; their worktrees start from its tip (`start-agent.fromBranch`).
 */
export function ticketBranchCreated(
  state: RunState,
  branch: string,
  ctx: EngineContext,
): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const loop = d.integration;
    if (loop === undefined) return noLoop();
    if (d.isStopping()) return refusal('run-not-active', 'The run has ended.');
    const named = TicketBranchNameSchema.safeParse(branch);
    // ADR-0025: the server names the branch from the ticket or the project's branching strategy,
    // so any safe name is accepted, except `main`/`master` and an `acp/…` name that is not this
    // ticket's own legacy name (another ticket's branch, or a helper's `acp/<run>/<agent>`). The
    // server's guard refuses every other long-lived branch it knows of.
    const legacy =
      branch === `acp/${loop.ticketKey}` ||
      (/^-r[1-9]\d*$/.test(branch.slice(`acp/${loop.ticketKey}`.length)) &&
        branch.startsWith(`acp/${loop.ticketKey}-r`));
    const ours =
      named.success &&
      branch !== 'main' &&
      branch !== 'master' &&
      (branch.startsWith('acp/') ? legacy : true);
    if (!ours) {
      return refusal('invalid-input', "That is not a ticket branch name for this run's ticket.");
    }
    if (loop.ticketBranch !== null && loop.ticketBranch !== branch) {
      return refusal('invalid-input', 'This run already has a ticket branch.');
    }
    loop.ticketBranch = branch;
    return done;
  });
}

/**
 * Why the server could not seal a change:
 * - `branch-changed` (F-1): the helper switched its folder to another branch;
 * - `invalid-workspace` (F-2): its folder is gone, or it committed files the app never saves
 *   (an attachment copy or a setup output);
 * - `not-saved` (F-2): any other failure (also a failed seal reported with no code).
 */
export type SealFailure = 'branch-changed' | 'invalid-workspace' | 'not-saved';

/** What the lead is told when a helper's folder left its branch (F-1). */
export function branchChangedLine(role: string, agentRunId: string): string {
  return `${role} (agentId ${agentRunId}) switched its folder to another branch, so its work could not be saved. Discard its change with discard_change, then start a fresh helper for that step if the work is still needed. Do not ask helpers to run git commands that create, switch, commit, reset or push branches: the app does that.`;
}

/** Why another failed seal happened, in plain words (F-2). */
const SEAL_FAILURE_WORDS: Readonly<Record<Exclude<SealFailure, 'branch-changed'>, string>> = {
  'invalid-workspace':
    'its folder is gone, or it committed files the app never saves (an attachment copy or a setup output)',
  'not-saved': 'git could not commit it',
};

/**
 * What the lead is told when a change could not be saved for another reason (F-2): the owner has
 * it, and the lead may discard it (never merge or rework it).
 */
export function changeNotSavedLine(
  role: string,
  agentRunId: string,
  failure: Exclude<SealFailure, 'branch-changed'>,
): string {
  return `${role}'s change (agentId ${agentRunId}) could not be saved (${SEAL_FAILURE_WORDS[failure]}), so it cannot be reviewed or merged; the owner will look at it. If the step should be done again, discard it with discard_change first.`;
}

/**
 * The server sealed a change after `seal-change` (ADR-0021 §3): no change → `no-changes` and the
 * agent SUCCEEDED (FAILED if its turn had failed); a sealed commit → `ready` for a reviewer; a
 * change that could not be sealed (`changed` with no commit) → `needs-owner`. F-1: a change whose
 * helper switched its folder to another branch (`failure: 'branch-changed'`) goes to the lead
 * (`decision`, with `sealFailure`), who can discard it and start a fresh helper; the owner gets it
 * only when the lead cannot decide. F-2: any other failed seal keeps `sealFailure` too
 * (`invalid-workspace`, or `not-saved` when no code came), so the lead may discard it while it
 * waits for the owner.
 */
export function changeSealed(
  state: RunState,
  agentRunId: string,
  result: {
    changed: boolean;
    headCommit: string | null;
    changedFiles: number | null;
    failure?: SealFailure;
  },
  ctx: EngineContext,
): EngineResult {
  return onChange(state, agentRunId, ctx, (d, agent) => {
    const change = agent.change;
    if (change?.state !== 'sealing' || agent.status !== 'AWAITING_REVIEW') {
      return refusal('change-not-decidable', 'This change is not being sealed.');
    }
    if (result.headCommit !== null && !GitCommitSchema.safeParse(result.headCommit).success) {
      return refusal('invalid-input', 'The sealed commit id is not valid.');
    }
    const files = result.changedFiles;
    if (files !== null && (!Number.isInteger(files) || files < 0)) {
      return refusal('invalid-input', 'The changed-file count is not valid.');
    }
    if (!result.changed) {
      change.state = 'no-changes';
      agent.review = 'no-changes';
      d.setAgentStatus(agent, change.turnFailed ? 'FAILED' : 'SUCCEEDED');
      notifyLead(d, noChangeLine(agent));
      return done;
    }
    change.changedFiles = files;
    if (result.failure === 'branch-changed') {
      change.sealFailure = 'branch-changed';
      change.headCommit = null;
      if (leadCanDecide(d)) {
        change.state = 'decision';
        notifyLead(d, branchChangedLine(agent.role, agent.id));
      } else {
        change.state = 'needs-owner';
      }
      return done;
    }
    if (result.headCommit === null) {
      // F-2: the owner has it, and the lead may discard it (merge and rework stay refused), so
      // a lead is never left with only "start another helper".
      const failure = result.failure ?? 'not-saved';
      change.state = 'needs-owner';
      change.sealFailure = failure;
      notifyLead(d, changeNotSavedLine(agent.role, agent.id, failure));
      return done;
    }
    change.headCommit = result.headCommit;
    change.sealedForRecovery = true;
    // A rework the owner granted after a failed seal saved it this time (F-2).
    delete change.sealFailure;
    change.state = 'ready';
    change.readyAt = d.now;
    // ADR-0027 §5: a Checks block on the change runs first; the review waits for its result.
    startChangeChecks(d, agent, change);
    // `reconcile` assigns a reviewer, oldest change first.
    return done;
  });
}

/**
 * Whether `by` may take `action` on the change now (ADR-0021 §3). Call it before doing any git
 * work for an owner's action; the commands check again.
 */
export function checkChangeAction(
  state: RunState,
  agentRunId: string,
  action: ChangeAction,
  by: ChangeDecider,
): Refusal | null {
  return checkChange(state, agentRunId, action, by);
}

/**
 * Starts a merge of the change into the ticket branch: marks it as merging and emits
 * `merge-change` for the server, which then reports with `recordChangeDecision` (merged, or no
 * changes) or `changeMergeBlocked`. The lead's `merge_change` comes here too.
 */
export function beginChangeMerge(
  state: RunState,
  agentRunId: string,
  options: { by: ChangeDecider; anyway?: boolean },
  ctx: EngineContext,
): EngineResult<string> {
  return onChange(state, agentRunId, ctx, (d, agent) => {
    const anyway = options.anyway === true;
    const check = checkChange(d, agent.id, anyway ? 'merge-anyway' : 'merge', options.by);
    const change = agent.change;
    if (check?.code === 'checks-failed' && options.by === 'lead' && change !== undefined) {
      // ADR-0027 §5: the block before the merge sends a failed change to the owner.
      if (mergeFailureRoute(d) === 'owner') return { value: toOwner(d, agent, change) };
    }
    if (check !== null) return check;
    if (change === undefined) return refusal('change-not-found', 'No change.');
    change.merging = true;
    d.effects.push({ type: 'merge-change', agentRunId: agent.id, by: options.by, anyway });
    if (options.by === 'lead') leadActivity(d, `Merging ${agent.role} into ${branchLabel(d)}`);
    return { value: `Merging ${agent.role}'s change into ${branchLabel(d)}…` };
  });
}

/**
 * Records a decision on a change (ADR-0021 §3), by the lead or the owner:
 * - `merge` / `merge-anyway`: after the server merged (`outcome` merged, with the new ticket tip
 *   in `headCommit`) or found nothing new (`outcome` no-changes);
 * - `discard` (`comments` = the reason): emits `discard-change` for the server;
 * - `rework` (`comments` required): the helper starts again in its own worktree;
 * - `ask-owner` (the lead; `comments` = the question): the change waits for the owner.
 * The value is the reply for the decider (the lead's merge_change result, or the owner).
 */
export function recordChangeDecision(
  state: RunState,
  agentRunId: string,
  input: DecisionInput,
  ctx: EngineContext,
): EngineResult<string> {
  return onChange(state, agentRunId, ctx, (d, agent) => {
    const change = agent.change;
    if (change === undefined) return refusal('change-not-found', 'No change.');
    const merge = input.decision === 'merge' || input.decision === 'merge-anyway';
    if (merge) {
      if (input.outcome !== 'merged' && input.outcome !== 'no-changes') {
        return refusal(
          'invalid-input',
          'A merge decision needs its outcome (merged or no-changes).',
        );
      }
      if (input.headCommit !== undefined && !GitCommitSchema.safeParse(input.headCommit).success) {
        return refusal('invalid-input', 'The merged commit id is not valid.');
      }
      if (input.decision === 'merge-anyway' && input.by !== 'owner') {
        return refusal('not-lead', 'Only the owner can merge past a failed check.');
      }
      // The merge was begun (and checked) by `beginChangeMerge`; otherwise check it now.
      if (!change.merging) {
        const check = checkChange(d, agent.id, input.decision, input.by);
        if (check !== null) return check;
      }
    } else {
      const action: ChangeAction = input.decision;
      const check = checkChange(d, agent.id, action, input.by);
      if (check !== null) return check;
      const text = input.comments?.trim() ?? '';
      if ((input.decision === 'rework' || input.decision === 'ask-owner') && text.length === 0) {
        return refusal(
          'invalid-input',
          input.decision === 'rework' ? 'Say what should change.' : 'Ask the owner a question.',
        );
      }
    }
    return { value: applyDecision(d, agent, input) };
  });
}

/**
 * Where the block before the lead's merge sends a failed change (ADR-0027 §5; old graphs: lead).
 * Without that block (ADR-0028 §2) no check gates the merge, so nothing fails there: `lead`.
 */
function mergeFailureRoute(d: Draft): 'lead' | 'owner' | 'helper' {
  return d.program().checkBlocks.merge?.onFailure ?? 'lead';
}

/** The change goes to the owner after a failed merge block; returns the lead's reply. */
function toOwner(d: Draft, agent: EngineAgent, change: NonNullable<EngineAgent['change']>): string {
  change.merging = false;
  change.state = 'needs-owner';
  leadActivity(d, `${agent.role}'s change failed its checks; the owner decides`);
  return `This workflow sends a change whose checks failed before the merge to the owner, who decides; you will get a message when they do.`;
}

/**
 * Why the server could not merge a change (README §6, `merge_change` steps 3–4). F-2: the ticket
 * branch moved outside the app (`ticket-branch-moved`: it is not at the recorded tip) or is
 * checked out in another folder (`ticket-branch-checked-out`). Neither goes away by trying again.
 */
export type MergeBlocked =
  | { reason: 'merge-conflict'; files: readonly string[] }
  | { reason: 'checks-pending' }
  | { reason: 'checks-failed'; failed: readonly string[] }
  | { reason: 'ticket-branch-moved' }
  | { reason: 'ticket-branch-checked-out' }
  | { reason: 'failed' };

/** Longest list of file names or check names quoted back. */
const MAX_LISTED = 100;

/**
 * F-2: merges of one change that may fail in a row (`failed`, a git failure that may be passing)
 * before the change goes to the owner, so a lead can never retry a merge forever.
 */
export const MAX_FAILED_MERGES = 3;

/** The change waits for the owner after a merge that cannot succeed now (F-2). */
function mergeToOwner(
  d: Draft,
  agent: EngineAgent,
  change: NonNullable<EngineAgent['change']>,
  why: string,
): string {
  change.state = 'needs-owner';
  leadActivity(d, `${agent.role}'s change waits for the owner: the merge cannot succeed now`);
  return `${why} ${agent.role}'s change (agentId ${agent.id}) now waits for the owner; do not try the merge again. You get a message when the owner decides.`;
}

/**
 * The server could not merge the change: a conflict with the ticket branch, the required checks
 * running (it started them; `checksFinished` follows) or failed, or a git failure. Clears the
 * merge; the change waits for the next decision. The value is the reply for the decider.
 */
export function changeMergeBlocked(
  state: RunState,
  agentRunId: string,
  blocked: MergeBlocked,
  ctx: EngineContext,
): EngineResult<string> {
  return onChange(state, agentRunId, ctx, (d, agent) => {
    const change = agent.change;
    if (change === undefined) return refusal('change-not-found', 'No change.');
    if (!change.merging) {
      return refusal('change-not-decidable', 'No merge of this change is under way.');
    }
    change.merging = false;
    const role = agent.role;
    const branch = branchLabel(d);
    // F-2: a merge that failed for a git reason counts until the change merges or is blocked for
    // another reason.
    if (blocked.reason === 'failed') change.failedMerges = (change.failedMerges ?? 0) + 1;
    else delete change.failedMerges;
    switch (blocked.reason) {
      case 'merge-conflict': {
        const files = blocked.files.slice(0, MAX_LISTED);
        change.conflictFiles = files;
        return {
          value: `${role}'s change conflicts with ${branch}${files.length > 0 ? ` in: ${files.join(', ')}` : ''}. Ask for rework to resolve it, discard it, or ask the owner.`,
        };
      }
      case 'checks-pending':
        change.checks = 'pending';
        return {
          value: `The required checks are running on ${role}'s change; you will get a message when they finish. Then call merge_change again.`,
        };
      case 'checks-failed': {
        change.checks = 'failed';
        const failed = blocked.failed.slice(0, MAX_LISTED);
        const text = `Required checks failed on ${role}'s change${failed.length > 0 ? `: ${failed.join(', ')}` : ''}.`;
        // ADR-0027 §5: the block before the merge may send a failed change to the owner.
        if (mergeFailureRoute(d) === 'owner' && change.state !== 'needs-owner') {
          return { value: `${text} ${toOwner(d, agent, change)}` };
        }
        return { value: `${text} Ask for rework, discard it, or ask the owner.` };
      }
      case 'ticket-branch-moved':
        // F-2: permanent until the owner resets the branch (F-1's reset) or discards it.
        return {
          value: mergeToOwner(
            d,
            agent,
            change,
            `${branch} was changed outside the app (it is not at the last commit the app merged), so nothing can be merged into it. Only the owner can reset it to the last reviewed commit.`,
          ),
        };
      case 'ticket-branch-checked-out':
        return {
          value: mergeToOwner(
            d,
            agent,
            change,
            `${branch} is checked out in another folder, so nothing can be merged into it. Only the owner can free it.`,
          ),
        };
      case 'failed':
        if ((change.failedMerges ?? 0) >= MAX_FAILED_MERGES) {
          return {
            value: mergeToOwner(
              d,
              agent,
              change,
              `The merge of ${role}'s change failed ${change.failedMerges ?? MAX_FAILED_MERGES} times in a row.`,
            ),
          };
        }
        return { value: `The merge of ${role}'s change failed. Try again, or ask the owner.` };
    }
  });
}

/**
 * The required checks finished on `commit` (ADR-0021 §3–4). For a change: records the result and
 * tells the lead (merge_change again, or rework). For the ticket tip (`agentRunId` null): the
 * owner sees it with the ticket branch, so the engine has nothing to record.
 */
export function checksFinished(
  state: RunState,
  agentRunId: string | null,
  result: { commit: string; requiredPassed: boolean; failed: readonly string[] },
  ctx: EngineContext,
): EngineResult {
  if (!GitCommitSchema.safeParse(result.commit).success) {
    return { ok: false, refusal: refusal('invalid-input', 'The checked commit id is not valid.') };
  }
  if (agentRunId === null) {
    if (state.integration === undefined) return { ok: false, refusal: noLoop() };
    return { ok: true, state, effects: [], value: undefined };
  }
  return onChange(state, agentRunId, ctx, (d, agent) => {
    const change = agent.change;
    if (change === undefined) return refusal('change-not-found', 'No change.');
    // A late result for a change already decided changes nothing.
    if (isFinalChangeState(change.state)) return done;
    // ADR-0028 §2: without a Checks block before the merge no check gates it, so a result (which
    // the server never asks for then) is not recorded and never holds the merge back.
    if (!hasMergeChecks(d)) return done;
    change.checks = result.requiredPassed ? 'passed' : 'failed';
    const atLead =
      change.state === 'decision' || (change.state === 'reviewing' && change.reviewer === 'lead');
    if (!atLead) return done;
    const failed = result.failed.slice(0, MAX_LISTED);
    if (!result.requiredPassed && mergeFailureRoute(d) === 'owner') {
      // ADR-0027 §5: the block before the merge sends a failed change to the owner.
      notifyLead(
        d,
        `Required checks failed on ${agent.role}'s change (agentId ${agent.id})${failed.length > 0 ? `: ${failed.join(', ')}` : ''}. ${toOwner(d, agent, change)}`,
      );
      return done;
    }
    notifyLead(
      d,
      result.requiredPassed
        ? `The required checks passed on ${agent.role}'s change (agentId ${agent.id}, commit ${result.commit}). Call merge_change to merge it.`
        : `Required checks failed on ${agent.role}'s change (agentId ${agent.id})${failed.length > 0 ? `: ${failed.join(', ')}` : ''}. Ask for rework, discard it, or ask the owner.`,
    );
    return done;
  });
}

// ------------------------------------------------------------------ the owner's final merge

/**
 * Whether the owner may act on the ticket branch now (ADR-0021 §4):
 * - merge, merge anyway, update from main: in REVIEW, with every change decided and no agent but
 *   the lead working;
 * - request changes: in REVIEW, while the lead is live and within budget;
 * - discard: in REVIEW or NEEDS_REVIEW with no agent working, or after the run was stopped or
 *   failed (its branch stays open until discarded).
 */
export function checkTicketBranchAction(
  state: RunState,
  action: TicketBranchActionRequest['action'],
): Refusal | null {
  const loop = state.integration;
  if (loop === undefined) return noLoop();
  const status = state.run.status;
  if (status === 'CANCELLING') return refusal('run-cancelling', 'The run is being stopped.');
  if (status === 'COMPLETED')
    return refusal('run-not-active', 'The ticket branch was already settled.');
  const working = state.agents.some((a) => a.kind !== 'lead' && isActiveAgentStatus(a.status));
  if (action === 'discard') {
    if (isTerminalRunStatus(status)) return null;
    if (status !== 'REVIEW' && status !== 'NEEDS_REVIEW') {
      return refusal('run-not-active', 'Stop the run first, or wait for it to reach review.');
    }
    return working ? refusal('workers-still-running', 'Some agents are still working.') : null;
  }
  if (status !== 'REVIEW') {
    return refusal(
      'run-not-active',
      `The run is ${status.toLowerCase()}; the ticket branch waits.`,
    );
  }
  if (working) return refusal('workers-still-running', 'Some agents are still working.');
  if (action === 'request-changes') {
    const lead = state.agents.find((a) => a.kind === 'lead');
    if (lead === undefined || !isLiveAgentStatus(lead.status)) {
      return refusal('agent-not-live', 'The lead agent has ended; changes need a new run.');
    }
    if (isAgentOverBudget(lead)) {
      return refusal('over-budget', 'The lead agent reached its budget; raise it first.');
    }
    return null;
  }
  if (loop.ticketBranch === null) {
    return refusal('no-ticket-branch', 'This run has no ticket branch.');
  }
  if (undecidedChanges(state).length > 0) {
    return refusal('changes-undecided', 'Some changes are not decided yet.');
  }
  return null;
}

/**
 * The owner merged the ticket branch into the base branch, or discarded it (ADR-0021 §4), after
 * the server did the git work: the run is COMPLETED and the lead, if still live, is stopped.
 * Discarding also drops every undecided change. For a run that was stopped or failed, the branch
 * is just gone: nothing changes in the engine.
 */
export function recordTicketBranchDecision(
  state: RunState,
  outcome: 'merged' | 'discarded',
  ctx: EngineContext,
): EngineResult {
  const check = checkTicketBranchAction(state, outcome === 'merged' ? 'merge-anyway' : 'discard');
  if (check !== null) return { ok: false, refusal: check };
  if (isTerminalRunStatus(state.run.status))
    return { ok: true, state, effects: [], value: undefined };
  return applyCommand(state, ctx, (d) => {
    if (outcome === 'discarded') {
      for (const agent of undecidedChanges(d)) {
        const change = agent.change;
        if (change !== undefined) change.state = 'discarded';
        agent.review = 'discarded';
        if (agent.status === 'AWAITING_REVIEW') d.setAgentStatus(agent, 'CANCELLED');
        d.effects.push({ type: 'discard-change', agentRunId: agent.id });
      }
    }
    if (d.run.status === 'NEEDS_REVIEW') d.setRunStatus('REVIEW');
    d.setRunStatus('COMPLETED');
    // The conversation is over; stop the lead if it is still waiting.
    for (const agent of d.agents) d.endAgent(agent, 'CANCELLED', true);
    return done;
  });
}

/** Longest owner comment sent with "request changes" (`TicketBranchActionRequest.comment`). */
const REQUEST_CHANGES_MAX_CHARS = 8000;

/**
 * The owner's "Request changes" on the ticket branch (ADR-0021 §4): REVIEW → RUNNING, the
 * handover is undone and the comment goes to the lead, which may start helpers again. The server
 * stores the comment as the owner's ticket comment. The final stages do not run a second time.
 */
export function requestTicketChanges(
  state: RunState,
  comment: string,
  ctx: EngineContext,
): EngineResult {
  const check = checkTicketBranchAction(state, 'request-changes');
  if (check !== null) return { ok: false, refusal: check };
  const text = comment.trim();
  if (text.length === 0 || text.length > REQUEST_CHANGES_MAX_CHARS) {
    return {
      ok: false,
      refusal: refusal('invalid-input', 'Say what should change (up to 8000 characters).'),
    };
  }
  return applyCommand(state, ctx, (d) => {
    const loop = d.integration;
    if (loop === undefined) return noLoop();
    loop.handedOver = false;
    // The owner's message below already says what to do; the "hand over" prompt waits for the
    // next idle point after new helper work (RL-F).
    d.handoverPrompted = true;
    d.setRunStatus('RUNNING');
    notifyLead(
      d,
      [
        `The owner asked for changes before merging ${branchLabel(d)}:`,
        text,
        'Start helpers for the changes with start_agent, decide their changes as before, then call request_review again with an updated summary.',
      ].join('\n\n'),
    );
    return done;
  });
}

/**
 * ADR-0030 §5: the lead's line about a helper that ended with no changes. It carries the helper's
 * own reported outcome and note, so the lead can tell a read-only step that is done from a blocked
 * one, instead of starting the same helper again with nothing new.
 */
export function noChangeLine(agent: EngineAgent): string {
  const reported = agent.reportedOutcome;
  const base = `${agent.role} (agentId ${agent.id}) finished with no changes; there is nothing to merge.`;
  if (reported === undefined) {
    return `${base} It sent no report, so why is unknown; give a replacement a different, more specific task, or hand over.`;
  }
  if (reported.kind === 'blocked') {
    return `${base} It reported it was blocked: ${reported.note} A replacement with the same task would be blocked too; change the task or hand over (it counts as an attempt of the step).`;
  }
  return `${base} It reported ${reported.kind}: ${reported.note}`;
}
