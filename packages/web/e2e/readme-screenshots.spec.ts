import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  LOOP_PROJECT_GRAPH_PATH,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_TICKET_ID,
  PROJECT_ID,
  loopWorkingScenario,
} from './review-loop-fixtures.js';
import { fixtureProject } from './ticket-fixtures.js';
import { WF_CSRF, agentFilesFixture, workflowFixture, setupFixture } from './workflow-fixtures.js';

/*
 * The README screenshots, saved to docs/images/. Runs only with ACP_README_SHOTS set and the
 * readme config (BUILD.md, "README screenshots"); otherwise it skips. Everything shown is sample
 * data: the demo server's two demo projects and sessions (DEMO mode, a temp data dir) plus the
 * synthetic `web-app` project, its tickets, a review-loop run, its workflow and its skill files,
 * all answered with page.route. No route reaches a real repository, Claude data or an agent.
 */

const SHOTS = process.env.ACP_README_SHOTS;
const OUT = fileURLToPath(new URL('../../../docs/images/', import.meta.url));
const WIDTH = 1440;
const HEIGHT = 900;
const T = (min: number) => new Date(Date.UTC(2026, 9, 16, 9, min)).toISOString();

test.skip(SHOTS === undefined, 'README screenshots: set ACP_README_SHOTS=1');

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

interface Project {
  id: string;
  name: string;
}

async function demoApi(request: APIRequestContext): Promise<Project> {
  const res = await request.get('/api/projects');
  expect(res.ok()).toBe(true);
  const project = ((await res.json()) as Project[]).find((p) => p.name === 'demo-api');
  if (project === undefined) throw new Error('demo-api project missing');
  return project;
}

interface ShotOptions {
  scheme?: 'light' | 'dark';
  height?: number;
  /** Scroll this element to just under the sticky bars, instead of the page top. */
  scrollTo?: Locator;
}

async function shoot(page: Page, name: string, o: ShotOptions = {}): Promise<void> {
  await page.setViewportSize({ width: WIDTH, height: o.height ?? HEIGHT });
  await page.emulateMedia({ colorScheme: o.scheme ?? 'light', reducedMotion: 'reduce' });
  // Let the theme's color transitions and late cards settle before the picture.
  await page.waitForTimeout(600);
  if (o.scrollTo === undefined) await page.evaluate(() => window.scrollTo(0, 0));
  else {
    const box = await o.scrollTo.boundingBox();
    const top = (box?.y ?? 0) + (await page.evaluate(() => window.scrollY));
    // Leave room for the top bar and the sample-data banner.
    await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 100)), top);
    await page.waitForTimeout(200);
  }
  // The viewport, not fullPage: a full-page capture tears at the sticky top bar.
  await page.screenshot({ path: `${OUT}${name}.png` });
}

/** The synthetic `web-app` project, listed next to the demo server's own. */
async function withFixtureProject(page: Page): Promise<void> {
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
}

/** A synthetic board card (invented titles and labels). */
function card(n: number, stage: string, over: Record<string, unknown> = {}) {
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
async function withBoard(page: Page, demoId: string): Promise<void> {
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
async function withLoopRun(page: Page): Promise<void> {
  const scenario = loopWorkingScenario();
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
async function withWorkflow(page: Page): Promise<void> {
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
}

/** Three synthetic skill files for the Skills & Agents page. */
async function withSkills(page: Page): Promise<void> {
  const skill = (name: string, description: string, usedBy: string[], over = {}) => ({
    name,
    description,
    path: `.claude/skills/${name}/SKILL.md`,
    usedBy,
    sizeBytes: 900 + name.length * 40,
    lastCommittedAt: T(5),
    uncommitted: false,
    problems: [],
    ...over,
  });
  const skills = [
    skill('code-review', 'Review a change for bugs first, then style.', ['code-review']),
    skill('plan-tickets', 'Turn a ticket into small steps with clear owners.', ['plan']),
    skill('unit-tests', 'Write focused unit tests for the changed code.', ['unit-tests'], {
      uncommitted: true,
      lastCommittedAt: null,
    }),
  ];
  const detail = (s: (typeof skills)[number]) => ({
    ...s,
    instructions: `# ${s.name}\n\n${s.description}\n\n## Steps\n\n1. Read the diff.\n2. Run \`pnpm test\`.\n`,
  });
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: WF_CSRF } }));
  await page.route(/\/api\/projects\/[^/]+\/skills(\/[^/]+)?$/, async (route) => {
    const name = /\/skills\/([^/]+)$/.exec(new URL(route.request().url()).pathname)?.[1];
    if (name === undefined) return route.fulfill({ json: skills });
    const found = skills.find((s) => s.name === decodeURIComponent(name));
    return found === undefined
      ? route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', message: 'No such file', requestId: 'e2e' } },
        })
      : route.fulfill({ json: detail(found) });
  });
  await page.route(/\/api\/projects\/[^/]+\/agents(\/[^/]+)?$/, (route) =>
    route.fulfill({ json: agentFilesFixture() }),
  );
}

type Counts = Record<'input' | 'output' | 'cacheCreation' | 'cacheRead', number>;

/** One usage row as the Tokens page reads it (ProjectTokensDto), every count reported. */
function usageRow(input: number, output: number, cacheCreation: number, cacheRead: number) {
  const tokens: Counts = { input, output, cacheCreation, cacheRead };
  const totalProcessed = input + output + cacheCreation + cacheRead;
  return {
    usage: {
      tokens,
      recordCount: Math.max(1, Math.round(output / 220)),
      recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      provenance: 'derived',
    },
    headline: {
      newWork: input + output,
      totalProcessed,
      cacheReuseShare: cacheRead / totalProcessed,
      provenance: 'derived',
    },
  };
}

/** Three weeks of synthetic usage for the web-app project (invented numbers). */
function tokensFixture() {
  const byDay = [];
  const total: Counts = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  for (let d = 0; d < 21; d++) {
    if (d % 7 === 5) continue; // a quiet day: no row, not a zero
    const wave = 1 + Math.sin(d / 2.5);
    const day: Counts = {
      input: Math.round(900 + 600 * wave),
      output: Math.round(5_000 + 4_000 * wave + d * 120),
      cacheCreation: Math.round(25_000 + 18_000 * wave),
      cacheRead: Math.round(600_000 + 450_000 * wave + d * 9_000),
    };
    for (const k of Object.keys(total) as (keyof Counts)[]) total[k] += day[k];
    byDay.push({
      day: new Date(Date.UTC(2026, 8, 26 + d)).toISOString().slice(0, 10),
      ...usageRow(day.input, day.output, day.cacheCreation, day.cacheRead),
    });
  }
  const all = usageRow(total.input, total.output, total.cacheCreation, total.cacheRead);
  return {
    projectId: PROJECT_ID,
    range: { from: null, to: null },
    sessions: { total: 42, withUsage: 42 },
    runs: 7,
    ticketsWithRuns: 5,
    totals: all.usage,
    headline: all.headline,
    byDay,
    bySession: [
      {
        sessionId: '5a1e0c2b-0000-4000-8000-000000000021',
        title: 'Lead: Saved searches',
        latestEstimatedCost: { provenance: 'estimated', value: 3.42 },
        ...usageRow(3_120, 29_400, 160_200, 3_880_000),
      },
      {
        sessionId: '5a1e0c2b-0000-4000-8000-000000000024',
        title: 'Rate limit the public API',
        latestEstimatedCost: { provenance: 'estimated', value: 2.07 },
        ...usageRow(2_410, 18_300, 98_000, 2_210_000),
      },
      {
        sessionId: '5a1e0c2b-0000-4000-8000-000000000012',
        title: 'Dark mode toggle',
        latestEstimatedCost: { provenance: 'estimated', value: 1.15 },
        ...usageRow(1_380, 10_900, 52_000, 1_190_000),
      },
    ],
    byTicket: [
      {
        ticketId: LOOP_TICKET_ID,
        key: 'WEB-21',
        title: 'Saved searches',
        ...usageRow(3_120, 29_400, 160_200, 3_880_000),
      },
      {
        ticketId: 't-readme-24',
        key: 'WEB-24',
        title: 'Rate limit the public API',
        ...usageRow(2_410, 18_300, 98_000, 2_210_000),
      },
      {
        ticketId: 't-readme-12',
        key: 'WEB-12',
        title: 'Dark mode toggle',
        ...usageRow(1_380, 10_900, 52_000, 1_190_000),
      },
    ],
    byRole: [
      { role: 'planner', ...usageRow(610, 4_100, 30_000, 410_000) },
      { role: 'lead', ...usageRow(1_900, 15_200, 88_000, 1_870_000) },
      { role: 'worker', ...usageRow(4_570, 40_900, 92_400, 4_932_000) },
      { role: 'reviewer', ...usageRow(380, 2_900, 16_000, 260_000) },
    ],
    byModel: [
      { model: 'claude-opus-4-1', ...usageRow(4_100, 38_000, 151_000, 4_600_000) },
      { model: 'claude-sonnet-4-5', ...usageRow(3_360, 25_100, 75_400, 2_872_000) },
    ],
  };
}

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

test('readme: the board', async ({ page, request }) => {
  const demo = await demoApi(request);
  await withFixtureProject(page);
  await withBoard(page, demo.id);
  await withWorkflow(page);
  await page.goto(`/#/p/${PROJECT_ID}/board`);
  await expect(h1(page)).toContainText('Board');
  await expect(page.getByText('Saved searches').first()).toBeVisible();
  await shoot(page, 'board');
  await shoot(page, 'board-dark', { scheme: 'dark' });
});

test('readme: a ticket with a live run and its review loop', async ({ page }) => {
  await withFixtureProject(page);
  await withLoopRun(page);
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`);
  await expect(h1(page)).toContainText('Saved searches');
  const overview = page.getByTestId('changes-overview');
  await expect(overview).toBeVisible();
  // Open the reworked change: its card shows the review agent's findings in the side panel.
  await overview.getByTestId('change-row').first().getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('side-panel').getByTestId('change-finding')).toBeVisible();
  // The agent tree, the open change card and the changes list, under the run's workflow.
  const agents = page.getByTestId('agent-canvas');
  await shoot(page, 'ticket-run', { scrollTo: agents, height: 1000 });
  await shoot(page, 'ticket-run-dark', { scheme: 'dark', scrollTo: agents, height: 1000 });
});

test('readme: the workflow', async ({ page }) => {
  await withFixtureProject(page);
  await withWorkflow(page);
  await page.goto(`/#/p/${PROJECT_ID}/workflow`);
  await expect(h1(page)).toContainText('Workflow');
  await expect(page.getByTestId('wf-node-plan')).toBeVisible();
  await shoot(page, 'workflow');
});

test('readme: sessions and the agent tree', async ({ page, request }) => {
  const demo = await demoApi(request);
  await page.goto(`/#/p/${demo.id}/sessions`);
  await expect(h1(page)).toContainText('Sessions');
  await expect(page.getByTestId('family-tree')).toBeVisible();
  // Tall enough for the list and the agent tree under it.
  await shoot(page, 'sessions', { height: 1300 });
});

test('readme: tokens', async ({ page }) => {
  await withFixtureProject(page);
  await page.route(`**/api/projects/${PROJECT_ID}/tokens*`, (route) =>
    route.fulfill({ json: tokensFixture() }),
  );
  await page.goto(`/#/p/${PROJECT_ID}/tokens`);
  await expect(h1(page)).toContainText('Tokens');
  await expect(page.getByText('Saved searches').first()).toBeAttached();
  await shoot(page, 'tokens');
});

test('readme: skills and agent files', async ({ page }) => {
  await withFixtureProject(page);
  await withSkills(page);
  await page.goto(`/#/p/${PROJECT_ID}/skills`);
  await expect(h1(page)).toContainText('Skills & Agents');
  await expect(page.getByText('plan-tickets').first()).toBeVisible();
  await shoot(page, 'skills');
});
