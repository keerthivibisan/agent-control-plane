import { expect, test, type Page } from '@playwright/test';
import {
  L_API,
  LOOP_BRANCH_PATH,
  LOOP_PROJECT_GRAPH_PATH,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_REVIEW_PATH,
  LOOP_TICKET_ID,
  PROJECT_ID,
  loopReviewScenario,
  loopWorkingScenario,
  type LoopScenario,
} from './review-loop-fixtures.js';
import { fixtureProject } from './ticket-fixtures.js';

/*
 * G-C (ADR-0025 §6): the shared diff viewer in the change card and the ticket branch card, on the
 * demo server's built UI, with the ticket routes answered from the review loop's synthetic
 * fixtures (page.route) and their diffs replaced by the ones below. Shiki runs for real: the
 * test checks it loads only when a diff is opened, from the app's own assets, and that no request
 * leaves the app's origin. With ACP_SCREENSHOT_DIR set, it saves light and dark pictures.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;
const TICKET_HASH = `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`;

type Json = Record<string, unknown>;

const ctx = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ` export const LIMIT_${from + i} = ${from + i};`);

/** The API builder's change: a TypeScript edit with long context (as `-U10` prints), a small
 * route change, a rename with an edit, and a binary file. Invented content. */
const CHANGE_DIFF = [
  'diff --git a/src/search/api.ts b/src/search/api.ts',
  'index 1a2b3c4..5d6e7f8 100644',
  '--- a/src/search/api.ts',
  '+++ b/src/search/api.ts',
  '@@ -1,24 +1,25 @@',
  " import { z } from 'zod';",
  ...ctx(2, 9),
  '-export const MAX_PAGE_SIZE = 50;',
  '+export const MAX_PAGE_SIZE = 100;',
  '+// Callers above the cap get the cap, not an error.',
  ...ctx(12, 10),
  ' export const SearchQuery = z.object({',
  '   q: z.string().trim().min(1),',
  ' });',
  'diff --git a/src/server/routes.ts b/src/server/routes.ts',
  'index 2b3c4d5..6e7f8a9 100644',
  '--- a/src/server/routes.ts',
  '+++ b/src/server/routes.ts',
  '@@ -12,3 +12,4 @@ export function routes(app: App) {',
  "   app.get('/api/tickets', listTickets);",
  "+  app.get('/api/search', searchTickets);",
  ' }',
  ' ',
  'diff --git a/docs/find.md b/docs/search.md',
  'similarity index 82%',
  'rename from docs/find.md',
  'rename to docs/search.md',
  'index 3c4d5e6..7f8a9b0 100644',
  '--- a/docs/find.md',
  '+++ b/docs/search.md',
  '@@ -1,3 +1,3 @@',
  '-# Find',
  '+# Search',
  ' ',
  ' Results are capped at `MAX_PAGE_SIZE`.',
  'diff --git a/assets/search.png b/assets/search.png',
  'new file mode 100644',
  'index 0000000..9a8b7c6',
  'Binary files /dev/null and b/assets/search.png differ',
  '',
].join('\n');

const CHANGE_FILES = [
  { path: 'src/search/api.ts', status: 'modified', additions: 2, deletions: 1 },
  { path: 'src/server/routes.ts', status: 'modified', additions: 1, deletions: 0 },
  { path: 'docs/search.md', status: 'renamed', additions: 1, deletions: 1 },
  { path: 'assets/search.png', status: 'added', additions: null, deletions: null },
];

/** The ticket branch: one large file (held back), a small one, and a cut at the end. */
const BRANCH_DIFF = [
  'diff --git a/src/search/index.ts b/src/search/index.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/search/index.ts',
  '@@ -0,0 +1,450 @@',
  ...Array.from({ length: 450 }, (_, i) => `+export const term${i + 1} = 'term ${i + 1}';`),
  'diff --git a/src/server/routes.ts b/src/server/routes.ts',
  '--- a/src/server/routes.ts',
  '+++ b/src/server/routes.ts',
  '@@ -12,3 +12,4 @@ export function routes(app: App) {',
  "   app.get('/api/tickets', listTickets);",
  "+  app.get('/api/search', searchTickets);",
  ' }',
  ' ',
  'diff --git a/src/search/SearchBox.tsx b/src/search/SearchBox.tsx',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/search/SearchBox.tsx',
  '@@ -0,0 +1,20 @@',
  "+import { useState } from 'react';",
  '+',
  '',
].join('\n');

const BRANCH_FILES = [
  { path: 'src/search/index.ts', status: 'added', additions: 450, deletions: 0 },
  { path: 'src/server/routes.ts', status: 'modified', additions: 1, deletions: 0 },
  { path: 'src/search/SearchBox.tsx', status: 'added', additions: 20, deletions: 0 },
  { path: 'src/search/useSearch.ts', status: 'added', additions: 30, deletions: 0 },
];

function withDiffs(sc: LoopScenario): LoopScenario {
  const routes = structuredClone(sc.routes) as Record<string, Json>;
  const review = routes[LOOP_REVIEW_PATH];
  if (review !== undefined) {
    const agents = review['agents'] as Json[];
    review['agents'] = agents.map((a) =>
      a['agentRunId'] === L_API ? { ...a, files: CHANGE_FILES, diff: CHANGE_DIFF } : a,
    );
  }
  const branch = routes[LOOP_BRANCH_PATH];
  if (branch !== undefined) {
    routes[LOOP_BRANCH_PATH] = {
      ...branch,
      files: BRANCH_FILES,
      diff: BRANCH_DIFF,
      diffTruncated: true,
    };
  }
  return { routes };
}

/** Serves one scenario of the loop, read-only, and records every request's origin. */
async function serve(page: Page, sc: LoopScenario): Promise<string[]> {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route(`**${LOOP_PROJECT_WORKFLOW_PATH}`, (route) =>
    route.fulfill({ json: sc.routes[LOOP_PROJECT_WORKFLOW_PATH] }),
  );
  await page.route(`**${LOOP_PROJECT_GRAPH_PATH}`, (route) =>
    route.fulfill({ json: sc.routes[LOOP_PROJECT_GRAPH_PATH] }),
  );
  await page.route(/\/api\/(tickets|runs|control)\//, async (route) => {
    const url = new URL(route.request().url());
    const body = sc.routes[url.pathname];
    if (body === undefined) {
      await route.fulfill({
        status: 404,
        json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
      });
      return;
    }
    await route.fulfill({ json: body });
  });
  return urls;
}

/** A picture of one element in both themes, at a desktop and a phone width (or the `widths`). */
async function shootPart(
  page: Page,
  name: string,
  testId: string,
  widths: readonly number[] = [1440, 390],
): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of widths) {
    for (const scheme of ['light', 'dark'] as const) {
      // Tall enough that the part fits: a scrolled element picture draws the sticky bar over it.
      await page.setViewportSize({ width, height: 3400 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      const part = page.getByTestId(testId).first();
      await part.scrollIntoViewIfNeeded();
      await part.screenshot({ path: `${SHOTS}/diff-${name}-${width}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a change’s diff: files, side by side, collapse, hidden lines, Shiki from the app', async ({
  page,
  baseURL,
}) => {
  const urls = await serve(page, withDiffs(loopWorkingScenario()));
  // The change card in the Agents tab's side panel (Files changed, since C-D, shows the diff at
  // once; the side panel's diff stays folded until opened).
  await page.goto(`/${TICKET_HASH}?tab=agents`);
  await page
    .getByRole('button', { name: 'Show the API builder in the side panel' })
    .and(page.locator(':not([data-testid="live-agent"])'))
    .click();
  await page
    .getByTestId('side-panel')
    .getByRole('tab', { name: /Changes/ })
    .click();
  const card = page.getByTestId('side-panel').getByTestId('change-card');
  const section = card.getByTestId('change-diff');
  await expect(section).toBeVisible();
  // Nothing of the viewer, and nothing of Shiki, until the diff is opened.
  await expect(section.getByTestId('diff-viewer')).toHaveCount(0);
  expect(urls.some((u) => /engine-javascript|\/core-/.test(u))).toBe(false);

  await section.locator('summary').click();
  const viewer = section.getByTestId('diff-viewer');
  await expect(viewer.getByTestId('diff-summary')).toHaveText('4 files · 4 added · 2 removed');
  await expect(viewer.getByTestId('diff-file-link')).toHaveCount(4);
  const api = viewer.locator('[data-testid="diff-file"][data-path="src/search/api.ts"]');
  // Real Shiki, loaded now from the app's own assets.
  await expect(api).toHaveAttribute('data-syntax', 'highlighted');
  await expect(api.locator('span[style*="--shiki-token-keyword"]').first()).toBeVisible();
  await expect(viewer.locator('[data-path="docs/search.md"]')).toHaveAttribute(
    'data-syntax',
    'highlighted',
  );
  await expect(viewer.locator('[data-path="assets/search.png"]')).toContainText('Binary file');
  // Word-level changes and screen-reader words on the changed lines.
  await expect(api.locator('tr[data-kind="del"] [data-word-change]')).toHaveText(['50']);
  await expect(api.locator('tr[data-kind="add"]').first()).toContainText('Added line:');
  await shootPart(page, 'change-unified', 'side-panel');

  // Hidden unchanged lines.
  const expanders = api.getByTestId('diff-expand');
  await expect(expanders).toHaveText(['Show 7 hidden lines', 'Show 10 hidden lines']);
  const rows = api.locator('tr[data-kind]');
  const before = await rows.count();
  await expanders.first().click();
  await expect(expanders).toHaveCount(1);
  await expect(rows).toHaveCount(before + 7);

  // G-D: the side panel beside the agents is too narrow for side by side: unified, with the
  // choice off and the reason as its tooltip.
  const splitButton = viewer.getByRole('button', { name: 'Side by side' });
  await expect(viewer).toHaveAttribute('data-narrow', '');
  await expect(splitButton).toHaveAttribute('aria-disabled', 'true');
  await expect(splitButton).toHaveAttribute('title', 'Not enough room here');
  // Playwright waits for an aria-disabled button to be enabled; a forced click is the owner's.
  await splitButton.click({ force: true });
  await expect(viewer).toHaveAttribute('data-view', 'unified');
  await shootPart(page, 'change-narrow', 'side-panel', [1440]);

  // Under the agents (narrower windows) the panel is wide: side by side, remembered after a
  // reload.
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(splitButton).not.toHaveAttribute('aria-disabled', 'true');
  await splitButton.click();
  await expect(viewer).toHaveAttribute('data-view', 'split');
  await expect(api.locator('tr[data-kind="change"]').first()).toContainText('Removed line:');
  await shootPart(page, 'change-split', 'side-panel', [1024]);
  await page.setViewportSize({ width: 1024, height: 900 });

  // Collapse one file; the list jumps to it (keyboard) and opens it again.
  const routes = viewer.locator('[data-path="src/server/routes.ts"]');
  const toggle = routes.getByTestId('diff-file-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(routes.locator('tr[data-kind]')).toHaveCount(0);
  await viewer.getByTestId('diff-file-link').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(viewer.getByTestId('diff-file-link').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toBeFocused();

  // Collapse all and expand all.
  await viewer.getByTestId('diff-collapse-all').click();
  for (const f of await viewer.getByTestId('diff-file').all()) {
    await expect(f).toHaveAttribute('data-open', 'false');
  }
  await viewer.getByTestId('diff-collapse-all').click();
  for (const f of await viewer.getByTestId('diff-file').all()) {
    await expect(f).toHaveAttribute('data-open', 'true');
  }

  await page.reload();
  await page
    .getByRole('tablist', { name: 'Ticket sections' })
    .getByRole('tab', { name: /Files changed/ })
    .click();
  await page.getByTestId('change-picker').click();
  await page.getByRole('menuitemradio', { name: /API builder/ }).click();
  await page.getByRole('button', { name: 'Open API builder in Agents' }).click();
  const again = page.getByTestId('side-panel').getByTestId('change-diff');
  await again.locator('summary').click();
  await expect(again.getByTestId('diff-viewer')).toHaveAttribute('data-view', 'split');
  // Back beside the agents: unified there, the choice kept for wider places.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(again.getByTestId('diff-viewer')).toHaveAttribute('data-view', 'unified');
  expect(await page.evaluate(() => window.localStorage.getItem('acp.diff.view'))).toBe('split');

  // Shiki came from the app's own assets; no request left the app's origin.
  const origin = new URL(baseURL ?? 'http://127.0.0.1').origin;
  expect(urls.some((u) => /\/assets\/engine-javascript-[^/]+\.js$/.test(u))).toBe(true);
  expect(urls.some((u) => /\/assets\/typescript-[^/]+\.js$/.test(u))).toBe(true);
  const foreign = urls.filter((u) => !/^(data|blob):/.test(u) && new URL(u).origin !== origin);
  expect(foreign).toEqual([]);
});

test('the ticket branch’s combined diff: the large-diff guard and the server’s cut', async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem('acp.diff.view', 'unified'));
  await serve(page, withDiffs(loopReviewScenario()));
  // C-D: all changes on Files changed, in the review UI.
  await page.goto(`/${TICKET_HASH}?tab=files`);
  const files = page.getByTestId('review-files');
  await expect(files.getByTestId('review-truncated')).toHaveText(
    'The server cut this diff at its size limit: only its start is shown.',
  );
  await expect(files.getByTestId('review-large')).toContainText('2 of 3 files are shown');
  const big = files.locator('[data-testid="diff-file"][data-path="src/search/index.ts"]');
  await expect(big).toHaveAttribute('data-shown', 'false');
  await expect(
    files.locator('[data-testid="diff-file"][data-path="src/search/SearchBox.tsx"]'),
  ).toContainText('Cut');
  await expect(files.getByTestId('review-missing')).toContainText('src/search/useSearch.ts');
  await shootPart(page, 'branch', 'review-files');
  await big.getByRole('button', { name: 'Show this file' }).click();
  await expect(big.locator('tr[data-kind="add"]')).toHaveCount(450);
  await expect(files.getByTestId('review-large')).toHaveCount(0);
});
