import type { AgentRoleKind, ProjectWorkflow, TicketPlan, WorkflowStageId } from '@acp/core';
import { approvedPlan } from './plan-read.js';
import type { EngineAgent, RunState } from './state.js';
import { isLiveAgentStatus } from './transitions.js';

/**
 * Workflow stages (ADR-0019): plan → orchestrate → helpers → review → code-review → unit-tests.
 * Pure reads over a run's state and its workflow snapshot. The first four stages always run, as
 * in Phase 4; the two post-merge stages run when the project switched them on and at least one
 * helper's change was merged.
 */

/** The stages that start an agent after the owner merged the helpers' work. */
export type PostMergeStage = 'code-review' | 'unit-tests';

/** The stage each role works in. Every agent of a ticket run records it (`EngineAgent.stage`). */
export const ROLE_STAGE: Readonly<Record<AgentRoleKind, WorkflowStageId>> = Object.freeze({
  planner: 'plan',
  lead: 'orchestrate',
  worker: 'helpers',
  reviewer: 'code-review',
  tester: 'unit-tests',
});

/** The agent's recorded stage, or the stage of its role (rows stored before stages existed). */
export function stageOf(agent: Pick<EngineAgent, 'kind' | 'stage'>): WorkflowStageId {
  return agent.stage ?? ROLE_STAGE[agent.kind];
}

/** `separate` planner mode: a planner writes the plan and the lead only orchestrates. */
export function isSeparatePlanner(state: Pick<RunState, 'workflow'>): boolean {
  return state.workflow?.plannerMode === 'separate';
}

/** The agent that writes and revises the plan: the planner in separate mode, else the lead. */
export function planningAgent(state: Pick<RunState, 'agents' | 'workflow'>): EngineAgent | undefined {
  const kind: AgentRoleKind = isSeparatePlanner(state) ? 'planner' : 'lead';
  return state.agents.find((a) => a.kind === kind);
}

/** Roles whose change the owner reviews (merge or discard): helpers and the tester. */
export function hasReviewableChange(kind: AgentRoleKind): boolean {
  return kind === 'worker' || kind === 'tester';
}

/** Roles counted against the helper limit: the reviewer and the tester count as one helper each. */
export function countsAsHelper(kind: AgentRoleKind): boolean {
  return kind === 'worker' || kind === 'reviewer' || kind === 'tester';
}

/** Roles the engine starts after the merge. */
export function isPostMergeRole(kind: AgentRoleKind): boolean {
  return kind === 'reviewer' || kind === 'tester';
}

/**
 * Roles that only read and never ask to edit or run anything (ADR-0019). The lead is read-only
 * too, but the server denies its tool uses itself (ADR-0013 §2), so it is not listed here.
 */
export function isReadOnlyRole(kind: AgentRoleKind): boolean {
  return kind === 'planner' || kind === 'reviewer';
}

/** At least one helper's change was merged; the post-merge stages have something to work on. */
export function anyHelperMerged(state: Pick<RunState, 'agents'>): boolean {
  return state.agents.some((a) => a.kind === 'worker' && a.review === 'merged');
}

function lastOfKind(state: Pick<RunState, 'agents'>, kind: AgentRoleKind): EngineAgent | undefined {
  const all = state.agents.filter((a) => a.kind === kind);
  return all[all.length - 1];
}

/**
 * The post-merge stage that should start next, or null when none is left. Only meaningful once
 * no agent of the run is live and every change is reviewed.
 * - code-review (when on): until a reviewer has run. A reviewer interrupted by a restart
 *   (NEEDS_REVIEW) never posted its review, so the stage is offered again; it starts only with the
 *   owner's `continueStages`.
 * - unit-tests (when on), after code-review: until a tester has run. A tester's own change is then
 *   reviewed like a helper's, and an interrupted tester's change too, so it is never re-run.
 * Nothing runs when no helper's change was merged: there is nothing to review or test.
 */
export function nextStage(state: Pick<RunState, 'agents' | 'workflow'>): PostMergeStage | null {
  const workflow = state.workflow;
  if (workflow === undefined || !anyHelperMerged(state)) return null;
  if (workflow.stages['code-review'].enabled) {
    const reviewer = lastOfKind(state, 'reviewer');
    if (reviewer === undefined || reviewer.status === 'NEEDS_REVIEW') return 'code-review';
    if (isLiveAgentStatus(reviewer.status)) return null;
  }
  if (workflow.stages['unit-tests'].enabled && lastOfKind(state, 'tester') === undefined) {
    return 'unit-tests';
  }
  return null;
}

/** Whether the workflow has an optional stage switched on. */
export function hasPostMergeStages(workflow: ProjectWorkflow | undefined): boolean {
  return (
    workflow !== undefined &&
    (workflow.stages['code-review'].enabled || workflow.stages['unit-tests'].enabled)
  );
}

// ------------------------------------------------------------------ skills and models

/** The single instruction line a stage's skill adds to its agent's prompt (ADR-0019 §4). */
export function skillLine(name: string): string {
  return `Use the project skill \`${name}\`.`;
}

/** The stages an agent of this role works in: in `lead` mode the lead plans and orchestrates. */
export function stagesForRole(
  kind: AgentRoleKind,
  workflow: Pick<ProjectWorkflow, 'plannerMode'> | undefined,
): WorkflowStageId[] {
  if (kind === 'lead') {
    return workflow?.plannerMode === 'separate' ? ['orchestrate'] : ['plan', 'orchestrate'];
  }
  return [ROLE_STAGE[kind]];
}

function agentStage(
  workflow: ProjectWorkflow,
  stage: WorkflowStageId,
): { model: string | null; skill: string | null } | null {
  const s = workflow.stages;
  switch (stage) {
    case 'plan':
      return s.plan;
    case 'orchestrate':
      return s.orchestrate;
    case 'helpers':
      return s.helpers;
    case 'code-review':
      return s['code-review'];
    case 'unit-tests':
      return s['unit-tests'];
    case 'review':
      return null;
  }
}

/**
 * The skill lines for an agent of this role, one per distinct skill of its stages. No file
 * content is injected: Claude Code resolves the skill from `.claude/skills` (ADR-0018), and a
 * missing skill does not block the run.
 */
export function skillLinesFor(workflow: ProjectWorkflow | undefined, kind: AgentRoleKind): string[] {
  if (workflow === undefined) return [];
  const names: string[] = [];
  for (const stage of stagesForRole(kind, workflow)) {
    const skill = agentStage(workflow, stage)?.skill ?? null;
    if (skill !== null && !names.includes(skill)) names.push(skill);
  }
  return names.map(skillLine);
}

/** The prompt with the role's skill lines appended; unchanged when no stage maps a skill. */
export function withSkills(
  prompt: string,
  workflow: ProjectWorkflow | undefined,
  kind: AgentRoleKind,
): string {
  const lines = skillLinesFor(workflow, kind);
  return lines.length === 0 ? prompt : `${prompt}\n\n${lines.join('\n')}`;
}

/**
 * The model the workflow sets for this role, or null (the project default). The lead in `lead`
 * mode uses the orchestrate stage's model, else the plan stage's.
 */
export function stageModelFor(
  workflow: ProjectWorkflow | undefined,
  kind: AgentRoleKind,
): string | null {
  if (workflow === undefined) return null;
  for (const stage of [...stagesForRole(kind, workflow)].reverse()) {
    const model = agentStage(workflow, stage)?.model ?? null;
    if (model !== null) return model;
  }
  return null;
}

// ------------------------------------------------------------------ post-merge briefs

/** The longest reviewer finding stored: the ticket comment limit (`TicketCommentSchema.body`). */
export const REVIEW_POST_MAX_CHARS = 8000;
/** How many findings one reviewer may post; more is refused. */
export const MAX_REVIEW_POSTS = 5;
/** The tester's owner-facing task (`AgentRun.task`). */
export const TESTER_TASK = 'Write unit tests for the merged change.';

function planLines(plan: TicketPlan | undefined): string[] {
  if (plan === undefined) return [];
  return [
    `The approved plan (v${plan.version}): ${plan.summary}`,
    plan.steps.map((s, i) => `${i + 1}. ${s.title} (${s.role})`).join('\n'),
  ];
}

function mergedWork(state: Pick<RunState, 'agents'>): string {
  const merged = state.agents.filter((a) => a.kind === 'worker' && a.review === 'merged');
  return [
    'Merged work:',
    ...merged.map((a) => `- ${a.role}: ${a.task ?? '(no task text)'}`),
  ].join('\n');
}

/** The reviewer's fixed brief: what was merged, and how to report (ADR-0019 §2). */
export function reviewerBrief(state: Pick<RunState, 'run' | 'agents' | 'plans'>): string {
  return [
    `Final code review for "${state.run.title}".`,
    'The owner merged the helpers’ changes into the main branch. Your working folder is a temporary read-only checkout of the merged result.',
    ...planLines(approvedPlan(state)),
    mergedWork(state),
    'Read the changed code. Look for bugs, risky changes, missing tests and unclear code. You cannot edit files or run commands.',
    `Post your findings with post_review as plain text (up to ${REVIEW_POST_MAX_CHARS} characters each, at most ${MAX_REVIEW_POSTS} posts). They become comments on the ticket; they do not block or merge anything. When you have posted, you are done.`,
  ].join('\n\n');
}

/** The tester's fixed brief (ADR-0019 §2): unit tests for the merged change, in its own copy. */
export function testerBrief(state: Pick<RunState, 'run' | 'agents' | 'plans'>): string {
  return [
    `${TESTER_TASK} Ticket: "${state.run.title}".`,
    ...planLines(approvedPlan(state)),
    mergedWork(state),
    'You work in your own copy of the project, which already holds the merged change. Add or extend unit tests for the merged behaviour and keep them fast. Do not change product code; if a test shows a bug, say so in your final message.',
    'The owner reviews and merges your change like the helpers’ changes, after the project’s checks.',
  ].join('\n\n');
}
