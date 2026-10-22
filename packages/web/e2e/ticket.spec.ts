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
import {
  LIVE_GRAPH_PATH,
  PROJECT_GRAPH_PATH,
  carefulGraph,
  directLoopScenario,
  projectGraphDto,
} from './live-graph-fixtures.js';
import {
  LOOP_KEY,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  loopDoneScenario,
} from './review-loop-fixtures.js';

/*
 * P4-G: the ticket page in the browser, on the built UI served by the demo server, with the
 * ticket and run routes answered from synthetic fixtures (page.route), because the server routes
 * arrive with P4-D. Mutations are answered but never reach a server. With ACP_SCREENSHOT_DIR set,
 * it also saves light and dark screenshots at 1440 and 1024 pixels wide for the WP review.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;

// U-V: a test can end while a `route.fetch()` handler is mid-way ("Response has been disposed").
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

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
  // WG-F: the ticket's run options read the project's graph.
  await page.route(`**${PROJECT_GRAPH_PATH}`, (route) =>
    route.fulfill({ json: sc.routes[PROJECT_GRAPH_PATH] }),
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

/** Opens the ticket, on a tab when given (v0.3.0 D-B: the address's `?tab=`). */
async function open(
  page: Page,
  sc: TicketScenario,
  tab?: 'agents' | 'files' | 'checks',
): Promise<{ posts: () => string[] }> {
  const server = await serve(page, sc);
  await page.goto(`/${TICKET_HASH}${tab ? `?tab=${tab}` : ''}`);
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

test('plan review: the plan card comes first on Conversation; the tree is on Agents', async ({
  page,
}) => {
  await open(page, planReviewScenario());
  const card = page.getByTestId('plan-card');
  await expect(card).toContainText('Version 2');
  await expect(card.getByRole('button', { name: 'Approve plan' })).toBeVisible();
  await expect(page.getByTestId('agent-canvas')).toHaveCount(0);
  await shoot(page, 'plan-review');
});

test('working: depth-2 helpers nest under their parent; an approval waits', async ({ page }) => {
  await open(page, workingScenario(), 'agents');
  const nested = page.getByRole('list', { name: 'Started by Theme store' });
  await expect(nested.getByRole('article', { name: 'Migration helper' })).toBeVisible();
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
  // What waits for you is first on Conversation.
  await page.getByRole('tab', { name: /Conversation/ }).click();
  await expect(page.getByTestId('approvals')).toContainText('Edit src/theme/store.ts');
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
  await open(page, planReviewScenario(), 'agents');
  const graph = page.getByTestId('live-workflow');
  await expect(graph.getByTestId('live-plan')).toHaveAttribute('data-state', 'needs-you');
  await expect(graph.getByTestId('live-approve')).toHaveAttribute('data-state', 'needs-you');
  await expect(page.getByTestId('ticket-summary')).not.toContainText('Plan ready for you');
});

test('working with stages: a separate planner, helpers at work, review stages waiting', async ({
  page,
}) => {
  await open(page, stagesScenario(), 'agents');
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
  await open(page, reviewedScenario(), 'agents');
  await expect(page.getByTestId('live-code-review')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('live-unit-tests')).toHaveAttribute('data-state', 'needs-you');
  await expect(page.getByTestId('held-stage')).toHaveCount(0);
  await expect(page.getByTestId(`agent-${TESTER}`).getByTestId('agent-term')).toHaveText(
    'Tester agent',
  );
  await page.getByTestId('reviewer-findings-link').click();
  const reviewer = page.getByTestId('comments').locator('[data-author="reviewer"]');
  await expect(reviewer.getByTestId('comment-author')).toHaveText('Reviewer');
  await shoot(page, 'reviewed');
});

test('a held stage: Continue starts it', async ({ page }) => {
  const server = await open(page, heldScenario(), 'agents');
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
  await page.goto(`/${TICKET_HASH}?tab=agents`);
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
  await open(page, followUpScenario({ state: 'unavailable', reason: 'session-gone' }), 'agents');
  const panel = page.getByTestId('side-panel');
  await expect(panel.getByText(/no longer has this conversation/)).toBeVisible();
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await shoot(page, 'follow-up-unavailable');
});

// --- R-V: a refused follow-up message shows the server's reason --------------------------------

test('a follow-up the server refuses shows its reason, and the box stays usable', async ({
  page,
}) => {
  const sc = followUpScenario(
    { state: 'available', reason: null },
    { messages: FOLLOW_UP_MESSAGES },
  );
  await serve(page, sc);
  const reason = 'Another answer is still being written. Wait for it, then ask again.';
  let calls = 0;
  await page.route(`**/api/runs/${RUN_ID}/chat`, async (route) => {
    calls++;
    await route.fulfill({
      status: 409,
      json: { error: { code: 'follow_up_running', message: reason, requestId: 'e2e' } },
    });
  });
  await page.goto(`/${TICKET_HASH}?tab=agents`);
  const panel = page.getByTestId('side-panel');
  const box = panel.getByRole('textbox', { name: 'Message to the lead agent' });
  await box.fill('Is it done?');
  await box.press('Enter');
  // The owner reads the server's reason in words; the code stays under "Technical details".
  await expect(
    panel.getByRole('alert').filter({ hasText: "Your message wasn't sent." }),
  ).toContainText(reason);
  expect(calls).toBe(1);
  await expect(box).toBeEnabled();
  await shoot(page, 'follow-up-refused');
});

// --- WG-E (ADR-0023): the run's own workflow graph, and run options as a limit -----------------

/** Serves a review-loop ticket's routes (GET from the table; a POST answers the ticket). */
async function serveRoutes(
  page: Page,
  routes: Record<string, unknown>,
): Promise<{ posts: () => { path: string; body: unknown }[] }> {
  const posts: { path: string; body: unknown }[] = [];
  await withFixtureProject(page);
  await page.route(/\/api\/(tickets|runs|control|projects\/[^/]+\/workflow)/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      expect(await route.request().headerValue('x-acp-csrf')).toBe(CSRF);
      posts.push({ path: url.pathname, body: route.request().postDataJSON() as unknown });
      await route.fulfill({ json: routes[LOOP_TICKET_PATH] });
      return;
    }
    const body = routes[url.pathname];
    if (body === undefined) {
      await route.fulfill({
        status: 404,
        json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
      });
      return;
    }
    await route.fulfill({ json: body });
  });
  return { posts: () => [...posts] };
}

const LOOP_HASH = `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`;

/** The live graph card in both themes and widths, as a picture of the card itself. */
async function shootGraph(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 1400 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(500);
      const card = page.getByTestId('live-workflow');
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${SHOTS}/ticket-${name}-${width}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

test('the run’s own graph: states, modes, the sandbox and the review agent’s direct rework', async ({
  page,
}) => {
  await serveRoutes(page, directLoopScenario().routes);
  await page.goto(`/${LOOP_HASH}?tab=agents`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Saved searches');
  const graph = page.getByTestId('live-run-graph');
  await expect(graph).toBeVisible();
  await expect(page.getByTestId('wf-node-review')).toHaveCount(0);
  const block = (id: string) => page.getByTestId(`live-block-${id}`);
  await expect(block('orchestrate')).toHaveAttribute('data-state', 'active');
  await expect(block('plan-approval')).toHaveAttribute('data-state', 'done');
  await expect(block('code-review')).toHaveAttribute('data-state', 'waiting');
  // The Full auto helper runs as Auto edits in this run and keeps the sandbox.
  await expect(block('api-helper').getByTestId('live-mode')).toHaveText('Mode: Auto edits');
  await expect(block('api-helper').getByTestId('live-sandbox')).toHaveText('Sandboxed');
  await expect(block('helpers').getByTestId('live-sandbox')).toHaveCount(0);
  await expect(block('review').getByTestId('live-direct')).toBeVisible();
  // The review agent's direct rework, on its own link, apart from the lead's.
  await expect(graph.getByText('Direct rework ×1')).toBeVisible();
  await expect(graph.getByText('Rework', { exact: true })).toBeVisible();
  await expect(page.getByTestId('review-counts')).toHaveText('1 in review · 1 in rework');
  await shootGraph(page, 'live-graph');
  await shoot(page, 'live-graph-page');

  // An agent on a block shows itself in the side panel.
  await block('api-helper')
    .getByRole('button', { name: 'Show the API helper in the side panel' })
    .click();
  await expect(
    page.getByTestId('side-panel').getByRole('heading', { name: 'API helper' }),
  ).toBeVisible();
  // Its change: the review agent decided the rework itself.
  await page.getByRole('tab', { name: /Files changed/ }).click();
  await page.getByTestId('changes-overview').getByRole('button', { name: /^Open/ }).first().click();
  const card = page.getByTestId('side-panel').getByTestId('change-card');
  await expect(card.getByTestId('change-direct-rounds')).toContainText(
    'Review agent: 1 direct rework round',
  );
  await expect(card.getByTestId('change-history')).toContainText(
    'Review agent sent it back to the helper for rework',
  );
});

test('a server without run graphs keeps the version 1 workflow', async ({ page }) => {
  const routes = { ...directLoopScenario().routes };
  delete routes[LIVE_GRAPH_PATH];
  await serveRoutes(page, routes);
  await page.goto(`/${LOOP_HASH}?tab=agents`);
  await expect(page.getByTestId('wf-node-review')).toBeVisible();
  await expect(page.getByTestId('live-run-graph')).toHaveCount(0);
});

test('the Start dialog: the approval mode is a limit', async ({ page }) => {
  const server = await serveRoutes(page, {
    ...loopDoneScenario().routes,
    [PROJECT_GRAPH_PATH]: projectGraphDto(carefulGraph()),
  });
  await page.goto(`/${LOOP_HASH}`);
  await page.getByRole('button', { name: `Re-run ${LOOP_KEY} with options` }).click();
  const dialog = page.getByTestId('start-dialog');
  await expect(dialog.getByText('Approval mode: at most')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /^No limit/ })).toBeChecked();
  // WG-F: the dialog is taller than this 720-pixel window and focuses Re-run at its foot. It
  // opens at its top: the title and the first choice are in view, near the top of the window.
  await expect(dialog.getByRole('button', { name: 'Re-run', exact: true })).toBeFocused();
  await expect(dialog.getByRole('heading', { name: `Re-run ${LOOP_KEY}` })).toBeInViewport();
  const firstChoice = (await dialog.getByRole('radio', { name: /^No limit/ }).boundingBox())?.y;
  expect(firstChoice).toBeGreaterThanOrEqual(0);
  expect(firstChoice).toBeLessThan(260);
  if (SHOTS !== undefined) {
    // The window as the owner sees the dialog open (after its fade-in).
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/ticket-start-open-light.png` });
  }
  await expect(dialog.getByTestId('mode-limit-summary')).toHaveText(
    'Approval mode: no limit — each block keeps the mode set on the Workflow page.',
  );
  await expect(dialog.getByText(/Blocks set to Project default use Auto edits\./)).toBeVisible();
  await dialog.getByText('Full auto', { exact: true }).click();
  await expect(dialog.getByTestId('mode-no-effect')).toHaveText(
    'No block in this workflow is set looser than Auto edits, so “at most Full auto” changes nothing.',
  );
  await expect(dialog.getByTestId('full-auto-warning')).toHaveCount(0);
  await dialog.getByText('Manual', { exact: true }).click();
  await expect(dialog.getByTestId('mode-limit-summary')).toHaveText(
    'Approval mode: at most Manual — blocks set to a stricter mode keep it; this can’t loosen any block.',
  );
  await expect(dialog.getByTestId('mode-no-effect')).toHaveCount(0);
  await expect(dialog.getByText(/^Lead reviews: every change goes to the lead/)).toBeVisible();
  if (SHOTS !== undefined) {
    // A picture of the whole dialog: in a window as tall as it, scrolled to its top. (In a
    // shorter window, the part the clicks above scrolled out of the overlay comes out blank.)
    const size = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.setViewportSize({ width: size.width, height: 1100 });
    await page.getByTestId('start-dialog').evaluate((d) => d.parentElement?.scrollTo(0, 0));
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await dialog.screenshot({ path: `${SHOTS}/ticket-start-limit-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize(size);
  }
  await dialog.getByRole('button', { name: 'Re-run', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(server.posts()).toEqual([
    { path: `${LOOP_TICKET_PATH}/start`, body: { approvalMode: 'manual' } },
  ]);
});
