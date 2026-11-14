import { helperBrief } from './agent-note.js';
import { editorNoteBlocks, withOwnerNotes } from './arrow-notes.js';
import type { Draft } from './draft.js';
import { runLimits } from './limits.js';
import { activeHelperCount, isFinalChangeState } from './loop.js';
import { nodeProvider, launchFieldsFor, stageOf } from './stages.js';
import { programOf } from './program.js';
import type { EngineAgent } from './state.js';
import { isActiveAgentStatus, isLiveAgentStatus } from './transitions.js';

/**
 * ADR-0038 §3 (FR-3): a tester's failures go to the author of the failing code, never back to the
 * tester. An author whose change is already merged gets a fix turn as a new helper of its node,
 * from the ticket branch, with its node's settings (model, skills, agent file, approval mode)
 * and the failure context; the handover is undone, as with the owner's "Request changes", so the
 * lead decides the fix's change and hands over again. The final stages do not run again.
 */

/** Why the fix cannot start now (the failure then goes to the lead), or null when it can. */
function blocked(d: Draft, author: EngineAgent): string | null {
  const loop = d.integration;
  if (loop?.ticketBranch === null || loop === undefined) return 'the run has no ticket branch';
  if (!['RUNNING', 'BLOCKED', 'REVIEW'].includes(d.run.status) || d.isStopping()) {
    return 'the run is not going';
  }
  const lead = d.lead();
  if (lead === undefined || !isLiveAgentStatus(lead.status)) {
    return 'the lead has ended, and it decides the fix';
  }
  if (author.change === undefined || !isFinalChangeState(author.change.state)) {
    return `${author.role}'s change is not decided yet`;
  }
  const node = programOf(d).helpers.find((h) => h.id === stageOf(author));
  if (node === undefined) return `${author.role}'s block is not a helper block of this workflow`;
  if (activeHelperCount(d) >= runLimits(d).maxConcurrentHelpers) {
    return 'no helper slot is free';
  }
  const live = d.agents.filter(
    (a) => a.kind === 'worker' && isActiveAgentStatus(a.status) && stageOf(a) === node.id,
  ).length;
  if (live >= node.maxInstances) return `${node.label} has no room for another helper now`;
  return null;
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
  const lead = d.lead();
  const branch = d.integration?.ticketBranch ?? null;
  const program = programOf(d);
  const nodeId = stageOf(author);
  reopenForFix(d);
  const fixer: EngineAgent = {
    id: d.freshId(),
    runId: d.run.id,
    parentAgentRunId: lead?.id ?? null,
    kind: 'worker',
    role: author.role,
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
      withOwnerNotes(`${helperBrief(task, d.run.ticketId !== null)}\n\n${context}`, [
        ...editorNoteBlocks(program, nodeId),
      ]),
    ),
    ...(branch !== null ? { fromBranch: branch } : {}),
    ...d.launchModeFields(fixer),
  });
  return { ok: true, agent: fixer };
}
