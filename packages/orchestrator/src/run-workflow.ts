import { defaultProjectWorkflow, WORKFLOW_STAGES } from '@acp/core';
import type { ProjectWorkflow, WorkflowStageId } from '@acp/core';
import type { RunWorkflowDto, WorkflowStageState } from '@acp/core/api';
import { isFinalChangeState } from './loop.js';
import { approvedPlan } from './plan-read.js';
import { anyHelperMerged, hasReviewableChange, nextStage, stageOf } from './stages.js';
import type { EngineAgent, RunState } from './state.js';
import { isLiveAgentStatus, isTerminalRunStatus } from './transitions.js';

/**
 * The live state of each workflow stage for the ticket page graph (ADR-0019 §5). Derived from the
 * run and agent statuses only, never stored. Stages switched off are `off`; stages the run will
 * not reach (it ended, nothing was merged, or Phase 3 runs have no plan) are `skipped`.
 */
export function deriveRunWorkflow(state: RunState, workflow?: ProjectWorkflow): RunWorkflowDto {
  const wf =
    workflow ?? state.workflow ?? defaultProjectWorkflow(state.run.projectId, state.run.createdAt);
  const view: RunState = { ...state, workflow: wf };
  return {
    runId: state.run.id,
    stages: WORKFLOW_STAGES.map((stage) => ({
      stage,
      state: stageState(view, wf, stage),
      agentRunIds: agentsOf(view, wf, stage).map((a) => a.id),
    })),
    ...(state.integration !== undefined ? { review: reviewCounts(state) } : {}),
  };
}

/** ADR-0021: how many changes are in each part of the review loop (the graph's review stage). */
function reviewCounts(state: RunState): NonNullable<RunWorkflowDto['review']> {
  const counts = {
    waiting: 0,
    inReview: 0,
    rework: 0,
    needsOwner: 0,
    merged: 0,
    discarded: 0,
    noChanges: 0,
    reworkRounds: 0,
  };
  for (const agent of state.agents) {
    const change = agent.change;
    if (!hasReviewableChange(agent.kind) || change === undefined) continue;
    counts.reworkRounds += change.round;
    switch (change.state) {
      case 'sealing':
      case 'ready':
        counts.waiting++;
        break;
      case 'reviewing':
      case 'decision':
        counts.inReview++;
        break;
      case 'rework':
        counts.rework++;
        break;
      case 'needs-owner':
        counts.needsOwner++;
        break;
      case 'merged':
        counts.merged++;
        break;
      case 'discarded':
        counts.discarded++;
        break;
      case 'no-changes':
        counts.noChanges++;
        break;
    }
  }
  return counts;
}

/** ADR-0021: the review stage of a loop run, from its changes. */
function loopReviewState(state: RunState, stopped: boolean): WorkflowStageState {
  const changes = state.agents.flatMap((a) =>
    hasReviewableChange(a.kind) && a.change !== undefined ? [a.change] : [],
  );
  if (changes.some((c) => c.state === 'needs-owner')) return stopped ? 'skipped' : 'needs-you';
  if (changes.some((c) => !isFinalChangeState(c.state))) return stopped ? 'skipped' : 'active';
  if (changes.length > 0) return 'done';
  return stopped || state.run.status === 'REVIEW' ? 'skipped' : 'waiting';
}

function agentsOf(state: RunState, wf: ProjectWorkflow, stage: WorkflowStageId): EngineAgent[] {
  return state.agents.filter(
    (a) =>
      stageOf(a) === stage ||
      // In `lead` mode the lead plans as well as orchestrates.
      (stage === 'plan' && a.kind === 'lead' && wf.plannerMode === 'lead'),
  );
}

function waitsForOwner(state: RunState, agent: EngineAgent): boolean {
  return (
    agent.status === 'WAITING_APPROVAL' ||
    agent.status === 'BLOCKED' ||
    state.approvals.some((p) => p.agentRunId === agent.id && p.status === 'pending')
  );
}

/** One agent's contribution: live, or how it ended. A restart's NEEDS_REVIEW is a failure here. */
function agentState(state: RunState, agent: EngineAgent): WorkflowStageState {
  if (agent.status === 'QUEUED') return 'waiting';
  if (isLiveAgentStatus(agent.status)) return waitsForOwner(state, agent) ? 'needs-you' : 'active';
  if (agent.status === 'SUCCEEDED') return 'done';
  if (agent.status === 'CANCELLED') return 'skipped';
  return 'failed';
}

/** Several agents of one stage: live ones first, then how they all ended. */
function groupState(state: RunState, agents: readonly EngineAgent[]): WorkflowStageState {
  const states = agents.map((a) => agentState(state, a));
  if (states.includes('needs-you')) return 'needs-you';
  if (states.includes('active')) return 'active';
  if (states.includes('done')) return 'done';
  if (states.length > 0 && states.every((s) => s === 'skipped')) return 'skipped';
  return 'failed';
}

function stageState(
  state: RunState,
  wf: ProjectWorkflow,
  stage: WorkflowStageId,
): WorkflowStageState {
  const status = state.run.status;
  const stopped = status === 'CANCELLING' || isTerminalRunStatus(status);
  const agents = agentsOf(state, wf, stage);
  const lead = state.agents.find((a) => a.kind === 'lead');
  const approved = approvedPlan(state) !== undefined;
  const isTicketRun = state.run.ticketId !== null;
  const workers = state.agents.filter((a) => a.kind === 'worker');

  switch (stage) {
    case 'plan': {
      if (!isTicketRun) return 'skipped';
      if (approved) return 'done';
      if (status === 'PLAN_REVIEW') return 'needs-you';
      if (status === 'PLANNING') {
        const author = state.agents.find(
          (a) => a.kind === (wf.plannerMode === 'separate' ? 'planner' : 'lead'),
        );
        return author === undefined ? 'failed' : agentState(state, author);
      }
      return status === 'QUEUED' ? 'waiting' : 'failed';
    }

    case 'orchestrate': {
      if (isTicketRun && !approved)
        return stopped || status === 'NEEDS_REVIEW' ? 'skipped' : 'waiting';
      if (lead === undefined) return 'skipped';
      // ADR-0021: after the handover the lead only waits for the final stages and the owner.
      if (state.integration?.handedOver === true && isLiveAgentStatus(lead.status)) return 'done';
      // The engine stops the lead once the helpers' work is reviewed; its stage is then done.
      if (lead.status === 'CANCELLED' && (status === 'REVIEW' || status === 'COMPLETED')) {
        return 'done';
      }
      return agentState(state, lead);
    }

    case 'helpers': {
      // ADR-0021: a helper waiting for its change to be decided has done its work.
      if (state.integration !== undefined && workers.length > 0) {
        const working = workers.filter((w) => w.status !== 'AWAITING_REVIEW');
        return working.some((w) => isLiveAgentStatus(w.status))
          ? groupState(state, working)
          : groupState(
              state,
              workers.map((w) =>
                w.status === 'AWAITING_REVIEW' ? { ...w, status: 'SUCCEEDED' } : w,
              ),
            );
      }
      if (workers.length > 0) return groupState(state, workers);
      // No helper (yet): the lead may still start some; once it is past that, none ran.
      return stopped || status === 'REVIEW' || status === 'NEEDS_REVIEW' ? 'skipped' : 'waiting';
    }

    case 'review': {
      if (state.integration !== undefined) return loopReviewState(state, stopped);
      if (workers.length === 0) {
        return stopped || status === 'REVIEW' || status === 'NEEDS_REVIEW' ? 'skipped' : 'waiting';
      }
      if (workers.some((w) => isLiveAgentStatus(w.status))) return 'waiting';
      if (workers.some((w) => w.review === null || w.review === 'pending')) {
        return stopped ? 'skipped' : 'needs-you';
      }
      return 'done';
    }

    case 'code-review':
    case 'unit-tests': {
      if (!wf.stages[stage].enabled) return 'off';
      const last = agents[agents.length - 1];
      if (last !== undefined) {
        // ADR-0021: the tester's change goes through the review loop.
        const testerChange = stage === 'unit-tests' ? last.change : undefined;
        if (testerChange !== undefined) {
          if (testerChange.state === 'needs-owner') return stopped ? 'skipped' : 'needs-you';
          if (!isFinalChangeState(testerChange.state)) {
            return stopped ? 'skipped' : agentState(state, last);
          }
          return testerChange.state === 'discarded' ? 'skipped' : 'done';
        }
        if (isLiveAgentStatus(last.status)) return agentState(state, last);
        if (stage === 'unit-tests') {
          if (last.review === 'pending' || last.review === null)
            return stopped ? 'skipped' : 'needs-you';
          return last.review === 'discarded' ? 'skipped' : 'done';
        }
        // Code review: posting is what finishes it; a reviewer stopped by the owner is skipped.
        if (last.status === 'NEEDS_REVIEW') {
          return state.stagesHeld === true && !stopped ? 'needs-you' : 'failed';
        }
        if ((last.reviewPosts ?? 0) > 0 || last.status === 'SUCCEEDED') return 'done';
        return last.status === 'CANCELLED' ? 'skipped' : 'failed';
      }
      if (stopped) return 'skipped';
      const helpersReviewed =
        (status === 'REVIEW' || status === 'NEEDS_REVIEW') &&
        !workers.some((w) => isLiveAgentStatus(w.status) || w.review === 'pending');
      if (helpersReviewed && !anyHelperMerged(state)) return 'skipped';
      if (state.stagesHeld === true && nextStage(state) === stage) return 'needs-you';
      return 'waiting';
    }
  }
}
