import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';

/**
 * Project workflow and skills (docs/history/redesign/README.md §4.2–4.3, ADR-0018, ADR-0019).
 *
 * A workflow is a fixed sequence of stages; a project turns optional stages on or off and gives each
 * agent stage a model and a skill. Agent limits (helpers, depth, budget) and the approval settings
 * (allowlist, ADR-0021 approvals) stay in `ProjectAgentSetup`, so there is one source for each
 * value. The review stage's reviewer and rework rounds live here (ADR-0021).
 */

/** Claude Code skill names: lowercase letters, digits and hyphens (ADR-0018). */
export const SkillNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'lowercase letters, digits and dashes (up to 64)');
export type SkillName = z.infer<typeof SkillNameSchema>;

/** Where project skills live, relative to the project root (ADR-0018). */
export const SKILLS_DIR = '.claude/skills';
export const SKILL_FILE = 'SKILL.md';
/** Size cap for one SKILL.md written by the app. */
export const MAX_SKILL_BYTES = 64 * 1024;
export const MAX_SKILL_DESCRIPTION = 1024;

/**
 * Project agent definitions (Claude Code subagents): `<project>/.claude/agents/<name>.md`, Markdown
 * with front matter (`name`, `description`, optional `tools`, `model`). Written by the app on an
 * owner action under the same rules as skills (ADR-0018, amended 2026-10-16).
 */
export const AGENTS_DIR = '.claude/agents';
export const MAX_AGENT_BYTES = 64 * 1024;
/** A Claude Code tool name in an agent's `tools` list, e.g. `Read`, `Bash`, `mcp__server__tool`. */
export const AgentToolNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_:*.-]{0,99}$/);

/**
 * The stages, in order. `review` is each helper's change being reviewed (a review agent or the
 * lead), decided by the lead and gated by the harness checks; the owner merges the ticket branch
 * once at the end (ADR-0021 §3–4). Before ADR-0021 it was the owner plus the checks.
 */
export const WorkflowStageIdSchema = z.enum([
  'plan',
  'orchestrate',
  'helpers',
  'review',
  'code-review',
  'unit-tests',
]);
export type WorkflowStageId = z.infer<typeof WorkflowStageIdSchema>;
export const WORKFLOW_STAGES = WorkflowStageIdSchema.options;

const ModelSchema = z.string().trim().min(1).max(100).nullable();

/** An agent stage that always runs. */
const AgentStageSchema = z.object({
  /** Null: the project's default model (`ProjectAgentSetup.model`), else the provider default. */
  model: ModelSchema,
  /** Null: no skill. The agent is told to use this project skill when set. */
  skill: SkillNameSchema.nullable(),
  /**
   * A project agent file (`.claude/agents/<name>.md`) this stage's agent uses (redesign §6a,
   * ADR-0019 amendment): its instructions are added, its model is the stage default, and its tools
   * can only narrow the role's tools. Absent or null: no agent file.
   */
  agent: SkillNameSchema.nullable().optional(),
});

/** An agent stage the project can switch off. */
const OptionalAgentStageSchema = AgentStageSchema.extend({ enabled: z.boolean() });

/** Who reviews each helper's change before the lead decides (ADR-0021 §3). */
export const ChangeReviewerModeSchema = z.enum(['agent', 'lead']);
export type ChangeReviewerMode = z.infer<typeof ChangeReviewerModeSchema>;
/** Rework rounds the lead may ask for per change, unless the owner grants more (ADR-0021 §3). */
export const DEFAULT_MAX_REWORK_ROUNDS = 2;
export const MAX_REWORK_ROUNDS = 5;
export const ReworkRoundsSchema = z.number().int().min(0).max(MAX_REWORK_ROUNDS);

export const PlannerModeSchema = z.enum(['lead', 'separate']);
export type PlannerMode = z.infer<typeof PlannerModeSchema>;

export const ProjectWorkflowSchema = z.object({
  projectId: z.string().min(1),
  /**
   * `lead`: one lead agent plans and then orchestrates (the Phase 4 behaviour, the default).
   * `separate`: a read-only planner writes and revises the plan; the lead receives the approved plan
   * and runs the helpers (ADR-0019).
   */
  plannerMode: PlannerModeSchema,
  stages: z.object({
    plan: AgentStageSchema,
    orchestrate: AgentStageSchema,
    helpers: AgentStageSchema,
    review: z.object({
      /** Required harness checks must pass before a plain merge (ADR-0017). Always on for now. */
      requireChecks: z.literal(true),
      /**
       * ADR-0021 §3. The fields below are optional so workflows stored before it still parse;
       * read them with `reviewStageOf()`, which applies the defaults (`agent`, 2 rounds, no model,
       * skill or agent file). `model`, `skill` and `agent` configure the review agent.
       */
      reviewer: ChangeReviewerModeSchema.optional(),
      maxReworkRounds: ReworkRoundsSchema.optional(),
      model: ModelSchema.optional(),
      skill: SkillNameSchema.nullable().optional(),
      agent: SkillNameSchema.nullable().optional(),
    }),
    /** A read-only reviewer reads the merged result and posts findings as ticket comments. */
    'code-review': OptionalAgentStageSchema,
    /** A tester writes unit tests in its own worktree; its change is reviewed and merged too. */
    'unit-tests': OptionalAgentStageSchema,
  }),
  updatedAt: IsoTimestampSchema,
});
export type ProjectWorkflow = z.infer<typeof ProjectWorkflowSchema>;

/** The workflow a project gets until the owner changes it: today's Phase 4 flow. */
export function defaultProjectWorkflow(projectId: string, now: string): ProjectWorkflow {
  return {
    projectId,
    plannerMode: 'lead',
    stages: {
      plan: { model: null, skill: null },
      orchestrate: { model: null, skill: null },
      helpers: { model: null, skill: null },
      review: { requireChecks: true },
      'code-review': { enabled: false, model: null, skill: null },
      'unit-tests': { enabled: false, model: null, skill: null },
    },
    updatedAt: now,
  };
}

/** The review stage's settings with the ADR-0021 defaults applied. */
export interface ReviewStageSettings {
  reviewer: ChangeReviewerMode;
  maxReworkRounds: number;
  model: string | null;
  skill: SkillName | null;
  agent: SkillName | null;
}

/** The review stage of `workflow`, defaults applied for a workflow stored before ADR-0021. */
export function reviewStageOf(workflow: Pick<ProjectWorkflow, 'stages'>): ReviewStageSettings {
  const r = workflow.stages.review;
  return {
    reviewer: r.reviewer ?? 'agent',
    maxReworkRounds: r.maxReworkRounds ?? DEFAULT_MAX_REWORK_ROUNDS,
    model: r.model ?? null,
    skill: r.skill ?? null,
    agent: r.agent ?? null,
  };
}

/** The stages a skill is mapped to, in workflow order. */
export function stagesUsingSkill(workflow: ProjectWorkflow, skill: SkillName): WorkflowStageId[] {
  const s = workflow.stages;
  const mapped: [WorkflowStageId, SkillName | null][] = [
    ['plan', s.plan.skill],
    ['orchestrate', s.orchestrate.skill],
    ['helpers', s.helpers.skill],
    ['review', s.review.skill ?? null],
    ['code-review', s['code-review'].skill],
    ['unit-tests', s['unit-tests'].skill],
  ];
  return mapped.filter(([, name]) => name === skill).map(([stage]) => stage);
}

/** The stages an agent file is mapped to, in workflow order (for "Used by" chips). */
export function stagesUsingAgent(workflow: ProjectWorkflow, agent: SkillName): WorkflowStageId[] {
  const s = workflow.stages;
  const mapped: [WorkflowStageId, SkillName | null | undefined][] = [
    ['plan', s.plan.agent],
    ['orchestrate', s.orchestrate.agent],
    ['helpers', s.helpers.agent],
    ['review', s.review.agent],
    ['code-review', s['code-review'].agent],
    ['unit-tests', s['unit-tests'].agent],
  ];
  return mapped.filter(([, name]) => name === agent).map(([stage]) => stage);
}
