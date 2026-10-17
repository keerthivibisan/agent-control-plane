import { GitCommitSchema, TicketBranchNameSchema } from '@acp/core';
import type { ChangeDecider } from '@acp/core';
import type { TicketBranchActionRequest } from '@acp/core/api';
import { applyCommand } from './commands.js';
import type { Draft } from './draft.js';
import { refusal } from './errors.js';
import type { Refusal } from './errors.js';
import {
  applyDecision,
  branchLabel,
  checkChange,
  isFinalChangeState,
  leadActivity,
  notifyLead,
  undecidedChanges,
} from './loop.js';
import type { ChangeAction, DecisionInput } from './loop.js';
import { isAgentOverBudget } from './policy.js';
import type { EngineAgent, EngineContext, EngineResult, RunState } from './state.js';
import { isActiveAgentStatus, isLiveAgentStatus, isTerminalRunStatus } from './transitions.js';

/**
 * The review loop's commands for the server (ADR-0021 §3–4, docs/review-loop/README.md §5–6).
 * The engine never runs git: the server carries out `seal-change`, `create-ticket-branch`,
 * `merge-change` and `discard-change`, and reports back here. Every command refuses runs without
 * the review loop, which keep the legacy per-change owner review.
 */

type Body<T> = Refusal | { value: T };
const done = { value: undefined } as const;

function noLoop(): Refusal {
  return refusal(
    'review-not-allowed',
    'This run has no review loop; the owner reviews each change.',
    'legacy-review',
  );
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
      return refusal(
        'unknown-agent',
        'No change in this run belongs to that agent.',
        'change-not-found',
      );
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
    const ours =
      named.success &&
      (branch === `acp/${loop.ticketKey}` || branch.startsWith(`acp/${loop.ticketKey}-r`));
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
 * The server sealed a change after `seal-change` (ADR-0021 §3): no change → `no-changes` and the
 * agent SUCCEEDED (FAILED if its turn had failed); a sealed commit → `ready` for a reviewer; a
 * change that could not be sealed (`changed` with no commit) → `needs-owner`.
 */
export function changeSealed(
  state: RunState,
  agentRunId: string,
  result: { changed: boolean; headCommit: string | null; changedFiles: number | null },
  ctx: EngineContext,
): EngineResult {
  return onChange(state, agentRunId, ctx, (d, agent) => {
    const change = agent.change;
    if (change?.state !== 'sealing' || agent.status !== 'AWAITING_REVIEW') {
      return refusal(
        'review-not-allowed',
        'This change is not being sealed.',
        'change-not-decidable',
      );
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
      notifyLead(d, `${agent.role} finished with no changes; there is nothing to merge.`);
      return done;
    }
    change.changedFiles = files;
    if (result.headCommit === null) {
      change.state = 'needs-owner';
      notifyLead(
        d,
        `${agent.role}'s change could not be saved, so it cannot be reviewed; the owner will look at it.`,
      );
      return done;
    }
    change.headCommit = result.headCommit;
    change.state = 'ready';
    change.readyAt = d.now;
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
    if (check !== null) return check;
    const change = agent.change;
    if (change === undefined) return refusal('unknown-agent', 'No change.', 'change-not-found');
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
    if (change === undefined) return refusal('unknown-agent', 'No change.', 'change-not-found');
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

/** Why the server could not merge a change (README §6, `merge_change` steps 3–4). */
export type MergeBlocked =
  | { reason: 'merge-conflict'; files: readonly string[] }
  | { reason: 'checks-pending' }
  | { reason: 'checks-failed'; failed: readonly string[] }
  | { reason: 'failed' };

/** Longest list of file names or check names quoted back. */
const MAX_LISTED = 100;

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
    if (change === undefined) return refusal('unknown-agent', 'No change.', 'change-not-found');
    if (!change.merging) {
      return refusal(
        'review-not-allowed',
        'No merge of this change is under way.',
        'change-not-decidable',
      );
    }
    change.merging = false;
    const role = agent.role;
    const branch = branchLabel(d);
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
        return {
          value: `Required checks failed on ${role}'s change${failed.length > 0 ? `: ${failed.join(', ')}` : ''}. Ask for rework, discard it, or ask the owner.`,
        };
      }
      case 'failed':
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
    if (change === undefined) return refusal('unknown-agent', 'No change.', 'change-not-found');
    // A late result for a change already decided changes nothing.
    if (isFinalChangeState(change.state)) return done;
    change.checks = result.requiredPassed ? 'passed' : 'failed';
    const atLead =
      change.state === 'decision' || (change.state === 'reviewing' && change.reviewer === 'lead');
    if (!atLead) return done;
    const failed = result.failed.slice(0, MAX_LISTED);
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
    return refusal('review-not-allowed', 'This run has no ticket branch.', 'no-ticket-branch');
  }
  if (undecidedChanges(state).length > 0) {
    return refusal(
      'workers-still-running',
      'Some changes are not decided yet.',
      'changes-undecided',
    );
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
    d.setRunStatus('RUNNING');
    notifyLead(
      d,
      [
        `The owner asked for changes before merging ${branchLabel(d)}:`,
        text,
        'Start helpers for the changes with start_agent, decide their changes as before, then call request_review again.',
      ].join('\n\n'),
    );
    return done;
  });
}
