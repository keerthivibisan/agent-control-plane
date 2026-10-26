import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  LOOP_PROJECT_GRAPH_PATH,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_TICKET_ID,
  PROJECT_ID,
  loopWorkingScenario,
  type LoopScenario,
} from './review-loop-fixtures.js';
import { fixtureProject } from './ticket-fixtures.js';
import {
  WF_CSRF,
  agentFilesFixture,
  customGraph,
  graphDto,
  setupFixture,
  workflowFixture,
} from './workflow-fixtures.js';

/*
 * Synthetic routes shared by the picture-taking specs (readme-screenshots.spec.ts and
 * design-shots.spec.ts): the demo server's demo-api project, the synthetic `web-app` project with
 * its board, a review-loop run and a full workflow, all answered with page.route. Sample data only:
 * no route reaches a real repository, Claude data or an agent.
 */

const T = (min: number) => new Date(Date.UTC(2026, 9, 16, 9, min)).toISOString();

export interface Project {
  id: string;
  name: string;
}

export async function demoApi(request: APIRequestContext): Promise<Project> {
  const res = await request.get('/api/projects');
  expect(res.ok()).toBe(true);
  const project = ((await res.json()) as Project[]).find((p) => p.name === 'demo-api');
  if (project === undefined) throw new Error('demo-api project missing');
  return project;
}

/** The synthetic `web-app` project, listed next to the demo server's own. */
export async function withFixtureProject(page: Page): Promise<void> {
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
}

/** A synthetic board card (invented titles and labels). */
export function card(n: number, stage: string, over: Record<string, unknown> = {}) {
  const status: Record<string, string> = {
    BACKLOG: 'BACKLOG',
    READY: 'READY',
    WORKING: 'ACTIVE',
    NEEDS_YOU: 'ACTIVE',
    IN_REVIEW: 'ACTIVE',
    DONE: 'DONE',
  };
  const active = status[stage] === 'ACTIVE';
  return {
    id: `t-readme-${n}`,
    projectId: PROJECT_ID,
    key: `WEB-${n}`,
    title: `Ticket ${n}`,
    description: 'Sample ticket.',
    type: 'feature',
    priority: 'medium',
    labels: [],
    status: status[stage],
    currentRunId: active ? `run-readme-${n}` : null,
    createdAt: T(n),
    updatedAt: T(n + 10),
    stage,
    activeHelpers: active ? 2 : 0,
    budgetTokensUsed: active ? 48_200 + n * 1_350 : null,
    needsYou: stage === 'NEEDS_YOU' ? 1 : 0,
    latestEstimatedCost: active ? { provenance: 'estimated', value: 0.18 + n / 100 } : null,
    lastActivityAt: active ? T(n + 12) : null,
    lastRunOutcome: null,
    ...over,
  };
}

/** The web-app board: the demo server's board shape with synthetic tickets in its columns. */
export async function withBoard(page: Page, demoId: string): Promise<void> {
  await page.route(`**/api/board?projectId=${PROJECT_ID}`, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('projectId', demoId);
    const real = (await (await route.fetch({ url: url.toString() })).json()) as Record<
      string,
      unknown
    >;
    const cards = [
      card(30, 'BACKLOG', { title: 'Export tickets as CSV', type: 'feature', priority: 'low' }),
      card(31, 'BACKLOG', { title: 'Document the search API', type: 'chore' }),
      card(27, 'READY', { title: 'Retry failed webhooks', type: 'bug', priority: 'high' }),
      card(28, 'READY', { title: 'Keyboard shortcuts for the board', labels: ['ui'] }),
      card(21, 'WORKING', {
        id: LOOP_TICKET_ID,
        title: 'Saved searches',
        priority: 'high',
        labels: ['search'],
      }),
      card(24, 'WORKING', { title: 'Rate limit the public API', priority: 'urgent' }),
      card(19, 'NEEDS_YOU', { title: 'Rotate the signing keys', labels: ['security'] }),
      card(17, 'IN_REVIEW', { title: 'Paginate the activity feed', labels: ['api'] }),
      card(12, 'DONE', { title: 'Dark mode toggle', labels: ['ui', 'settings'] }),
      card(9, 'DONE', { title: 'Build the harness', type: 'harness' }),
    ];
    const stages = ['BACKLOG', 'READY', 'WORKING', 'NEEDS_YOU', 'IN_REVIEW', 'DONE'];
    await route.fulfill({
      json: {
        ...real,
        project: { ...(real['project'] as object), ...fixtureProject() },
        projectKey: 'WEB',
        stats: { ...(real['stats'] as object), runningRuns: 3, needsYou: 1 },
        columns: stages.map((stage) => ({
          stage,
          tickets: cards.filter((c) => c.stage === stage),
        })),
      },
    });
  });
}

/** The review-loop run's ticket, run, review and workflow routes, from the synthetic fixtures. */
export async function withLoopRun(
  page: Page,
  scenario: LoopScenario = loopWorkingScenario(),
): Promise<void> {
  await page.route(`**${LOOP_PROJECT_WORKFLOW_PATH}`, (route) =>
    route.fulfill({ json: scenario.routes[LOOP_PROJECT_WORKFLOW_PATH] }),
  );
  await page.route(`**${LOOP_PROJECT_GRAPH_PATH}`, (route) =>
    route.fulfill({ json: scenario.routes[LOOP_PROJECT_GRAPH_PATH] }),
  );
  await page.route(/\/api\/(tickets|runs|control)\//, async (route) => {
    const body = scenario.routes[new URL(route.request().url()).pathname];
    await (body === undefined
      ? route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
        })
      : route.fulfill({ json: body }));
  });
}

/** A workflow with every stage on: a separate planner, the review agent, code review and tests. */
export async function withWorkflow(page: Page): Promise<void> {
  const dto = {
    workflow: workflowFixture({
      plannerMode: 'separate',
      plan: { skill: 'plan-tickets' },
      helpers: { agent: 'db-migrator' },
      codeReview: { enabled: true, skill: 'code-review' },
      unitTests: { enabled: true, skill: 'unit-tests' },
    }),
    setup: setupFixture({ model: 'claude-sonnet-4' }),
    skills: ['code-review', 'plan-tickets', 'unit-tests'],
  };
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: WF_CSRF } }));
  await page.route(`**/api/projects/${PROJECT_ID}/workflow`, (route) =>
    route.fulfill({ json: dto }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/agents`, (route) =>
    route.fulfill({ json: agentFilesFixture() }),
  );
  // ADR-0023: the Workflow page is the graph editor, so it reads the project's graph. The
  // hand-built sample graph (planner, a named helper, the pool with a change reviewer that sends
  // changes back, a tester) with every skill and agent file it names, so it shows no warnings.
  await page.route(`**/api/projects/${PROJECT_ID}/workflow-graph`, (route) =>
    route.fulfill({
      json: graphDto({
        graph: customGraph(),
        stored: 'v2',
        skills: ['code-review', 'plan-tickets', 'release-notes', 'unit-tests'],
        agents: ['db-migrator', 'docs-writer', 'test-writer'],
        updatedAt: '2026-10-21T09:00:00.000Z',
      }),
    }),
  );
}
