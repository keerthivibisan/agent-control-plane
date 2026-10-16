import { expect, test, type Page } from '@playwright/test';
import { fixtureProject } from './ticket-fixtures.js';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  agentFilesFixture,
  defaultWorkflowDto,
  fullWorkflowDto,
} from './workflow-fixtures.js';

/*
 * Redesign R-B: the Workflow page in the browser, on the demo server's built UI. The workflow,
 * setup, CSRF token and agent-file routes are answered from synthetic fixtures (page.route), so the
 * graph, the stage panel and the saves can be checked without managed agents. With
 * ACP_SCREENSHOT_DIR set, it saves light and dark screenshots at 1440 and 1024 pixels wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;
const BASE = `/api/projects/${WF_PROJECT_ID}`;

interface Served {
  puts: { path: string; body: unknown }[];
}

async function serve(page: Page, initial: Record<string, unknown>, agents = true): Promise<Served> {
  const served: Served = { puts: [] };
  let current = structuredClone(initial);
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: WF_CSRF } }));
  await page.route(`**${BASE}/agents`, (route) =>
    agents
      ? route.fulfill({ json: agentFilesFixture() })
      : route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', message: 'no route', requestId: 'e2e' } },
        }),
  );
  await page.route(`**${BASE}/workflow`, async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      expect(req.headers()['x-acp-csrf']).toBe(WF_CSRF);
      const body = req.postDataJSON() as Record<string, unknown>;
      served.puts.push({ path: 'workflow', body });
      current = {
        ...current,
        workflow: { ...(current['workflow'] as object), ...body },
      };
    }
    await route.fulfill({ json: current });
  });
  await page.route(`**${BASE}/setup`, async (route) => {
    const req = route.request();
    const body = req.postDataJSON() as Record<string, unknown>;
    served.puts.push({ path: 'setup', body });
    const setup = { ...(current['setup'] as object), ...body };
    current = { ...current, setup };
    await route.fulfill({ json: setup });
  });
  return served;
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 1240 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      // The viewport, not fullPage: a full-page capture tears at the sticky top bar.
      await page.screenshot({ path: `${SHOTS}/workflow-${name}-${width}-${scheme}.png` });
      // Below 1360px the panel sits under the graph; capture it too when a stage is open.
      if (width === 1024 && (await panel(page).getAttribute('data-stage')) !== null) {
        await panel(page).scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${SHOTS}/workflow-${name}-panel-${width}-${scheme}.png` });
      }
    }
  }
}

const node = (page: Page, id: string) => page.getByTestId(`wf-node-${id}`);
const panel = (page: Page) => page.getByRole('complementary', { name: 'Stage settings' });

test('the default workflow: one lead plans and orchestrates; optional stages are off', async ({
  page,
}) => {
  await serve(page, defaultWorkflowDto(), false);
  await page.goto(`/#/p/${WF_PROJECT_ID}/workflow`);
  await expect(page.getByRole('heading', { level: 1, name: /Workflow/ })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workflow' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(node(page, 'plan')).toBeVisible();
  await expect(node(page, 'plan')).toHaveAttribute('data-role', 'lead');
  await expect(node(page, 'plan').getByTestId('same-agent')).toBeVisible();
  await expect(node(page, 'code-review')).toHaveAttribute('data-enabled', 'false');
  await expect(page.getByTestId(/^wf-helper-/)).toHaveCount(3);
  // The agent files route isn't served yet (404): the list is hidden, not an error.
  await expect(page.getByTestId('agent-files')).toHaveCount(0);
  // Every node of the graph is inside the canvas (fit to the width, nothing cut off).
  const canvas = await page.getByTestId('workflow-graph').boundingBox();
  for (const id of ['ticket', 'approve', 'done', 'unit-tests']) {
    const box = await node(page, id).boundingBox();
    expect(box).not.toBeNull();
    if (canvas && box) {
      expect(box.x).toBeGreaterThanOrEqual(canvas.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
    }
  }
  await shoot(page, 'default');
});

test('turning on the final code review saves the workflow', async ({ page }) => {
  const served = await serve(page, defaultWorkflowDto());
  await page.goto(`/#/p/${WF_PROJECT_ID}/workflow`);
  await node(page, 'code-review').click();
  await expect(panel(page)).toHaveAttribute('data-stage', 'code-review');
  await panel(page).getByRole('checkbox', { name: 'Run this stage' }).check();
  await expect(node(page, 'code-review')).toHaveAttribute('data-enabled', 'true');
  await panel(page).getByRole('combobox', { name: 'Skill' }).selectOption('code-review');
  await panel(page).getByRole('button', { name: 'Save' }).click();
  await expect(panel(page).getByTestId('saved')).toHaveText('Saved');
  expect(served.puts).toHaveLength(1);
  expect(served.puts[0]).toMatchObject({
    path: 'workflow',
    body: { stages: { 'code-review': { enabled: true, skill: 'code-review' } } },
  });
});

test('everything on: separate planner, four helpers at depth 2, a missing skill', async ({
  page,
}) => {
  const served = await serve(page, fullWorkflowDto());
  await page.goto(`/#/p/${WF_PROJECT_ID}/workflow`);
  await expect(node(page, 'plan')).toHaveAttribute('data-role', 'planner');
  await expect(node(page, 'plan').getByTestId('same-agent')).toHaveCount(0);
  await expect(page.getByTestId(/^wf-helper-/)).toHaveCount(4);
  await expect(node(page, 'helpers').getByTestId('node-skill')).toHaveAttribute(
    'data-skill',
    'missing',
  );
  await expect(page.getByTestId('agent-files')).toBeVisible();
  await page.getByTestId('wf-helper-2').click();
  await expect(panel(page)).toHaveAttribute('data-stage', 'helpers');
  await expect(panel(page).getByTestId('skill-missing')).toBeVisible();
  await shoot(page, 'full-helpers');

  await panel(page).getByRole('radio', { name: '2 helpers' }).check({ force: true });
  await expect(page.getByTestId(/^wf-helper-/)).toHaveCount(2);
  await panel(page).getByRole('button', { name: 'Save' }).click();
  await expect(panel(page).getByTestId('saved')).toHaveText('Saved');
  expect(served.puts.map((p) => p.path)).toEqual(['setup']);
  expect(served.puts[0]?.body).toMatchObject({ maxConcurrentHelpers: 2, projectKey: 'WEB' });

  await node(page, 'review').click();
  await expect(panel(page).getByRole('link', { name: 'Open the Harness page' })).toBeVisible();
  await shoot(page, 'full-review');
});
