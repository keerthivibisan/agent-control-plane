import { defaultProjectWorkflow, WORKFLOW_STAGES } from '@acp/core';
import type { ProjectWorkflow, WorkflowStageId } from '@acp/core';
import type { RunWorkflowDto, RunWorkflowGraphDto, WorkflowStageState } from '@acp/core/api';
import { isFinalChangeState } from './loop.js';
import { approvedPlan } from './plan-read.js';
import { programOf, runGraphOf } from './program.js';
import {
  anyHelperMerged,
  hasReviewableChange,
  isChangeReviewer,
  nextStage,
  stageOf,
} from './stages.js';
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
  const agents = agentsOf(state, wf, stage);
  const workers = state.agents.filter((a) => a.kind === 'worker');
  switch (stage) {
    case 'plan':
      return planState(state, wf.plannerMode === 'separate' ? 'planner' : 'lead');
    case 'orchestrate':
      return orchestrateState(state);
    case 'helpers':
      return helpersState(state, workers);
    case 'review':
      return reviewStageState(state, workers);
    case 'code-review':
    case 'unit-tests':
      if (!wf.stages[stage].enabled) return 'off';
      return finalStageState(state, stage, stage === 'unit-tests' ? 'tester' : 'reviewer', agents);
  }
}

function stopped(state: RunState): boolean {
  const status = state.run.status;
  return status === 'CANCELLING' || isTerminalRunStatus(status);
}

/** Planning: the author's state until the owner approves (the plan stage, the plan gate). */
function planState(state: RunState, authorKind: 'planner' | 'lead'): WorkflowStageState {
  const status = state.run.status;
  if (state.run.ticketId === null) return 'skipped';
  if (approvedPlan(state) !== undefined) return 'done';
  if (status === 'PLAN_REVIEW') return 'needs-you';
  if (status === 'PLANNING') {
    const author = state.agents.find((a) => a.kind === authorKind);
    return author === undefined ? 'failed' : agentState(state, author);
  }
  return status === 'QUEUED' ? 'waiting' : 'failed';
}

function orchestrateState(state: RunState): WorkflowStageState {
  const status = state.run.status;
  const lead = state.agents.find((a) => a.kind === 'lead');
  if (state.run.ticketId !== null && approvedPlan(state) === undefined) {
    return stopped(state) || status === 'NEEDS_REVIEW' ? 'skipped' : 'waiting';
  }
  if (lead === undefined) return 'skipped';
  // ADR-0021: after the handover the lead only waits for the final stages and the owner.
  if (state.integration?.handedOver === true && isLiveAgentStatus(lead.status)) return 'done';
  // The engine stops the lead once the helpers' work is reviewed; its stage is then done.
  if (lead.status === 'CANCELLED' && (status === 'REVIEW' || status === 'COMPLETED')) {
    return 'done';
  }
  return agentState(state, lead);
}

/** Helpers (all of them for the v1 stage, or one node's for a graph node). */
function helpersState(state: RunState, workers: readonly EngineAgent[]): WorkflowStageState {
  const status = state.run.status;
  // ADR-0021: a helper waiting for its change to be decided has done its work.
  if (state.integration !== undefined && workers.length > 0) {
    const working = workers.filter((w) => w.status !== 'AWAITING_REVIEW');
    return working.some((w) => isLiveAgentStatus(w.status))
      ? groupState(state, working)
      : groupState(
          state,
          workers.map((w) => (w.status === 'AWAITING_REVIEW' ? { ...w, status: 'SUCCEEDED' } : w)),
        );
  }
  if (workers.length > 0) return groupState(state, workers);
  // No helper (yet): the lead may still start some; once it is past that, none ran.
  return stopped(state) || status === 'REVIEW' || status === 'NEEDS_REVIEW' ? 'skipped' : 'waiting';
}

function reviewStageState(state: RunState, workers: readonly EngineAgent[]): WorkflowStageState {
  const status = state.run.status;
  if (state.integration !== undefined) return loopReviewState(state, stopped(state));
  if (workers.length === 0) {
    return stopped(state) || status === 'REVIEW' || status === 'NEEDS_REVIEW'
      ? 'skipped'
      : 'waiting';
  }
  if (workers.some((w) => isLiveAgentStatus(w.status))) return 'waiting';
  if (workers.some((w) => w.review === null || w.review === 'pending')) {
    return stopped(state) ? 'skipped' : 'needs-you';
  }
  return 'done';
}

/** A final stage (a final reviewer or a tester) from its agents, oldest first. */
function finalStageState(
  state: RunState,
  stageId: string,
  kind: 'reviewer' | 'tester',
  agents: readonly EngineAgent[],
): WorkflowStageState {
  const status = state.run.status;
  const isStopped = stopped(state);
  const workers = state.agents.filter((a) => a.kind === 'worker');
  const last = agents[agents.length - 1];
  if (last !== undefined) {
    // ADR-0021: the tester's change goes through the review loop.
    const testerChange = kind === 'tester' ? last.change : undefined;
    if (testerChange !== undefined) {
      if (testerChange.state === 'needs-owner') return isStopped ? 'skipped' : 'needs-you';
      if (!isFinalChangeState(testerChange.state)) {
        return isStopped ? 'skipped' : agentState(state, last);
      }
      return testerChange.state === 'discarded' ? 'skipped' : 'done';
    }
    if (isLiveAgentStatus(last.status)) return agentState(state, last);
    if (kind === 'tester') {
      if (last.review === 'pending' || last.review === null)
        return isStopped ? 'skipped' : 'needs-you';
      return last.review === 'discarded' ? 'skipped' : 'done';
    }
    // Code review: posting is what finishes it; a reviewer stopped by the owner is skipped.
    if (last.status === 'NEEDS_REVIEW') {
      return state.stagesHeld === true && !isStopped ? 'needs-you' : 'failed';
    }
    if ((last.reviewPosts ?? 0) > 0 || last.status === 'SUCCEEDED') return 'done';
    return last.status === 'CANCELLED' ? 'skipped' : 'failed';
  }
  if (isStopped) return 'skipped';
  const helpersReviewed =
    (status === 'REVIEW' || status === 'NEEDS_REVIEW') &&
    !workers.some((w) => isLiveAgentStatus(w.status) || w.review === 'pending');
  if (helpersReviewed && !anyHelperMerged(state)) return 'skipped';
  if (state.stagesHeld === true && nextStage(state) === stageId) return 'needs-you';
  return 'waiting';
}

// ------------------------------------------------------------------ the graph (ADR-0023)

type NodeState = RunWorkflowGraphDto['nodes'][number];

/**
 * The live state of each node of the run's graph (ADR-0023, `RunWorkflowGraphDto` without
 * `runId` and `graph`): the snapshot graph, or a version 1 run's workflow migrated. Derived from
 * the run and agent statuses only, never stored. Agent nodes list their agents; editing nodes add
 * their mode for this run and whether they run sandboxed (runs with an approval policy). A
 * version 1 node gives the same state as its stage in `deriveRunWorkflow`.
 */
export function deriveRunWorkflowGraph(
  state: RunState,
): Omit<RunWorkflowGraphDto, 'runId' | 'graph'> {
  const graph = runGraphOf(state);
  const program = programOf(state);
  const workers = state.agents.filter((a) => a.kind === 'worker');
  const ofNode = (kind: EngineAgent['kind'], id: string) =>
    state.agents.filter((a) => a.kind === kind && stageOf(a) === id);
  const planner = program.planner;
  const nodes = graph.nodes.map((node): NodeState => {
    const ids = (agents: readonly EngineAgent[]) => agents.map((a) => a.id);
    switch (node.type) {
      case 'ticket':
        return {
          nodeId: node.id,
          state: state.run.ticketId === null ? 'skipped' : 'done',
          agentRunIds: [],
        };
      case 'planner':
        return {
          nodeId: node.id,
          state: planState(state, 'planner'),
          agentRunIds: ids(ofNode('planner', node.id)),
        };
      case 'plan-approval':
        return {
          nodeId: node.id,
          state: planState(state, planner === null ? 'lead' : 'planner'),
          agentRunIds: [],
        };
      case 'lead':
        return {
          nodeId: node.id,
          state: orchestrateState(state),
          agentRunIds: ids(ofNode('lead', node.id)),
        };
      case 'helper':
      case 'helper-pool': {
        const own = workers.filter((w) => stageOf(w) === node.id);
        return withMode(state, {
          nodeId: node.id,
          state: helpersState(state, own),
          agentRunIds: ids(own),
        });
      }
      case 'reviewer': {
        if (node.scope === 'final') {
          const own = ofNode('reviewer', node.id).filter((a) => !isChangeReviewer(a));
          return {
            nodeId: node.id,
            state: finalStageState(state, node.id, 'reviewer', own),
            agentRunIds: ids(own),
          };
        }
        // A reloaded run's change reviewers have no `reviewsAgentRunId` (it lives with the live run
        // only), so their recorded stage says which node they reviewed for.
        const own = ofNode('reviewer', node.id).filter(
          (a) => isChangeReviewer(a) || a.stage === node.id,
        );
        return { nodeId: node.id, state: changeReviewerState(state, own), agentRunIds: ids(own) };
      }
      case 'tester': {
        const own = ofNode('tester', node.id);
        return withMode(state, {
          nodeId: node.id,
          state: finalStageState(state, node.id, 'tester', own),
          agentRunIds: ids(own),
        });
      }
      case 'checks':
        return { nodeId: node.id, state: checksState(state), agentRunIds: [] };
      case 'ticket-merge':
        return { nodeId: node.id, state: ticketMergeState(state), agentRunIds: [] };
      case 'owner-merge':
        return { nodeId: node.id, state: ownerMergeState(state), agentRunIds: [] };
      case 'done':
        return {
          nodeId: node.id,
          state: state.run.status === 'COMPLETED' ? 'done' : stopped(state) ? 'skipped' : 'waiting',
          agentRunIds: [],
        };
    }
  });
  return {
    nodes,
    ...(state.integration !== undefined ? { review: reviewCounts(state) } : {}),
  };
}

function withMode(state: RunState, node: NodeState): NodeState {
  if (state.approvalPolicy === undefined) return node;
  const mode = Object.hasOwn(programOf(state).nodeModes, node.nodeId)
    ? programOf(state).nodeModes[node.nodeId]
    : undefined;
  return mode === undefined ? node : { ...node, approvalMode: mode.mode, sandbox: mode.sandbox };
}

/** A change reviewer node: its review agents, live first. */
function changeReviewerState(state: RunState, agents: readonly EngineAgent[]): WorkflowStageState {
  if (agents.length > 0) {
    const live = agents.filter((a) => isLiveAgentStatus(a.status));
    if (live.length > 0) return groupState(state, live);
    if (stopped(state) || !loopWaitsForReview(state)) return groupState(state, agents);
    return 'waiting';
  }
  return stopped(state) || state.run.status === 'REVIEW' || state.run.status === 'COMPLETED'
    ? 'skipped'
    : 'waiting';
}

/** Some change still waits to be sealed or reviewed. */
function loopWaitsForReview(state: RunState): boolean {
  return state.agents.some(
    (a) => a.change !== undefined && (a.change.state === 'sealing' || a.change.state === 'ready'),
  );
}

/** The required checks: running on some change, or passed for a merged one. */
function checksState(state: RunState): WorkflowStageState {
  const changes = state.agents.flatMap((a) => (a.change === undefined ? [] : [a.change]));
  if (changes.some((c) => c.checks === 'pending')) return stopped(state) ? 'skipped' : 'active';
  if (
    changes.some((c) => c.state === 'merged') ||
    state.agents.some((a) => a.review === 'merged')
  ) {
    return 'done';
  }
  return stopped(state) ? 'skipped' : 'waiting';
}

/** Every change is decided and the ticket branch holds the work (the lead handed over). */
function ticketMergeState(state: RunState): WorkflowStageState {
  const status = state.run.status;
  if (state.integration?.handedOver === true || status === 'REVIEW' || status === 'COMPLETED') {
    return 'done';
  }
  return stopped(state) ? 'skipped' : 'waiting';
}

/** The owner's single merge: theirs to do once the run is in review. */
function ownerMergeState(state: RunState): WorkflowStageState {
  const status = state.run.status;
  if (status === 'COMPLETED') return 'done';
  if (stopped(state)) return 'skipped';
  return status === 'REVIEW' || status === 'NEEDS_REVIEW' ? 'needs-you' : 'waiting';
}
