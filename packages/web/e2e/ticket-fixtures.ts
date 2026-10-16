/*
 * Synthetic, test-only ticket-page responses (Phase 4, P4-G), as plain JSON so both the vitest
 * suite (which parses every one with its @acp/core/api schema, tests/features/ticket.test.tsx) and
 * the Playwright screenshot harness (ticket.spec.ts, which serves them with page.route) can use
 * them. Roles, tasks, paths, outputs and the diff are invented. Never import this from src/.
 */

export const TICKET_ID = 't-12';
export const PROJECT_ID = 'p-web';
export const RUN_ID = 'run-2';
export const OLD_RUN_ID = 'run-1';
export const CSRF = 'csrf-token-0123456789abcdef0123456789abcdef';

export const LEAD = 'ag-lead';
export const UI = 'ag-ui';
export const STORE = 'ag-store';
export const TESTS = 'ag-tests';
/** Depth 2: started by the Theme store helper. */
export const MIGRATION = 'ag-migration';
/** Depth 2: started by the Settings UI helper. */
export const TOKENS = 'ag-tokens';

export const PLAN_V1 = 'plan-1';
export const PLAN_V2 = 'plan-2';

type Json = Record<string, unknown>;

/** The fixtures' project as `GET /api/projects` lists it (the shell's switcher and sidebar). */
export function fixtureProject(): Json {
  return {
    id: PROJECT_ID,
    name: 'web-app',
    rootPath: '/work/web-app',
    createdAt: new Date(Date.UTC(2026, 9, 15, 9, 0)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 9, 15, 9, 0)).toISOString(),
    sessionCount: 0,
    lastEventAt: null,
  };
}

const T = (min: number) => new Date(Date.UTC(2026, 9, 15, 9, min)).toISOString();

const ticketBase = {
  id: TICKET_ID,
  projectId: PROJECT_ID,
  key: 'WEB-12',
  title: 'Dark mode toggle',
  description:
    'Add a dark mode toggle to the settings page.\n\nIt should follow the system setting until the user picks one, and remember the choice.',
  type: 'feature',
  priority: 'high',
  labels: ['ui', 'settings'],
  currentRunId: RUN_ID,
  createdAt: T(0),
  updatedAt: T(1),
};

function ticket(status: string, stage: string): Json {
  return { ...ticketBase, status, stage };
}

/** A helper's worktree branch, as the workspace names it (`acp/<run>/<agent>`). */
export const branchOf = (agentId: string) => `acp/${RUN_ID}/${agentId}`;

function agent(over: Json & { id: string }): Json {
  return {
    runId: RUN_ID,
    parentAgentRunId: LEAD,
    kind: 'worker',
    role: 'Helper',
    task: null,
    status: 'RUNNING',
    sessionId: null,
    budget: { used: 0, limit: 50_000 },
    latestActivity: null,
    review: null,
    branch: branchOf(over.id),
    createdAt: T(10),
    endedAt: null,
    ...over,
  };
}

function lead(status: string, used: number, latestActivity: string): Json {
  return agent({
    id: LEAD,
    parentAgentRunId: null,
    kind: 'lead',
    role: 'Lead',
    status,
    // The lead works in the project's checkout and has no worktree branch.
    branch: null,
    budget: { used, limit: 200_000 },
    latestActivity,
    createdAt: T(2),
  });
}

function runSummary(id: string, status: string, over: Json = {}): Json {
  return {
    id,
    projectId: PROJECT_ID,
    ticketId: TICKET_ID,
    title: 'WEB-12 Dark mode toggle',
    status,
    agentCount: 1,
    pendingApprovals: 0,
    createdAt: id === RUN_ID ? T(2) : '2026-10-14T15:00:00.000Z',
    updatedAt: T(30),
    endedAt: null,
    ...over,
  };
}

function runDetail(status: string, agents: Json[], over: Json = {}): Json {
  return {
    ...runSummary(RUN_ID, status, { agentCount: agents.length }),
    budget: { maxTokensPerAgent: 50_000, softCostUsdPerRun: null },
    agents,
    approvals: [],
    messages: [
      {
        id: 'm-1',
        runId: RUN_ID,
        role: 'lead',
        text: 'I read the settings page and the theme code. My plan is ready for you.',
        createdAt: T(5),
      },
    ],
    ...over,
  };
}

const OLD_RUN = runSummary(OLD_RUN_ID, 'FAILED', { endedAt: '2026-10-14T15:20:00.000Z' });

const steps = [
  {
    title: 'Theme store',
    role: 'Theme store',
    detail: 'Keep the chosen theme (system, light or dark) and remember it between visits.',
  },
  {
    title: 'Settings toggle',
    role: 'Settings UI',
    detail: 'Add a three-way switch to the settings page that reads and writes the theme store.',
  },
  {
    title: 'Tests',
    role: 'Tests',
    detail: 'Unit tests for the store and a component test for the switch.',
  },
];

function plan(id: string, version: number, status: string, over: Json = {}): Json {
  return {
    id,
    ticketId: TICKET_ID,
    runId: RUN_ID,
    version,
    summary:
      version === 1
        ? 'Replace the settings page with a new appearance page that holds the theme switch.'
        : 'Keep the settings page as it is and add a theme switch to it. Store the choice in a small theme store that follows the system setting until the user picks one.',
    steps: version === 1 ? steps.slice(0, 2) : steps,
    plannedHelpers: version === 1 ? 2 : 3,
    status,
    createdAt: version === 1 ? T(4) : T(8),
    decidedAt: status === 'proposed' ? null : version === 1 ? T(6) : T(9),
    ...over,
  };
}

const COMMENTS = [
  {
    id: 'c-1',
    ticketId: TICKET_ID,
    runId: RUN_ID,
    planId: PLAN_V1,
    author: 'owner',
    body: 'Keep the old settings page. Add the toggle there instead of making a new page.',
    createdAt: T(6),
  },
  {
    id: 'c-0',
    ticketId: TICKET_ID,
    runId: null,
    planId: null,
    author: 'owner',
    body: 'The design team wants the toggle near the language setting.',
    createdAt: T(1),
  },
];

function check(
  agentRunId: string,
  checkId: string,
  name: string,
  status: string,
  over: Json & { startedAt?: string } = {},
): Json {
  return {
    id: `ck-${agentRunId}-${checkId}-${over.startedAt ?? 'latest'}`,
    runId: RUN_ID,
    agentRunId,
    projectId: PROJECT_ID,
    checkId,
    name,
    required: true,
    status,
    exitCode: status === 'passed' ? 0 : 1,
    durationMs: 14_200,
    outputTail: '',
    startedAt: T(40),
    ...over,
  };
}

const BUILD_OUTPUT = [
  '> web@0.1.0 build',
  '> tsc -p tsconfig.json && vite build',
  '',
  "src/settings/ThemeSwitch.tsx(14,7): error TS2322: Type 'string' is not assignable to type 'Theme'.",
  '',
  'Found 1 error in src/settings/ThemeSwitch.tsx:14',
].join('\n');

export const DIFF = [
  'diff --git a/src/settings/ThemeSwitch.tsx b/src/settings/ThemeSwitch.tsx',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/settings/ThemeSwitch.tsx',
  '@@ -0,0 +1,6 @@',
  "+import { useTheme } from '../theme/store';",
  '+',
  '+export function ThemeSwitch() {',
  '+  const [theme, setTheme] = useTheme();',
  '+  return <select value={theme} onChange={(e) => setTheme(e.target.value)} />;',
  '+}',
  'diff --git a/src/settings/SettingsPage.tsx b/src/settings/SettingsPage.tsx',
  '--- a/src/settings/SettingsPage.tsx',
  '+++ b/src/settings/SettingsPage.tsx',
  '@@ -8,3 +8,4 @@',
  '   <LanguageSetting />',
  '+  <ThemeSwitch />',
  ' </Section>',
  '',
].join('\n');

function agentReview(id: string, role: string, state: string, files: Json[]): Json {
  return {
    agentRunId: id,
    role,
    branch: branchOf(id),
    baseBranch: 'main',
    state,
    files,
    diff: files.length > 0 ? DIFF : '',
    diffTruncated: false,
  };
}

const UI_FILES = [
  { path: 'src/settings/ThemeSwitch.tsx', status: 'added', additions: 6, deletions: 0 },
  { path: 'src/settings/SettingsPage.tsx', status: 'modified', additions: 1, deletions: 0 },
];
const STORE_FILES = [
  { path: 'src/theme/store.ts', status: 'added', additions: 48, deletions: 0 },
  { path: 'src/theme/migrate.ts', status: 'added', additions: 22, deletions: 0 },
  { path: 'src/main.tsx', status: 'modified', additions: 3, deletions: 1 },
];
const TEST_FILES = [
  { path: 'src/theme/store.test.ts', status: 'added', additions: 61, deletions: 0 },
];

export interface TicketScenario {
  /** GET routes, path → JSON body. */
  routes: Record<string, Json | Json[]>;
}

const ticketPath = `/api/tickets/${TICKET_ID}`;
const runPath = `/api/runs/${RUN_ID}`;
/** `GET /api/projects/:id/workflow` (R-G): the project's stages, setup and skills. */
export const PROJECT_WORKFLOW_PATH = `/api/projects/${PROJECT_ID}/workflow`;
/** `GET /api/runs/:id/workflow` (R-G): the run's stage states. */
export const RUN_WORKFLOW_PATH = `${runPath}/workflow`;

// --- Redesign R-H: the live workflow (stage states), new roles, reviewer comments --------------

export const PLANNER = 'ag-planner';
export const REVIEWER = 'ag-reviewer';
export const TESTER = 'ag-tester';

type StageId = 'plan' | 'orchestrate' | 'helpers' | 'review' | 'code-review' | 'unit-tests';
type StageState = 'off' | 'waiting' | 'active' | 'needs-you' | 'done' | 'failed' | 'skipped';

/** The project's workflow as `GET /api/projects/:id/workflow` answers it. */
export function projectWorkflow(o: { separate?: boolean; postMerge?: boolean } = {}): Json {
  const stage = (over: Json = {}) => ({ model: null, skill: null, ...over });
  return {
    workflow: {
      projectId: PROJECT_ID,
      plannerMode: o.separate === true ? 'separate' : 'lead',
      stages: {
        plan: stage(o.separate === true ? { skill: 'plan-tickets' } : {}),
        orchestrate: stage(),
        helpers: stage(),
        review: { requireChecks: true },
        'code-review': stage({ enabled: o.postMerge === true, skill: 'code-review' }),
        'unit-tests': stage({ enabled: o.postMerge === true }),
      },
      // Saved before the run started, so the graph shows the run's own settings.
      updatedAt: '2026-10-14T08:00:00.000Z',
    },
    setup: {
      projectId: PROJECT_ID,
      projectKey: 'WEB',
      planFirst: true,
      maxConcurrentHelpers: 3,
      maxDepth: 2,
      defaultBudgetTokensPerAgent: 50_000,
      model: null,
      allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
      contextFiles: ['CLAUDE.md'],
      updatedAt: '2026-10-14T08:00:00.000Z',
    },
    skills: ['code-review', 'plan-tickets'],
  };
}

/** `GET /api/runs/:id/workflow`: every stage in workflow order, with its state and agents. */
export function runWorkflow(
  states: Record<StageId, StageState>,
  agents: Partial<Record<StageId, string[]>> = {},
): Json {
  const order: StageId[] = [
    'plan',
    'orchestrate',
    'helpers',
    'review',
    'code-review',
    'unit-tests',
  ];
  return {
    runId: RUN_ID,
    stages: order.map((stage) => ({
      stage,
      state: states[stage],
      agentRunIds: agents[stage] ?? [],
    })),
  };
}

function scenario(detail: Json, extra: Record<string, Json | Json[]> = {}): TicketScenario {
  return {
    routes: {
      [ticketPath]: detail,
      [runPath]: detail['currentRun'] as Json,
      '/api/control/token': { token: CSRF },
      [PROJECT_WORKFLOW_PATH]: projectWorkflow(),
      ...extra,
    },
  };
}

/** Plan review: version 2 waits for the owner; version 1 was sent back with a comment. */
export function planReviewScenario(): TicketScenario {
  const run = runDetail('PLAN_REVIEW', [lead('RUNNING', 18_400, 'Used tool: Read')]);
  return scenario(
    {
      ticket: ticket('ACTIVE', 'PLAN_REVIEW'),
      runs: [runSummary(RUN_ID, 'PLAN_REVIEW'), OLD_RUN],
      currentRun: run,
      plans: [plan(PLAN_V1, 1, 'changes-requested'), plan(PLAN_V2, 2, 'proposed')],
      comments: COMMENTS,
      checks: [],
    },
    {
      [RUN_WORKFLOW_PATH]: runWorkflow(
        {
          plan: 'needs-you',
          orchestrate: 'waiting',
          helpers: 'waiting',
          review: 'waiting',
          'code-review': 'off',
          'unit-tests': 'off',
        },
        { plan: [LEAD], orchestrate: [LEAD] },
      ),
    },
  );
}

/** Agents working: three helpers, two of them with a helper of their own; one approval waits. */
export function workingScenario(): TicketScenario {
  const agents = [
    lead('RUNNING', 42_100, 'Started a helper agent: Tests'),
    agent({
      id: UI,
      role: 'Settings UI',
      task: 'Add the theme switch to the settings page.',
      status: 'RUNNING',
      budget: { used: 12_000, limit: 50_000 },
      latestActivity: 'Used tool: Edit',
      createdAt: T(10),
    }),
    agent({
      id: STORE,
      role: 'Theme store',
      task: 'Write the theme store and remember the choice.',
      status: 'WAITING_APPROVAL',
      budget: { used: 8_200, limit: 50_000 },
      latestActivity: 'Asked to edit src/theme/store.ts',
      createdAt: T(11),
    }),
    agent({
      id: TESTS,
      role: 'Tests',
      task: 'Unit tests for the store; a component test for the switch.',
      status: 'SUCCEEDED',
      budget: { used: 22_500, limit: 50_000 },
      latestActivity: 'Finished its turn',
      review: { state: 'pending', changedFiles: 1 },
      createdAt: T(12),
      endedAt: T(28),
    }),
    agent({
      id: MIGRATION,
      parentAgentRunId: STORE,
      role: 'Migration helper',
      task: 'Move the old "darkMode" flag into the new store.',
      status: 'RUNNING',
      budget: { used: 3_100, limit: 25_000 },
      latestActivity: 'Used tool: Grep',
      // Its workspace is not set up yet: the card says "No branch yet".
      branch: null,
      createdAt: T(14),
    }),
    agent({
      id: TOKENS,
      parentAgentRunId: UI,
      role: 'CSS tokens',
      task: 'Add dark values for the color tokens.',
      status: 'SUCCEEDED',
      budget: { used: 4_800, limit: 25_000 },
      latestActivity: 'Finished its turn',
      review: { state: 'pending', changedFiles: 1 },
      // Not reported on the agent (e.g. an older server): the card falls back to the review's.
      branch: null,
      createdAt: T(15),
      endedAt: T(24),
    }),
  ];
  const run = runDetail('RUNNING', agents, {
    pendingApprovals: 1,
    approvals: [
      {
        id: 'ap-2',
        runId: RUN_ID,
        agentRunId: STORE,
        kind: 'tool-use',
        toolName: 'Edit',
        summary: 'Edit src/theme/store.ts',
        status: 'pending',
        decidedBy: null,
        requestedAt: T(29),
        decidedAt: null,
      },
      {
        id: 'ap-1',
        runId: RUN_ID,
        agentRunId: UI,
        kind: 'tool-use',
        toolName: 'Bash',
        summary: 'Run pnpm test',
        status: 'approved',
        decidedBy: 'allowlist',
        requestedAt: T(20),
        decidedAt: T(20),
      },
    ],
  });
  return scenario(
    {
      ticket: ticket('ACTIVE', 'NEEDS_YOU'),
      runs: [runSummary(RUN_ID, 'RUNNING', { agentCount: 6, pendingApprovals: 1 }), OLD_RUN],
      currentRun: run,
      plans: [plan(PLAN_V1, 1, 'changes-requested'), plan(PLAN_V2, 2, 'approved')],
      comments: COMMENTS,
      checks: [
        check(TESTS, 'test', 'Unit tests', 'passed'),
        check(TESTS, 'lint', 'Lint', 'passed', { required: false, durationMs: 4_100 }),
      ],
    },
    {
      [`${runPath}/review`]: {
        runId: RUN_ID,
        agents: [
          agentReview(TESTS, 'Tests', 'pending', TEST_FILES),
          agentReview(TOKENS, 'CSS tokens', 'pending', [
            { path: 'src/styles/tokens.css', status: 'modified', additions: 14, deletions: 2 },
          ]),
        ],
      },
      [RUN_WORKFLOW_PATH]: runWorkflow(
        {
          plan: 'done',
          orchestrate: 'active',
          helpers: 'needs-you',
          review: 'waiting',
          'code-review': 'off',
          'unit-tests': 'off',
        },
        {
          plan: [LEAD],
          orchestrate: [LEAD],
          helpers: [UI, STORE, TESTS, MIGRATION, TOKENS],
        },
      ),
    },
  );
}

/** In review: every agent stopped; the Settings UI's build check failed. */
export function inReviewScenario(): TicketScenario {
  const done = (over: Json & { id: string }) =>
    agent({ status: 'SUCCEEDED', latestActivity: 'Finished its turn', endedAt: T(38), ...over });
  const agents = [
    lead('SUCCEEDED', 51_700, 'Finished its turn'),
    done({
      id: UI,
      role: 'Settings UI',
      budget: { used: 31_000, limit: 50_000 },
      review: { state: 'pending', changedFiles: 2 },
    }),
    done({
      id: STORE,
      role: 'Theme store',
      budget: { used: 27_400, limit: 50_000 },
      review: { state: 'pending', changedFiles: 3 },
      createdAt: T(11),
    }),
    done({
      id: TESTS,
      role: 'Tests',
      budget: { used: 22_500, limit: 50_000 },
      review: { state: 'merged', changedFiles: 1 },
      createdAt: T(12),
    }),
    done({
      id: MIGRATION,
      parentAgentRunId: STORE,
      role: 'Migration helper',
      budget: { used: 9_900, limit: 25_000 },
      review: { state: 'no-changes', changedFiles: 0 },
      createdAt: T(14),
    }),
  ];
  const run = runDetail('REVIEW', agents);
  return scenario(
    {
      ticket: ticket('ACTIVE', 'IN_REVIEW'),
      runs: [runSummary(RUN_ID, 'REVIEW', { agentCount: 5 }), OLD_RUN],
      currentRun: run,
      plans: [plan(PLAN_V1, 1, 'changes-requested'), plan(PLAN_V2, 2, 'approved')],
      comments: COMMENTS,
      checks: [
        check(UI, 'test', 'Unit tests', 'passed'),
        check(UI, 'lint', 'Lint', 'passed', { required: false, durationMs: 4_100 }),
        check(UI, 'build', 'Build', 'failed', {
          exitCode: 2,
          durationMs: 21_800,
          outputTail: BUILD_OUTPUT,
        }),
        check(STORE, 'test', 'Unit tests', 'failed', { startedAt: T(39), exitCode: 1 }),
        check(STORE, 'test', 'Unit tests', 'passed', { startedAt: T(45) }),
        check(STORE, 'lint', 'Lint', 'passed', { required: false, durationMs: 3_900 }),
        check(STORE, 'build', 'Build', 'passed', { durationMs: 19_300 }),
      ],
    },
    {
      [`${runPath}/review`]: {
        runId: RUN_ID,
        agents: [
          agentReview(UI, 'Settings UI', 'pending', UI_FILES),
          agentReview(STORE, 'Theme store', 'pending', STORE_FILES),
          agentReview(TESTS, 'Tests', 'merged', TEST_FILES),
          agentReview(MIGRATION, 'Migration helper', 'no-changes', []),
        ],
      },
      [RUN_WORKFLOW_PATH]: runWorkflow(
        {
          plan: 'done',
          orchestrate: 'done',
          helpers: 'done',
          review: 'needs-you',
          'code-review': 'off',
          'unit-tests': 'off',
        },
        { plan: [LEAD], orchestrate: [LEAD], helpers: [UI, STORE, TESTS, MIGRATION] },
      ),
    },
  );
}

/** Done: the run finished and every change was reviewed; Re-run is offered. */
export function doneScenario(): TicketScenario {
  const base = inReviewScenario();
  const detail = base.routes[ticketPath] as Json;
  const run = { ...(detail['currentRun'] as Json), status: 'COMPLETED', endedAt: T(50) };
  return scenario(
    {
      ...detail,
      ticket: ticket('DONE', 'DONE'),
      runs: [runSummary(RUN_ID, 'COMPLETED', { endedAt: T(50) }), OLD_RUN],
      currentRun: run,
    },
    {
      [RUN_WORKFLOW_PATH]: runWorkflow(
        {
          plan: 'done',
          orchestrate: 'done',
          helpers: 'done',
          review: 'done',
          'code-review': 'off',
          'unit-tests': 'off',
        },
        { plan: [LEAD], orchestrate: [LEAD], helpers: [UI, STORE, TESTS, MIGRATION] },
      ),
    },
  );
}

/** The separate planner of the redesign scenarios: it planned, and ended when the plan was approved. */
function planner(): Json {
  return agent({
    id: PLANNER,
    parentAgentRunId: null,
    kind: 'planner',
    role: 'Planner',
    status: 'SUCCEEDED',
    branch: null,
    budget: { used: 16_900, limit: 200_000 },
    latestActivity: 'Finished its turn',
    createdAt: T(2),
    endedAt: T(9),
  });
}

/** Chat in separate mode: the planner's reply before approval, the lead's after (both `lead`). */
const SEPARATE_MESSAGES: Json[] = [
  {
    id: 'm-1',
    runId: RUN_ID,
    role: 'lead',
    text: 'I read the settings page and the theme code. My plan is ready for you.',
    createdAt: T(5),
  },
  {
    id: 'm-2',
    runId: RUN_ID,
    role: 'owner',
    text: 'Looks good. Keep the tests small.',
    createdAt: T(9),
  },
  {
    id: 'm-3',
    runId: RUN_ID,
    role: 'lead',
    text: 'Starting the helpers for the theme store and the settings switch now.',
    createdAt: T(11),
  },
];

/**
 * Working, with stages (redesign): a separate planner that finished, the lead running two
 * helpers, and the reviewer and tester stages on, waiting for the merge.
 */
export function stagesScenario(): TicketScenario {
  const agents = [
    planner(),
    { ...lead('RUNNING', 30_200, 'Started a helper agent: Theme store'), createdAt: T(2) },
    agent({
      id: UI,
      role: 'Settings UI',
      task: 'Add the theme switch to the settings page.',
      status: 'RUNNING',
      budget: { used: 14_000, limit: 50_000 },
      latestActivity: 'Used tool: Edit',
      createdAt: T(10),
    }),
    agent({
      id: STORE,
      role: 'Theme store',
      task: 'Write the theme store and remember the choice.',
      status: 'RUNNING',
      budget: { used: 9_400, limit: 50_000 },
      latestActivity: 'Used tool: Write',
      createdAt: T(11),
    }),
  ];
  const run = runDetail('RUNNING', agents, { messages: SEPARATE_MESSAGES });
  return scenario(
    {
      ticket: ticket('ACTIVE', 'WORKING'),
      runs: [runSummary(RUN_ID, 'RUNNING', { agentCount: 4 }), OLD_RUN],
      currentRun: run,
      plans: [plan(PLAN_V1, 1, 'changes-requested'), plan(PLAN_V2, 2, 'approved')],
      comments: COMMENTS,
      checks: [],
    },
    {
      [PROJECT_WORKFLOW_PATH]: projectWorkflow({ separate: true, postMerge: true }),
      [RUN_WORKFLOW_PATH]: runWorkflow(
        {
          plan: 'done',
          orchestrate: 'active',
          helpers: 'active',
          review: 'waiting',
          'code-review': 'waiting',
          'unit-tests': 'waiting',
        },
        { plan: [PLANNER], orchestrate: [LEAD], helpers: [UI, STORE] },
      ),
    },
  );
}

/**
 * Plan review with a separate planner (R-R visual): the planner wrote plan 2 and holds the chat;
 * the lead waits (QUEUED) until the plan is approved.
 */
export function plannerReviewScenario(): TicketScenario {
  const agents = [
    { ...planner(), status: 'RUNNING', endedAt: null, latestActivity: 'Used tool: Read' },
    { ...lead('QUEUED', 0, 'Used tool: Read'), latestActivity: null },
  ];
  const run = runDetail('PLAN_REVIEW', agents);
  return scenario(
    {
      ticket: ticket('ACTIVE', 'PLAN_REVIEW'),
      runs: [runSummary(RUN_ID, 'PLAN_REVIEW', { agentCount: 2 }), OLD_RUN],
      currentRun: run,
      plans: [plan(PLAN_V1, 1, 'changes-requested'), plan(PLAN_V2, 2, 'proposed')],
      comments: COMMENTS,
      checks: [],
    },
    {
      [PROJECT_WORKFLOW_PATH]: projectWorkflow({ separate: true }),
      [RUN_WORKFLOW_PATH]: runWorkflow(
        {
          plan: 'needs-you',
          orchestrate: 'waiting',
          helpers: 'waiting',
          review: 'waiting',
          'code-review': 'off',
          'unit-tests': 'off',
        },
        { plan: [PLANNER], orchestrate: [LEAD] },
      ),
    },
  );
}

const REVIEWER_COMMENT: Json = {
  id: 'c-r1',
  ticketId: TICKET_ID,
  runId: RUN_ID,
  planId: null,
  author: 'reviewer',
  body: 'ThemeSwitch reads the store on every render; a selector would avoid re-renders. The migration keeps the old "darkMode" key; remove it once read.',
  createdAt: T(47),
};

/** The helpers' merged work after the post-merge stages (redesign): agents and their reviews. */
function mergedAgents(): Json[] {
  const done = (over: Json & { id: string }) =>
    agent({ status: 'SUCCEEDED', latestActivity: 'Finished its turn', endedAt: T(38), ...over });
  return [
    planner(),
    // The engine closes the lead in the step that starts the reviewer (createdAt T(45)).
    { ...lead('CANCELLED', 41_800, 'Finished its turn'), endedAt: T(45) },
    done({
      id: UI,
      role: 'Settings UI',
      budget: { used: 31_000, limit: 50_000 },
      review: { state: 'merged', changedFiles: 2 },
    }),
    done({
      id: STORE,
      role: 'Theme store',
      budget: { used: 27_400, limit: 50_000 },
      review: { state: 'merged', changedFiles: 3 },
      createdAt: T(11),
    }),
  ];
}

const MERGED_REVIEWS = [
  agentReview(UI, 'Settings UI', 'merged', UI_FILES),
  agentReview(STORE, 'Theme store', 'merged', STORE_FILES),
];

/**
 * In review with stages (redesign): the reviewer posted its findings as a ticket comment, and the
 * tester's unit tests wait for review and merge.
 */
export function reviewedScenario(): TicketScenario {
  const agents = [
    ...mergedAgents(),
    agent({
      id: REVIEWER,
      parentAgentRunId: null,
      kind: 'reviewer',
      role: 'Reviewer',
      status: 'SUCCEEDED',
      branch: null,
      budget: { used: 12_300, limit: 50_000 },
      latestActivity: 'Finished its turn',
      createdAt: T(45),
      endedAt: T(47),
    }),
    agent({
      id: TESTER,
      parentAgentRunId: null,
      kind: 'tester',
      role: 'Tester',
      status: 'SUCCEEDED',
      budget: { used: 19_600, limit: 50_000 },
      latestActivity: 'Finished its turn',
      review: { state: 'pending', changedFiles: 1 },
      createdAt: T(48),
      endedAt: T(55),
    }),
  ];
  const run = runDetail('REVIEW', agents, { messages: SEPARATE_MESSAGES });
  return scenario(
    {
      ticket: ticket('ACTIVE', 'IN_REVIEW'),
      runs: [runSummary(RUN_ID, 'REVIEW', { agentCount: agents.length }), OLD_RUN],
      currentRun: run,
      plans: [plan(PLAN_V1, 1, 'changes-requested'), plan(PLAN_V2, 2, 'approved')],
      comments: [...COMMENTS, REVIEWER_COMMENT],
      checks: [
        check(TESTER, 'test', 'Unit tests', 'passed', { startedAt: T(56) }),
        check(TESTER, 'lint', 'Lint', 'passed', { required: false, startedAt: T(56) }),
      ],
    },
    {
      [`${runPath}/review`]: {
        runId: RUN_ID,
        agents: [...MERGED_REVIEWS, agentReview(TESTER, 'Tester', 'pending', TEST_FILES)],
      },
      [PROJECT_WORKFLOW_PATH]: projectWorkflow({ separate: true, postMerge: true }),
      [RUN_WORKFLOW_PATH]: runWorkflow(
        {
          plan: 'done',
          orchestrate: 'done',
          helpers: 'done',
          review: 'done',
          'code-review': 'done',
          'unit-tests': 'needs-you',
        },
        {
          plan: [PLANNER],
          orchestrate: [LEAD],
          helpers: [UI, STORE],
          'code-review': [REVIEWER],
          'unit-tests': [TESTER],
        },
      ),
    },
  );
}

/**
 * A held stage (redesign): the app restarted while the reviewer worked. The reviewer is
 * interrupted, and the final code review waits for the owner's Continue.
 */
export function heldScenario(): TicketScenario {
  const agents = [
    ...mergedAgents(),
    agent({
      id: REVIEWER,
      parentAgentRunId: null,
      kind: 'reviewer',
      role: 'Reviewer',
      status: 'NEEDS_REVIEW',
      branch: null,
      budget: { used: 4_100, limit: 50_000 },
      latestActivity: 'Used tool: Read',
      createdAt: T(45),
      endedAt: T(46),
    }),
  ];
  const run = runDetail('REVIEW', agents, { messages: SEPARATE_MESSAGES });
  return scenario(
    {
      ticket: ticket('ACTIVE', 'IN_REVIEW'),
      runs: [runSummary(RUN_ID, 'REVIEW', { agentCount: agents.length }), OLD_RUN],
      currentRun: run,
      plans: [plan(PLAN_V1, 1, 'changes-requested'), plan(PLAN_V2, 2, 'approved')],
      comments: COMMENTS,
      checks: [],
    },
    {
      [`${runPath}/review`]: { runId: RUN_ID, agents: MERGED_REVIEWS },
      [PROJECT_WORKFLOW_PATH]: projectWorkflow({ separate: true, postMerge: true }),
      [RUN_WORKFLOW_PATH]: runWorkflow(
        {
          plan: 'done',
          orchestrate: 'done',
          helpers: 'done',
          review: 'done',
          'code-review': 'needs-you',
          'unit-tests': 'waiting',
        },
        {
          plan: [PLANNER],
          orchestrate: [LEAD],
          helpers: [UI, STORE],
          'code-review': [REVIEWER],
        },
      ),
    },
  );
}

// --- Redesign R-J: the lead's chat after the lead ends (ADR-0020) ------------------------------

/** `RunDetailDto.followUp`: absent while the lead is live; present once it ended. */
export interface FollowUpFixture {
  state: 'available' | 'running' | 'unavailable';
  reason: 'no-session' | 'session-gone' | 'managed-off' | null;
}

/** The lead's last message of the run itself, before it ended. */
const LEAD_DONE_MESSAGE: Json = {
  id: 'm-2',
  runId: RUN_ID,
  role: 'lead',
  text: 'Every change is merged. The theme switch and its store are on the main branch.',
  createdAt: T(47),
};

/** One follow-up turn after the run: the owner asks, the resumed lead answers. */
export const FOLLOW_UP_MESSAGES: Json[] = [
  {
    id: 'm-f1',
    runId: RUN_ID,
    role: 'owner',
    text: 'Why does the migration keep the old darkMode key?',
    createdAt: T(70),
    followUp: true,
  },
  {
    id: 'm-f2',
    runId: RUN_ID,
    role: 'lead',
    text: 'It reads darkMode once to pick the starting theme, so nobody loses their choice. It can go after one release.',
    createdAt: T(71),
    followUp: true,
  },
];

/** A follow-up message the owner sends in a test, as the chat route answers it. */
export function followUpOwnerMessage(text: string): Json {
  return { id: 'm-f9', runId: RUN_ID, role: 'owner', text, createdAt: T(80), followUp: true };
}

/** The resumed lead's answer to `followUpOwnerMessage`. */
export function followUpLeadAnswer(): Json {
  return {
    id: 'm-f10',
    runId: RUN_ID,
    role: 'lead',
    text: 'The store is in src/theme/store.ts; the switch reads it through useTheme().',
    createdAt: T(81),
    followUp: true,
  };
}

/**
 * Done, and the lead has ended (redesign R-J): the run completed with every change merged, so the
 * server reports the chat's follow-up state. `followUp: null` leaves it out, as for a live lead.
 * `messages` are added after the run's own chat.
 */
export function followUpScenario(
  followUp: FollowUpFixture | null,
  o: { messages?: Json[] } = {},
): TicketScenario {
  const detail = doneScenario().routes[ticketPath] as Json;
  const current = detail['currentRun'] as Json;
  const agents = (current['agents'] as Json[]).map((a) => {
    const review = a['review'] as Json | null;
    return {
      ...a,
      ...(a['id'] === LEAD ? { endedAt: T(48) } : {}),
      ...(review !== null && review['state'] === 'pending'
        ? { review: { ...review, state: 'merged' } }
        : {}),
    };
  });
  const run: Json = {
    ...current,
    agents,
    messages: [...(current['messages'] as Json[]), LEAD_DONE_MESSAGE, ...(o.messages ?? [])],
    ...(followUp === null ? {} : { followUp }),
  };
  return scenario(
    { ...detail, currentRun: run },
    {
      [`${runPath}/review`]: {
        runId: RUN_ID,
        agents: [
          agentReview(UI, 'Settings UI', 'merged', UI_FILES),
          agentReview(STORE, 'Theme store', 'merged', STORE_FILES),
          agentReview(TESTS, 'Tests', 'merged', TEST_FILES),
          agentReview(MIGRATION, 'Migration helper', 'no-changes', []),
        ],
      },
      [RUN_WORKFLOW_PATH]: runWorkflow(
        {
          plan: 'done',
          orchestrate: 'done',
          helpers: 'done',
          review: 'done',
          'code-review': 'off',
          'unit-tests': 'off',
        },
        { plan: [LEAD], orchestrate: [LEAD], helpers: [UI, STORE, TESTS, MIGRATION] },
      ),
    },
  );
}
