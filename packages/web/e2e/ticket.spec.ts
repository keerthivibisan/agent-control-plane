import { expect, test, type Page } from '@playwright/test';
import {
  STORE,
  TICKET_ID,
  UI,
  inReviewScenario,
  planReviewScenario,
  workingScenario,
  type TicketScenario,
} from './ticket-fixtures.js';

/*
 * P4-G: the ticket page in the browser, on the built UI served by the demo server, with the
 * ticket and run routes answered from synthetic fixtures (page.route), because the server routes
 * arrive with P4-D. Mutations are answered but never reach a server. With ACP_SCREENSHOT_DIR set,
 * it also saves light and dark screenshots at 1440 and 1024 pixels wide for the WP review.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;

async function serve(page: Page, sc: TicketScenario): Promise<void> {
  await page.route(/\/api\/(tickets|runs|control)\//, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 200, json: sc.routes[`/api/tickets/${TICKET_ID}`] });
      return;
    }
    const body = sc.routes[url.pathname];
    if (body === undefined) {
      await route.fulfill({
        status: 404,
        json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
      });
      return;
    }
    await route.fulfill({ status: 200, json: body });
  });
}

async function open(page: Page, sc: TicketScenario): Promise<void> {
  await serve(page, sc);
  await page.goto(`/#/tickets/${TICKET_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Dark mode toggle');
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      // Let the theme's color transitions finish before the picture.
      await page.waitForTimeout(400);
      // From the top: a full-page picture of a scrolled page draws sticky parts mid-page.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${SHOTS}/ticket-${name}-${width}-${scheme}.png`,
        fullPage: true,
      });
    }
  }
}

test('plan review: the plan card replaces the tree', async ({ page }) => {
  await open(page, planReviewScenario());
  const card = page.getByTestId('plan-card');
  await expect(card).toContainText('Version 2');
  await expect(card.getByRole('button', { name: 'Approve plan' })).toBeVisible();
  await expect(page.getByTestId('agent-canvas')).toHaveCount(0);
  await shoot(page, 'plan-review');
});

test('working: depth-2 helpers nest under their parent; an approval waits', async ({ page }) => {
  await open(page, workingScenario());
  const nested = page.getByRole('list', { name: 'Started by Theme store' });
  await expect(nested.getByRole('article', { name: 'Migration helper' })).toBeVisible();
  await expect(page.getByTestId('approvals')).toContainText('Edit src/theme/store.ts');
  // Three helpers fit next to the side panel at 1440 without a sideways scroll.
  await page.setViewportSize({ width: 1440, height: 900 });
  const scroller = page.getByTestId('agent-canvas').locator('.overflow-x-auto');
  const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shoot(page, 'working');
  await page
    .getByTestId(`agent-${STORE}`)
    .getByRole('button', { name: /Show the/ })
    .click();
  await page.getByRole('tab', { name: /Approvals/ }).click();
  await shoot(page, 'working-helper');
});

test('in review: a failed required check blocks Merge', async ({ page }) => {
  await open(page, inReviewScenario());
  await page
    .getByTestId('review-list')
    .getByRole('listitem')
    .filter({ hasText: 'Settings UI' })
    .getByRole('button', { name: 'Review' })
    .click();
  const panel = page.getByTestId('side-panel');
  await expect(panel.getByTestId('merge-blocked')).toContainText('Build');
  await expect(panel.getByRole('button', { name: 'Merge anyway…' })).toBeVisible();
  await expect(page.getByTestId(`agent-${UI}`)).toHaveAttribute('data-selected', 'true');
  // The agent's own branch is on its card from the start (AgentRunDto.branch).
  await expect(page.getByTestId(`agent-${UI}`).getByTestId('agent-branch')).toHaveText(`…/${UI}`);
  await shoot(page, 'in-review-changes');
  await panel.getByRole('tab', { name: 'Checks' }).click();
  await expect(panel.getByTestId('check-build')).toContainText('Failed');
  await shoot(page, 'in-review-checks');
});
