/*
 * Synthetic, test-only Workflow page responses (redesign R-B), as plain JSON so both the vitest
 * suite (which parses each one with its @acp/core/api schema, tests/features/workflow.test.tsx)
 * and the Playwright screenshot harness (workflow.spec.ts, which serves them with page.route) can
 * use them. Skill and agent names, descriptions and models are invented. Never import this from
 * src/.
 */

export const WF_PROJECT_ID = 'p-web';
export const WF_CSRF = 'csrf-token-0123456789abcdef0123456789abcdef';
export const SKILLS = ['code-review', 'plan-tickets', 'unit-tests'] as const;

type Json = Record<string, unknown>;

const T = (min: number) => new Date(Date.UTC(2026, 9, 16, 9, min)).toISOString();

export function setupFixture(over: Json = {}): Json {
  return {
    projectId: WF_PROJECT_ID,
    projectKey: 'WEB',
    planFirst: true,
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 500_000,
    model: null,
    allowlist: { editInOwnWorktree: true, runHarnessChecks: false },
    contextFiles: ['CLAUDE.md'],
    updatedAt: T(0),
    ...over,
  };
}

const stage = (over: Json = {}) => ({ model: null, skill: null, ...over });

export interface WorkflowOptions {
  plannerMode?: 'lead' | 'separate';
  plan?: Json;
  orchestrate?: Json;
  helpers?: Json;
  codeReview?: Json;
  unitTests?: Json;
}

export function workflowFixture(o: WorkflowOptions = {}): Json {
  return {
    projectId: WF_PROJECT_ID,
    plannerMode: o.plannerMode ?? 'lead',
    stages: {
      plan: stage(o.plan),
      orchestrate: stage(o.orchestrate),
      helpers: stage(o.helpers),
      review: { requireChecks: true },
      'code-review': stage({ enabled: false, ...o.codeReview }),
      'unit-tests': stage({ enabled: false, ...o.unitTests }),
    },
    updatedAt: T(1),
  };
}

/** `GET /api/projects/:id/workflow`: the default (Phase 4) workflow. */
export function defaultWorkflowDto(): Json {
  return { workflow: workflowFixture(), setup: setupFixture(), skills: [...SKILLS] };
}

/**
 * Everything on: a separate planner, both optional stages, four helpers at depth 2, and a mapped
 * skill (`release-notes`) that is no longer in the project.
 */
export function fullWorkflowDto(): Json {
  return {
    workflow: workflowFixture({
      plannerMode: 'separate',
      plan: { skill: 'plan-tickets', model: 'claude-opus-4' },
      helpers: { skill: 'release-notes' },
      codeReview: { enabled: true, skill: 'code-review' },
      unitTests: { enabled: true, skill: 'unit-tests' },
    }),
    setup: setupFixture({ maxConcurrentHelpers: 4, maxDepth: 2, model: 'claude-sonnet-4' }),
    skills: [...SKILLS],
  };
}

/** `GET /api/projects/:id/agents` (R-D): two agent definition files. */
export function agentFilesFixture(): Json[] {
  return [
    {
      name: 'db-migrator',
      description: 'Writes and checks database migrations.',
      path: '.claude/agents/db-migrator.md',
      tools: ['Read', 'Edit', 'Bash'],
      model: null,
      sizeBytes: 812,
      lastCommittedAt: T(2),
      uncommitted: false,
      problems: [],
    },
    {
      name: 'docs-writer',
      description: 'Keeps the README and the docs folder in step with the code.',
      path: '.claude/agents/docs-writer.md',
      tools: null,
      model: 'claude-haiku-4',
      sizeBytes: 640,
      lastCommittedAt: null,
      uncommitted: true,
      problems: [],
    },
  ];
}

// --- Agent files on stages (redesign R-I, wp/r-i-web) -------------------------------------------

/**
 * Stages that use agent files: Helpers use `db-migrator` (no model of its own), Unit tests use
 * `docs-writer` (model `claude-haiku-4`), and Final code review names `test-writer`, which is not
 * among the project's agent files (`agentFilesFixture`).
 */
export function agentWorkflowDto(): Json {
  return {
    workflow: workflowFixture({
      helpers: { agent: 'db-migrator', skill: 'unit-tests' },
      codeReview: { enabled: true, agent: 'test-writer', skill: 'code-review' },
      unitTests: { enabled: true, agent: 'docs-writer' },
    }),
    setup: setupFixture({ model: 'claude-sonnet-4' }),
    skills: [...SKILLS],
  };
}
