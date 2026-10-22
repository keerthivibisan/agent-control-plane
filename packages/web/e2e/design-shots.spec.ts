import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  CODE_HOST_PATH,
  PROJECT_SETUP_PATH,
  codeHost,
  githubFlowStrategy,
} from './github-fixtures.js';
import { CSRF, LOOP_TICKET_ID, PROJECT_ID, loopReviewScenario } from './review-loop-fixtures.js';
import {
  demoApi,
  withBoard,
  withFixtureProject,
  withLoopRun,
  withWorkflow,
} from './shot-fixtures.js';
import { fixtureProject } from './ticket-fixtures.js';
import { setupFixture } from './workflow-fixtures.js';

/*
 * v0.3.0 D-0: the owner's design checkpoint pictures (light and dark, 1440 wide) of the board, a
 * ticket with a run, a diff side by side, the Workflow page, project settings, the theme menu and
 * the sidebar expanded and collapsed. Runs only with ACP_DESIGN_SHOTS set to the output folder
 * (git-ignored `.acp-data/...`) and the design-shots config; otherwise it skips. ACP_DESIGN_TAG
 * prefixes the file names ("before", "after"). Sample data only, as in the README pictures.
 */

const DIR = process.env.ACP_DESIGN_SHOTS;
const TAG = process.env.ACP_DESIGN_TAG ?? 'shot';
const WIDTH = 1440;
const HEIGHT = 900;
const SCHEMES = ['light', 'dark'] as const;

test.skip(DIR === undefined, 'design pictures: set ACP_DESIGN_SHOTS to an output folder');

test.beforeAll(() => {
  if (DIR !== undefined) mkdirSync(resolve(DIR), { recursive: true });
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const file = (name: string, scheme: string) => resolve(DIR ?? '.', `${TAG}-${name}-${scheme}.png`);
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

async function settle(page: Page, scheme: 'light' | 'dark', height = HEIGHT): Promise<void> {
  await page.setViewportSize({ width: WIDTH, height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.waitForTimeout(500);
}

/** The viewport in both themes, from the top or with `scrollTo` just under the sticky bars. */
async function shoot(page: Page, name: string, scrollTo?: Locator, height = HEIGHT) {
  for (const scheme of SCHEMES) {
    await settle(page, scheme, height);
    if (scrollTo === undefined) await page.evaluate(() => window.scrollTo(0, 0));
    else {
      const box = await scrollTo.boundingBox();
      const top = (box?.y ?? 0) + (await page.evaluate(() => window.scrollY));
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 100)), top);
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: file(name, scheme) });
  }
}

/** The sidebar strip (and the top bar over it) in both themes. */
async function shootSidebar(page: Page, name: string): Promise<void> {
  for (const scheme of SCHEMES) {
    await settle(page, scheme);
    await page.screenshot({
      path: file(name, scheme),
      clip: { x: 0, y: 0, width: 480, height: 640 },
    });
  }
}

test('design: the board, and the sidebar expanded and collapsed', async ({ page, request }) => {
  const demo = await demoApi(request);
  await withFixtureProject(page);
  await withBoard(page, demo.id);
  await withWorkflow(page);
  await page.addInitScript(() => window.localStorage.setItem('acp.sidebar', 'expanded'));
  await page.goto(`/#/p/${PROJECT_ID}/board`);
  await expect(h1(page)).toContainText('Board');
  await expect(page.getByText('Saved searches').first()).toBeVisible();
  await shoot(page, 'board');
  await shootSidebar(page, 'sidebar-expanded');

  await page.addInitScript(() => window.localStorage.setItem('acp.sidebar', 'collapsed'));
  await page.reload();
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
  await shootSidebar(page, 'sidebar-collapsed');
});

test('design: a ticket with a run', async ({ page }) => {
  await withFixtureProject(page);
  await withLoopRun(page);
  // v0.3.0 D-B: the agents are on the ticket page's Agents tab.
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}?tab=agents`);
  await expect(h1(page)).toContainText('Saved searches');
  await expect(page.getByTestId('agent-canvas')).toBeVisible();
  await shoot(page, 'ticket-run', undefined, 1000);
  await shoot(page, 'ticket-run-agents', page.getByTestId('agent-canvas'), 1000);
});

test('design: the ticket branch diff, side by side', async ({ page }) => {
  await withFixtureProject(page);
  await withLoopRun(page, loopReviewScenario());
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}?tab=files`);
  const branch = page.getByTestId('branch-files');
  await branch.getByTestId('branch-diff').locator('summary').click();
  const viewer = branch.getByTestId('diff-viewer');
  await viewer.getByRole('button', { name: 'Side by side' }).click();
  await expect(viewer).toHaveAttribute('data-view', 'split');
  await expect(viewer.locator('[data-syntax="highlighted"]').first()).toBeVisible();
  for (const scheme of SCHEMES) {
    await settle(page, scheme, 2400);
    await viewer.scrollIntoViewIfNeeded();
    await viewer.screenshot({ path: file('diff-split', scheme) });
  }
});

test('design: the Workflow page', async ({ page }) => {
  await withFixtureProject(page);
  await withWorkflow(page);
  await page.goto(`/#/p/${PROJECT_ID}/workflow`);
  await expect(h1(page)).toContainText('Workflow');
  await expect(page.getByTestId('block-helper-1')).toBeVisible();
  await shoot(page, 'workflow');
});

test('design: project settings', async ({ page }) => {
  // The synthetic project with its setup, a GitHub flow strategy and a connected GitHub, as in
  // github.spec.ts (demo mode serves no setup of its own).
  await withFixtureProject(page);
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: CSRF } }));
  await page.route(`**${PROJECT_SETUP_PATH}`, (route) =>
    route.fulfill({ json: { ...setupFixture(), branching: githubFlowStrategy() } }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) =>
    route.fulfill({ json: fixtureProject() }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/context-candidates`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**${CODE_HOST_PATH}`, (route) => route.fulfill({ json: codeHost('ready') }));
  await page.goto(`/#/p/${PROJECT_ID}/settings`);
  await expect(h1(page)).toContainText('Settings');
  await expect(page.getByTestId('settings-branching')).toBeVisible();
  await expect(
    page.getByTestId('settings-code-host').getByTestId('code-host-message'),
  ).toBeVisible();
  await shoot(page, 'settings', undefined, 1600);
});

test('design: the theme menu open', async ({ page, request }) => {
  const demo = await demoApi(request);
  await page.goto(`/#/p/${demo.id}/board`);
  await expect(h1(page)).toContainText('Board');
  const button = page.getByTestId('theme-menu');
  // Before D-0 the top bar had a cycling toggle and no menu: nothing to picture.
  test.skip((await button.count()) === 0, 'no theme menu in this build');
  for (const scheme of SCHEMES) {
    await settle(page, scheme);
    await button.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.screenshot({ path: file('theme-menu', scheme) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
});
