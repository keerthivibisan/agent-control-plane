import { expect, test, type Page } from '@playwright/test';
import { fixtureProject } from './ticket-fixtures.js';
import { WF_CSRF, WF_PROJECT_ID, agentFilesFixture, customGraphDto } from './workflow-fixtures.js';

/*
 * H-D (ADR-0027): the harness in the workflow, in the browser on the demo server's built UI. The
 * workflow-graph, harness, setup, setup-runs, check and token routes are answered from synthetic
 * fixtures (page.route); no setup step or check ever runs. Covers the Workflow editor's Checks
 * block panel (place, which checks, failure routes, the Add block menu's Checks items) and the
 * Harness page (setup steps, the network switch by keyboard, "Run setup and checks now", where
 * each check runs). Core's link rules for the new places are H-A's, so nothing here depends on
 * whether a new block could be linked. With ACP_SCREENSHOT_DIR set, light and dark screenshots.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const BASE = `/api/projects/${WF_PROJECT_ID}`;
const T = (min: number) => new Date(Date.UTC(2026, 9, 23, 9, min)).toISOString();
type Json = Record<string, unknown>;

/** Synthetic harness (test-only; commands and folders are invented). */
const HARNESS: Json = {
  state: 'ready',
  checkedAt: T(0),
  problems: [],
  checks: [
    {
      id: 'lint',
      name: 'Lint',
      argv: ['pnpm', 'lint'],
      timeoutSec: 300,
      required: true,
      labels: ['fast'],
    },
    {
      id: 'unit',
      name: 'Unit tests',
      argv: ['pnpm', 'test'],
      timeoutSec: 600,
      required: true,
      labels: ['fast', 'full'],
    },
    {
      id: 'e2e',
      name: 'End-to-end',
      argv: ['pnpm', 'test:e2e'],
      timeoutSec: 1800,
      required: false,
      labels: ['full'],
    },
  ],
  setup: [
    {
      id: 'install',
      name: 'Install dependencies',
      argv: ['pnpm', 'install', '--frozen-lockfile'],
      timeoutSec: 600,
      network: true,
      outputs: ['node_modules'],
    },
  ],
};

interface Served {
  setupPuts: Json[];
  checkPosts: number;
}

async function serve(page: Page): Promise<Served> {
  const served: Served = { setupPuts: [], checkPosts: 0 };
  const dto = customGraphDto();
  let setup = { ...(dto['setup'] as Json) };
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: WF_CSRF } }));
  await page.route(`**${BASE}/agents`, (route) => route.fulfill({ json: agentFilesFixture() }));
  await page.route(`**${BASE}/workflow-graph`, (route) =>
    route.fulfill({ json: { ...dto, setup } }),
  );
  await page.route(`**${BASE}/harness`, (route) => route.fulfill({ json: HARNESS }));
  await page.route(`**${BASE}/tickets`, (route) => route.fulfill({ json: [] }));
  await page.route(`**${BASE}/harness/setup-runs`, (route) =>
    route.fulfill({
      json: [
        {
          id: 'sr-1',
          projectId: WF_PROJECT_ID,
          runId: null,
          agentRunId: null,
          stepId: 'install',
          name: 'Install dependencies',
          status: 'refused',
          exitCode: null,
          durationMs: 0,
          outputTail: '',
          startedAt: T(1),
          commit: null,
        },
      ],
    }),
  );
  await page.route(`**${BASE}/harness/checks`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }
    expect(route.request().headers()['x-acp-csrf']).toBe(WF_CSRF);
    served.checkPosts += 1;
    await route.fulfill({ json: [] });
  });
  await page.route(`**${BASE}/setup`, async (route) => {
    if (route.request().method() === 'PUT') {
      expect(route.request().headers()['x-acp-csrf']).toBe(WF_CSRF);
      const body = route.request().postDataJSON() as Json;
      served.setupPuts.push(body);
      setup = { ...setup, setupNetwork: body['setupNetwork'] };
    }
    await route.fulfill({ json: setup });
  });
  return served;
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/h-d-${name}-1440-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Block settings' });

async function addBlock(page: Page, name: RegExp): Promise<void> {
  await page.getByTestId('add-block').click();
  await page.getByRole('menuitem', { name }).click();
}

test('the Checks block panel: the fixed merge block, picks, failure routes, new blocks', async ({
  page,
}) => {
  await serve(page);
  await page.setViewportSize({ width: 1440, height: 1240 });
  await page.goto(`/#/p/${WF_PROJECT_ID}/workflow`);
  await expect(page.getByTestId('graph-editor')).toBeVisible();

  // The block before the lead's merge: shows its pick, can't move or be removed.
  const merge = page.getByTestId('block-checks');
  await expect(merge.getByTestId('checks-select')).toHaveText('Runs: Required');
  await merge.click();
  const p = panel(page);
  await expect(p.getByTestId('check-place')).toHaveAttribute('data-place', 'merge');
  await expect(p.getByTestId('check-place-mandatory')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Remove block' })).toHaveCount(0);
  const failure = p.getByRole('group', { name: 'When a check fails' });
  await expect(failure.getByRole('radio')).toHaveCount(2);
  await expect(p.getByTestId('check-runs')).toHaveText('Runs: Lint, Unit tests.');

  // Pick checks by keyboard: the checklist starts from the required ones.
  await p.getByRole('radio', { name: /Pick checks/ }).check();
  const ids = p.getByTestId('check-ids');
  await expect(ids.getByRole('checkbox', { name: /Lint/ })).toBeChecked();
  await ids.getByRole('checkbox', { name: /End-to-end/ }).focus();
  await page.keyboard.press('Space');
  await expect(p.getByTestId('check-runs')).toHaveText('Runs: Lint, Unit tests, End-to-end.');
  await expect(merge.getByTestId('checks-select')).toHaveText('Runs: 3 checks');

  // By label: chips that say whether they are on.
  await p.getByRole('radio', { name: /By label/ }).check();
  const full = p.getByTestId('check-labels').getByRole('button', { name: /full/ });
  await expect(full).toHaveAttribute('aria-pressed', 'false');
  await full.click();
  await expect(full).toHaveAttribute('aria-pressed', 'true');
  await expect(merge.getByTestId('checks-select')).toHaveText('Runs: fast · full');
  await shoot(page, 'merge-block');

  // Checks on the branch: only "Ask me"; the menu then says there is one.
  await addBlock(page, /Checks on the branch/);
  await expect(page.getByTestId('block-branch-checks')).toBeVisible();
  await expect(panel(page).getByTestId('check-place')).toHaveAttribute('data-place', 'branch');
  const branchFailure = panel(page).getByRole('group', { name: 'When a check fails' });
  await expect(branchFailure.getByRole('radio')).toHaveCount(1);
  await expect(branchFailure).toContainText('Ask me');
  await page.getByTestId('add-block').click();
  await expect(page.getByTestId('palette-checks-branch')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  // Checks on a change: three routes, "Back to the helper" among them; it can be removed.
  await page.getByTestId('block-helper-1').click();
  await addBlock(page, /Checks on a change/);
  await expect(page.getByTestId('block-change-checks')).toBeVisible();
  const change = panel(page);
  await expect(change.getByTestId('check-place')).toHaveAttribute('data-place', 'change');
  await expect(
    change.getByRole('group', { name: 'When a check fails' }).getByRole('radio'),
  ).toHaveCount(3);
  await expect(change.getByRole('radio', { name: /Back to the helper/ })).toBeVisible();
  await expect(change.getByRole('button', { name: 'Remove block' })).toBeVisible();
  await shoot(page, 'change-block');
  await change.getByRole('button', { name: 'Remove block' }).click();
  await expect(page.getByTestId('block-change-checks')).toHaveCount(0);
});

test('the Harness page: setup steps, the network switch, run setup and checks, where checks run', async ({
  page,
}) => {
  const served = await serve(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/#/p/${WF_PROJECT_ID}/harness`);
  await expect(page.getByRole('heading', { level: 1, name: /Harness/ })).toBeVisible();

  const steps = page.getByRole('table', { name: 'Setup steps' });
  const install = steps.locator('[data-step="install"]');
  await expect(install).toContainText('pnpm install --frozen-lockfile');
  await expect(install.getByTestId('uses-network')).toHaveText('Uses the network');
  await expect(install).toContainText('node_modules');
  await expect(page.getByTestId('latest-setup')).toContainText('Not run: needs the network');

  // The switch: off by default, toggled with the keyboard, saved with setupNetwork.
  const sw = page.getByRole('switch', { name: 'Setup may use the network' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('setup-network-effect')).toContainText(
    'won’t run while this is off',
  );
  await sw.focus();
  await page.keyboard.press('Space');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(served.setupPuts).toHaveLength(1);
  expect(served.setupPuts[0]).toMatchObject({ setupNetwork: true, projectKey: 'WEB' });
  expect(served.setupPuts[0]).not.toHaveProperty('approvals');

  // Where each check runs, with its labels.
  const checks = page.getByRole('table', { name: 'Harness checks' });
  await expect(checks.locator('[data-check="lint"]').getByTestId('check-where')).toHaveText(
    'Before the lead’s merge: Checks',
  );
  await expect(checks.locator('[data-check="e2e"]')).toContainText('Not in the workflow');
  await expect(checks.locator('[data-check="unit"]')).toContainText('full');
  await shoot(page, 'harness');

  await page.getByRole('button', { name: 'Run setup and checks now' }).click();
  await expect.poll(() => served.checkPosts).toBe(1);
});
