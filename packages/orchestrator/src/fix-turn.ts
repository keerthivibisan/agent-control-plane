import { helperBrief } from './agent-note.js';
import { editorNoteBlocks, withOwnerNotes } from './arrow-notes.js';
import type { Draft } from './draft.js';
import { runLimits } from './limits.js';
import { isOverBudget } from './budget.js';
import { activeHelperCount, emitRound, isFinalChangeState, nodeHasRoom } from './loop.js';
import { nodeProvider, launchFieldsFor, stageOf } from './stages.js';
import { programOf } from './program.js';
import type { EngineAgent } from './state.js';
import { isActiveAgentStatus, isLiveAgentStatus } from './transitions.js';

/**
 * ADR-0038 §3 (FR-3): a tester's failures go to the author of the failing code, never back to the
 * tester. An author whose change is already merged gets a fix turn as a new helper of its node,
 * from the ticket branch, with its node's settings (model, skills, agent file, approval mode)
 * and the failure context; the handover is undone, as with the owner's "Request changes", so the
 * lead decides the fix's change and hands over again. Once that change is merged, the tester runs
 * again unless the When arrow switched its retest off (ADR-0038 §4, amended 2026-11-14).
 */

/** Why no fix may start in this run now, or null. */
function runBlocked(d: Draft): string | null {
  const loop = d.integration;
  if (loop?.ticketBranch === null || loop === undefined) return 'the run has no ticket branch';
  if (!['RUNNING', 'BLOCKED', 'REVIEW'].includes(d.run.status) || d.isStopping()) {
    return 'the run is not going';
  }
  const lead = d.lead();
  if (lead === undefined || !isLiveAgentStatus(lead.status)) {
    return 'the lead has ended, and it decides the fix';
  }
  return null;
}

/** Why `nodeId` has no room for a new helper now, or null. */
function nodeRoomBlocked(d: Draft, nodeId: string): string | null {
  const node = programOf(d).helpers.find((h) => h.id === nodeId);
  if (node === undefined) return 'the target is not a helper block of this workflow';
  if (activeHelperCount(d) >= runLimits(d).maxConcurrentHelpers) {
    return 'no helper slot is free';
  }
  const live = d.agents.filter(
    (a) => a.kind === 'worker' && isActiveAgentStatus(a.status) && stageOf(a) === node.id,
  ).length;
  if (live >= node.maxInstances) return `${node.label} has no room for another helper now`;
  return null;
}

/** Why a new helper of `nodeId` cannot start a fix now (the failure then goes to the lead). */
export function nodeFixBlocked(d: Draft, nodeId: string): string | null {
  return runBlocked(d) ?? nodeRoomBlocked(d, nodeId);
}

/** Why the author's fix cannot start now (the failure then goes to the lead), or null when it can. */
function blocked(d: Draft, author: EngineAgent): string | null {
  const run = runBlocked(d);
  if (run !== null) return run;
  if (author.change === undefined || !isFinalChangeState(author.change.state)) {
    return `${author.role}'s change is not decided yet`;
  }
  const node = programOf(d).helpers.find((h) => h.id === stageOf(author));
  if (node === undefined) return `${author.role}'s block is not a helper block of this workflow`;
  return nodeRoomBlocked(d, node.id);
}

/**
 * Undoes the handover so the lead may start helpers again and must hand over again; the run
 * goes on. No effect before the handover.
 */
export function reopenForFix(d: Draft): void {
  const loop = d.integration;
  if (loop === undefined || !loop.handedOver) return;
  loop.handedOver = false;
  // The lead is told what to do in the failure notice; the "hand over" prompt waits for the
  // next idle point after the fix.
  d.handoverPrompted = true;
  if (d.run.status === 'REVIEW') d.setRunStatus('RUNNING');
}

/**
 * Starts the author's fix turn: a new helper of the author's node from the ticket branch, with the
 * failure context (quoted data). Returns the new agent, or why it could not start.
 */
export function startAuthorFix(
  d: Draft,
  author: EngineAgent,
  task: string,
  context: string,
): { ok: true; agent: EngineAgent } | { ok: false; why: string } {
  const why = blocked(d, author);
  if (why !== null) return { ok: false, why };
  return {
    ok: true,
    agent: startNodeFix(d, stageOf(author), author.role, task, [context]),
  };
}

/**
 * A fix turn as a new helper of `nodeId` from the ticket branch, with that node's settings (model,
 * skills, agent file, approval mode, owner note on its implement arrow) and `blocks` (the failure
 * context and notes, quoted data) after its brief. The handover is undone first. The caller
 * checked `nodeFixBlocked`.
 */
export function startNodeFix(
  d: Draft,
  nodeId: string,
  role: string,
  task: string,
  blocks: readonly string[],
): EngineAgent {
  const lead = d.lead();
  const branch = d.integration?.ticketBranch ?? null;
  const program = programOf(d);
  reopenForFix(d);
  const fixer: EngineAgent = {
    id: d.freshId(),
    runId: d.run.id,
    parentAgentRunId: lead?.id ?? null,
    kind: 'worker',
    role,
    task,
    status: 'QUEUED',
    sessionId: null,
    budgetTokensUsed: 0,
    createdAt: d.now,
    endedAt: null,
    budgetLimit: d.run.budget.maxTokensPerAgent,
    latestActivity: null,
    review: null,
    reportedCostUsd: null,
    provider: nodeProvider(program, nodeId),
    stage: nodeId,
  };
  d.agents.push(fixer);
  d.setAgentStatus(fixer, 'STARTING');
  d.effects.push({
    type: 'start-agent',
    agentRunId: fixer.id,
    kind: 'worker',
    role: fixer.role,
    ...launchFieldsFor(
      program,
      nodeId,
      withOwnerNotes([helperBrief(task, d.run.ticketId !== null), ...blocks].join('\n\n'), [
        ...editorNoteBlocks(program, nodeId),
      ]),
    ),
    ...(branch !== null ? { fromBranch: branch } : {}),
    ...d.launchModeFields(fixer),
  });
  return fixer;
}

/**
 * Like the reviewer's direct rework (ADR-0023 §4): the run is going, the helper waits within its
 * budget, and a helper slot and room in its node are free. Null when it can, else why not.
 */
export function reworkBlocked(d: Draft, agent: EngineAgent): string | null {
  const change = agent.change;
  if (change === undefined) return `${agent.role} has no change`;
  if (!['RUNNING', 'BLOCKED', 'REVIEW'].includes(d.run.status) || d.isStopping()) {
    return 'the run is not going';
  }
  if (agent.status !== 'AWAITING_REVIEW' || change.merging) {
    return `${agent.role} is not waiting for a decision`;
  }
  if (isOverBudget(agent.budgetTokensUsed, agent.budgetLimit)) {
    return `${agent.role} has used its budget`;
  }
  if (activeHelperCount(d) >= runLimits(d).maxConcurrentHelpers) return 'no helper slot is free';
  if (!nodeHasRoom(d, agent)) return `${agent.role}'s block has no room for it now`;
  return null;
}

/**
 * A fix turn as a rework of the failing change itself: the same helper, worktree and session,
 * with `prompt`. `reviewRound`: the failure was a review asking for rework, so the round is
 * recorded as the reviewer's decision and a new review round begins, as on the direct route.
 * The caller checked `reworkBlocked`.
 */
export function reworkForFix(
  d: Draft,
  agent: EngineAgent,
  prompt: string,
  reviewRound: boolean,
): void {
  const change = agent.change;
  if (change === undefined) return;
  if (reviewRound) {
    emitRound(d, agent, { decision: 'rework', by: 'reviewer' });
    change.round += 1;
  }
  delete change.fanOut;
  change.state = 'rework';
  change.verdict = null;
  change.reviewer = null;
  change.reviewerAgentRunId = null;
  change.readyAt = null;
  change.checks = null;
  change.merging = false;
  change.conflictFiles = [];
  delete change.blockChecks;
  d.setAgentStatus(agent, 'STARTING');
  d.effects.push({
    type: 'start-agent',
    agentRunId: agent.id,
    kind: agent.kind,
    role: agent.role,
    ...launchFieldsFor(
      d.program(),
      stageOf(agent),
      withOwnerNotes(prompt, editorNoteBlocks(d.program(), stageOf(agent))),
    ),
    rework: { resumeSessionId: agent.sessionId },
    ...d.launchModeFields(agent),
    // ADR-0034 §4 (CM-3): only a fresh session needs its starting points again.
    ...(agent.sessionId === null && agent.startingPoints !== undefined
      ? { startingPoints: agent.startingPoints }
      : {}),
  });
}
