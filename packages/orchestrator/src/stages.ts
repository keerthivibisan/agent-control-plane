import { reviewStageOf } from '@acp/core';
import type {
  AgentRoleKind,
  OrchestrationRun,
  ProjectWorkflow,
  TicketPlan,
  WorkflowStageId,
} from '@acp/core';
import { approvedPlan } from './plan-read.js';
import type { EngineAgent, RunIntegration } from './state.js';
import { isLiveAgentStatus } from './transitions.js';

/**
 * Workflow stages (ADR-0019): plan → orchestrate → helpers → review → code-review → unit-tests.
 * Pure reads over a run's state and its workflow snapshot. The first four stages always run, as
 * in Phase 4; the two post-merge stages run when the project switched them on and at least one
 * helper's change was merged.
 */

/**
 * What these reads need. `Draft` and `RunState` both satisfy it (optional fields may be explicitly
 * undefined in a draft).
 */
interface AgentsView {
  readonly agents: readonly EngineAgent[];
}
interface WorkflowView {
  readonly workflow?: ProjectWorkflow | undefined;
}
interface BriefView extends AgentsView {
  readonly run: Pick<OrchestrationRun, 'title'>;
  readonly plans?: readonly TicketPlan[] | undefined;
  readonly integration?: RunIntegration | undefined;
}

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
export function isSeparatePlanner(state: WorkflowView): boolean {
  return state.workflow?.plannerMode === 'separate';
}

/** The agent that writes and revises the plan: the planner in separate mode, else the lead. */
export function planningAgent(state: AgentsView & WorkflowView): EngineAgent | undefined {
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
 * A change reviewer (ADR-0021 §3): a `reviewer` that reviews one helper's change in the review
 * loop (stage `review`), as opposed to the final code reviewer (stage `code-review`).
 */
export function isChangeReviewer(agent: Pick<EngineAgent, 'kind' | 'reviewsAgentRunId'>): boolean {
  return agent.kind === 'reviewer' && agent.reviewsAgentRunId !== undefined;
}

/** The final code reviewer or the tester: the agents a post-merge stage starts (ADR-0019). */
export function isStageAgent(agent: Pick<EngineAgent, 'kind' | 'reviewsAgentRunId'>): boolean {
  return isPostMergeRole(agent.kind) && !isChangeReviewer(agent);
}

/**
 * Roles that only read and never ask to edit or run anything (ADR-0019). The lead is read-only
 * too, but the server denies its tool uses itself (ADR-0013 §2), so it is not listed here.
 */
export function isReadOnlyRole(kind: AgentRoleKind): boolean {
  return kind === 'planner' || kind === 'reviewer';
}

/** At least one helper's change was merged; the post-merge stages have something to work on. */
export function anyHelperMerged(state: AgentsView): boolean {
  return state.agents.some((a) => a.kind === 'worker' && a.review === 'merged');
}

/** The last stage agent of a kind; change reviewers (ADR-0021) are not the code-review stage. */
function lastOfKind(state: AgentsView, kind: AgentRoleKind): EngineAgent | undefined {
  const all = state.agents.filter((a) => a.kind === kind && !isChangeReviewer(a));
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
export function nextStage(state: AgentsView & WorkflowView): PostMergeStage | null {
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

/**
 * The run-scoped skills plugin (ADR-0019 §4, amended: decision E). With `settingSources: []`
 * Claude Code loads no filesystem skills, so the server copies the mapped skills into a plugin
 * named `acp-skills` and the agent sees them as `acp-skills:<name>`.
 */
export const SKILLS_PLUGIN_NAME = 'acp-skills';

/** A skill's name inside the plugin, as the SDK `skills` allowlist and the agent see it. */
export function pluginSkillName(name: string): string {
  return `${SKILLS_PLUGIN_NAME}:${name}`;
}

/** The single instruction line a stage's skill adds to its agent's prompt (ADR-0019 §4). */
export function skillLine(name: string): string {
  return `Use the project skill \`${pluginSkillName(name)}\`.`;
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
): { model: string | null; skill: string | null; agent?: string | null | undefined } | null {
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
 * The project skills mapped to this role's stages, distinct, in stage order (bare names, as in
 * `.claude/skills/<name>`). The server builds the skills plugin from them.
 */
export function skillsFor(workflow: ProjectWorkflow | undefined, kind: AgentRoleKind): string[] {
  if (workflow === undefined) return [];
  const names: string[] = [];
  for (const stage of stagesForRole(kind, workflow)) {
    const skill = agentStage(workflow, stage)?.skill ?? null;
    if (skill !== null && !names.includes(skill)) names.push(skill);
  }
  return names;
}

/**
 * The skill lines for an agent of this role, one per distinct skill of its stages. No file
 * content is injected, and a missing skill does not block the run.
 */
export function skillLinesFor(
  workflow: ProjectWorkflow | undefined,
  kind: AgentRoleKind,
): string[] {
  return skillsFor(workflow, kind).map(skillLine);
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

/**
 * The project agent file (`.claude/agents/<name>.md`) the workflow gives this role, or null
 * (ADR-0019 §6). An agent uses at most one file: the lead in `lead` mode uses the orchestrate
 * stage's file, else the plan stage's, the same order as `stageModelFor`.
 */
export function stageAgentFor(
  workflow: ProjectWorkflow | undefined,
  kind: AgentRoleKind,
): string | null {
  if (workflow === undefined) return null;
  for (const stage of [...stagesForRole(kind, workflow)].reverse()) {
    const agent = agentStage(workflow, stage)?.agent ?? null;
    if (agent !== null) return agent;
  }
  return null;
}

/**
 * The model an agent runs with (ADR-0019 §6): an explicit stage model, else the stage's agent
 * file's `model`, else the project's default model, else null (the provider default). The engine
 * never reads files, so it puts only the stage model on the effect (`model`) and the file's name
 * (`agent`); the server reads the file and resolves the model with this function.
 */
export function resolveAgentModel(input: {
  stage: string | null | undefined;
  agentFile: string | null | undefined;
  project: string | null | undefined;
}): string | null {
  for (const candidate of [input.stage, input.agentFile, input.project]) {
    if (candidate !== null && candidate !== undefined && candidate.trim() !== '') return candidate;
  }
  return null;
}

/**
 * The launch fields of a `start-agent` effect for this role under the workflow: the prompt with
 * its skill lines, plus `model`, `skills` and `agent` only when the workflow sets them, so a run
 * without a workflow (or with the default one) gets exactly the Phase 4 effect.
 */
export function launchFields(
  prompt: string,
  workflow: ProjectWorkflow | undefined,
  kind: AgentRoleKind,
): { prompt: string; model?: string; skills?: string[]; agent?: string } {
  const model = stageModelFor(workflow, kind);
  const skills = skillsFor(workflow, kind);
  const agent = stageAgentFor(workflow, kind);
  return {
    prompt: withSkills(prompt, workflow, kind),
    ...(model !== null ? { model } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(agent !== null ? { agent } : {}),
  };
}

/**
 * The launch fields of a change reviewer (ADR-0021 §3): the review stage's model, skill and agent
 * file (`reviewStageOf`), present only when set, like `launchFields`.
 */
export function changeReviewerLaunchFields(
  prompt: string,
  workflow: ProjectWorkflow | undefined,
): { prompt: string; model?: string; skills?: string[]; agent?: string } {
  const review = workflow === undefined ? null : reviewStageOf(workflow);
  const model = review?.model ?? null;
  const skill = review?.skill ?? null;
  const agent = review?.agent ?? null;
  return {
    prompt: skill === null ? prompt : `${prompt}\n\n${skillLine(skill)}`,
    ...(model !== null ? { model } : {}),
    ...(skill !== null ? { skills: [skill] } : {}),
    ...(agent !== null ? { agent } : {}),
  };
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

function mergedWork(state: AgentsView): string {
  const merged = state.agents.filter((a) => a.kind === 'worker' && a.review === 'merged');
  return ['Merged work:', ...merged.map((a) => `- ${a.role}: ${a.task ?? '(no task text)'}`)].join(
    '\n',
  );
}

/** The reviewer's fixed brief: what was merged, and how to report (ADR-0019 §2). */
export function reviewerBrief(state: BriefView): string {
  const branch = state.integration?.ticketBranch ?? null;
  return [
    `Final code review for "${state.run.title}".`,
    branch === null
      ? 'The owner merged the helpers’ changes into the main branch. Your working folder is a temporary read-only checkout of the merged result.'
      : `The lead merged the helpers’ reviewed changes into the ticket branch ${branch}. Your working folder is a temporary read-only checkout of its tip. The owner merges the branch into the main branch after your review.`,
    ...planLines(approvedPlan({ plans: state.plans ?? [] })),
    mergedWork(state),
    'Read the changed code. Look for bugs, risky changes, missing tests and unclear code. You cannot edit files or run commands.',
    `Post your findings with post_review as plain text (up to ${REVIEW_POST_MAX_CHARS} characters each, at most ${MAX_REVIEW_POSTS} posts). They become comments on the ticket${branch === null ? '' : ' and are sent to the lead'}; they do not block or merge anything. When you have posted, you are done.`,
  ].join('\n\n');
}

/** The tester's fixed brief (ADR-0019 §2): unit tests for the merged change, in its own copy. */
export function testerBrief(state: BriefView): string {
  return [
    `${TESTER_TASK} Ticket: "${state.run.title}".`,
    ...planLines(approvedPlan({ plans: state.plans ?? [] })),
    mergedWork(state),
    'You work in your own copy of the project, which already holds the merged change. Add or extend unit tests for the merged behaviour and keep them fast. Do not change product code; if a test shows a bug, say so in your final message.',
    (state.integration?.ticketBranch ?? null) === null
      ? 'The owner reviews and merges your change like the helpers’ changes, after the project’s checks.'
      : 'Your copy starts from the ticket branch. Your change is reviewed and decided like the helpers’ changes, after the project’s checks.',
  ].join('\n\n');
}

/** The longest helper task quoted in a change reviewer's brief. */
const BRIEF_TASK_MAX_CHARS = 2000;

/**
 * A change reviewer's fixed brief (ADR-0021 §3). The server appends the change's diff (at most
 * 64 KiB, sent and never stored); the reviewer reads the detached checkout of the sealed commit.
 */
export function changeReviewerBrief(
  state: BriefView,
  helper: Pick<EngineAgent, 'role' | 'task'>,
  round: number,
): string {
  const task = helper.task ?? '(no task text)';
  return [
    `Review one helper’s change for "${state.run.title}"${round > 0 ? ` (after rework round ${round})` : ''}.`,
    `The helper "${helper.role}" was asked to: ${task.length <= BRIEF_TASK_MAX_CHARS ? task : `${task.slice(0, BRIEF_TASK_MAX_CHARS - 1)}…`}`,
    ...planLines(approvedPlan({ plans: state.plans ?? [] })),
    'Your working folder is a temporary read-only checkout of the change. Read the changed code and judge whether it does the task correctly and safely: bugs, risky changes, missing tests, unclear code. You cannot edit files or run commands.',
    'When you are done, call submit_review once with your verdict ("approve" or "rework") and your findings as plain text. They go to the lead, who decides, and become a comment on the ticket. Your verdict is advice; it does not merge or block anything. Then you are done.',
  ].join('\n\n');
}
