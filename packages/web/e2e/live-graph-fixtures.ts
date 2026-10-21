/*
 * Synthetic, test-only responses for the ticket page's live run graph (WG-E, ADR-0023): the
 * review-loop ticket of review-loop-fixtures.ts, run on a drawn workflow where a review agent
 * sends changes straight back to the helpers (scenario c, "direct" rework) and the lead merges.
 * A named "API helper" set to Full auto runs as Auto edits in this run (the ticket's limit) and
 * keeps the sandbox. Plain JSON, so the vitest suite (which parses each with its @acp/core/api
 * schema) and the Playwright specs (page.route) share them. Names, roles and findings are
 * invented. Never import this from src/.
 */

import {
  L_API,
  L_LEAD,
  L_REV1,
  L_REV2,
  L_UI,
  LOOP_RUN_ID,
  LOOP_RUN_PATH,
  LOOP_TICKET_PATH,
  loopWorkingScenario,
  type LoopScenario,
} from './review-loop-fixtures.js';
import { PROJECT_GRAPH_PATH, projectWorkflow } from './ticket-fixtures.js';

type Json = Record<string, unknown>;

export const LIVE_GRAPH_PATH = `${LOOP_RUN_PATH}/workflow-graph`;
export { PROJECT_GRAPH_PATH };

const agentConfig = (over: Json = {}): Json => ({ model: null, skills: [], agent: null, ...over });
const flow = (from: string, to: string): Json => ({
  type: 'flow',
  id: `flow-${from}-${to}`,
  from,
  to,
});
const link = (type: string, from: string, to: string, over: Json = {}): Json => ({
  type,
  id: `${type}-${from}-${to}`,
  from,
  to,
  ...over,
});

/**
 * The drawn workflow: the lead plans; an "API helper" (Full auto) and the helper pool
 * (project default) send their changes to a change reviewer, which reworks them directly (up to
 * 2 rounds) and passes its findings to the lead; the lead may send a pool change back once more;
 * a final code reviewer reads the merged ticket branch before your merge.
 */
export function directLoopGraph(): Json {
  return {
    version: 2,
    template: 'custom',
    nodes: [
      { type: 'ticket', id: 'ticket', label: 'Ticket' },
      { type: 'lead', id: 'orchestrate', label: 'Lead', ...agentConfig() },
      { type: 'plan-approval', id: 'plan-approval', label: 'Plan approval', auto: false },
      {
        type: 'helper',
        id: 'api-helper',
        label: 'API helper',
        ...agentConfig({ skills: ['api-design'], model: 'claude-sonnet-4-5' }),
        approvalMode: 'full-auto',
        description: 'Server routes and the search API.',
        maxInstances: 1,
        canStartHelpers: false,
      },
      {
        type: 'helper-pool',
        id: 'helpers',
        label: 'Helpers',
        ...agentConfig(),
        approvalMode: null,
        canStartHelpers: false,
      },
      {
        type: 'reviewer',
        id: 'review',
        label: 'Change reviewer',
        scope: 'change',
        ...agentConfig({ skills: ['code-review'] }),
      },
      { type: 'checks', id: 'checks', label: 'Checks' },
      { type: 'ticket-merge', id: 'ticket-merge', label: 'Ticket branch' },
      {
        type: 'reviewer',
        id: 'code-review',
        label: 'Code reviewer',
        scope: 'final',
        ...agentConfig({ skills: ['code-review'] }),
      },
      { type: 'owner-merge', id: 'owner-merge', label: 'Your merge' },
      { type: 'done', id: 'done', label: 'Done' },
    ],
    edges: [
      flow('ticket', 'orchestrate'),
      flow('orchestrate', 'plan-approval'),
      link('assigns', 'orchestrate', 'api-helper'),
      link('assigns', 'orchestrate', 'helpers'),
      link('review', 'api-helper', 'review'),
      link('review', 'helpers', 'review'),
      link('rework', 'review', 'api-helper', { maxRounds: 2 }),
      link('rework', 'review', 'helpers', { maxRounds: 2 }),
      link('findings', 'review', 'orchestrate'),
      link('rework', 'orchestrate', 'helpers', { maxRounds: 1 }),
      link('merge', 'orchestrate', 'checks'),
      flow('checks', 'ticket-merge'),
      flow('ticket-merge', 'code-review'),
      flow('code-review', 'owner-merge'),
      flow('owner-merge', 'done'),
    ],
  };
}

/** The review agent's round on the API helper's change: it sent the change straight back. */
const API_DIRECT_ROUND: Json = {
  id: 'cr-api-0',
  round: 0,
  reviewer: 'agent',
  reviewerAgentRunId: L_REV1,
  verdict: 'rework',
  decision: 'rework',
  decidedBy: 'reviewer',
  commentId: 'c-find-1',
  createdAt: '2026-10-17T09:20:00.000Z',
  decidedAt: '2026-10-17T09:21:00.000Z',
};

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

/** `GET /api/runs/:id/workflow-graph` for the working run below. */
export function directLoopRunGraph(): Json {
  const node = (nodeId: string, state: string, agentRunIds: string[] = [], over: Json = {}) => ({
    nodeId,
    state,
    agentRunIds,
    ...over,
  });
  return {
    runId: LOOP_RUN_ID,
    graph: directLoopGraph(),
    nodes: [
      node('ticket', 'done'),
      node('orchestrate', 'active', [L_LEAD]),
      node('plan-approval', 'done'),
      node('api-helper', 'active', [L_API], { approvalMode: 'auto-edits', sandbox: true }),
      node('helpers', 'done', [L_UI], { approvalMode: 'auto-edits', sandbox: false }),
      node('review', 'active', [L_REV1, L_REV2]),
      node('checks', 'waiting'),
      node('ticket-merge', 'waiting'),
      node('code-review', 'waiting'),
      node('owner-merge', 'waiting'),
      node('done', 'waiting'),
    ],
    review: counts({ inReview: 1, rework: 1, reworkRounds: 1 }),
  };
}

/**
 * Working, on the drawn workflow: the review agent sent the API helper's change straight back
 * (round 1 of 2, decided by the review agent); the Search UI's change (the pool) is in review.
 */
export function directLoopScenario(): LoopScenario {
  const sc = loopWorkingScenario();
  const detail = sc.routes[LOOP_TICKET_PATH] as Json;
  const run = detail['currentRun'] as Json;
  const changes = (run['changes'] as Json[]).map((c) =>
    c['agentRunId'] === L_API ? { ...c, role: 'API helper', reviews: [API_DIRECT_ROUND] } : c,
  );
  const agents = (run['agents'] as Json[]).map((a) =>
    a['id'] === L_API ? { ...a, role: 'API helper' } : a,
  );
  const working = { ...run, agents, changes, reviewer: 'agent', maxReworkRounds: 2 };
  return {
    routes: {
      ...sc.routes,
      [LOOP_TICKET_PATH]: { ...detail, currentRun: working },
      [LOOP_RUN_PATH]: working,
      [LIVE_GRAPH_PATH]: directLoopRunGraph(),
      [PROJECT_GRAPH_PATH]: projectGraphDto(directLoopGraph()),
    },
  };
}

/**
 * `GET /api/projects/:id/workflow-graph` for a graph. The project's mode is Auto edits (its
 * legacy allowlist), its skills those the fixtures use.
 */
export function projectGraphDto(graph: Json): Json {
  const wf = projectWorkflow();
  return {
    graph,
    stored: 'v2',
    issues: [],
    setup: wf['setup'],
    skills: ['api-design', 'code-review', 'plan-tickets'],
    agents: [],
    updatedAt: '2026-10-14T08:00:00.000Z',
  };
}

/** The same drawn workflow with every block at the project's mode (no block looser than it). */
export function carefulGraph(): Json {
  const graph = directLoopGraph();
  const nodes = (graph['nodes'] as Json[]).map((n) =>
    n['id'] === 'api-helper' ? { ...n, approvalMode: 'manual' } : n,
  );
  return { ...graph, nodes };
}
