import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PROJECT_ID, TICKET_ID, fixtureProject, workingScenario } from './ticket-fixtures.js';

/*
 * Redesign R-A: the project-first shell in the browser, on the demo server's built UI. The two
 * demo projects are real (demo mode). Demo mode has no ticket writes (the control routes are off),
 * so the demo-api board is the server's real board with synthetic tickets put into its columns
 * (page.route). The ticket page uses the synthetic ticket fixtures, as ticket.spec.ts does. With
 * ACP_SCREENSHOT_DIR set, it saves light and dark screenshots at 1440 and 1024 pixels wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;

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

const T = (min: number) => new Date(Date.UTC(2026, 9, 16, 9, min)).toISOString();

/** A synthetic board card (test-only data; titles and labels are invented). */
function card(projectId: string, n: number, stage: string, over: Record<string, unknown> = {}) {
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
    id: `t-e2e-${n}`,
    projectId,
    key: `API-${n}`,
    title: `Ticket ${n}`,
    description: 'Synthetic e2e ticket.',
    type: 'feature',
    priority: 'medium',
    labels: [],
    status: status[stage],
    currentRunId: active ? `run-e2e-${n}` : null,
    createdAt: T(n),
    updatedAt: T(n + 10),
    stage,
    activeHelpers: active ? 2 : 0,
    budgetTokensUsed: active ? 48_200 : null,
    needsYou: stage === 'NEEDS_YOU' ? 1 : 0,
    latestEstimatedCost: active ? { provenance: 'estimated', value: 0.42 } : null,
    lastActivityAt: active ? T(n + 12) : null,
    lastRunOutcome: null,
    ...over,
  };
}

/** Serves demo-api's real board with synthetic tickets and live counts in it. */
async function withTickets(page: Page, projectId: string): Promise<void> {
  await page.route(`**/api/board?projectId=${encodeURIComponent(projectId)}`, async (route) => {
    const real = (await (await route.fetch()).json()) as Record<string, unknown>;
    const cards = [
      card(projectId, 1, 'BACKLOG', { title: 'Document the pagination cursor', type: 'chore' }),
      card(projectId, 2, 'READY', {
        title: 'Retry failed webhooks',
        type: 'bug',
        priority: 'high',
      }),
      card(projectId, 3, 'WORKING', {
        title: 'Rate limit the public API',
        priority: 'urgent',
        labels: ['api'],
      }),
      card(projectId, 4, 'NEEDS_YOU', { title: 'Rotate the signing keys', labels: ['security'] }),
      card(projectId, 5, 'DONE', { title: 'Build the harness', type: 'harness' }),
    ];
    const stages = [...new Set(cards.map((c) => c.stage))];
    await route.fulfill({
      json: {
        ...real,
        stats: { ...(real['stats'] as object), runningRuns: 2, needsYou: 1 },
        columns: stages.map((stage) => ({
          stage,
          tickets: cards.filter((c) => c.stage === stage),
        })),
      },
    });
  });
}

/** Lists the fixtures' project next to the server's own, so the shell knows its name. */
async function withFixtureProject(page: Page): Promise<void> {
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
}

async function shoot(
  page: Page,
  name: string,
  beforeEach?: () => Promise<void>,
  fullPage = false,
): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      if (beforeEach) await beforeEach();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/shell-${name}-${width}-${scheme}.png`, fullPage });
    }
  }
}

test('All projects: one card per project, then the cross-project summary', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  await withTickets(page, project.id);
  await page.goto('/#/projects');
  await expect(page.getByRole('heading', { level: 1, name: 'All projects' })).toBeVisible();
  const cards = page.getByRole('list', { name: 'Your projects' });
  await expect(cards.getByRole('listitem')).toHaveCount(2);
  await expect(cards.locator(`[data-project-id="${project.id}"]`)).toContainText('Harness');
  await expect(page.getByRole('region', { name: 'Across your projects' })).toBeVisible();
  await shoot(page, 'all-projects');
});

test('the board in the shell; the switcher remembers the project for #/', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  await withTickets(page, project.id);
  await page.goto(`/#/p/${project.id}/board`);
  await expect(page.getByTestId('board-counts')).toBeVisible();
  await expect(page.getByText('Rate limit the public API')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
  // R-H: the project name heads the board; the top-bar switcher is the only project picker.
  await expect(page.getByRole('heading', { level: 1, name: 'demo-api' })).toBeVisible();
  await expect(page.getByTestId('board-counts')).toHaveText('2 running·1 needs you');
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveCount(0);
  await expect(page.getByTestId('board-stats')).toHaveCount(0);
  await shoot(page, 'board');

  // The front door reopens the last project.
  await page.goto('/#/');
  await expect(page).toHaveURL(new RegExp(`#/p/${project.id}/board$`));

  // Switching keeps the page.
  await nav.getByRole('link', { name: 'Tokens' }).click();
  await page.getByRole('button', { name: 'Project: demo-api. Switch project' }).click();
  await page
    .getByRole('navigation', { name: 'Switch project' })
    .getByRole('link', {
      name: /demo-web/,
    })
    .click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/tokens$/);
  await expect(
    page.getByRole('button', { name: 'Project: demo-web. Switch project' }),
  ).toBeVisible();
});

test('the sidebar shows labels above 1280px and collapses to icons at 1280px and below', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  await page.goto(`/#/p/${project.id}/board`);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const board = nav.getByRole('link', { name: 'Board' });
  // The label is screen-reader text when collapsed (1px, clipped), so measure it.
  const labelWidth = async () => (await board.getByText('Board').boundingBox())?.width ?? 0;
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await nav.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  expect(await labelWidth()).toBeGreaterThan(20);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(async () => (await nav.boundingBox())?.width ?? 0).toBeLessThan(100);
  expect(await labelWidth()).toBeLessThanOrEqual(1);
  await expect(board).toHaveAttribute('title', 'Board');
  if (SHOTS !== undefined) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/shell-collapsed-1280-${scheme}.png` });
    }
  }
});

test('the ⌘K palette jumps to a ticket by key and closes with Esc', async ({ page, request }) => {
  const project = await demoApi(request);
  await withTickets(page, project.id);
  await page.goto(`/#/p/${project.id}/board`);
  await expect(page.getByTestId('board-counts')).toBeVisible();

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const openPalette = async () => {
    if (await palette.isVisible()) return;
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(palette).toBeVisible();
  };
  await openPalette();
  await expect(palette.getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();

  await openPalette();
  await shoot(page, 'palette', openPalette);
  await palette.getByRole('combobox').fill('api-3');
  await expect(palette.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/p/${project.id}/tickets/t-e2e-3$`));
});

test('the ticket page in the shell', async ({ page }) => {
  const sc = workingScenario();
  await withFixtureProject(page);
  await page.route(/\/api\/(tickets|runs|control)\//, async (route) => {
    const body = sc.routes[new URL(route.request().url()).pathname];
    await (body === undefined
      ? route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
        })
      : route.fulfill({ status: 200, json: body }));
  });
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${TICKET_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Dark mode toggle');
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Board' }),
  ).toHaveAttribute('aria-current', 'page');
  await shoot(page, 'ticket');
});

test('settings: the project, its board key, context files, and links to Workflow and Harness', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  // Synthetic setup and context files (R-H); the project itself is the demo server's.
  await page.route(`**/api/projects/${project.id}/setup`, (route) =>
    route.fulfill({
      json: {
        projectId: project.id,
        projectKey: 'API',
        planFirst: true,
        maxConcurrentHelpers: 3,
        maxDepth: 1,
        defaultBudgetTokensPerAgent: 500_000,
        model: null,
        allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
        contextFiles: ['CLAUDE.md'],
        updatedAt: T(0),
      },
    }),
  );
  await page.route(`**/api/projects/${project.id}/context-candidates`, (route) =>
    route.fulfill({
      json: [
        { path: 'CLAUDE.md', sizeBytes: 2_480, suggested: true },
        { path: 'README.md', sizeBytes: 5_120, suggested: true },
        { path: 'docs/architecture.md', sizeBytes: 9_870, suggested: false },
      ],
    }),
  );
  await page.goto(`/#/p/${project.id}/settings`);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  const card = page.getByTestId('settings-project');
  await expect(card).toContainText('demo-api');
  await expect(card.getByLabel('Board key')).toHaveValue('API');
  await expect(page.getByTestId('settings-context').getByLabel('CLAUDE.md')).toBeChecked();
  await expect(
    page.getByTestId('settings-workflow-link').getByRole('link', { name: 'Open Workflow' }),
  ).toHaveAttribute('href', `#/p/${project.id}/workflow`);
  await expect(
    page.getByTestId('settings-harness-link').getByRole('link', { name: 'Open Harness' }),
  ).toHaveAttribute('href', `#/p/${project.id}/harness`);
  await expect(page.getByText('Helpers at once')).toHaveCount(0);
  await shoot(page, 'settings', undefined, true);
});
