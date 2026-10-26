import { expect, test, type Page } from '@playwright/test';
import { LIVE_GRAPH_PATH, directLoopScenario } from './live-graph-fixtures.js';
import { LOOP_RUN_PATH, LOOP_TICKET_ID, LOOP_TICKET_PATH } from './review-loop-fixtures.js';
import { CSRF, PROJECT_ID, fixtureProject } from './ticket-fixtures.js';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  agentFilesFixture,
  graphDto,
  setupFixture,
} from './workflow-fixtures.js';

/*
 * v0.3.1 P-B (ADR-0028) in the browser, on the demo server's built UI with synthetic routes
 * (page.route): the Workflow editor's Effort select, removing the Checks block before the lead's
 * merge and saving with the "no checks" warning, the Finish block in the editor, and the Finish
 * block and an effort chip on the ticket page's live run graph. With ACP_SCREENSHOT_DIR set, it
 * saves light and dark screenshots at 1440 pixels wide.
 *
 * Removing the last Checks block is a warning, not an error (ADR-0028 §2, core's `no-checks`), and
 * the lead then merges straight into the ticket branch.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

type Json = Record<string, unknown>;
const BASE = `/api/projects/${WF_PROJECT_ID}`;

const GIT_FLOW = {
  preset: 'git-flow',
  baseBranch: 'develop',
  defaultTargetBranch: 'develop',
  ticketBranchTemplate: '{type}/{key}-{slug}',
  typeWords: { feature: 'feature', bug: 'bugfix', chore: 'chore', harness: 'chore' },
};

async function withFixtureProject(page: Page): Promise<void> {
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
}

/** The Workflow page's routes; a PUT stores the graph it gets. */
async function serveWorkflow(page: Page, initial: Json): Promise<{ puts: Json[] }> {
  const puts: Json[] = [];
  let current = structuredClone(initial);
  await withFixtureProject(page);
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: WF_CSRF } }));
  await page.route(`**${BASE}/agents`, (route) => route.fulfill({ json: agentFilesFixture() }));
  await page.route(`**${BASE}/workflow-graph`, async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      expect(req.headers()['x-acp-csrf']).toBe(WF_CSRF);
      const body = req.postDataJSON() as Json;
      puts.push(body);
      current = { ...current, graph: body['graph'], stored: 'v2' };
    }
    await route.fulfill({ json: current });
  });
  return { puts };
}

/** The ticket page's routes for a review-loop run (GET from the table). */
async function serveTicket(page: Page, routes: Record<string, unknown>): Promise<void> {
  await withFixtureProject(page);
  await page.route(/\/api\/(tickets|runs|control|projects\/[^/]+\/workflow)/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      expect(await route.request().headerValue('x-acp-csrf')).toBe(CSRF);
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
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SHOTS}/p-b-${name}-1440-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Block settings' });

test('the editor: effort on an agent block, no Checks block, the Finish block', async ({
  page,
}) => {
  const served = await serveWorkflow(
    page,
    graphDto({
      setup: setupFixture({
        approvals: { mode: 'auto-edits', commands: [] },
        branching: GIT_FLOW,
      }),
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`/#/p/${WF_PROJECT_ID}/workflow`);
  await expect(page.getByTestId('graph-editor')).toBeVisible();

  // The Finish block: one block with the project's target, Done in it; no separate Done.
  const finish = page.getByTestId('block-owner-merge');
  await expect(finish).toHaveAttribute('data-kind', 'finish');
  await expect(finish.getByTestId('finish-text')).toHaveText(
    'Merge into develop or open a pull request',
  );
  await expect(finish.getByTestId('finish-done')).toHaveText('then Done');
  await expect(page.getByTestId('block-done')).toHaveCount(0);
  await expect(page.getByTestId('block-ticket-merge')).toHaveCount(0);
  await finish.click();
  await expect(panel(page)).toContainText(
    'You finish every ticket: merge it into develop here, or push it and open a pull request.',
  );
  await expect(panel(page).getByRole('button', { name: 'Remove block' })).toHaveCount(0);
  await shoot(page, 'finish-panel');

  // Effort: the lead's panel, next to Model; the keyboard picks High.
  await page.getByTestId('block-orchestrate').click();
  const effort = panel(page).getByRole('combobox', { name: 'Effort' });
  await expect(effort).toHaveValue('default');
  await expect(panel(page).getByTestId('effort-field')).toContainText(
    'more effort is slower and uses more tokens',
  );
  await effort.focus();
  await effort.selectOption('high');
  await expect(page.getByTestId('block-orchestrate').getByTestId('block-effort')).toHaveText(
    'High effort',
  );
  await shoot(page, 'agent-panel');

  // The Checks block before the lead's merge can be removed: a warning, not an error.
  const checks = page.getByTestId('block-checks');
  await expect(checks.getByTestId('checks-kind')).toHaveText('Checks before merge');
  await checks.click();
  await expect(panel(page).getByTestId('check-optional')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Remove block' }).click();
  await expect(page.getByTestId('block-checks')).toHaveCount(0);
  await expect(page.getByTestId('problems-button')).toHaveAttribute('data-errors', '0');
  await page.getByTestId('problems-button').click();
  const warnings = page.getByTestId('issues-warnings');
  await expect(warnings).toBeVisible();
  await expect(warnings).toContainText(/check/i);

  // Add block → Checks offers the place again.
  await page.getByTestId('add-block').click();
  await expect(page.getByTestId('palette-checks-merge')).not.toHaveAttribute('data-disabled', '');
  await page.keyboard.press('Escape');

  // Save: stored with the effort, without a Checks block, with the three end steps kept.
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  const graph = served.puts[0]?.['graph'] as {
    nodes: { id: string; type: string; effort?: string }[];
  };
  expect(graph.nodes.find((n) => n.id === 'orchestrate')?.effort).toBe('high');
  expect(graph.nodes.some((n) => n.type === 'checks')).toBe(false);
  expect(
    graph.nodes.filter((n) => ['ticket-merge', 'owner-merge', 'done'].includes(n.type)),
  ).toHaveLength(3);
  // The warning stays after the save.
  await expect(page.getByTestId('issues-warnings')).toBeVisible();
  await shoot(page, 'no-checks');
});

test('the live run graph: the Finish block with the run’s target, and the effort chip', async ({
  page,
}) => {
  const sc = directLoopScenario();
  const run = sc.routes[LOOP_RUN_PATH] as Json;
  const live = sc.routes[LIVE_GRAPH_PATH] as Json;
  const inner = live['graph'] as Json;
  await serveTicket(page, {
    ...sc.routes,
    [LOOP_RUN_PATH]: {
      ...run,
      ticketBranch: { ...(run['ticketBranch'] as Json), baseBranch: 'develop' },
    },
    [LIVE_GRAPH_PATH]: {
      ...live,
      graph: {
        ...inner,
        nodes: (inner['nodes'] as Json[]).map((n) =>
          n['id'] === 'orchestrate' ? { ...n, effort: 'high' } : n,
        ),
      },
    },
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}?tab=agents`);
  await expect(page.getByTestId('live-run-graph')).toBeVisible();
  const finish = page.getByTestId('live-node-owner-merge');
  await expect(finish).toHaveAttribute('data-kind', 'finish');
  await expect(finish.getByTestId('live-finish-text')).toHaveText(
    'Merge into develop or open a pull request',
  );
  await expect(finish.getByTestId('live-finish-done')).toHaveAttribute('data-done', 'false');
  await expect(page.getByTestId('live-block-done')).toHaveCount(0);
  await expect(page.getByTestId('live-block-orchestrate').getByTestId('live-effort')).toHaveText(
    'High effort',
  );
  if (SHOTS !== undefined) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(500);
      const card = page.getByTestId('live-workflow');
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${SHOTS}/p-b-live-finish-1440-${scheme}.png` });
    }
  }
});
