import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectFocusRing } from './focus-ring.js';
import { fixtureProject } from './ticket-fixtures.js';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  agentFilesFixture,
  customGraphDto,
  graphDto,
  workflowInvalidError,
} from './workflow-fixtures.js';

/*
 * WG-D: the Workflow page's graph editor in the browser, on the demo server's built UI. The
 * workflow-graph, validate, setup, CSRF token and agent-file routes are answered from synthetic
 * fixtures (page.route) until WG-C serves them, so the canvas, the palette, the links (dragged
 * with the mouse), the problems and the saves can be checked without managed agents. With
 * ACP_SCREENSHOT_DIR set, it saves light and dark screenshots at 1440 and 1024 pixels wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;

// U-V: a test can end while a `route.fetch()` handler is mid-way ("Response has been disposed").
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
const BASE = `/api/projects/${WF_PROJECT_ID}`;

type Json = Record<string, unknown>;
interface GraphJson {
  version: number;
  template: string;
  nodes: (Json & { id: string; type: string; label: string })[];
  edges: (Json & { id: string; type: string; from: string; to: string })[];
  legacyV1?: unknown;
}

interface Served {
  puts: { path: string; body: Json }[];
  validates: number;
}

async function serve(page: Page, initial: Json, opts: { refuse?: boolean } = {}): Promise<Served> {
  const served: Served = { puts: [], validates: 0 };
  let current = structuredClone(initial);
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: WF_CSRF } }));
  await page.route(`**${BASE}/agents`, (route) => route.fulfill({ json: agentFilesFixture() }));
  await page.route(`**${BASE}/workflow-graph/validate`, async (route) => {
    served.validates += 1;
    await route.fulfill({
      json: {
        ok: false,
        issues: [
          {
            code: 'no-review-route',
            severity: 'error',
            message: '"Helpers" has no review link (from the server).',
            nodeId: 'helpers',
          },
        ],
      },
    });
  });
  await page.route(`**${BASE}/workflow-graph`, async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      expect(req.headers()['x-acp-csrf']).toBe(WF_CSRF);
      const body = req.postDataJSON() as Json;
      served.puts.push({ path: 'workflow-graph', body });
      if (opts.refuse === true) {
        await route.fulfill({ status: 422, json: workflowInvalidError() });
        return;
      }
      current = { ...current, graph: body['graph'], stored: 'v2' };
    }
    await route.fulfill({ json: current });
  });
  await page.route(`**${BASE}/setup`, async (route) => {
    const body = route.request().postDataJSON() as Json;
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
      // Below 1360px the panel sits under the canvas; capture it too when a block is open.
      if (
        width === 1024 &&
        (await panel(page)
          .getByTestId(/^(node|edge)-panel$/)
          .count()) > 0
      ) {
        await panel(page).scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${SHOTS}/workflow-${name}-panel-${width}-${scheme}.png` });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1240 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => window.scrollTo(0, 0));
}

const block = (page: Page, id: string) => page.getByTestId(`block-${id}`);
const panel = (page: Page) => page.getByRole('complementary', { name: 'Block settings' });
const issues = (page: Page) => page.getByTestId('issues');
const issueCodes = (page: Page) =>
  issues(page)
    .getByTestId('issue')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-code')));

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('handle not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags a link with the mouse, from a block's out handle to another block's in handle. */
async function drag(page: Page, from: string, to: string): Promise<void> {
  const source = await centre(page.getByTestId(`handle-out-${from}`));
  const target = await centre(page.getByTestId(`handle-in-${to}`));
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move((source.x + target.x) / 2, (source.y + target.y) / 2, { steps: 6 });
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1240 });
  await page.goto(`/#/p/${WF_PROJECT_ID}/workflow`);
  await expect(page.getByRole('heading', { level: 1, name: /Workflow/ })).toBeVisible();
  await expect(page.getByTestId('graph-editor')).toBeVisible();
}

test('opens the migrated workflow: every block on the canvas, no problems', async ({ page }) => {
  await serve(page, graphDto());
  await open(page);
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workflow' }),
  ).toHaveAttribute('aria-current', 'page');
  for (const id of ['ticket', 'orchestrate', 'plan-approval', 'helpers', 'review', 'done']) {
    await expect(block(page, id)).toBeVisible();
  }
  await expect(block(page, 'orchestrate')).toHaveAttribute('data-kind', 'lead');
  await expect(issues(page).getByTestId('issues-none')).toBeVisible();
  await expect(page.getByTestId('save-workflow')).toBeDisabled();
  // Every block is inside the canvas (fit to the view, nothing cut off).
  const canvas = await page.getByTestId('graph-editor').boundingBox();
  for (const id of ['ticket', 'owner-merge', 'done', 'helpers']) {
    const box = await block(page, id).boundingBox();
    expect(box).not.toBeNull();
    if (canvas && box) {
      expect(box.x).toBeGreaterThanOrEqual(canvas.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
    }
  }
  await shoot(page, 'default');
});

test('picks each template; restores the earlier setup', async ({ page }) => {
  await serve(page, graphDto());
  await open(page);
  const picker = page.getByRole('dialog', { name: 'Start from a template' });
  const cases: [RegExp, boolean, string[], string[]][] = [
    // [template, planner, blocks that must be there, blocks that must not]
    [/^Lead only/, false, ['orchestrate', 'helpers'], ['review', 'plan']],
    [/^Today’s setup/, true, ['plan', 'review'], []],
    [/^Reviewer ↔ helper loop/, false, ['review'], ['plan']],
  ];
  for (const [name, planner, present, absent] of cases) {
    await page.getByTestId('open-templates').click();
    await picker.getByLabel(name).check();
    const box = picker.getByRole('checkbox', { name: 'Add a planner' });
    if ((await box.isChecked()) !== planner) await box.click();
    await picker.getByRole('button', { name: 'Use this template' }).click();
    // After the first template there is unsaved work: confirm the replacement.
    const replace = picker.getByRole('button', { name: 'Replace' });
    if (await replace.isVisible().catch(() => false)) await replace.click();
    await expect(picker).toHaveCount(0);
    for (const id of present) await expect(block(page, id)).toBeVisible();
    for (const id of absent) await expect(block(page, id)).toHaveCount(0);
    await expect(issues(page).getByTestId('issues-none')).toBeVisible();
  }
  // The loop template: the reviewer reworks the helper directly ("Rework ×2" on the canvas).
  await expect(page.getByText('Rework ×2').first()).toBeVisible();
  await shoot(page, 'template-loop');

  await page.getByTestId('open-templates').click();
  await expect(picker.getByText(/The reviewer sends changes back to the helper/)).toBeVisible();
  await picker.getByRole('button', { name: 'Restore my earlier setup' }).click();
  await picker.getByRole('button', { name: 'Replace' }).click();
  await expect(picker).toHaveCount(0);
  await expect(block(page, 'review')).toBeVisible();
  await expect(page.getByTestId('unsaved')).toHaveCount(0);
});

test('a named helper from the palette, linked by dragging; a refused drag; fix and save', async ({
  page,
}) => {
  const served = await serve(page, graphDto());
  await open(page);
  await page.getByRole('button', { name: 'Add Named helper' }).click();
  await expect(block(page, 'helper-1')).toBeVisible();
  await expect(panel(page).getByTestId('node-panel')).toHaveAttribute('data-node', 'helper-1');
  expect(await issueCodes(page)).toEqual(
    expect.arrayContaining(['no-review-route', 'not-assigned']),
  );
  await expect(page.getByTestId('save-workflow')).toBeDisabled();
  await expect(page.getByTestId('save-blocked')).toHaveText('Fix the problems to save.');
  await panel(page).getByRole('textbox', { name: 'Name' }).fill('Frontend helper');
  await expect(block(page, 'helper-1').getByTestId('block-label')).toHaveText('Frontend helper');

  // An invalid drag: a helper can't send anything to the Checks block. Refused, in plain words.
  await drag(page, 'helper-1', 'checks');
  await expect(page.getByTestId('link-refused')).toContainText('That link isn’t allowed');
  await expect(page.getByTestId('link-refused')).toContainText(
    'cannot send its change for review to "Checks"',
  );
  await shoot(page, 'refused');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('link-refused')).toHaveCount(0);

  // The lead → helper fits two kinds (assigns, rework): the owner picks assigns.
  await drag(page, 'orchestrate', 'helper-1');
  const choice = page.getByRole('dialog', { name: 'What does this link do?' });
  await expect(choice).toBeVisible();
  await choice.getByRole('button', { name: /^Assigns work/ }).click();
  await expect(choice).toHaveCount(0);
  await expect(panel(page).getByTestId('edge-panel')).toHaveAttribute('data-type', 'assigns');
  await expect.poll(() => issueCodes(page)).not.toContain('not-assigned');

  // helper → change reviewer fits only "review": made at once.
  await drag(page, 'helper-1', 'review');
  await expect(panel(page).getByTestId('edge-panel')).toHaveAttribute('data-type', 'review');
  await expect(issues(page).getByTestId('issues-none')).toBeVisible();
  await shoot(page, 'named-helper');

  // A rework link straight from the reviewer, with its rounds set in the link panel.
  await drag(page, 'review', 'helper-1');
  await expect(panel(page).getByTestId('edge-panel')).toHaveAttribute('data-type', 'rework');
  await panel(page).getByRole('radio', { name: 'No rework' }).check({ force: true });

  await expect(page.getByTestId('save-workflow')).toBeEnabled();
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('saved')).toHaveText('Saved');
  expect(served.puts).toHaveLength(1);
  const graph = served.puts[0]?.body['graph'] as GraphJson;
  // The PUT body is a whole version 2 graph with the helper wired as drawn. (The browser checked
  // it with core's validator before Save was enabled; workflow-editor.test.tsx re-validates a PUT
  // body with core too.)
  expect(graph.version).toBe(2);
  expect(graph.template).toBe('custom');
  expect(graph.legacyV1).toBeDefined();
  for (const x of [...graph.nodes, ...graph.edges]) expect(x.id).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
  expect(graph.nodes.find((n) => n.id === 'helper-1')).toMatchObject({
    type: 'helper',
    label: 'Frontend helper',
    approvalMode: null,
    maxInstances: 1,
  });
  const edges = graph.edges.map((e) => `${e.type}:${e.from}>${e.to}`);
  expect(edges).toEqual(
    expect.arrayContaining([
      'assigns:orchestrate>helper-1',
      'review:helper-1>review',
      'rework:review>helper-1',
    ]),
  );
  expect(graph.edges.filter((e) => e.type === 'review' && e.from === 'helper-1')).toHaveLength(1);
  expect(graph.edges.find((e) => e.id === 'rework-review-helper-1')).toMatchObject({
    maxRounds: 0,
  });
});

test('the block panel: modes on editing blocks only, missing files flagged, keyboard', async ({
  page,
}) => {
  await serve(page, customGraphDto());
  await open(page);
  await expect(page.getByRole('button', { name: 'Add Planner' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await block(page, 'orchestrate').click();
  await expect(panel(page).getByTestId('no-mode')).toBeVisible();
  await expect(panel(page).getByTestId('mode-field')).toHaveCount(0);
  await block(page, 'helper-1').click();
  await expect(panel(page).getByTestId('mode-field')).toBeVisible();
  await expect(panel(page).getByTestId('skill-missing')).toContainText('release-notes');
  await expect(panel(page).getByTestId('agent-missing')).toBeVisible();
  await panel(page)
    .getByLabel(/^Full auto/)
    .check();
  await expect(panel(page).getByTestId('full-auto-warning')).toBeVisible();
  await expect(block(page, 'helper-1').getByTestId('block-mode')).toHaveText('Mode: Full auto');
  await shoot(page, 'node-panel');

  // Keyboard: the palette's buttons show the focus ring, and a focused block nudges with arrows.
  await page.getByRole('button', { name: 'Add Planner' }).focus();
  await page.keyboard.press('Tab');
  await expectFocusRing(page, 'Add Named helper');
  await page.locator('.react-flow__node[data-id="helpers"]').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('unsaved')).toBeVisible();

  // Delete removes the selected block (the final chain joins around the tester)…
  await block(page, 'unit-tests').click();
  await page.keyboard.press('Delete');
  await expect(block(page, 'unit-tests')).toHaveCount(0);
  await expect(issues(page)).toHaveAttribute('data-errors', '0');
  // …but never the lead or a step every workflow has.
  await block(page, 'orchestrate').click();
  await page.keyboard.press('Delete');
  await expect(block(page, 'orchestrate')).toBeVisible();
  await expect(panel(page).getByTestId('block-fixed')).toBeVisible();
});

test('a refused save shows the server’s issues', async ({ page }) => {
  const served = await serve(page, graphDto(), { refuse: true });
  await open(page);
  await block(page, 'helpers').click();
  await panel(page).getByRole('textbox', { name: 'Name' }).fill('Workers');
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('server-issues')).toContainText('(from the server)');
  await expect(page.getByTestId('save-refusal')).toContainText('The workflow wasn’t saved.');
  expect(served.validates).toBe(1);
  await shoot(page, 'refused-save');
});

test('project defaults: helper limits and the approval mode save through …/setup', async ({
  page,
}) => {
  const served = await serve(page, graphDto());
  await open(page);
  const defaults = page.getByTestId('project-defaults');
  await defaults.scrollIntoViewIfNeeded();
  await defaults.getByRole('radio', { name: '2 helpers' }).check({ force: true });
  await defaults.getByLabel(/^Manual/).check();
  await defaults.getByRole('button', { name: 'Save project defaults' }).click();
  await expect(defaults.getByTestId('defaults-saved')).toBeVisible();
  expect(served.puts.map((p) => p.path)).toEqual(['setup']);
  expect(served.puts[0]?.body).toMatchObject({
    maxConcurrentHelpers: 2,
    approvals: { mode: 'manual' },
  });
});
