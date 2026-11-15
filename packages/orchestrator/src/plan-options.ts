import type { PlanStep, WorkflowNodeId } from '@acp/core';
import type { Draft } from './draft.js';
import { planNote, recordOutputNote } from './handoffs.js';
import { hasNamedHelpers, programNode, programOf } from './program.js';
import type { ProgramView } from './program.js';
import { stageOf } from './stages.js';
import type { EngineAgent, PlanOption } from './state.js';
import { isLiveAgentStatus } from './transitions.js';

/**
 * Several planners (ADR-0037 §4). With two or more `plan` arrows every planner submits a plan
 * option; the run waits in PLANNING until every planner submitted one or ended (one that ended
 * without a plan is dropped), then PLAN_REVIEW holds the options side by side. The owner approves
 * one (`decidePlanOption`), which becomes the run's plan; the others are kept as `not-chosen`.
 * Such a plan is never approved automatically, even in Full auto: the owner must pick. A request
 * for changes supersedes every option and asks each live planner for a new one.
 */

/** The run has two or more planners: its plans are options the owner picks from. */
export function isMultiPlanner(view: ProgramView): boolean {
  return programOf(view).planners.length > 1;
}

/** The options waiting for the owner (or for the other planners), oldest first. */
export function proposedOptions(view: {
  readonly planOptions?: readonly PlanOption[] | undefined;
}): PlanOption[] {
  return (view.planOptions ?? []).filter((o) => o.status === 'proposed');
}

/** The line every planner of a run with several planners gets in its brief. */
export function multiPlannerLine(count: number): string {
  return `${count} planners each write a plan for this ticket; the owner compares them and approves one, which a lead agent then carries out. Submit yours with submit_plan, then wait. Your plan is never approved automatically: the owner always picks.`;
}

/** Files a planner's plan as an option; supersedes its own earlier proposed option. */
export function submitPlanOption(
  d: Draft,
  author: EngineAgent,
  input: { summary: string; steps: readonly PlanStep[]; plannedHelpers: number },
  stepHelpers: readonly WorkflowNodeId[],
): string {
  d.planOptions = (d.planOptions ?? []).map((o) =>
    o.agentRunId === author.id && o.status === 'proposed' ? { ...o, status: 'superseded' } : o,
  );
  const program = d.program();
  const nodeId = stageOf(author);
  const option: PlanOption = {
    id: d.freshId(),
    agentRunId: author.id,
    nodeId,
    label: programNode(program, nodeId)?.label ?? author.role,
    summary: input.summary,
    steps: input.steps.map((s) => ({ ...s })),
    plannedHelpers: input.plannedHelpers,
    ...(hasNamedHelpers(program) ? { stepHelpers: [...stepHelpers] } : {}),
    status: 'proposed',
    createdAt: d.now,
  };
  d.planOptions = [...d.planOptions, option];
  recordOutputNote(d, author, planNote(input.summary, input.steps));
  d.effects.push({ type: 'plan-option-submitted', planOptionId: option.id });
  openPlanReviewIfReady(d);
  return d.run.status === 'PLAN_REVIEW'
    ? 'Your plan is submitted, and every planner has submitted or ended: the owner now compares the plans and approves one. Wait: you get a message if they ask for changes.'
    : "Your plan is submitted as one option. The owner compares it with the other planners' plans once they are in and approves one. Wait: you get a message if they ask for changes.";
}

/**
 * PLANNING → PLAN_REVIEW once every planner submitted an option or ended, with at least one
 * option. Runs after each submission and after every command (a planner that ends counts).
 */
export function openPlanReviewIfReady(d: Draft): void {
  if (d.run.status !== 'PLANNING' || !isMultiPlanner(d)) return;
  const proposed = proposedOptions(d);
  if (proposed.length === 0) return;
  const waiting = d.agents.some(
    (a) =>
      a.kind === 'planner' &&
      isLiveAgentStatus(a.status) &&
      !proposed.some((o) => o.agentRunId === a.id),
  );
  if (waiting) return;
  d.setRunStatus('PLAN_REVIEW');
  d.effects.push({ type: 'plan-options-ready', planOptionIds: proposed.map((o) => o.id) });
}

/** No planner can plan any more and no option waits: the run cannot go on (it fails). */
export function multiPlanningGone(d: Draft): boolean {
  const live = d.agents.some((a) => a.kind === 'planner' && isLiveAgentStatus(a.status));
  return !live && proposedOptions(d).length === 0;
}
