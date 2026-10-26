import { isModeWithin } from '@acp/core';
import type { ApprovalMode, WorkflowNode } from '@acp/core';
import {
  approvedPlan,
  changeCheckBlockOf,
  effectiveMode,
  leadRoundsUsed,
  programNode,
  programOf,
  reviewRouteOf,
  runGraphOf,
  stageOf,
  undecidedChanges,
} from '../../src/index.js';
import type { EngineAgent, EngineEffect, RunState } from '../../src/index.js';
import type { SimResult, StepRecord } from './sim.js';

/**
 * The safety and liveness invariants of README "Graph correctness" layer 1, checked after every
 * engine step of a simulated run, and at its end. Each returns plain descriptions of what broke
 * (empty: all held). They read only the step's states, effects and actor, so a violation is
 * local to one step and the explorer may prune states it has already explored. Synthetic data.
 */

const EDITING: readonly EngineAgent['kind'][] = ['worker', 'tester'];
const isEditing = (a: EngineAgent | undefined) => a !== undefined && EDITING.includes(a.kind);
const isFinalStageAgent = (a: EngineAgent) =>
  a.kind === 'tester' || (a.kind === 'reviewer' && a.reviewsAgentRunId === undefined);

function effectsOf<T extends EngineEffect['type']>(
  effects: readonly EngineEffect[],
  type: T,
): Extract<EngineEffect, { type: T }>[] {
  return effects.filter((e): e is Extract<EngineEffect, { type: T }> => e.type === type);
}

/** The mode a node is configured with (its own, else the project's), before ceilings. */
function configuredMode(node: WorkflowNode | undefined, projectMode: ApprovalMode): ApprovalMode {
  if (node !== undefined && 'approvalMode' in node && node.approvalMode !== null) {
    return node.approvalMode;
  }
  return projectMode;
}

export function stepInvariants(step: StepRecord): string[] {
  const out: string[] = [];
  const { before, after, result } = step;
  const effects = result !== null && result.ok ? result.effects : [];
  const agent = (s: RunState, id: string) => s.agents.find((a) => a.id === id);
  const ticketRun = after.run.ticketId !== null;
  const program = programOf(after);

  // 1. Plan-first: no helper or tester, and no approved edit, before an approved plan.
  if (ticketRun && approvedPlan(after) === undefined) {
    if (after.agents.some((a) => isEditing(a))) out.push('a helper exists before an approved plan');
    if (after.approvals.some((p) => p.kind === 'tool-use' && p.status === 'approved')) {
      out.push('an edit was approved before an approved plan');
    }
  }

  // 2. Only helpers and testers edit, each in its own worktree; reviewers read a checkout.
  for (const p of after.approvals) {
    if (
      p.kind === 'tool-use' &&
      p.status === 'approved' &&
      !isEditing(agent(after, p.agentRunId))
    ) {
      out.push(`a ${agent(after, p.agentRunId)?.kind ?? 'unknown'} was allowed to edit`);
    }
  }
  for (const e of effects) {
    if (e.type === 'start-agent' && e.fromBranch !== undefined && !EDITING.includes(e.kind)) {
      out.push(`a ${e.kind} got a worktree`);
    }
    if (
      (e.type === 'seal-change' || e.type === 'merge-change' || e.type === 'discard-change') &&
      !isEditing(agent(after, e.agentRunId))
    ) {
      out.push(`${e.type} on a non-editing agent`);
    }
    if (e.type === 'create-review-checkout' && agent(after, e.agentRunId)?.kind !== 'reviewer') {
      out.push('a review checkout for a non-reviewer');
    }
  }

  // 3. Only the lead (or the owner instead of it) merges, and only through the checks.
  for (const e of effectsOf(effects, 'merge-change')) {
    const actor = e.by === 'lead' ? 'lead' : e.by === 'owner' ? 'owner' : null;
    if (actor === null || step.actor !== actor)
      out.push(`merge-change by ${e.by} from ${step.actor}`);
  }
  for (const a of after.agents) {
    const was = agent(before, a.id)?.change;
    if (a.change?.state !== 'merged' || was === undefined || was.state === 'merged') continue;
    if (!was.merging) out.push(`${a.role}'s change merged without a merge through the checks`);
    const round = effectsOf(effects, 'change-round').find((r) => r.agentRunId === a.id);
    if (
      was.checks === 'failed' &&
      !(round?.decision === 'merge-anyway' && round.decidedBy === 'owner')
    ) {
      out.push(`${a.role}'s change merged past a failed check without the owner`);
    }
  }

  // 4. The base branch changes only on the owner's final merge (review loop runs).
  if (
    after.integration !== undefined &&
    after.run.status === 'COMPLETED' &&
    before.run.status !== 'COMPLETED' &&
    !/ticket branch/.test(step.action)
  ) {
    out.push(`the run completed without the owner's merge (${step.action})`);
  }

  // 5. Rework rounds stay within each decider's limit.
  for (const r of effectsOf(effects, 'change-round')) {
    if (r.decision !== 'rework') continue;
    const a = agent(before, r.agentRunId);
    const change = a?.change;
    if (a === undefined || change === undefined) continue;
    const route = reviewRouteOf(program, a);
    if (r.decidedBy === 'lead' && leadRoundsUsed(change) >= route.leadRounds) {
      out.push(`the lead reworked ${a.role} past its ${route.leadRounds} rounds`);
    }
    if (r.decidedBy === 'reviewer') {
      const limit = route.by === 'agent' && route.then === 'direct' ? route.reviewerRounds : 0;
      if ((change.reviewerRounds ?? 0) >= limit) {
        out.push(`the reviewer reworked ${a.role} past its ${limit} rounds`);
      }
    }
  }

  // 6. ADR-0027 §5: a change's Checks block runs before its review, and sends it back at most
  //    `maxRounds` times (only with "back to the helper").
  for (const a of after.agents) {
    const c = a.change;
    if (c === undefined) continue;
    const was = agent(before, a.id)?.change;
    if (c.blockChecks === 'pending' && c.state === 'reviewing' && was?.state !== 'reviewing') {
      out.push(`${a.role}'s change was reviewed before its Checks block finished`);
    }
    const rounds = c.checkRounds ?? 0;
    if (rounds > (was?.checkRounds ?? 0)) {
      const block = changeCheckBlockOf(program, a);
      if (block?.onFailure !== 'helper')
        out.push(`${a.role} was sent back by a block without the helper route`);
      else if (rounds > (block.maxRounds ?? 0)) {
        out.push(`${a.role}'s Checks block reworked it past its ${block.maxRounds ?? 0} rounds`);
      }
    }
  }
  for (const e of effectsOf(effects, 'run-change-checks')) {
    const a = agent(after, e.agentRunId);
    if (a === undefined || changeCheckBlockOf(program, a)?.nodeId !== e.blockNodeId) {
      out.push(`checks of the wrong block on ${a?.role ?? 'an unknown agent'}`);
    }
  }

  // 7. Final stages start in the program's order, each at most once.
  const order = program.finalStages.map((n) => n.id);
  for (const e of effectsOf(effects, 'start-agent')) {
    if (e.rework !== undefined) continue;
    const a = agent(after, e.agentRunId);
    if (a === undefined || !isFinalStageAgent(a) || agent(before, a.id) !== undefined) continue;
    const k = order.indexOf(a.stage ?? '');
    if (k < 0) {
      out.push(`a final stage agent on unknown node ${a.stage ?? '-'}`);
      continue;
    }
    const ran = (id: string) =>
      before.agents.some((b) => isFinalStageAgent(b) && b.stage === id && b.id !== a.id);
    if (order.slice(0, k).some((id) => !ran(id)))
      out.push(`final stage ${a.stage ?? ''} out of order`);
    if (ran(order[k] ?? '')) {
      const prev = before.agents.filter((b) => isFinalStageAgent(b) && b.stage === a.stage);
      if (!prev.every((b) => b.kind === 'reviewer' && b.status === 'NEEDS_REVIEW')) {
        out.push(`final stage ${a.stage ?? ''} ran twice`);
      }
    }
  }

  // 8. Modes: editing agents within their node's mode and every ceiling; the rest never get one.
  const graph = runGraphOf(after);
  const projectMode = after.graphContext?.projectMode ?? after.approvalPolicy?.mode ?? 'manual';
  const ceilings = after.graphContext?.approvalCeilings ?? [];
  for (const e of effectsOf(effects, 'start-agent')) {
    const a = agent(after, e.agentRunId);
    if (a === undefined) continue;
    const mode = effectiveMode(after, a);
    if (!isEditing(a)) {
      if (mode !== undefined || e.autoMode !== undefined || e.sandbox !== undefined) {
        out.push(`a ${a.kind} got an approval mode`);
      }
      continue;
    }
    const nodeIds = a.kind === 'worker' ? program.helpers.map((h) => h.id) : order;
    if (ticketRun && !nodeIds.includes(a.stage ?? ''))
      out.push(`${a.role} on unknown node ${a.stage ?? '-'}`);
    if (after.approvalPolicy === undefined) continue;
    const configured = configuredMode(
      graph.nodes.find((n) => n.id === a.stage),
      projectMode,
    );
    if (
      mode === undefined ||
      !isModeWithin(mode, configured) ||
      ceilings.some((c) => !isModeWithin(mode, c))
    ) {
      out.push(`${a.role} runs ${mode ?? 'no mode'}, looser than its node (${configured})`);
    }
    if (after.graph !== undefined) {
      if ((e.autoMode === true) !== (mode === 'full-auto')) out.push(`${a.role}: autoMode wrong`);
      const sandbox = mode === 'full-auto' || configured === 'full-auto';
      if ((e.sandbox === true) !== sandbox) out.push(`${a.role}: sandbox wrong`);
    }
  }
  // 9. ADR-0028 §1: every start of a node's agent (first turn, rework, check rework) and the
  //    lead's follow-up carry the node's effort, and nothing when the block sets none.
  for (const e of effectsOf(effects, 'start-agent')) {
    const a = agent(after, e.agentRunId);
    if (a === undefined) continue;
    const want = programNode(program, stageOf(a))?.effort;
    if (e.effort !== want) {
      out.push(
        `${a.role} started with effort ${e.effort ?? 'none'}, its node has ${want ?? 'none'}`,
      );
    }
  }
  for (const e of effectsOf(effects, 'start-follow-up')) {
    if (e.effort !== program.lead.effort) out.push('the follow-up lost the lead’s effort');
  }

  // 10. ADR-0028 §2: without a Checks block before the merge no check runs on a change for its
  //     merge, and none holds a merge back.
  if (program.checkBlocks.merge === null) {
    for (const a of after.agents) {
      if (a.change?.checks !== undefined && a.change.checks !== null) {
        out.push(`${a.role}'s change has merge checks (${a.change.checks}) without a merge block`);
      }
    }
  }
  return out;
}

/** At the end: the run ended (no deadlock, no endless loop) and every change was decided. */
export function endInvariants(result: SimResult): string[] {
  const out: string[] = [];
  if (result.outcome !== 'ended') {
    out.push(`the run did not finish: ${result.outcome} in ${result.state.run.status}`);
  }
  const s = result.state;
  if (s.run.status === 'COMPLETED') {
    if (s.integration !== undefined && undecidedChanges(s).length > 0) {
      out.push('the run completed with undecided changes');
    }
    if (
      s.integration === undefined &&
      s.agents.some((a) => isEditing(a) && (a.review === null || a.review === 'pending'))
    ) {
      out.push('the run completed with unreviewed changes');
    }
  }
  return out;
}
