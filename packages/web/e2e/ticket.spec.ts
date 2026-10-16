import { expect, test, type Page } from '@playwright/test';
import {
  CSRF,
  FOLLOW_UP_MESSAGES,
  followUpLeadAnswer,
  followUpOwnerMessage,
  followUpScenario,
  PLANNER,
  PROJECT_ID,
  PROJECT_WORKFLOW_PATH,
  RUN_ID,
  fixtureProject,
  STORE,
  TESTER,
  TICKET_ID,
  UI,
  heldScenario,
  inReviewScenario,
  planReviewScenario,
  reviewedScenario,
  stagesScenario,
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

/** Lists the fixtures' project next to the server's own, so the shell knows its name. */
async function withFixtureProject(page: Page): Promise<void> {
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
}

async function serve(page: Page, sc: TicketScenario): Promise<{ posts: () => string[] }> {
  const posts: string[] = [];
  await withFixtureProject(page);
  // The project's workflow for the live graph (redesign R-H).
  await page.route(`**${PROJECT_WORKFLOW_PATH}`, (route) =>
    route.fulfill({ json: sc.routes[PROJECT_WORKFLOW_PATH] }),
  );
  await page.route(/\/api\/(tickets|runs|control)\//, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      posts.push(`${route.request().method()} ${url.pathname}`);
      const run = sc.routes[`/api/runs/${RUN_ID}`];
      await route.fulfill({
        status: 200,
        json: url.pathname.endsWith('/continue') ? run : sc.routes[`/api/tickets/${TICKET_ID}`],
      });
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
  return { posts: () => [...posts] };
}

/** Redesign (R-A): the ticket page lives under its project. */
const TICKET_HASH = `#/p/${PROJECT_ID}/tickets/${TICKET_ID}`;

async function open(page: Page, sc: TicketScenario): Promise<{ posts: () => string[] }> {
  const server = await serve(page, sc);
  await page.goto(`/${TICKET_HASH}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Dark mode toggle');
  return server;
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

test('an old #/tickets/:id link opens the ticket under its project', async ({ page }) => {
  await serve(page, planReviewScenario());
  await page.goto(`/#/tickets/${TICKET_ID}`);
  await expect(page).toHaveURL(new RegExp(`${TICKET_HASH}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Dark mode toggle');
});

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

// --- Redesign R-H: the live workflow, the new roles, reviewer comments and Continue -----------

test('plan review: the live workflow shows the plan waiting for you', async ({ page }) => {
  await open(page, planReviewScenario());
  const graph = page.getByTestId('live-workflow');
  await expect(graph.getByTestId('live-plan')).toHaveAttribute('data-state', 'needs-you');
  await expect(graph.getByTestId('live-approve')).toHaveAttribute('data-state', 'needs-you');
  await expect(page.getByTestId('ticket-summary')).not.toContainText('Plan ready for you');
});

test('working with stages: a separate planner, helpers at work, review stages waiting', async ({
  page,
}) => {
  await open(page, stagesScenario());
  const graph = page.getByTestId('live-workflow');
  await expect(graph.getByTestId('wf-node-plan')).toHaveAttribute('data-role', 'planner');
  await expect(graph.getByTestId('live-helpers')).toHaveAttribute('data-state', 'active');
  await expect(graph.getByTestId('live-code-review')).toHaveAttribute('data-state', 'waiting');
  await expect(page.getByTestId(`agent-${PLANNER}`).getByTestId('agent-term')).toHaveText(
    'Planner agent',
  );
  await expect(page.getByTestId('side-panel').getByTestId('chat-speaker').first()).toHaveText(
    'Planner agent',
  );
  await shoot(page, 'stages');
});

test('in review with stages: reviewer findings and the tester’s change', async ({ page }) => {
  await open(page, reviewedScenario());
  await expect(page.getByTestId('live-code-review')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('live-unit-tests')).toHaveAttribute('data-state', 'needs-you');
  await expect(page.getByTestId('held-stage')).toHaveCount(0);
  const reviewer = page.getByTestId('comments').locator('[data-author="reviewer"]');
  await expect(reviewer.getByTestId('comment-author')).toHaveText('Reviewer');
  await expect(page.getByTestId(`agent-${TESTER}`).getByTestId('agent-term')).toHaveText(
    'Tester agent',
  );
  await shoot(page, 'reviewed');
});

test('a held stage: Continue starts it', async ({ page }) => {
  const server = await open(page, heldScenario());
  const held = page.getByTestId('held-stage');
  await expect(held).toContainText('Final code review is waiting for you');
  await shoot(page, 'held');
  await held.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => server.posts()).toEqual([`POST /api/runs/${RUN_ID}/continue`]);
});

// --- Redesign R-J: the lead's chat after the lead ends (ADR-0020) ------------------------------

test('a done run: the ended lead answers a follow-up message', async ({ page }) => {
  const sc = followUpScenario(
    { state: 'available', reason: null },
    { messages: FOLLOW_UP_MESSAGES },
  );
  const run = sc.routes[`/api/runs/${RUN_ID}`] as Record<string, unknown>;
  const messages = run['messages'] as unknown[];
  const question = 'Where does the switch read the theme?';
  let phase: 'before' | 'running' | 'answered' = 'before';
  const sent: { csrf: string | null; body: unknown }[] = [];
  await serve(page, sc);
  // Registered after `serve`, so these answer first: the run moves on as the server's would.
  await page.route(`**/api/runs/${RUN_ID}`, (route) =>
    route.fulfill({
      json:
        phase === 'before'
          ? run
          : {
              ...run,
              followUp: { state: phase === 'running' ? 'running' : 'available', reason: null },
              messages: [
                ...messages,
                followUpOwnerMessage(question),
                ...(phase === 'answered' ? [followUpLeadAnswer()] : []),
              ],
            },
    }),
  );
  await page.route(`**/api/runs/${RUN_ID}/chat`, async (route) => {
    sent.push({
      csrf: (await route.request().headerValue('x-acp-csrf')) ?? null,
      body: route.request().postDataJSON() as unknown,
    });
    phase = 'running';
    await route.fulfill({ status: 201, json: followUpOwnerMessage(question) });
  });
  await page.goto(`/${TICKET_HASH}`);
  const panel = page.getByTestId('side-panel');
  await expect(panel.getByRole('heading', { name: 'Lead', exact: true })).toBeVisible();
  await expect(panel.getByTestId('chat-notice')).toContainText('The lead has finished.');
  await expect(panel.getByTestId('chat-divider')).toHaveText('After the run ended');
  await expect(panel.getByTestId('chat-tag')).toHaveCount(2);
  await shoot(page, 'follow-up');

  const box = panel.getByRole('textbox', { name: 'Message to the lead agent' });
  await box.fill(question);
  await box.press('Enter');
  await expect(panel.getByRole('status')).toHaveText('The lead is answering…');
  await expect(box).toBeDisabled();
  expect(sent).toEqual([{ csrf: CSRF, body: { text: question } }]);
  await shoot(page, 'follow-up-running');

  // The answer arrives; the server's notice would refetch the run, the reload stands in for it.
  phase = 'answered';
  await page.reload();
  await expect(panel.getByText('The store is in src/theme/store.ts')).toBeVisible();
  await expect(panel.getByTestId('chat-tag')).toHaveCount(4);
  await expect(panel.getByRole('textbox', { name: 'Message to the lead agent' })).toBeEnabled();
});

test('a done run whose conversation is gone says why it can’t be continued', async ({ page }) => {
  await open(page, followUpScenario({ state: 'unavailable', reason: 'session-gone' }));
  const panel = page.getByTestId('side-panel');
  await expect(panel.getByText(/no longer has this conversation/)).toBeVisible();
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await shoot(page, 'follow-up-unavailable');
});
