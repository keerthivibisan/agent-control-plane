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

// --- Workflow graph editor (WG-D, wp/wg-d-editor; ADR-0023) --------------------------------------
//
// Synthetic `GET /api/projects/:id/workflow-graph` answers (`WorkflowGraphDto`), as plain JSON like
// the rest of this file. `migratedGraph()` is exactly what core's `migrateWorkflowV1` gives for the
// default version 1 workflow in an Auto edits project (tests/features/workflow-editor.test.tsx
// checks that, and that every graph here parses and validates as described).

const gateNodes = (planAuto = false): Json[] => [
  { type: 'ticket', id: 'ticket', label: 'Ticket' },
  { type: 'plan-approval', id: 'plan-approval', label: 'Plan approval', auto: planAuto },
];
const tailNodes = (): Json[] => [
  { type: 'checks', id: 'checks', label: 'Checks' },
  { type: 'ticket-merge', id: 'ticket-merge', label: 'Ticket branch' },
];
const endNodes = (): Json[] => [
  { type: 'owner-merge', id: 'owner-merge', label: 'Your merge' },
  { type: 'done', id: 'done', label: 'Done' },
];
const agent = (over: Json): Json => ({ model: null, skills: [], agent: null, ...over });
const flowEdge = (from: string, to: string): Json => ({
  type: 'flow',
  id: `flow-${from}-${to}`,
  from,
  to,
});
const typedEdge = (type: string, from: string, to: string, over: Json = {}): Json => ({
  type,
  id: `${type}-${from}-${to}`.slice(0, 40),
  from,
  to,
  ...over,
});

/** The default version 1 workflow, migrated: today's setup with `legacyV1` kept. */
export function migratedGraph(): Json {
  return {
    version: 2,
    template: 'custom',
    nodes: [
      ...gateNodes(),
      agent({ type: 'lead', id: 'orchestrate', label: 'Lead' }),
      agent({
        type: 'helper-pool',
        id: 'helpers',
        label: 'Helpers',
        approvalMode: null,
        canStartHelpers: true,
      }),
      agent({ type: 'reviewer', id: 'review', label: 'Change reviewer', scope: 'change' }),
      ...tailNodes(),
      ...endNodes(),
    ],
    edges: [
      flowEdge('ticket', 'orchestrate'),
      flowEdge('orchestrate', 'plan-approval'),
      typedEdge('assigns', 'orchestrate', 'helpers'),
      typedEdge('review', 'helpers', 'review'),
      typedEdge('findings', 'review', 'orchestrate'),
      typedEdge('rework', 'orchestrate', 'helpers', { maxRounds: 2 }),
      typedEdge('merge', 'orchestrate', 'checks'),
      flowEdge('checks', 'ticket-merge'),
      flowEdge('ticket-merge', 'owner-merge'),
      flowEdge('owner-merge', 'done'),
    ],
    legacyV1: {
      plannerMode: 'lead',
      stages: {
        plan: { model: null, skill: null },
        orchestrate: { model: null, skill: null },
        helpers: { model: null, skill: null },
        review: { requireChecks: true },
        'code-review': { enabled: false, model: null, skill: null },
        'unit-tests': { enabled: false, model: null, skill: null },
      },
    },
  };
}

/**
 * A stored graph built by hand: a planner, a named "Frontend helper" (Manual, two at once, a skill
 * and an agent file the project doesn't have) reviewed by the lead, the pool reviewed by a change
 * reviewer, and a tester before your merge. Valid, with warnings for the missing skill and file.
 */
export function customGraph(): Json {
  return {
    version: 2,
    template: 'custom',
    nodes: [
      { type: 'ticket', id: 'ticket', label: 'Ticket' },
      agent({ type: 'planner', id: 'plan', label: 'Planner', skills: ['plan-tickets'] }),
      { type: 'plan-approval', id: 'plan-approval', label: 'Plan approval', auto: false },
      agent({ type: 'lead', id: 'orchestrate', label: 'Lead', model: 'claude-opus-4' }),
      agent({
        type: 'helper',
        id: 'helper-1',
        label: 'Frontend helper',
        description: 'Builds the screens.',
        skills: ['release-notes'],
        agent: 'test-writer',
        approvalMode: 'manual',
        maxInstances: 2,
        canStartHelpers: false,
      }),
      agent({
        type: 'helper-pool',
        id: 'helpers',
        label: 'Helpers',
        agent: 'db-migrator',
        approvalMode: null,
        canStartHelpers: true,
      }),
      agent({ type: 'reviewer', id: 'review', label: 'Change reviewer', scope: 'change' }),
      ...tailNodes(),
      agent({ type: 'tester', id: 'unit-tests', label: 'Tester', approvalMode: 'auto-edits' }),
      ...endNodes(),
    ],
    edges: [
      flowEdge('ticket', 'plan'),
      flowEdge('plan', 'plan-approval'),
      flowEdge('plan-approval', 'orchestrate'),
      typedEdge('assigns', 'orchestrate', 'helper-1'),
      typedEdge('assigns', 'orchestrate', 'helpers'),
      typedEdge('review', 'helper-1', 'orchestrate'),
      typedEdge('rework', 'orchestrate', 'helper-1', { maxRounds: 1 }),
      typedEdge('review', 'helpers', 'review'),
      typedEdge('findings', 'review', 'orchestrate'),
      typedEdge('rework', 'review', 'helpers', { maxRounds: 2 }),
      typedEdge('review', 'unit-tests', 'orchestrate'),
      typedEdge('merge', 'orchestrate', 'checks'),
      flowEdge('checks', 'ticket-merge'),
      flowEdge('ticket-merge', 'unit-tests'),
      flowEdge('unit-tests', 'owner-merge'),
      flowEdge('owner-merge', 'done'),
    ],
  };
}

/** `GET /api/projects/:id/workflow-graph`. Defaults: the migrated graph in an Auto edits project. */
export function graphDto(over: Json = {}): Json {
  return {
    graph: migratedGraph(),
    stored: 'v1',
    issues: [],
    setup: setupFixture({ approvals: { mode: 'auto-edits', commands: [] } }),
    skills: [...SKILLS],
    agents: ['db-migrator', 'docs-writer'],
    updatedAt: null,
    ...over,
  };
}

/** The same project with the hand-built graph stored. */
export function customGraphDto(): Json {
  return graphDto({ graph: customGraph(), stored: 'v2', updatedAt: T(3) });
}

/** A 422 `workflow_invalid` answer to a PUT (the server's issues come from …/validate). */
export function workflowInvalidError(): Json {
  return {
    error: {
      code: 'workflow_invalid',
      message: 'The workflow cannot run: 1 problem (no-review-route).',
      requestId: 'req-e2e',
    },
  };
}
