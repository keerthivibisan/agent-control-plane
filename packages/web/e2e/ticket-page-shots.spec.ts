import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  CODE_HOST_PATH,
  PROJECT_SETUP_PATH,
  codeHost,
  ghReviewScenario,
  githubFlowStrategy,
} from './github-fixtures.js';
import {
  CSRF,
  LOOP_PROJECT_GRAPH_PATH,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_TICKET_ID,
  PROJECT_ID,
  loopWorkingScenario,
  type LoopScenario,
} from './review-loop-fixtures.js';
import { fixtureProject } from './ticket-fixtures.js';
import { setupFixture } from './workflow-fixtures.js';

/*
 * v0.3.0 D-B: pictures of the ticket page as a pull request page, every tab in light and dark at
 * 1440 wide, for the owner's review. Runs only with ACP_TICKET_SHOTS set to the output
 * folder (git-ignored `.acp-data/...`) and its own config; otherwise it skips. Synthetic data only:
 * every route is answered from the e2e fixtures.
 */

const DIR = process.env.ACP_TICKET_SHOTS;
const WIDTHS = [1440] as const;
const SCHEMES = ['light', 'dark'] as const;

test.skip(DIR === undefined, 'ticket page pictures: set ACP_TICKET_SHOTS to an output folder');

test.beforeAll(() => {
  if (DIR !== undefined) mkdirSync(resolve(DIR), { recursive: true });
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function serve(page: Page, sc: LoopScenario): Promise<void> {
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: CSRF } }));
  await page.route(`**${PROJECT_SETUP_PATH}`, (route) =>
    route.fulfill({ json: setupFixture({ branching: githubFlowStrategy() }) }),
  );
  await page.route(`**${CODE_HOST_PATH}`, (route) => route.fulfill({ json: codeHost('ready') }));
  await page.route(`**${LOOP_PROJECT_WORKFLOW_PATH}`, (route) =>
    route.fulfill({ json: sc.routes[LOOP_PROJECT_WORKFLOW_PATH] }),
  );
  await page.route(`**${LOOP_PROJECT_GRAPH_PATH}`, (route) =>
    route.fulfill({ json: sc.routes[LOOP_PROJECT_GRAPH_PATH] }),
  );
  await page.route(/\/api\/(tickets|runs|control)\//, async (route) => {
    const body = sc.routes[new URL(route.request().url()).pathname];
    await (body === undefined
      ? route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
        })
      : route.fulfill({ json: body }));
  });
}

async function shoot(page: Page, name: string, tab: string): Promise<void> {
  const tabQuery = tab === 'comments' ? '' : `?tab=${tab}`;
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}${tabQuery}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Saved searches');
  await expect(page.getByTestId(`ticket-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: resolve(DIR ?? '.', `ticket-${name}-${width}-${scheme}.png`),
        fullPage: true,
      });
    }
  }
}

test('ticket page: Comments, ready for the final step', async ({ page }) => {
  await serve(page, ghReviewScenario());
  await shoot(page, 'comments', 'comments');
});

test('ticket page: Conversation, what happened', async ({ page }) => {
  await serve(page, ghReviewScenario());
  await shoot(page, 'conversation', 'conversation');
});

test('ticket page: Agents while they work', async ({ page }) => {
  await serve(page, loopWorkingScenario());
  await shoot(page, 'agents', 'agents');
});

test('ticket page: Files changed', async ({ page }) => {
  await serve(page, ghReviewScenario());
  await shoot(page, 'files', 'files');
});

test('ticket page: Checks', async ({ page }) => {
  await serve(page, ghReviewScenario());
  await shoot(page, 'checks', 'checks');
});
