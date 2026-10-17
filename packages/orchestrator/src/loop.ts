import { FINAL_CHANGE_STATES } from '@acp/core';
import type {
  ChangeDecider,
  ChangeDecision,
  ChangeReviewerKind,
  ChangeState,
  OrchestrationRun,
} from '@acp/core';
import type { Draft } from './draft.js';
import { refusal } from './errors.js';
import { cleanSummary } from './summary.js';
import type { Refusal } from './errors.js';
import { isOverBudget } from './budget.js';
import { runLimits } from './limits.js';
import { editingNodeOf, programOf, reviewRouteOf } from './program.js';
import type { ProgramView } from './program.js';
import {
  changeReviewerBrief,
  countsAsHelper,
  hasReviewableChange,
  launchFieldsFor,
  stageOf,
} from './stages.js';
import type { EngineAgent, EngineChange, RunIntegration, RunLimits } from './state.js';
import { isActiveAgentStatus, isLiveAgentStatus } from './transitions.js';

/**
 * The review loop (ADR-0021 §3, docs/review-loop/README.md §5), as operations on a command's
 * draft. A helper (or the tester) that ends its turn goes to AWAITING_REVIEW and its worktree is
 * sealed; a reviewer (a read-only review agent, or the lead) reviews the change; the lead decides:
 * merge into the ticket branch, rework, discard, or ask the owner. The engine never runs git: it
 * asks the server with effects and records what the server reports.
 *
 * Every function here is only called for runs with `integration`; runs without it keep the legacy
 * flow untouched.
 */

/** What the lead's `view_change` reply may hold in all (ADR-0021 §3), in UTF-8 bytes. */
export const VIEW_CHANGE_MAX_BYTES = 32 * 1024;

/** Max length of a role quoted in a review agent's own role name (`AgentRun.role` ≤ 60). */
const ROLE_MAX_CHARS = 60;

/** The parts of a run the loop's reads need (`RunState` and `Draft` both fit). */
interface LoopView extends ProgramView {
  readonly agents: readonly EngineAgent[];
  readonly integration?: RunIntegration | undefined;
}

/**
 * Rework rounds per decider (ADR-0023 §4): `change.round` counts every rework; the ones a change
 * reviewer sent back itself (route "direct") are `reviewerRounds`, the rest the lead's and the
 * owner's. The lead's limit is its route's `leadRounds`.
 */
export function leadRoundsUsed(change: Pick<EngineChange, 'round' | 'reviewerRounds'>): number {
  return change.round - (change.reviewerRounds ?? 0);
}

/** How often the lead may send this agent's change back (its route's `leadRounds`). */
export function leadRoundLimit(view: ProgramView, agent: EngineAgent): number {
  return reviewRouteOf(programOf(view), agent).leadRounds;
}

/** Live helpers of an editing node (ADR-0023 §7), for its `maxInstances`. */
function liveOfNode(view: LoopView, agent: EngineAgent): number {
  const id = stageOf(agent);
  return view.agents.filter(
    (a) => a.kind === agent.kind && stageOf(a) === id && isActiveAgentStatus(a.status),
  ).length;
}

/** The helper's node has room for one more live agent (testers: no per-node limit). */
function nodeHasRoom(view: LoopView, agent: EngineAgent): boolean {
  const node = editingNodeOf(programOf(view), agent);
  if (node === undefined || node.type === 'tester') return true;
  return liveOfNode(view, agent) < node.maxInstances;
}

export function isFinalChangeState(state: ChangeState): boolean {
  return FINAL_CHANGE_STATES.includes(state);
}

/** Helpers and the tester whose change is not decided yet, oldest first. */
export function undecidedChanges(view: LoopView): EngineAgent[] {
  return view.agents.filter(
    (a) =>
      hasReviewableChange(a.kind) &&
      (a.status === 'AWAITING_REVIEW' ||
        (a.change !== undefined && !isFinalChangeState(a.change.state))),
  );
}

/** The ticket branch's name for messages, or a plain phrase before the server reported it. */
export function branchLabel(view: LoopView): string {
  return view.integration?.ticketBranch ?? 'the ticket branch';
}

function freshChange(round: number, turnFailed: boolean): EngineChange {
  return {
    state: 'sealing',
    round,
    verdict: null,
    reviewer: null,
    reviewerAgentRunId: null,
    headCommit: null,
    changedFiles: null,
    readyAt: null,
    checks: null,
    conflictFiles: [],
    merging: false,
    turnFailed,
  };
}

/** Change-tracked agents (workers and the tester) of the run, in creation order. */
function changeAgents(d: Draft): EngineAgent[] {
  return d.agents.filter((a) => hasReviewableChange(a.kind) && a.change !== undefined);
}

/** Live helpers counted against the run's limit (ADR-0019 §3): workers, reviewers, the tester. */
export function activeHelperCount(view: LoopView): number {
  return view.agents.filter((a) => countsAsHelper(a.kind) && isActiveAgentStatus(a.status)).length;
}

/** The lead can take decisions: it is live (BLOCKED counts; it gets a digest on resume). */
export function leadCanDecide(d: Draft): boolean {
  const lead = d.lead();
  return lead !== undefined && isLiveAgentStatus(lead.status);
}

/**
 * Sends an engine message to the lead when it can read it now: live and not BLOCKED (a message
 * would start a turn past its budget; the resume message after a raise lists what waits instead).
 */
export function notifyLead(d: Draft, text: string): void {
  const lead = d.lead();
  if (lead === undefined || !isActiveAgentStatus(lead.status) || lead.status === 'BLOCKED') return;
  d.effects.push({ type: 'send-to-agent', agentRunId: lead.id, text });
}

/** Sets the lead's "Latest" line to a specific, content-free description of its own action. */
export function leadActivity(d: Draft, text: string): void {
  const lead = d.lead();
  if (lead !== undefined) lead.latestActivity = cleanSummary(text, 'Working');
}

/** Emits the `change_reviews` row of the change's current round. */
export function emitRound(
  d: Draft,
  agent: EngineAgent,
  decided: { decision: ChangeDecision; by: ChangeDecider } | null = null,
): void {
  const change = agent.change;
  if (change === undefined) return;
  // A change reviewer that decides (route "direct", ADR-0023 §4) reviewed the round as an agent.
  const decider = decided?.by === 'reviewer' ? 'agent' : decided?.by;
  const reviewer: ChangeReviewerKind = change.reviewer ?? decider ?? 'owner';
  d.effects.push({
    type: 'change-round',
    agentRunId: agent.id,
    round: change.round,
    reviewer,
    reviewerAgentRunId: change.reviewerAgentRunId,
    verdict: change.verdict,
    decision: decided?.decision ?? null,
    decidedBy: decided?.by ?? null,
  });
}

/**
 * A helper's (or the tester's) turn ended (success or error): AWAITING_REVIEW, and its worktree is
 * sealed. Its open approvals are settled first (a budget-raise is moot once the turn is over).
 */
export function enterReview(d: Draft, agent: EngineAgent, turnFailed: boolean): void {
  d.settlePendingApprovals(
    agent.id,
    'denied',
    'The agent finished its turn; the action was denied.',
  );
  agent.awaitingHelpers = false;
  d.setAgentStatus(agent, 'AWAITING_REVIEW');
  agent.change = freshChange(agent.change?.round ?? 0, turnFailed);
  d.effects.push({ type: 'seal-change', agentRunId: agent.id });
}

/**
 * The hook for a helper or tester of a loop run that ends without entering the loop (stopped by
 * the lead or the owner, crashed while parked, …) while the run goes on: its work so far waits
 * for a decision (merge or discard; it cannot rework). Its worktree is not sealed: a merge seals
 * it first. Stop all and restart handle their own agents.
 */
export function stoppedWithoutReview(agent: EngineAgent): void {
  agent.change = {
    ...freshChange(agent.change?.round ?? 0, false),
    state: 'decision',
  };
}

/**
 * Runs after every command of a loop run (from `Draft.reconcile`), while the run is RUNNING,
 * BLOCKED or REVIEW:
 * 1. tells the lead about helpers that stopped with work waiting for a decision;
 * 2. a change whose review agent ended without a verdict goes to the lead's decision;
 * 3. with no live lead, every change at the lead's decision goes to the owner (`needs-owner`);
 * 4. assigns reviewers to `ready` changes, oldest first, while slots are free.
 */
export function sweepLoop(d: Draft, stopped: readonly string[]): void {
  for (const id of stopped) {
    const agent = d.agent(id);
    if (agent?.change?.state !== 'decision') continue;
    notifyLead(
      d,
      `${agent.role} (agentId ${agent.id}) stopped before finishing. Its work so far waits for your decision: merge_change or discard_change (a stopped helper cannot rework).`,
    );
  }
  for (const agent of changeAgents(d)) {
    const change = agent.change;
    if (change?.state !== 'reviewing' || change.reviewerAgentRunId === null) continue;
    const reviewer = d.agent(change.reviewerAgentRunId);
    if (reviewer !== undefined && isLiveAgentStatus(reviewer.status)) continue;
    change.state = 'decision';
    notifyLead(
      d,
      `The review agent for ${agent.role}'s change (agentId ${agent.id}) ended without a verdict. Decide yourself: view_change, then merge_change, request_rework, discard_change or ask_owner.`,
    );
  }
  if (!leadCanDecide(d)) {
    for (const agent of changeAgents(d)) {
      const change = agent.change;
      if (change === undefined) continue;
      const atLead =
        change.state === 'decision' || (change.state === 'reviewing' && change.reviewer === 'lead');
      if (atLead && !change.merging) change.state = 'needs-owner';
    }
  }
  assignReviewers(d);
}

/**
 * RL-F: the lead is told once that it should hand over. A real run (2026-10-17) showed a lead that
 * ended its turn after every change was decided and waited for the run timeout without calling
 * `request_review`, since nothing would ever start a new turn. At an idle point (not handed over,
 * the run RUNNING or BLOCKED, at least one change, every change decided, no agent but the lead
 * working) the lead gets one engine message; it is told again only after a helper or reviewer
 * worked again or a change became undecided. A BLOCKED lead is told once it can read messages
 * again (after the budget raise).
 */
export function promptHandover(d: Draft): void {
  const loop = d.integration;
  if (loop === undefined || loop.handedOver) return;
  if (d.run.status !== 'RUNNING' && d.run.status !== 'BLOCKED') return;
  const changes = changeAgents(d);
  if (changes.length === 0 || !d.loopSettled()) {
    d.handoverPrompted = false;
    return;
  }
  if (d.handoverPrompted) return;
  const lead = d.lead();
  if (lead === undefined || !isActiveAgentStatus(lead.status) || lead.status === 'BLOCKED') return;
  d.handoverPrompted = true;
  notifyLead(d, handoverPromptText(d, changes));
}

function handoverPromptText(d: Draft, changes: readonly EngineAgent[]): string {
  const count = (state: ChangeState) => changes.filter((a) => a.change?.state === state).length;
  const merged = count('merged');
  const branch = branchLabel(d);
  const decided = `Every change is decided (${merged} merged into ${branch}, ${count('discarded')} discarded, ${count('no-changes')} with no changes) and no helper is working.`;
  if (merged > 0) {
    return `${decided} Hand over with request_review, or start helpers with start_agent for work that is still missing.`;
  }
  return `${decided} Nothing was merged, so ${branch} has none of the ticket's work yet. Start helpers with start_agent for the work that is still missing, or hand over the empty branch with request_review.`;
}

/** Changes waiting for a reviewer, oldest first (ties: the agent's creation order). */
function readyQueue(d: Draft): EngineAgent[] {
  return changeAgents(d)
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.change?.state === 'ready')
    .sort(
      (x, y) => (x.a.change?.readyAt ?? '').localeCompare(y.a.change?.readyAt ?? '') || x.i - y.i,
    )
    .map(({ a }) => a);
}

function assignReviewers(d: Draft): void {
  const integration = d.integration;
  if (integration === undefined) return;
  const { maxConcurrentHelpers } = runLimits(d);
  const program = d.program();
  for (const helper of readyQueue(d)) {
    const change = helper.change;
    if (change === undefined) continue;
    // ADR-0023 §4: each change follows its node's review route.
    const route = reviewRouteOf(program, helper);
    if (route.by === 'lead') {
      if (!leadCanDecide(d)) {
        change.state = 'needs-owner';
        continue;
      }
      change.state = 'reviewing';
      change.reviewer = 'lead';
      change.reviewerAgentRunId = null;
      emitRound(d, helper);
      notifyLead(
        d,
        `${helper.role}'s change (agentId ${helper.id}) is ready for your review${change.round > 0 ? ` after rework round ${change.round}` : ''}. Use view_change to see it, then merge_change, request_rework, discard_change or ask_owner.`,
      );
      continue;
    }
    // A review agent counts as one helper (ADR-0021 §5); without a slot the change waits.
    if (activeHelperCount(d) >= maxConcurrentHelpers) continue;
    startChangeReviewer(d, helper, change, route.reviewer, route.then === 'direct');
  }
}

function startChangeReviewer(
  d: Draft,
  helper: EngineAgent,
  change: EngineChange,
  reviewerNode: string,
  direct: boolean,
): void {
  const role = `Review: ${helper.role}`.slice(0, ROLE_MAX_CHARS);
  const reviewer: EngineAgent = {
    id: d.freshId(),
    runId: d.run.id,
    parentAgentRunId: null,
    kind: 'reviewer',
    role,
    task: `Review the change of ${helper.role}.`,
    status: 'QUEUED',
    sessionId: null,
    budgetTokensUsed: 0,
    createdAt: d.now,
    endedAt: null,
    // A change reviewer has its own budget (ADR-0021 §5).
    budgetLimit: d.run.budget.maxTokensPerAgent,
    latestActivity: null,
    review: null,
    reportedCostUsd: null,
    stage: reviewerNode,
    reviewsAgentRunId: helper.id,
    reviewPosts: 0,
  };
  d.agents.push(reviewer);
  d.setAgentStatus(reviewer, 'STARTING');
  change.state = 'reviewing';
  change.reviewer = 'agent';
  change.reviewerAgentRunId = reviewer.id;
  change.verdict = null;
  emitRound(d, helper);
  d.effects.push({
    type: 'create-review-checkout',
    agentRunId: reviewer.id,
    ...(change.headCommit !== null ? { commit: change.headCommit } : {}),
    reviewsAgentRunId: helper.id,
  });
  d.effects.push({
    type: 'start-agent',
    agentRunId: reviewer.id,
    kind: 'reviewer',
    role,
    ...launchFieldsFor(
      d.program(),
      reviewerNode,
      changeReviewerBrief(d, helper, change.round, direct),
    ),
    reviewScope: 'change',
  });
}

// ------------------------------------------------------------------ decisions

export type ChangeAction = 'merge' | 'merge-anyway' | 'rework' | 'discard' | 'ask-owner';

const STATE_WORDS: Readonly<Record<ChangeState, string>> = Object.freeze({
  sealing: 'is still being saved',
  ready: 'is waiting for a reviewer',
  reviewing: 'is being reviewed; wait for the verdict',
  decision: 'waits for a decision',
  rework: 'is being reworked',
  'needs-owner': 'waits for the owner',
  merged: 'is already merged',
  discarded: 'was discarded',
  'no-changes': 'had no changes',
});

/** What `checkChange` reads (`RunState` and `Draft` both fit). */
interface ChangeView extends LoopView {
  readonly run: Pick<OrchestrationRun, 'status'>;
  readonly limits?: RunLimits | undefined;
}

/** Run states in which the lead (or the owner) may decide a change. */
function decisionRunStatus(d: ChangeView, by: ChangeDecider): Refusal | null {
  const status = d.run.status;
  if (status === 'CANCELLING' || status === 'CANCELLED') {
    return refusal('run-cancelling', 'The run is being stopped.');
  }
  const allowed =
    by === 'owner'
      ? ['RUNNING', 'BLOCKED', 'REVIEW', 'NEEDS_REVIEW']
      : ['RUNNING', 'BLOCKED', 'REVIEW'];
  if (!allowed.includes(status)) {
    return refusal(
      'run-not-active',
      `The run is ${status.toLowerCase()}; changes cannot be decided.`,
    );
  }
  return null;
}

/**
 * Whether `by` may take `action` on the change of `agentRunId` now (ADR-0021 §3). Pure; the
 * commands call it again before they change anything.
 * - the lead decides a change in `decision`, or one it reviews itself (`reviewing` by the lead);
 *   the owner also a `ready` or `needs-owner` one (never while a review agent reviews it);
 * - nothing while a merge of the change is under way;
 * - merge: refused while the required checks run, and for the lead after one failed (the owner's
 *   `merge-anyway` passes a failed check, never a running one); `merge-anyway` is the owner's;
 * - rework: the helper must be waiting (AWAITING_REVIEW), within the round limit (the lead only;
 *   the owner may grant a round past it), within budget (the lead only; the owner's rework raises
 *   the cap), and a helper slot must be free; `ask-owner` is the lead's.
 */
export function checkChange(
  d: ChangeView,
  agentRunId: string,
  action: ChangeAction,
  by: ChangeDecider,
): Refusal | null {
  const integration = d.integration;
  if (integration === undefined) {
    return refusal('legacy-review', 'This run has no review loop; the owner reviews each change.');
  }
  // ADR-0023 §4: a change reviewer decides only through its own `submit_review` (route
  // "direct"); it never merges, discards or asks the owner through these commands.
  if (by === 'reviewer') {
    return refusal('not-lead', 'A change reviewer can only submit its review (submit_review).');
  }
  const statusRefusal = decisionRunStatus(d, by);
  if (statusRefusal !== null) return statusRefusal;
  const agent = d.agents.find((a) => a.id === agentRunId);
  const change = agent?.change;
  if (agent === undefined || !hasReviewableChange(agent.kind) || change === undefined) {
    return refusal('change-not-found', 'No change in this run belongs to that agent.');
  }
  if (change.merging) {
    return refusal('change-busy', 'A merge of this change is already under way.');
  }
  const leadReviews = change.state === 'reviewing' && change.reviewer === 'lead';
  const decidable =
    change.state === 'decision' ||
    leadReviews ||
    (by === 'owner' && (change.state === 'needs-owner' || change.state === 'ready'));
  if (!decidable) {
    return refusal('change-not-decidable', `${agent.role}'s change ${STATE_WORDS[change.state]}.`);
  }
  switch (action) {
    case 'merge-anyway':
    case 'merge':
      if (action === 'merge-anyway' && by !== 'owner') {
        return refusal('not-lead', 'Only the owner can merge past a failed check.');
      }
      if (change.checks === 'pending') {
        return refusal(
          'checks-pending',
          'The required checks are still running on this change; wait for their result.',
        );
      }
      if (change.checks === 'failed' && action === 'merge') {
        return refusal(
          'checks-failed',
          by === 'lead'
            ? 'A required check failed on this change. Ask for rework, discard it, or ask the owner.'
            : 'A required check failed on this change; merge anyway with a reason, or send it back.',
        );
      }
      return null;
    case 'rework': {
      if (agent.status !== 'AWAITING_REVIEW') {
        return refusal(
          'change-not-decidable',
          `${agent.role} has stopped, so it cannot rework; merge or discard its work.`,
        );
      }
      const leadLimit = leadRoundLimit(d, agent);
      if (by === 'lead' && leadRoundsUsed(change) >= leadLimit) {
        return refusal(
          'rework-limit',
          `${agent.role}'s change already had ${leadRoundsUsed(change)} of ${leadLimit} rework rounds. Merge it, discard it, or ask the owner (who can allow another round).`,
        );
      }
      if (by === 'lead' && isOverBudget(agent.budgetTokensUsed, agent.budgetLimit)) {
        return refusal(
          'over-budget',
          `${agent.role} reached its budget, so it cannot rework. Merge it, discard it, or ask the owner.`,
        );
      }
      const { maxConcurrentHelpers } = runLimits(d);
      if (activeHelperCount(d) >= maxConcurrentHelpers || !nodeHasRoom(d, agent)) {
        return refusal(
          'too-many-agents',
          `At most ${maxConcurrentHelpers} agents can work at once; wait for one to finish, then ask again.`,
        );
      }
      return null;
    }
    case 'discard':
      return null;
    case 'ask-owner':
      if (by !== 'lead') return refusal('not-lead', 'Only the lead asks the owner.');
      return change.state === 'needs-owner'
        ? refusal('change-not-decidable', 'The owner already has this change.')
        : null;
  }
}

export interface DecisionInput {
  decision: ChangeDecision;
  by: ChangeDecider;
  outcome?: 'merged' | 'discarded' | 'no-changes';
  comments?: string;
  headCommit?: string;
}

/** The longest note kept in a ticket comment (`TicketCommentSchema.body`). */
const NOTE_MAX_CHARS = 8000;

function note(text: string | undefined): string {
  const trimmed = text?.trim() ?? '';
  return trimmed.length <= NOTE_MAX_CHARS ? trimmed : `${trimmed.slice(0, NOTE_MAX_CHARS - 1)}…`;
}

function reworkPrompt(
  agent: EngineAgent,
  change: EngineChange,
  by: ChangeDecider,
  comments: string,
  branch: string,
  roundText: string,
): string {
  const who = by === 'owner' ? 'The owner' : by === 'reviewer' ? 'The review agent' : 'The lead';
  return [
    `${who} reviewed your change and asks for rework (${roundText}):`,
    comments,
    change.conflictFiles.length > 0
      ? `Your change also conflicts with ${branch} in: ${change.conflictFiles.join(', ')}. Bring those files in line with ${branch}.`
      : null,
    `Work in the same copy of the project as before. Your task was: ${agent.task ?? '(no task text)'}`,
    'When you are done, end your turn: your change is reviewed again.',
  ]
    .filter((l) => l !== null)
    .join('\n\n');
}

/**
 * Applies one decision on a change already checked with `checkChange` (or, for merges, begun with
 * `beginMerge` and carried out by the server). Returns the reply text for the decider.
 */
export function applyDecision(d: Draft, agent: EngineAgent, input: DecisionInput): string {
  const change = agent.change;
  if (change === undefined) return 'No change.';
  const branch = branchLabel(d);
  const role = agent.role;
  const byOwner = input.by === 'owner';
  // A run interrupted by a restart enters REVIEW with the owner's first decision, as in Phase 3.
  if (d.run.status === 'NEEDS_REVIEW') d.setRunStatus('REVIEW');

  switch (input.decision) {
    case 'merge':
    case 'merge-anyway': {
      const noChanges = input.outcome === 'no-changes';
      change.merging = false;
      change.state = noChanges ? 'no-changes' : 'merged';
      if (input.headCommit !== undefined) change.headCommit = input.headCommit;
      change.conflictFiles = [];
      agent.review = noChanges ? 'no-changes' : 'merged';
      emitRound(d, agent, { decision: input.decision, by: input.by });
      if (agent.status === 'AWAITING_REVIEW') {
        d.setAgentStatus(agent, noChanges && change.turnFailed ? 'FAILED' : 'SUCCEEDED');
      }
      const done = noChanges
        ? `${role}'s change had nothing new to merge.`
        : `Merged ${role} into ${branch}.`;
      if (byOwner) notifyLead(d, `The owner decided: ${done}`);
      else leadActivity(d, done.replace(/\.$/, ''));
      return done;
    }
    case 'discard': {
      const reason = note(input.comments);
      change.merging = false;
      change.state = 'discarded';
      agent.review = 'discarded';
      emitRound(d, agent, { decision: 'discard', by: input.by });
      if (reason.length > 0 && input.by !== 'reviewer') {
        d.effects.push({
          type: 'change-comment',
          agentRunId: agent.id,
          round: change.round,
          author: input.by,
          kind: 'discard',
          body: reason,
        });
      }
      if (agent.status === 'AWAITING_REVIEW') d.setAgentStatus(agent, 'CANCELLED');
      d.effects.push({ type: 'discard-change', agentRunId: agent.id });
      const done = `Discarded ${role}'s change.`;
      if (byOwner) notifyLead(d, `The owner decided: ${done}`);
      else leadActivity(d, done.replace(/\.$/, ''));
      return done;
    }
    case 'ask-owner': {
      const question = note(input.comments);
      change.state = 'needs-owner';
      emitRound(d, agent, { decision: 'ask-owner', by: input.by });
      if (question.length > 0 && input.by !== 'reviewer') {
        d.effects.push({
          type: 'change-comment',
          agentRunId: agent.id,
          round: change.round,
          author: input.by,
          kind: 'ask-owner',
          body: question,
        });
      }
      leadActivity(d, `Asked the owner about ${role}'s change`);
      return `The owner will decide on ${role}'s change. You will get a message when they do.`;
    }
    case 'rework': {
      const comments = note(input.comments);
      emitRound(d, agent, { decision: 'rework', by: input.by });
      // A change reviewer's rework comments are its findings, already stored as its
      // `review-comment` on this round (ADR-0023 §4, route "direct").
      if (input.by !== 'reviewer') {
        d.effects.push({
          type: 'change-comment',
          agentRunId: agent.id,
          round: change.round,
          author: input.by,
          kind: 'rework',
          body: comments,
        });
      }
      // The owner's rework is the owner's authorization to spend more: like a budget raise.
      if (byOwner && isOverBudget(agent.budgetTokensUsed, agent.budgetLimit)) {
        agent.budgetLimit = agent.budgetTokensUsed + d.run.budget.maxTokensPerAgent;
      }
      change.round += 1;
      if (input.by === 'reviewer') change.reviewerRounds = (change.reviewerRounds ?? 0) + 1;
      change.state = 'rework';
      change.verdict = null;
      change.reviewer = null;
      change.reviewerAgentRunId = null;
      change.readyAt = null;
      change.checks = null;
      change.merging = false;
      const route = reviewRouteOf(d.program(), agent);
      const roundText =
        input.by === 'lead'
          ? `round ${leadRoundsUsed(change)} of ${route.leadRounds}`
          : input.by === 'reviewer' && route.by === 'agent' && route.then === 'direct'
            ? `round ${change.reviewerRounds ?? 0} of ${route.reviewerRounds}`
            : `round ${change.round}`;
      const prompt = reworkPrompt(agent, change, input.by, comments, branch, roundText);
      change.conflictFiles = [];
      d.setAgentStatus(agent, 'STARTING');
      // Same helper, same worktree, same budget; a rework turn never starts helpers (ADR-0021 §3).
      d.effects.push({
        type: 'start-agent',
        agentRunId: agent.id,
        kind: agent.kind,
        role: agent.role,
        ...launchFieldsFor(d.program(), stageOf(agent), prompt),
        rework: { resumeSessionId: agent.sessionId },
        ...d.launchModeFields(agent),
      });
      const done = `Asked ${role} to rework its change (round ${change.round}).`;
      if (byOwner) notifyLead(d, `The owner decided: ${done}`);
      else if (input.by === 'reviewer') {
        // ADR-0023 §4, route "direct": the lead is told each round (no findings, no content).
        notifyLead(
          d,
          `The review agent sent ${role}'s change (agentId ${agent.id}) back to it for rework (${roundText}). You get the change once the review agent approves it or its rounds run out.`,
        );
      } else leadActivity(d, done.replace(/\.$/, ''));
      return `${done} Its change is reviewed again when it finishes.`;
    }
  }
}

/** One line per undecided change, for the lead's resume message and refusals. */
export function waitingLines(view: LoopView): string[] {
  return undecidedChanges(view).map((a) => {
    const state = a.change?.state ?? 'sealing';
    return `- ${a.role} (agentId ${a.id}): ${STATE_WORDS[state]}`;
  });
}

// ------------------------------------------------------------------ view_change

function utf8Bytes(text: string): number {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** The longest prefix of `text` that fits in `max` UTF-8 bytes (never splits a character). */
function cutUtf8(text: string, max: number): string {
  let n = 0;
  let end = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    const len = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (n + len > max) break;
    n += len;
    end += ch.length;
  }
  return text.slice(0, end);
}

const DIFF_CUT_NOTE = '\n… (diff cut at 32 KiB)';

/**
 * The lead's `view_change` reply: the engine's summary, then the diff the server read for the
 * change, the whole capped at `VIEW_CHANGE_MAX_BYTES` (ADR-0021 §3). The server calls this with
 * the `value` of the lead's `view_change` call; the diff is sent to the lead and never stored.
 */
export function viewChangeReply(summary: string, diff: string | null): string {
  if (diff === null || diff.trim().length === 0) {
    return cutUtf8(`${summary}\n\nNo diff is available for this change.`, VIEW_CHANGE_MAX_BYTES);
  }
  const head = `${summary}\n\nDiff:\n`;
  const whole = head + diff;
  if (utf8Bytes(whole) <= VIEW_CHANGE_MAX_BYTES) return whole;
  const room = VIEW_CHANGE_MAX_BYTES - utf8Bytes(DIFF_CUT_NOTE);
  return cutUtf8(whole, room) + DIFF_CUT_NOTE;
}

/** The engine half of `view_change`: what the engine knows about one change, bounded. */
export function changeSummary(view: LoopView, agent: EngineAgent): string {
  const change = agent.change;
  const integration = view.integration;
  if (change === undefined || integration === undefined) return `${agent.role} has no change yet.`;
  const lines = [
    `Change of ${agent.role} (agentId ${agent.id}): it ${STATE_WORDS[change.state]}.`,
    `Rework rounds used: ${leadRoundsUsed(change)} of ${leadRoundLimit(view, agent)}.`,
  ];
  if (agent.task !== null) lines.push(`Task: ${agent.task}`);
  if (change.headCommit !== null) {
    lines.push(
      `Saved as commit ${change.headCommit}${change.changedFiles !== null ? `; ${change.changedFiles} file(s) changed` : ''}.`,
    );
  } else if (change.state === 'decision') {
    lines.push('Not saved yet: the helper stopped before finishing; a merge saves it first.');
  }
  if (change.turnFailed) lines.push("The helper's last turn ended with an error.");
  if (change.reviewer === 'agent') {
    lines.push(
      change.verdict === null
        ? 'Review agent: no verdict.'
        : `Review agent's verdict: ${change.verdict} (its findings were sent to you).`,
    );
  }
  const checks =
    change.checks === null
      ? 'not run yet on this change (merge_change runs them)'
      : change.checks === 'pending'
        ? 'running'
        : change.checks;
  lines.push(`Required checks: ${checks}.`);
  if (change.conflictFiles.length > 0) {
    lines.push(`Conflicting files on the last merge attempt: ${change.conflictFiles.join(', ')}.`);
  }
  lines.push(
    'Decide with merge_change, request_rework (with comments), discard_change (with a reason) or ask_owner (with a question).',
  );
  return cutUtf8(lines.join('\n'), VIEW_CHANGE_MAX_BYTES / 4);
}
