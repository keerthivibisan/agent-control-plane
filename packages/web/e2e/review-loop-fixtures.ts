/*
 * Synthetic, test-only responses for the review loop (RL-D, ADR-0021): a ticket run whose two
 * helpers' changes go through review, rework and the lead's decisions, then the owner's one merge
 * of the ticket branch. Plain JSON, so the vitest suite (which parses each with its @acp/core/api
 * schema) and the Playwright spec (review-loop.spec.ts, page.route) share them. Roles, tasks,
 * findings, paths, commits and the diff are invented. Never import this from src/.
 */

import { CSRF, PROJECT_ID, projectWorkflow } from './ticket-fixtures.js';

export { CSRF, PROJECT_ID };
export const LOOP_TICKET_ID = 't-21';
export const LOOP_RUN_ID = 'run-21';
export const LOOP_KEY = 'WEB-21';
export const LOOP_BRANCH = 'acp/WEB-21';

export const L_LEAD = 'ag-lead-21';
export const L_API = 'ag-api';
export const L_UI = 'ag-search-ui';
export const L_REV1 = 'ag-rev-1';
export const L_REV2 = 'ag-rev-2';
export const L_REV3 = 'ag-rev-3';

type Json = Record<string, unknown>;

const T = (min: number) => new Date(Date.UTC(2026, 9, 17, 9, min)).toISOString();

export const LOOP_TICKET_PATH = `/api/tickets/${LOOP_TICKET_ID}`;
export const LOOP_RUN_PATH = `/api/runs/${LOOP_RUN_ID}`;
export const LOOP_RUN_WORKFLOW_PATH = `${LOOP_RUN_PATH}/workflow`;
export const LOOP_REVIEW_PATH = `${LOOP_RUN_PATH}/review`;
export const LOOP_BRANCH_PATH = `${LOOP_RUN_PATH}/ticket-branch`;
export const LOOP_PROJECT_WORKFLOW_PATH = `/api/projects/${PROJECT_ID}/workflow`;

const BASE = '3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345';
const TIP_1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const API_R0 = 'b7e2d91c4a5f60718293a4b5c6d7e8f901234567';
const API_R1 = 'c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7';
const UI_R0 = 'd9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0';
const MERGED = 'e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4';

function agent(over: Json & { id: string }): Json {
  return {
    runId: LOOP_RUN_ID,
    parentAgentRunId: L_LEAD,
    kind: 'worker',
    role: 'Helper',
    task: null,
    status: 'RUNNING',
    sessionId: null,
    budget: { used: 0, limit: 60_000 },
    latestActivity: null,
    review: null,
    branch: `acp/${LOOP_RUN_ID}/${over.id}`,
    createdAt: T(10),
    endedAt: null,
    ...over,
  };
}

function lead(status: string, latestActivity: string, over: Json = {}): Json {
  return agent({
    id: L_LEAD,
    parentAgentRunId: null,
    kind: 'lead',
    role: 'Lead',
    status,
    branch: null,
    budget: { used: 61_300, limit: 200_000 },
    // The raw control-tool name, as the server still reports it: the UI words it (ADR-0021 fix 4).
    latestActivity,
    createdAt: T(2),
    ...over,
  });
}

function api(status: string, latestActivity: string, over: Json = {}): Json {
  return agent({
    id: L_API,
    role: 'API builder',
    task: 'Add GET /api/search with paging, and store saved searches per user.',
    status,
    budget: { used: 38_200, limit: 60_000 },
    latestActivity,
    ...over,
  });
}

function ui(status: string, latestActivity: string, over: Json = {}): Json {
  return agent({
    id: L_UI,
    role: 'Search UI',
    task: 'Add the search box and the saved-searches list to the sidebar.',
    status,
    budget: { used: 29_900, limit: 60_000 },
    latestActivity,
    createdAt: T(11),
    ...over,
  });
}

function reviewer(id: string, status: string, createdAt: string, endedAt: string | null): Json {
  return agent({
    id,
    kind: 'reviewer',
    role: 'Change reviewer',
    status,
    branch: null,
    budget: { used: 8_400, limit: 40_000 },
    latestActivity: status === 'RUNNING' ? 'Used tool: Read' : 'Used tool: mcp__acp__submit_review',
    createdAt,
    endedAt,
  });
}

function check(
  agentRunId: string | null,
  checkId: string,
  name: string,
  status: string,
  commit: string,
  over: Json = {},
): Json {
  return {
    id: `ck-${agentRunId ?? 'tip'}-${checkId}-${commit.slice(0, 7)}`,
    runId: LOOP_RUN_ID,
    agentRunId,
    projectId: PROJECT_ID,
    checkId,
    name,
    required: true,
    status,
    exitCode: status === 'passed' ? 0 : 1,
    durationMs: 12_400,
    outputTail: '',
    startedAt: T(30),
    commit,
    ...over,
  };
}

function round(over: Json & { id: string; round: number }): Json {
  return {
    reviewer: 'agent',
    reviewerAgentRunId: null,
    verdict: null,
    decision: null,
    decidedBy: null,
    commentId: null,
    createdAt: T(20),
    decidedAt: null,
    ...over,
  };
}

const API_ROUND_0 = round({
  id: 'cr-api-0',
  round: 0,
  reviewerAgentRunId: L_REV1,
  verdict: 'rework',
  decision: 'rework',
  decidedBy: 'lead',
  commentId: 'c-find-1',
  createdAt: T(20),
  decidedAt: T(22),
});
const API_ROUND_1 = round({
  id: 'cr-api-1',
  round: 1,
  reviewerAgentRunId: L_REV3,
  verdict: 'approve',
  decision: 'merge',
  decidedBy: 'lead',
  commentId: 'c-find-3',
  createdAt: T(34),
  decidedAt: T(36),
});
const UI_ROUND_0_OPEN = round({
  id: 'cr-ui-0',
  round: 0,
  reviewerAgentRunId: L_REV2,
  createdAt: T(24),
});
const UI_ROUND_0_ASKED = {
  ...UI_ROUND_0_OPEN,
  verdict: 'rework',
  decision: 'ask-owner',
  decidedBy: 'lead',
  commentId: 'c-find-2',
  decidedAt: T(38),
};
const UI_ROUND_0_DISCARDED = { ...UI_ROUND_0_ASKED, decision: 'discard', decidedBy: 'owner' };

const API_CHECKS_R0 = [
  check(L_API, 'test', 'Unit tests', 'failed', API_R0, { startedAt: T(19), exitCode: 1 }),
  check(L_API, 'build', 'Build', 'passed', API_R0, { startedAt: T(19) }),
];
const API_CHECKS_R1 = [
  check(L_API, 'test', 'Unit tests', 'passed', API_R1, { startedAt: T(33) }),
  check(L_API, 'build', 'Build', 'passed', API_R1, { startedAt: T(33) }),
];
const UI_CHECKS = [
  check(L_UI, 'test', 'Unit tests', 'passed', UI_R0, { startedAt: T(23) }),
  check(L_UI, 'build', 'Build', 'passed', UI_R0, { startedAt: T(23) }),
];

function change(over: Json & { agentRunId: string; role: string; state: string }): Json {
  return {
    reworkRounds: 0,
    maxReworkRounds: 2,
    headCommit: null,
    changedFiles: null,
    conflictFiles: [],
    checks: [],
    reviews: [],
    ...over,
  };
}

function ticketBranch(state: string, over: Json = {}): Json {
  return {
    runId: LOOP_RUN_ID,
    branch: LOOP_BRANCH,
    baseBranch: 'main',
    baseCommit: BASE,
    headCommit: TIP_1,
    state,
    mergedCommit: null,
    createdAt: T(8),
    updatedAt: T(36),
    ...over,
  };
}

const COMMENTS: Json[] = [
  {
    id: 'c-find-1',
    ticketId: LOOP_TICKET_ID,
    runId: LOOP_RUN_ID,
    planId: null,
    author: 'reviewer',
    body: 'GET /api/search has no upper limit on the page size, so one request can read every row. Cap pageSize at 100 and add a test for the cap. The unit tests fail on the empty-query case too.',
    createdAt: T(21),
  },
  {
    id: 'c-find-2',
    ticketId: LOOP_TICKET_ID,
    runId: LOOP_RUN_ID,
    planId: null,
    author: 'reviewer',
    body: 'The search box re-renders the whole saved-searches list on every key press. Debounce the query (about 200 ms). It also changes src/search/api.ts, which the API builder owns.',
    createdAt: T(25),
  },
  {
    id: 'c-find-3',
    ticketId: LOOP_TICKET_ID,
    runId: LOOP_RUN_ID,
    planId: null,
    author: 'reviewer',
    body: 'The cap is in place and tested. Looks good to merge.',
    createdAt: T(35),
  },
];

function ticket(status: string, stage: string): Json {
  return {
    id: LOOP_TICKET_ID,
    projectId: PROJECT_ID,
    key: LOOP_KEY,
    title: 'Saved searches',
    description: 'Let people search tickets and save a search to the sidebar.',
    type: 'feature',
    priority: 'medium',
    labels: ['search'],
    currentRunId: LOOP_RUN_ID,
    createdAt: T(0),
    updatedAt: T(1),
    status,
    stage,
  };
}

function runDetail(status: string, agents: Json[], over: Json): Json {
  return {
    id: LOOP_RUN_ID,
    projectId: PROJECT_ID,
    ticketId: LOOP_TICKET_ID,
    title: `${LOOP_KEY} Saved searches`,
    status,
    agentCount: agents.length,
    pendingApprovals: 0,
    createdAt: T(2),
    updatedAt: T(40),
    endedAt: null,
    budget: { maxTokensPerAgent: 60_000, softCostUsdPerRun: null },
    agents,
    approvals: [
      {
        id: 'ap-1',
        runId: LOOP_RUN_ID,
        agentRunId: L_API,
        kind: 'tool-use',
        toolName: 'Edit',
        summary: 'Edit src/search/api.ts',
        status: 'approved',
        decidedBy: 'allowlist',
        allowRule: 'edit-in-own-worktree',
        requestedAt: T(12),
        decidedAt: T(12),
      },
      {
        id: 'ap-2',
        runId: LOOP_RUN_ID,
        agentRunId: L_API,
        kind: 'tool-use',
        toolName: 'Bash',
        summary: 'Run pnpm test',
        status: 'approved',
        decidedBy: 'allowlist',
        allowRule: 'run-harness-check',
        requestedAt: T(18),
        decidedAt: T(18),
      },
    ],
    messages: [
      {
        id: 'm-21',
        runId: LOOP_RUN_ID,
        role: 'lead',
        text: 'Two helpers are on it: the API builder and the search UI. A review agent reads each change before I merge it into acp/WEB-21.',
        createdAt: T(9),
      },
    ],
    approvalMode: 'auto-edits',
    ...over,
  };
}

function runSummary(status: string, agentCount: number): Json {
  return {
    id: LOOP_RUN_ID,
    projectId: PROJECT_ID,
    ticketId: LOOP_TICKET_ID,
    title: `${LOOP_KEY} Saved searches`,
    status,
    agentCount,
    pendingApprovals: 0,
    createdAt: T(2),
    updatedAt: T(40),
    endedAt: status === 'COMPLETED' ? T(50) : null,
  };
}

const stageIds = ['plan', 'orchestrate', 'helpers', 'review', 'code-review', 'unit-tests'];

function runWorkflow(states: string[], review: Json, ids: Partial<Record<string, string[]>>): Json {
  return {
    runId: LOOP_RUN_ID,
    stages: stageIds.map((stage, i) => ({
      stage,
      state: states[i],
      agentRunIds: ids[stage] ?? [],
    })),
    review,
  };
}

const counts = (over: Json): Json => ({
  waiting: 0,
  inReview: 0,
  rework: 0,
  needsOwner: 0,
  merged: 0,
  discarded: 0,
  noChanges: 0,
  reworkRounds: 0,
  ...over,
});

export const API_FILES = [
  { path: 'src/search/api.ts', status: 'added', additions: 64, deletions: 0 },
  { path: 'src/search/api.test.ts', status: 'added', additions: 41, deletions: 0 },
  { path: 'src/server/routes.ts', status: 'modified', additions: 2, deletions: 0 },
];
const UI_FILES = [
  { path: 'src/search/SearchBox.tsx', status: 'added', additions: 52, deletions: 0 },
  { path: 'src/search/api.ts', status: 'modified', additions: 6, deletions: 2 },
];

export const LOOP_DIFF = [
  'diff --git a/src/search/api.ts b/src/search/api.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/search/api.ts',
  '@@ -0,0 +1,8 @@',
  "+import { z } from 'zod';",
  '+',
  '+export const MAX_PAGE_SIZE = 100;',
  '+export const SearchQuery = z.object({',
  '+  q: z.string().trim().min(1),',
  '+  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20),',
  '+});',
  '+',
  'diff --git a/src/server/routes.ts b/src/server/routes.ts',
  '--- a/src/server/routes.ts',
  '+++ b/src/server/routes.ts',
  '@@ -12,3 +12,5 @@',
  "   app.get('/api/tickets', listTickets);",
  "+  app.get('/api/search', searchTickets);",
  "+  app.post('/api/searches', saveSearch);",
  ' }',
  '',
].join('\n');

function review(entries: [string, string, Json[]][]): Json {
  return {
    runId: LOOP_RUN_ID,
    agents: entries.map(([id, role, files]) => ({
      agentRunId: id,
      role,
      branch: `acp/${LOOP_RUN_ID}/${id}`,
      baseBranch: LOOP_BRANCH,
      state: 'pending',
      files,
      diff: files.length > 0 ? LOOP_DIFF : '',
      diffTruncated: false,
    })),
  };
}

export interface LoopScenario {
  routes: Record<string, Json | Json[]>;
}

function scenario(
  detail: Json,
  workflow: Json,
  extra: Record<string, Json | Json[]> = {},
): LoopScenario {
  return {
    routes: {
      [LOOP_TICKET_PATH]: detail,
      [LOOP_RUN_PATH]: detail['currentRun'] as Json,
      [LOOP_RUN_WORKFLOW_PATH]: workflow,
      [LOOP_PROJECT_WORKFLOW_PATH]: projectWorkflow(),
      [LOOP_REVIEW_PATH]: review([
        [L_API, 'API builder', API_FILES],
        [L_UI, 'Search UI', UI_FILES],
      ]),
      '/api/control/token': { token: CSRF },
      ...extra,
    },
  };
}

/**
 * Working: the API builder reworks its change (round 1 of 2) after the review agent's findings;
 * the Search UI's change is being reviewed. The ticket branch is open.
 */
export function loopWorkingScenario(): LoopScenario {
  const agents = [
    lead('RUNNING', 'Used tool: mcp__acp__request_rework'),
    api('RUNNING', 'Used tool: Edit'),
    ui('AWAITING_REVIEW', 'Finished its turn'),
    reviewer(L_REV1, 'SUCCEEDED', T(20), T(21)),
    reviewer(L_REV2, 'RUNNING', T(24), null),
  ];
  const run = runDetail('RUNNING', agents, {
    ticketBranch: ticketBranch('open', { headCommit: BASE }),
    changes: [
      change({
        agentRunId: L_API,
        role: 'API builder',
        state: 'rework',
        reworkRounds: 1,
        headCommit: API_R0,
        changedFiles: 3,
        checks: API_CHECKS_R0,
        reviews: [API_ROUND_0],
      }),
      change({
        agentRunId: L_UI,
        role: 'Search UI',
        state: 'reviewing',
        headCommit: UI_R0,
        changedFiles: 2,
        checks: UI_CHECKS,
        reviews: [UI_ROUND_0_OPEN],
      }),
    ],
  });
  return scenario(
    {
      ticket: ticket('ACTIVE', 'WORKING'),
      runs: [runSummary('RUNNING', agents.length)],
      currentRun: run,
      plans: [],
      comments: COMMENTS.slice(0, 2),
      checks: [...API_CHECKS_R0, ...UI_CHECKS],
    },
    runWorkflow(
      ['done', 'active', 'active', 'active', 'off', 'off'],
      counts({ inReview: 1, rework: 1, reworkRounds: 1 }),
      { plan: [L_LEAD], orchestrate: [L_LEAD], helpers: [L_API, L_UI], review: [L_REV1, L_REV2] },
    ),
  );
}

/**
 * Needs you: the API builder's reworked change is merged into the ticket branch; the lead asked
 * the owner about the Search UI's change, which conflicts with it.
 */
export function loopNeedsYouScenario(): LoopScenario {
  const agents = [
    lead('RUNNING', 'Used tool: mcp__acp__ask_owner'),
    api('SUCCEEDED', 'Finished its turn', { endedAt: T(36) }),
    ui('AWAITING_REVIEW', 'Finished its turn'),
    reviewer(L_REV1, 'SUCCEEDED', T(20), T(21)),
    reviewer(L_REV2, 'SUCCEEDED', T(24), T(25)),
    reviewer(L_REV3, 'SUCCEEDED', T(34), T(35)),
  ];
  const run = runDetail('RUNNING', agents, {
    ticketBranch: ticketBranch('open'),
    changes: [
      change({
        agentRunId: L_API,
        role: 'API builder',
        state: 'merged',
        reworkRounds: 1,
        headCommit: API_R1,
        changedFiles: 3,
        checks: API_CHECKS_R1,
        reviews: [API_ROUND_0, API_ROUND_1],
      }),
      change({
        agentRunId: L_UI,
        role: 'Search UI',
        state: 'needs-owner',
        headCommit: UI_R0,
        changedFiles: 2,
        conflictFiles: ['src/search/api.ts'],
        checks: UI_CHECKS,
        reviews: [UI_ROUND_0_ASKED],
      }),
    ],
  });
  return scenario(
    {
      ticket: ticket('ACTIVE', 'NEEDS_YOU'),
      runs: [runSummary('RUNNING', agents.length)],
      currentRun: run,
      plans: [],
      comments: COMMENTS,
      checks: [...API_CHECKS_R1, ...UI_CHECKS],
    },
    runWorkflow(
      ['done', 'active', 'done', 'needs-you', 'off', 'off'],
      counts({ needsOwner: 1, merged: 1, reworkRounds: 1 }),
      {
        plan: [L_LEAD],
        orchestrate: [L_LEAD],
        helpers: [L_API, L_UI],
        review: [L_REV1, L_REV2, L_REV3],
      },
    ),
  );
}

/** The ticket branch's combined change, `GET /runs/:id/ticket-branch`. */
export function ticketBranchReview(o: { failing?: boolean; baseMoved?: boolean } = {}): Json {
  return {
    runId: LOOP_RUN_ID,
    ticketBranch: ticketBranch('open'),
    files: API_FILES,
    diff: LOOP_DIFF,
    diffTruncated: false,
    checks: [
      check(null, 'test', 'Unit tests', o.failing === true ? 'failed' : 'passed', TIP_1, {
        startedAt: T(40),
        ...(o.failing === true
          ? { outputTail: 'FAIL src/search/api.test.ts > caps the page size' }
          : {}),
      }),
      check(null, 'build', 'Build', 'passed', TIP_1, { startedAt: T(40) }),
    ],
    baseMoved: o.baseMoved === true,
  };
}

/**
 * Ready for your merge: the Search UI's change was discarded, the API builder's is on the ticket
 * branch, and the run waits for the owner's one merge into main.
 */
export function loopReviewScenario(
  o: { failing?: boolean; baseMoved?: boolean } = {},
): LoopScenario {
  const agents = [
    lead('RUNNING', 'Used tool: mcp__acp__request_review'),
    api('SUCCEEDED', 'Finished its turn', { endedAt: T(36) }),
    ui('CANCELLED', 'Finished its turn', { endedAt: T(41) }),
    reviewer(L_REV1, 'SUCCEEDED', T(20), T(21)),
    reviewer(L_REV2, 'SUCCEEDED', T(24), T(25)),
    reviewer(L_REV3, 'SUCCEEDED', T(34), T(35)),
  ];
  const run = runDetail('REVIEW', agents, {
    ticketBranch: ticketBranch('open'),
    changes: [
      change({
        agentRunId: L_API,
        role: 'API builder',
        state: 'merged',
        reworkRounds: 1,
        headCommit: API_R1,
        changedFiles: 3,
        checks: API_CHECKS_R1,
        reviews: [API_ROUND_0, API_ROUND_1],
      }),
      change({
        agentRunId: L_UI,
        role: 'Search UI',
        state: 'discarded',
        headCommit: UI_R0,
        changedFiles: 2,
        checks: UI_CHECKS,
        reviews: [UI_ROUND_0_DISCARDED],
      }),
    ],
  });
  return scenario(
    {
      ticket: ticket('ACTIVE', 'IN_REVIEW'),
      runs: [runSummary('REVIEW', agents.length)],
      currentRun: run,
      plans: [],
      comments: COMMENTS,
      checks: [...API_CHECKS_R1, ...UI_CHECKS],
    },
    runWorkflow(
      ['done', 'done', 'done', 'done', 'off', 'off'],
      counts({ merged: 1, discarded: 1, reworkRounds: 1 }),
      {
        plan: [L_LEAD],
        orchestrate: [L_LEAD],
        helpers: [L_API, L_UI],
        review: [L_REV1, L_REV2, L_REV3],
      },
    ),
    { [LOOP_BRANCH_PATH]: ticketBranchReview(o) },
  );
}

/** Done: the owner merged the ticket branch into main. */
export function loopDoneScenario(): LoopScenario {
  const sc = loopReviewScenario();
  const detail = sc.routes[LOOP_TICKET_PATH] as Json;
  const run = detail['currentRun'] as Json;
  const agents = (run['agents'] as Json[]).map((a) =>
    a['id'] === L_LEAD ? { ...a, status: 'CANCELLED', endedAt: T(50) } : a,
  );
  const done = {
    ...run,
    status: 'COMPLETED',
    endedAt: T(50),
    agents,
    ticketBranch: ticketBranch('merged', { mergedCommit: MERGED, updatedAt: T(50) }),
  };
  return scenario(
    {
      ...detail,
      ticket: ticket('DONE', 'DONE'),
      runs: [runSummary('COMPLETED', agents.length)],
      currentRun: done,
    },
    sc.routes[LOOP_RUN_WORKFLOW_PATH] as Json,
  );
}
