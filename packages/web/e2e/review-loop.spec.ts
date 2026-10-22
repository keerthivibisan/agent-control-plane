import { expect, test, type Page } from '@playwright/test';
import {
  CSRF,
  L_UI,
  LOOP_BRANCH,
  LOOP_BRANCH_PATH,
  LOOP_KEY,
  LOOP_PROJECT_GRAPH_PATH,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_REVIEW_PATH,
  LOOP_RUN_PATH,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  PROJECT_ID,
  loopDoneScenario,
  loopNeedsYouScenario,
  loopReviewScenario,
  loopWorkingScenario,
  type LoopScenario,
} from './review-loop-fixtures.js';
import { fixtureProject } from './ticket-fixtures.js';
import { graphDto, WF_PROJECT_ID } from './workflow-fixtures.js';

/*
 * RL-D (ADR-0021): the review loop in the browser, on the demo server's built UI, with the ticket,
 * run, review and ticket-branch routes answered from synthetic fixtures (page.route) while RL-A/B
 * build the real ones. The fixtures move on like the engine would: the owner's discard of the last
 * undecided change brings the run to REVIEW, and the merge of the ticket branch completes it.
 * Mutations never reach a server. With ACP_SCREENSHOT_DIR set, it saves light and dark
 * screenshots at 1440, 1024 and 390 pixels wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;
const TICKET_HASH = `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`;

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/rl-${name}-${width}-${scheme}.png`, fullPage });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

/** A picture of one element (a card or a dialog), in both themes at each width. */
async function shootPart(page: Page, name: string, testId: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
      // Tall enough that the part fits: a scrolled element picture draws the sticky bar over it.
      await page.setViewportSize({ width, height: 2000 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      const part = page.getByTestId(testId).first();
      await part.scrollIntoViewIfNeeded();
      await part.screenshot({ path: `${SHOTS}/rl-${name}-${width}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

type Stage = 'working' | 'needs-you' | 'review' | 'done';

interface Loop {
  posts: { path: string; body: unknown }[];
  advance: (stage: Stage) => void;
}

/** Serves the loop's fixtures; owner actions move the run on, as the engine would. */
async function serveLoop(page: Page, start: Stage): Promise<Loop> {
  const scenarios: Record<Stage, LoopScenario> = {
    working: loopWorkingScenario(),
    'needs-you': loopNeedsYouScenario(),
    review: loopReviewScenario(),
    done: loopDoneScenario(),
  };
  let stage = start;
  const posts: Loop['posts'] = [];
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route(`**${LOOP_PROJECT_WORKFLOW_PATH}`, (route) =>
    route.fulfill({ json: scenarios[stage].routes[LOOP_PROJECT_WORKFLOW_PATH] }),
  );
  // WG-F: the run options and the Start dialog read the project's graph.
  await page.route(`**${LOOP_PROJECT_GRAPH_PATH}`, (route) =>
    route.fulfill({ json: scenarios[stage].routes[LOOP_PROJECT_GRAPH_PATH] }),
  );
  await page.route(/\/api\/(tickets|runs|control)\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') {
      expect(req.headers()['x-acp-csrf']).toBe(CSRF);
      const body = req.postDataJSON() as Record<string, unknown>;
      posts.push({ path: url.pathname, body });
      if (url.pathname === LOOP_REVIEW_PATH && body['action'] === 'discard') stage = 'review';
      if (url.pathname === LOOP_BRANCH_PATH && body['action'] === 'merge') stage = 'done';
      const routes = scenarios[stage].routes;
      await route.fulfill({
        json:
          url.pathname === LOOP_REVIEW_PATH
            ? routes[LOOP_REVIEW_PATH]
            : url.pathname === LOOP_BRANCH_PATH
              ? routes[LOOP_BRANCH_PATH]
              : url.pathname.endsWith('/start')
                ? routes[LOOP_TICKET_PATH]
                : routes[LOOP_RUN_PATH],
      });
      return;
    }
    const body = scenarios[stage].routes[url.pathname];
    if (body === undefined) {
      await route.fulfill({
        status: 404,
        json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
      });
      return;
    }
    await route.fulfill({ json: body });
  });
  return {
    posts,
    advance: (s) => {
      stage = s;
    },
  };
}

test('the full loop: rework, a lead question, the owner’s discard, the final merge', async ({
  page,
}) => {
  const loop = await serveLoop(page, 'working');
  // v0.3.0 D-B, C-B: the changes are on Files changed, the agents on Agents, the rest on Comments.
  const tab = (name: RegExp) =>
    page.getByRole('tablist', { name: 'Ticket sections' }).getByRole('tab', { name });
  await page.goto(`/${TICKET_HASH}?tab=files`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Saved searches');

  // Working: the API builder reworks its change; the Search UI's change is in review.
  const overview = page.getByTestId('changes-overview');
  await expect(overview.getByTestId('change-state')).toHaveText([
    /Rework round 1 of 2/,
    /In review/,
  ]);
  await tab(/Comments/).click();
  await expect(page.getByTestId('run-approval-mode')).toHaveText('Auto edits');
  await expect(page.getByTestId('owner-decision')).toHaveCount(0);
  await tab(/Agents/).click();
  await expect(page.getByTestId('review-counts')).toHaveText('1 in review · 1 in rework');
  await expect(page.getByTestId('live-owner-merge')).toHaveAttribute('data-state', 'waiting');
  await expect(page.getByTestId('agent-canvas')).toContainText(
    'Asked a helper to rework its change',
  );
  await tab(/Files changed/).click();
  await overview.getByTestId('change-row').first().getByRole('button', { name: 'Open' }).click();
  const panel = page.getByTestId('side-panel');
  await expect(panel.getByTestId('change-finding')).toContainText('Cap pageSize at 100');
  await shoot(page, 'working');

  // The engine moves on: the reworked change is merged; the lead asks about the other one.
  loop.advance('needs-you');
  await page.reload();
  await tab(/Comments/).click();
  const need = page.getByTestId('changes-need-you');
  await expect(need).toContainText('1 change needs your decision');
  await need.getByRole('button', { name: 'Open' }).click();
  const card = panel.getByTestId('change-card');
  await expect(card.getByTestId('change-state')).toHaveAttribute('data-state', 'needs-owner');
  await expect(card.getByTestId('change-conflicts')).toContainText('src/search/api.ts');
  await expect(card.getByTestId('owner-decision')).toContainText('The lead asked you to decide.');
  await shootPart(page, 'change-card', 'side-panel');
  await shoot(page, 'needs-you');

  // The owner discards it: the run comes to REVIEW with the ticket branch to merge.
  await card.getByRole('button', { name: 'Discard', exact: true }).click();
  await card.getByRole('button', { name: 'Discard change' }).click();
  await expect(page.getByTestId('live-owner-merge')).toHaveAttribute('data-state', 'needs-you');
  await tab(/Checks/).click();
  await expect(page.getByTestId('branch-checks')).toBeVisible();
  await tab(/Files changed/).click();
  await page.getByTestId('branch-diff').locator('summary').click();
  await shootPart(page, 'ticket-branch', 'branch-files');
  await tab(/Comments/).click();
  const branch = page.getByTestId('ticket-branch');
  await expect(branch.getByRole('button', { name: 'Merge into main' })).toBeVisible();
  await expect(page.getByTestId('changes-need-you')).toHaveCount(0);
  await shoot(page, 'review');

  // The final merge, once, after a confirmation.
  await branch.getByRole('button', { name: 'Merge into main' }).click();
  await expect(branch.getByTestId('confirm')).toContainText(`Merge ${LOOP_BRANCH} into main?`);
  await branch.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(branch.getByTestId('branch-state')).toHaveText('Merged into main');
  await expect(page.getByTestId('ticket-stage')).toContainText('Done');
  await tab(/Agents/).click();
  await expect(page.getByTestId('live-owner-merge')).toHaveAttribute('data-state', 'done');
  await shoot(page, 'done');

  expect(loop.posts).toEqual([
    { path: LOOP_REVIEW_PATH, body: { agentRunId: L_UI, action: 'discard' } },
    { path: LOOP_BRANCH_PATH, body: { action: 'merge' } },
  ]);
});

test('the Start dialog: Re-run with this run’s own settings', async ({ page }) => {
  const loop = await serveLoop(page, 'done');
  await page.goto(`/${TICKET_HASH}`);
  await page.getByRole('button', { name: `Re-run ${LOOP_KEY} with options` }).click();
  const dialog = page.getByTestId('start-dialog');
  // WG-E (ADR-0023): the mode is a limit; without one, each block keeps its own mode.
  await expect(dialog.getByRole('radio', { name: /^No limit/ })).toBeChecked();
  await dialog.getByText('Manual', { exact: true }).click();
  await dialog.getByText('The lead', { exact: true }).click();
  await expect(dialog.getByTestId('start-dialog-summary')).toHaveText(
    '2 choices differ from the project, for this run only.',
  );
  await shootPart(page, 'start-dialog', 'start-dialog');
  await dialog.getByRole('button', { name: 'Re-run', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(loop.posts).toEqual([
    { path: `${LOOP_TICKET_PATH}/start`, body: { approvalMode: 'manual', reviewer: 'lead' } },
  ]);
});

test('the Workflow page: approvals with Auto’s command list, and the change reviewer block', async ({
  page,
}) => {
  // WG-D: the approvals are in the Project defaults card, and the review stage is the change
  // reviewer block with its links. Like the rest of this file, the routes are fixtures on the demo
  // server (its project p-web exists only in them).
  const puts: unknown[] = [];
  const BASE = `/api/projects/${WF_PROJECT_ID}`;
  let current = graphDto();
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: CSRF } }));
  await page.route(`**${BASE}/agents`, (route) => route.fulfill({ json: [] }));
  await page.route(`**${BASE}/workflow-graph`, (route) => route.fulfill({ json: current }));
  await page.route(`**${BASE}/setup`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    puts.push(body);
    const setup = { ...(current['setup'] as object), ...body };
    current = { ...current, setup };
    await route.fulfill({ json: setup });
  });
  await page.goto(`/#/p/${WF_PROJECT_ID}/workflow`);
  const defaults = page.getByTestId('project-defaults');
  const editor = defaults.getByTestId('approvals-editor');
  await editor.getByText('Auto', { exact: true }).click();
  await expect(editor.getByTestId('approvals-warning')).toBeVisible();
  const command = editor.getByRole('textbox', { name: 'Command' });
  await command.fill('npm test');
  await command.press('Enter');
  await command.fill('git push');
  await command.press('Enter');
  await expect(editor.getByTestId('command-error')).toContainText(
    'git needs a read-only subcommand',
  );
  await command.fill('mvn');
  await editor.getByRole('combobox', { name: 'How it matches' }).selectOption('prefix');
  await editor.getByRole('button', { name: 'Add command' }).click();
  await command.fill('make lint; rm -rf .');
  await command.press('Enter');
  await expect(editor.getByTestId('command-row')).toHaveCount(2);
  await expect(page.getByTestId('block-owner-merge')).toBeVisible();
  await shootPart(page, 'approvals-editor', 'project-defaults');
  await defaults.getByRole('button', { name: 'Save project defaults' }).click();
  await expect(defaults.getByTestId('defaults-saved')).toBeVisible();
  expect(puts[0]).not.toHaveProperty('allowlist');
  expect(puts[0]).toMatchObject({
    approvals: {
      mode: 'auto',
      commands: [
        { argv: ['npm', 'test'], match: 'exact' },
        { argv: ['mvn'], match: 'prefix' },
      ],
    },
  });

  // The change reviewer: a read-only block (no approval mode) that sends findings to the lead.
  await page.getByTestId('block-review').click();
  const panel = page.getByRole('complementary', { name: 'Block settings' });
  await expect(panel.getByTestId('node-panel')).toHaveAttribute('data-node', 'review');
  await expect(panel.getByRole('radio', { name: /^Each change/ })).toBeChecked();
  await expect(panel.getByTestId('no-mode')).toBeVisible();
  await expect(panel.getByTestId('node-links')).toContainText('Sends its findings → Lead');
  await shootPart(page, 'review-stage', 'block-panel');
  await shoot(page, 'workflow', false);
});
