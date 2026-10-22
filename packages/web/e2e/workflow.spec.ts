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
 * WG-D, v0.3.0 D-C: the Workflow page's graph editor in the browser, on the demo server's built UI.
 * The workflow-graph, validate, setup, CSRF token and agent-file routes are answered from synthetic
 * fixtures (page.route), so the canvas, the Add block menu, the links (dragged with the mouse, with
 * the valid targets highlighted and the link chooser by the drop point), the problems and the saves
 * can be checked without managed agents. With ACP_SCREENSHOT_DIR set, it saves light and dark
 * screenshots at 1440 and 1024 pixels wide.
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

const WIDTHS = [1440] as const;
const SCHEMES = ['light', 'dark'] as const;

async function frame(page: Page, width: number, scheme: 'light' | 'dark'): Promise<void> {
  await page.setViewportSize({ width, height: 1240 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function reset(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1240 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => window.scrollTo(0, 0));
  // The canvas refits to its new width; let it land before the next drag reads handle positions.
  await page.waitForTimeout(500);
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      await frame(page, width, scheme);
      // The viewport, not fullPage: a full-page capture tears at the sticky top bar.
      await page.screenshot({ path: `${SHOTS}/workflow-${name}-${width}-${scheme}.png` });
    }
  }
  await reset(page);
}

/** Screenshots while a link is being dragged from `from`: the blocks it can end on are lit. */
async function shootDragging(page: Page, from: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      await frame(page, width, scheme);
      await showCanvas(page);
      const start = await centre(page.getByTestId(`handle-out-${from}`));
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 60, start.y + 50, { steps: 6 });
      await expect(page.getByTestId('graph-editor')).toHaveAttribute('data-connecting', from);
      await page.screenshot({ path: `${SHOTS}/workflow-dragging-${width}-${scheme}.png` });
      await page.mouse.up();
    }
  }
  await reset(page);
}

const block = (page: Page, id: string) => page.getByTestId(`block-${id}`);
const panel = (page: Page) => page.getByRole('complementary', { name: 'Block settings' });
const issues = (page: Page) => page.getByTestId('issues');
const codesIn = (scope: Locator) =>
  scope.getByTestId('issue').evaluateAll((els) => els.map((e) => e.getAttribute('data-code')));
/** The problems list's codes; it shows while nothing is selected (the header button shows it). */
async function issueCodes(page: Page): Promise<(string | null)[]> {
  if ((await issues(page).count()) === 0) await page.getByTestId('problems-button').click();
  return codesIn(issues(page));
}

/** Adds a block with the Add block menu. */
async function addBlock(page: Page, name: string): Promise<void> {
  await page.getByTestId('add-block').click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
}

/** Scrolls the canvas to the middle of the window, clear of the sticky page header. */
async function showCanvas(page: Page): Promise<void> {
  await page
    .getByTestId('graph-editor')
    .evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
}

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('handle not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags a link with the mouse, from a block's out handle to another block's in handle. */
async function drag(page: Page, from: string, to: string): Promise<{ x: number; y: number }> {
  await showCanvas(page);
  const source = await centre(page.getByTestId(`handle-out-${from}`));
  const target = await centre(page.getByTestId(`handle-in-${to}`));
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move((source.x + target.x) / 2, (source.y + target.y) / 2, { steps: 6 });
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  return target;
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
  // Nothing selected: the problems list sits beside the canvas, with its count on the header.
  await expect(issues(page).getByTestId('issues-none')).toBeVisible();
  await expect(page.getByTestId('problems-button')).toHaveAttribute('data-errors', '0');
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
  // The legend folds away and stays folded on the next visit; How this works says it in three.
  await expect(page.getByTestId('workflow-legend')).toBeVisible();
  await page.getByTestId('how-it-works-button').click();
  await expect(
    page.getByRole('dialog', { name: 'How this works' }).getByRole('listitem'),
  ).toHaveCount(3);
  await page.keyboard.press('Escape');
  await page.getByTestId('legend-toggle').click();
  await expect(page.getByTestId('workflow-legend')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('graph-editor')).toBeVisible();
  await expect(page.getByTestId('workflow-legend')).toHaveCount(0);
  await page.getByTestId('legend-toggle').click();
  await expect(page.getByTestId('workflow-legend')).toBeVisible();
  // Zoom: in, out and Fit.
  const level = page.getByTestId('zoom-level');
  const before = await level.textContent();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(level).not.toHaveText(before ?? '');
  await page.getByTestId('zoom-fit').click();
  await expect(level).toHaveText(before ?? '');
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

test('a named helper from the menu, linked by dragging; a refused drag; fix and save', async ({
  page,
}) => {
  const served = await serve(page, graphDto());
  await open(page);
  await addBlock(page, 'Named helper');
  await expect(block(page, 'helper-1')).toBeVisible();
  await expect(panel(page).getByTestId('node-panel')).toHaveAttribute('data-node', 'helper-1');
  // The block's own problems are at the top of its panel, and a marker sits on the block.
  expect(await codesIn(panel(page).getByTestId('panel-issues'))).toEqual(
    expect.arrayContaining(['no-review-route', 'not-assigned']),
  );
  await expect(block(page, 'helper-1').getByTestId('block-problems')).toHaveAttribute(
    'data-severity',
    'error',
  );
  await expect(page.getByTestId('save-workflow')).toBeDisabled();
  await expect(page.getByTestId('save-blocked')).toHaveText('Fix the problems to save.');
  await panel(page).getByRole('textbox', { name: 'Name' }).fill('Frontend helper');
  await expect(block(page, 'helper-1').getByTestId('block-label')).toHaveText('Frontend helper');

  // The problems list, grouped (problems to fix first), after the header's Problems button.
  await page.getByTestId('problems-button').click();
  await expect(issues(page).getByTestId('issues-errors')).toBeVisible();
  expect(await codesIn(issues(page))).toEqual(
    expect.arrayContaining(['no-review-route', 'not-assigned']),
  );
  await shoot(page, 'problems');

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
  const dropped = await drag(page, 'orchestrate', 'helper-1');
  const choice = page.getByRole('dialog', { name: 'What does this link do?' });
  await expect(choice).toBeVisible();
  // The chooser opens by the drop point, not in the middle of the page.
  const chooserBox = await choice.boundingBox();
  expect(chooserBox).not.toBeNull();
  if (chooserBox) {
    expect(Math.abs(chooserBox.x - dropped.x)).toBeLessThan(340);
    expect(Math.abs(chooserBox.y - dropped.y)).toBeLessThan(80);
  }
  await expect(choice.getByRole('button', { name: /^Assigns work/ })).toBeFocused();
  await choice.getByRole('button', { name: /^Assigns work/ }).click();
  await expect(choice).toHaveCount(0);
  await expect(panel(page).getByTestId('edge-panel')).toHaveAttribute('data-type', 'assigns');
  await expect.poll(() => issueCodes(page)).not.toContain('not-assigned');

  // helper → change reviewer fits only "review": made at once.
  await drag(page, 'helper-1', 'review');
  await expect(panel(page).getByTestId('edge-panel')).toHaveAttribute('data-type', 'review');
  await expect(page.getByTestId('problems-button')).toHaveAttribute('data-errors', '0');
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

test('dragging a link lights the blocks it can end on; a drop on a block body links it', async ({
  page,
}) => {
  await serve(page, graphDto());
  await open(page);
  await addBlock(page, 'Named helper');
  await expect(block(page, 'helper-1')).toBeVisible();
  await page.keyboard.press('Escape');

  // From the lead: the new helper (assigns, rework) is valid; Checks (already merged through) and
  // Ticket are not.
  await showCanvas(page);
  const start = await centre(page.getByTestId('handle-out-orchestrate'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 30, { steps: 5 });
  await expect(page.getByTestId('graph-editor')).toHaveAttribute('data-connecting', 'orchestrate');
  await expect(block(page, 'orchestrate')).toHaveAttribute('data-link-target', 'source');
  await expect(block(page, 'helper-1')).toHaveAttribute('data-link-target', 'valid');
  await expect(block(page, 'checks')).toHaveAttribute('data-link-target', 'invalid');
  await expect(block(page, 'ticket')).toHaveAttribute('data-link-target', 'invalid');
  await expect(block(page, 'done')).toHaveAttribute('data-link-target', 'invalid');
  // The valid block's in handle grows into a target; an invalid block fades.
  const opacity = await block(page, 'ticket').evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBeLessThan(0.6);
  // Released over empty canvas: nothing is made and the highlight goes.
  const pane = await page.getByTestId('graph-editor').boundingBox();
  if (pane === null) throw new Error('no canvas');
  await page.mouse.move(pane.x + 8, pane.y + pane.height - 8, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('graph-editor')).not.toHaveAttribute('data-connecting', /.+/);
  await expect(block(page, 'helper-1')).not.toHaveAttribute('data-link-target', /.+/);
  await expect(page.getByTestId('edge-choice')).toHaveCount(0);

  // A drop anywhere on a valid block (here the change reviewer's body) makes the one kind that fits.
  await showCanvas(page);
  const from = await centre(page.getByTestId('handle-out-helper-1'));
  const body = await centre(block(page, 'review').getByTestId('block-label'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(body.x, body.y, { steps: 8 });
  await page.mouse.up();
  await expect(panel(page).getByTestId('edge-panel')).toHaveAttribute('data-type', 'review');

  // The chooser closes on Escape without making a link, and focus goes back to the canvas.
  await drag(page, 'orchestrate', 'helper-1');
  const choice = page.getByRole('dialog', { name: 'What does this link do?' });
  await expect(choice).toBeVisible();
  await expect(
    choice.getByRole('button', { name: /^Sends the change back for rework/ }),
  ).toBeVisible();
  await shoot(page, 'chooser');
  await page.keyboard.press('Escape');
  await expect(choice).toHaveCount(0);
  await shootDragging(page, 'orchestrate');
});

test('the block panel: modes on editing blocks only, missing files flagged, keyboard', async ({
  page,
}) => {
  await serve(page, customGraphDto());
  await open(page);
  // The Add block menu: a full kind stays listed, disabled, with the reason in plain sight.
  await page.getByTestId('add-block').click();
  const planner = page.getByRole('menuitem', { name: /^Planner/ });
  await expect(planner).toHaveAttribute('aria-disabled', 'true');
  await expect(planner).toContainText('it can have only one');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('add-block')).toBeFocused();
  await expectFocusRing(page, /Add block/);

  await block(page, 'orchestrate').click();
  await expect(panel(page).getByTestId('no-mode')).toBeVisible();
  await expect(panel(page).getByTestId('mode-field')).toHaveCount(0);
  await block(page, 'helper-1').click();
  await expect(panel(page).getByTestId('mode-field')).toBeVisible();
  await expect(panel(page).getByTestId('skill-missing')).toContainText('release-notes');
  await expect(panel(page).getByTestId('agent-missing')).toBeVisible();
  // On the block: a skills count and the agent file, both flagged, instead of every chip.
  await expect(block(page, 'helper-1').getByTestId('block-skills')).toHaveAttribute(
    'data-missing',
    '1',
  );
  await expect(block(page, 'helper-1').getByTestId('block-agent-chip')).toHaveAttribute(
    'data-agent',
    'missing',
  );
  // The warning marker's tooltip says what is wrong.
  await block(page, 'helper-1').getByTestId('block-problems').hover();
  await expect(page.getByRole('tooltip')).toContainText('warning');
  await panel(page)
    .getByLabel(/^Full auto/)
    .check();
  await expect(panel(page).getByTestId('full-auto-warning')).toBeVisible();
  await expect(block(page, 'helper-1').getByTestId('block-mode')).toHaveText('Mode: Full auto');
  await shoot(page, 'node-panel');

  // Keyboard: a focused block nudges with the arrows; Escape clears the selection.
  await page.locator('.react-flow__node[data-id="helpers"]').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(issues(page)).toBeVisible();

  // Delete removes the selected block (the final chain joins around the tester)…
  await block(page, 'unit-tests').click();
  await page.keyboard.press('Delete');
  await expect(block(page, 'unit-tests')).toHaveCount(0);
  await expect(page.getByTestId('problems-button')).toHaveAttribute('data-errors', '0');
  // …but never the lead or a step every workflow has.
  await block(page, 'orchestrate').click();
  await page.keyboard.press('Delete');
  await expect(block(page, 'orchestrate')).toBeVisible();
  await expect(panel(page).getByTestId('block-fixed')).toBeVisible();
});

test('a click on a problem selects its link; the selected link is highlighted', async ({
  page,
}) => {
  await serve(page, graphDto());
  await open(page);
  await addBlock(page, 'Tester');
  await page.getByTestId('problems-button').click();
  await issues(page)
    .getByText(/"Tester" has no review link/)
    .click();
  await expect(panel(page).getByTestId('node-panel')).toHaveAttribute('data-node', 'unit-tests');
  await expect(block(page, 'unit-tests')).toHaveAttribute('data-selected', 'true');
  // A link: selected from the canvas, drawn in the accent; the others fade. (The problem's click
  // zoomed in on the tester: Fit shows the whole workflow again.)
  await page.getByTestId('zoom-fit').click();
  await block(page, 'orchestrate').click();
  await panel(page)
    .getByTestId('node-links')
    .getByText(/Merges through/)
    .waitFor();
  const merge = page.locator('.react-flow__edge.link-merge');
  await merge.click({ force: true });
  await expect(panel(page).getByTestId('edge-panel')).toHaveAttribute('data-type', 'merge');
  await expect(merge.locator('path.react-flow__edge-path')).toHaveCSS(
    'stroke',
    /rgb\(9, 105, 218\)/,
  );
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
