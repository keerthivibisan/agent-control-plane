import { expect, test, type Page } from '@playwright/test';
import { CSRF, PROJECT_ID, fixtureProject } from './ticket-fixtures.js';

/*
 * Redesign R-E: the Harness page in the browser, on the demo server's built UI. The harness,
 * ticket and check routes are answered from synthetic fixtures (page.route); no check command
 * ever runs. With ACP_SCREENSHOT_DIR set, it saves light and dark screenshots at 1440 and 1024
 * pixels wide for the WP review.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;
const BASE = `/api/projects/${PROJECT_ID}`;
const HASH = `#/p/${PROJECT_ID}/harness`;
const T = (min: number) => new Date(Date.UTC(2026, 9, 16, 9, min)).toISOString();

type Json = Record<string, unknown>;

/** Synthetic harness states (test-only; commands, folders and output are invented). */
function harness(state: 'none' | 'invalid' | 'ready'): Json {
  const checks =
    state === 'ready'
      ? [
          {
            id: 'test',
            name: 'Unit tests',
            argv: ['pnpm', 'test'],
            timeoutSec: 600,
            required: true,
          },
          {
            id: 'typecheck',
            name: 'Type check',
            argv: ['pnpm', 'typecheck'],
            timeoutSec: 300,
            required: true,
          },
          {
            id: 'lint',
            name: 'Lint',
            argv: ['pnpm', 'exec', 'eslint', '.', '--max-warnings=0'],
            cwd: 'packages/app',
            timeoutSec: 90,
            required: false,
          },
        ]
      : [];
  const problems =
    state === 'invalid'
      ? [
          "Check 'test' needs a timeout.",
          'The first word of check "build" must be a command name, not a path.',
        ]
      : [];
  return { state, checkedAt: T(0), problems, checks };
}

function checkRun(checkId: string, name: string, over: Json = {}): Json {
  return {
    id: `cr-${checkId}`,
    runId: null,
    agentRunId: null,
    projectId: PROJECT_ID,
    checkId,
    name,
    required: true,
    status: 'passed',
    exitCode: 0,
    durationMs: 12_400,
    outputTail: '',
    startedAt: T(1),
    ...over,
  };
}

const RESULTS = [
  checkRun('test', 'Unit tests', {
    outputTail: ' Test Files  18 passed (18)\n      Tests  212 passed (212)\n',
  }),
  checkRun('typecheck', 'Type check', {
    status: 'failed',
    exitCode: 2,
    durationMs: 8_100,
    outputTail:
      "src/settings/theme.ts(14,7): error TS2322: Type 'string' is not assignable to type 'Theme'.\n",
  }),
  checkRun('lint', 'Lint', { required: false, durationMs: 3_900 }),
];

function harnessTicket(stage: string): Json {
  return {
    id: 't-harness',
    projectId: PROJECT_ID,
    key: 'WEB-1',
    title: 'Build the harness',
    description: 'Give this project a harness.',
    type: 'harness',
    priority: 'high',
    labels: ['harness'],
    status: stage === 'BACKLOG' ? 'BACKLOG' : 'ACTIVE',
    currentRunId: stage === 'BACKLOG' ? null : 'run-h',
    createdAt: T(2),
    updatedAt: T(2),
    stage,
  };
}

function card(ticket: Json): Json {
  return {
    ...ticket,
    activeHelpers: 0,
    budgetTokensUsed: null,
    needsYou: 0,
    latestEstimatedCost: null,
    lastActivityAt: null,
    lastRunOutcome: null,
  };
}

interface Fixture {
  harness: Json;
  tickets: Json[];
  /** POST …/harness/ticket answers this ticket and then lists it. */
  created?: Json;
}

/** The fixtures' project in the switcher, and every harness route answered from `fx`. */
async function serve(page: Page, fx: Fixture): Promise<{ checkPosts: () => number }> {
  let posts = 0;
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: CSRF } }));
  await page.route(`**${BASE}/harness`, (route) => route.fulfill({ json: fx.harness }));
  await page.route(`**${BASE}/tickets`, (route) => route.fulfill({ json: fx.tickets }));
  await page.route(`**${BASE}/harness/checks`, async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-acp-csrf']).toBe(CSRF);
    posts += 1;
    // A short wait so the running state is on screen for a moment, like a real run.
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ json: RESULTS });
  });
  await page.route(`**${BASE}/harness/ticket`, async (route) => {
    const created = fx.created ?? harnessTicket('BACKLOG');
    fx.tickets = [card(created)];
    await route.fulfill({ status: 201, json: created });
  });
  return { checkPosts: () => posts };
}

async function shoot(page: Page, name: string, before?: () => Promise<void>): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      if (before) await before();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${SHOTS}/harness-${name}-${width}-${scheme}.png`,
        fullPage: true,
      });
    }
  }
}

test('a ready harness: the checks, Run checks now with each result, and the history', async ({
  page,
}) => {
  const server = await serve(page, { harness: harness('ready'), tickets: [] });
  await page.goto(`/${HASH}`);
  await expect(page.getByRole('heading', { level: 1, name: /Harness/ })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Harness' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('harness-status')).toContainText('3 checks · 2 required');
  const table = page.getByRole('table', { name: 'Harness checks' });
  await expect(table.locator('[data-check="lint"]')).toContainText(
    'pnpm exec eslint . --max-warnings=0',
  );
  await expect(table.locator('[data-check="lint"]')).toContainText('packages/app');
  await expect(table.locator('[data-check="lint"]')).toContainText('1 min 30 s');

  await page.getByRole('button', { name: 'Run checks now' }).click();
  const latest = page.getByTestId('latest-run');
  await expect(latest).toHaveAttribute('data-state', 'finished');
  await expect(latest.getByTestId('run-summary')).toHaveText('2 of 3 checks passed');
  await expect(latest).toContainText('1 required check did not pass');
  const typecheck = latest.locator('[data-check="typecheck"]');
  await expect(typecheck).toContainText('Failed');
  // A failed check's output is open without a click; a passed one's stays collapsed.
  await expect(typecheck.getByText(/error TS2322/)).toBeVisible();
  await expect(latest.locator('[data-check="test"]').getByText(/212 passed/)).toBeHidden();
  expect(server.checkPosts()).toBe(1);

  await page.getByRole('button', { name: 'Run checks now' }).click();
  await expect(page.getByRole('region', { name: 'Earlier in this session' })).toContainText(
    '2 of 3 checks passed',
  );
  await shoot(page, 'ready');
});

test('no harness yet: Build the harness creates the ticket and shows its stage', async ({
  page,
}) => {
  await serve(page, { harness: harness('none'), tickets: [] });
  await page.goto(`/${HASH}`);
  const status = page.getByTestId('harness-status');
  await expect(status).toContainText('No harness yet');
  await expect(page.getByRole('button', { name: 'Run checks now' })).toHaveCount(0);
  await shoot(page, 'none');

  await status.getByRole('button', { name: 'Build the harness', exact: true }).click();
  const ticket = page.getByTestId('harness-ticket');
  await expect(ticket).toContainText('WEB-1');
  await expect(ticket).toContainText('Backlog');
  await expect(ticket.getByRole('link', { name: 'Open ticket' })).toHaveAttribute(
    'href',
    `#/p/${PROJECT_ID}/tickets/t-harness`,
  );
  await expect(status.getByRole('button', { name: 'Build the harness', exact: true })).toHaveCount(
    0,
  );
});

test('a harness ticket at work, and an invalid harness with its problems', async ({ page }) => {
  const fx: Fixture = { harness: harness('none'), tickets: [card(harnessTicket('WORKING'))] };
  await serve(page, fx);
  await page.goto(`/${HASH}`);
  await expect(page.getByTestId('harness-ticket')).toContainText('Agents working');
  await shoot(page, 'ticket');

  fx.harness = harness('invalid');
  await page.reload();
  const status = page.getByTestId('harness-status');
  await expect(status).toContainText('Invalid');
  await expect(status).toContainText("Check 'test' needs a timeout.");
  await shoot(page, 'invalid');
});

test('⌘K "Run checks" runs them and opens the results on the Harness page', async ({ page }) => {
  const server = await serve(page, { harness: harness('ready'), tickets: [] });
  // Start on another page of the project: the action opens the Harness page.
  await page.goto(`/#/p/${PROJECT_ID}/sessions`);
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Sessions' }),
  ).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('ControlOrMeta+KeyK');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill('run checks');
  await expect(palette.getByRole('option').first()).toHaveAttribute(
    'data-command',
    'action:run-checks',
  );
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`${HASH}$`));
  await expect(page.getByTestId('latest-run')).toHaveAttribute('data-state', 'finished');
  expect(server.checkPosts()).toBe(1);
});
