import { expect, test, type Page } from '@playwright/test';
import {
  L_UI,
  LOOP_BRANCH_PATH,
  LOOP_PROJECT_GRAPH_PATH,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_REVIEW_PATH,
  LOOP_RUN_ID,
  LOOP_TICKET_ID,
  PROJECT_ID,
  loopNeedsYouScenario,
  loopWorkingScenario,
  type LoopScenario,
} from './review-loop-fixtures.js';
import { fixtureProject } from './ticket-fixtures.js';

/*
 * v0.3.0 D-A: the review pages, GitHub's "Files changed", on the demo server's built UI with the
 * ticket routes answered from the review loop's synthetic fixtures (page.route) and their diffs
 * replaced by the ones below. The owner's decisions are POSTs to the existing endpoints, captured
 * here and answered from the fixtures; nothing reaches a server. With ACP_SCREENSHOT_DIR set, it
 * saves light and dark pictures at 1440 wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;
const CHANGE_HASH = `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}/changes/${L_UI}`;
const FILES_HASH = `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}/files`;

type Json = Record<string, unknown>;

/** The Search UI's change: a new component, an edited module and a doc. Invented content. */
const UI_DIFF = [
  'diff --git a/src/search/SearchBox.tsx b/src/search/SearchBox.tsx',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/search/SearchBox.tsx',
  '@@ -0,0 +1,12 @@',
  "+import { useState } from 'react';",
  "+import { MAX_PAGE_SIZE } from './api';",
  '+',
  '+export function SearchBox({ onSearch }: { onSearch: (q: string) => void }) {',
  "+  const [q, setQ] = useState('');",
  '+  return (',
  '+    <form onSubmit={() => onSearch(q)}>',
  '+      <input value={q} onChange={(e) => setQ(e.target.value)} />',
  '+      <small>Up to {MAX_PAGE_SIZE} results</small>',
  '+    </form>',
  '+  );',
  '+}',
  'diff --git a/src/search/api.ts b/src/search/api.ts',
  'index 1a2b3c4..5d6e7f8 100644',
  '--- a/src/search/api.ts',
  '+++ b/src/search/api.ts',
  '@@ -1,8 +1,9 @@',
  " import { z } from 'zod';",
  ' ',
  '-export const MAX_PAGE_SIZE = 50;',
  '+export const MAX_PAGE_SIZE = 100;',
  '+// Callers above the cap get the cap, not an error.',
  ' export const SearchQuery = z.object({',
  '   q: z.string().trim().min(1),',
  '-  pageSize: z.number().int().min(1).default(20),',
  '+  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20),',
  ' });',
  'diff --git a/docs/search.md b/docs/search.md',
  'index 3c4d5e6..7f8a9b0 100644',
  '--- a/docs/search.md',
  '+++ b/docs/search.md',
  '@@ -1,3 +1,3 @@',
  ' # Search',
  ' ',
  '-Results are capped at 50.',
  '+Results are capped at `MAX_PAGE_SIZE` (100).',
  '',
].join('\n');

const UI_FILES = [
  { path: 'src/search/SearchBox.tsx', status: 'added', additions: 12, deletions: 0 },
  { path: 'src/search/api.ts', status: 'modified', additions: 3, deletions: 2 },
  { path: 'docs/search.md', status: 'modified', additions: 1, deletions: 1 },
];

function withDiffs(sc: LoopScenario): LoopScenario {
  const routes = structuredClone(sc.routes) as Record<string, Json>;
  const review = routes[LOOP_REVIEW_PATH];
  if (review !== undefined) {
    const agents = review['agents'] as Json[];
    review['agents'] = agents.map((a) =>
      a['agentRunId'] === L_UI ? { ...a, files: UI_FILES, diff: UI_DIFF } : a,
    );
  }
  // The ticket branch's combined change, for the files page in every scenario.
  routes[LOOP_BRANCH_PATH] ??= {
    runId: LOOP_RUN_ID,
    ticketBranch: (routes[`/api/runs/${LOOP_RUN_ID}`] as Json)['ticketBranch'],
    files: UI_FILES,
    diff: UI_DIFF,
    diffTruncated: false,
    checks: [],
    baseMoved: false,
  };
  const branch = routes[LOOP_BRANCH_PATH];
  routes[LOOP_BRANCH_PATH] = { ...branch, files: UI_FILES, diff: UI_DIFF };
  return { routes };
}

interface Posted {
  path: string;
  body: unknown;
}

/** Serves one scenario; POSTs are recorded and answered with the matching GET's fixture. */
async function serve(page: Page, sc: LoopScenario): Promise<Posted[]> {
  const posted: Posted[] = [];
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
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      posted.push({ path: url.pathname, body: request.postDataJSON() as unknown });
      if (url.pathname.endsWith('/comments')) {
        await route.fulfill({
          status: 201,
          json: {
            id: 'cm-review',
            ticketId: LOOP_TICKET_ID,
            runId: null,
            planId: null,
            author: 'owner',
            body: (request.postDataJSON() as { body: string }).body,
            createdAt: new Date(Date.UTC(2026, 9, 17, 10, 0)).toISOString(),
          },
        });
        return;
      }
    }
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
  return posted;
}

/** The page in both themes at 1440 and 1024 wide. */
async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/review-${name}-${width}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a change’s files: split, viewed, two line comments and Request changes as rework', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const posted = await serve(page, withDiffs(loopNeedsYouScenario()));
  await page.goto(`/${CHANGE_HASH}`);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Files changed by Search UI');
  await expect(page.getByTestId('review-back')).toHaveAttribute(
    'href',
    `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`,
  );
  const context = page.getByTestId('review-context');
  await expect(context.getByTestId('change-state')).toHaveAttribute('data-state', 'needs-owner');
  await expect(context).toContainText('Round 1');
  const files = page.getByTestId('review-files');
  // Side by side by default on a wide screen, with nothing chosen before.
  await expect(files).toHaveAttribute('data-view', 'split');
  await expect(page.getByTestId('review-summary-line')).toContainText('3 files changed');
  await expect(page.getByTestId('review-tree-file')).toHaveCount(3);
  // The tree lists folders first (docs, src/search), as on GitHub; the files follow it.
  await expect(page.locator('[data-review-file]').first()).toHaveAttribute(
    'data-review-file',
    'docs/search.md',
  );

  // Unified and back.
  const bar = page.getByTestId('review-bar');
  await bar.getByRole('button', { name: 'Unified' }).click();
  await expect(files).toHaveAttribute('data-view', 'unified');
  await bar.getByRole('button', { name: 'Side by side' }).click();
  await expect(files).toHaveAttribute('data-view', 'split');

  // Viewed: the file collapses, the tree and the bar say so, and a reload keeps it.
  const doc = page.locator('[data-review-file="docs/search.md"]');
  await doc.getByRole('checkbox', { name: 'Mark docs/search.md as viewed' }).check();
  await expect(doc.getByTestId('diff-file')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('review-viewed-count')).toHaveText('1 of 3 viewed');
  await expect(
    page.locator('[data-testid="review-tree-file"][data-path="docs/search.md"]'),
  ).toHaveAttribute('data-viewed', '');

  // The tree jumps to a file.
  await page.locator('[data-testid="review-tree-file"][data-path="src/search/api.ts"]').click();
  const api = page.locator('[data-review-file="src/search/api.ts"]');
  await expect(api.getByTestId('diff-file-toggle')).toBeFocused();

  // Comment 1: one added line (the new cap), on the right side.
  await api.locator('tr[data-kind="change"]').first().hover();
  await api.getByRole('button', { name: 'Comment on src/search/api.ts line 3 (after)' }).click();
  const form = api.getByTestId('review-comment-form');
  await form.getByRole('textbox').fill('Keep 50 as the default page size.');
  await form.getByRole('button', { name: 'Add to review' }).click();
  await expect(api.getByTestId('review-comment')).toHaveCount(1);

  // Comment 2: a range on the new component, by shift-click, written with the keyboard.
  const box = page.locator('[data-review-file="src/search/SearchBox.tsx"]');
  await box
    .getByRole('button', { name: 'Comment on src/search/SearchBox.tsx line 4 (after)' })
    .click();
  await box
    .getByRole('button', { name: 'Comment on src/search/SearchBox.tsx line 6 (after)' })
    .click({ modifiers: ['Shift'] });
  const range = box.getByTestId('review-comment-form');
  await expect(range).toContainText('lines 4–6 (after)');
  await page.keyboard.type('Name the prop onSubmit,\nlike the other forms.');
  await page.keyboard.press('Control+Enter');
  await expect(box.getByTestId('review-comment')).toHaveCount(1);
  await expect(page.getByTestId('review-count')).toHaveText('2');
  await shoot(page, 'change');

  // Kept in this browser until sent.
  await page.reload();
  await expect(page.getByTestId('review-count')).toHaveText('2');
  await expect(page.getByTestId('review-viewed-count')).toHaveText('1 of 3 viewed');

  // Review changes: Request changes (rework) is open for a change waiting for the owner.
  await page.getByTestId('review-changes').click();
  const pop = page.getByTestId('review-popover');
  await expect(pop.getByRole('radio', { name: 'Request changes' })).toBeChecked();
  await expect(pop.getByRole('radio', { name: 'Comment' })).toBeEnabled();
  await pop.getByLabel('Overall comment').fill('Otherwise good.');
  await expect(pop.getByTestId('review-length')).toContainText('of 4,000 characters');
  await shoot(page, 'change-popover');
  await pop.getByTestId('review-submit').click();

  await expect(page.getByTestId('review-sent')).toContainText(
    'Sent to the helper as rework notes.',
  );
  const rework = posted.find((p) => p.path === `/api/runs/${LOOP_RUN_ID}/review`);
  expect(rework?.body).toEqual({
    agentRunId: L_UI,
    action: 'rework',
    comment: [
      'Review comments:',
      '- src/search/api.ts:3 (new): Keep 50 as the default page size.',
      '- src/search/SearchBox.tsx:4–6 (new): Name the prop onSubmit,',
      '  like the other forms.',
      'Otherwise good.',
    ].join('\n'),
  });
  // The pending review is gone once sent.
  await expect(page.getByTestId('review-count')).toHaveCount(0);
  await expect(page.getByTestId('review-comment')).toHaveCount(0);
});

test('keys: j and k move between files, v marks viewed, c comments on the focused line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await serve(page, withDiffs(loopNeedsYouScenario()));
  await page.goto(`/${CHANGE_HASH}`);
  await expect(page.getByTestId('review-files')).toBeVisible();
  // Nothing focused: the first `j` goes to the first file.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await page.keyboard.press('j');
  const doc = page.locator('[data-review-file="docs/search.md"]');
  await expect(doc.getByTestId('diff-file-toggle')).toBeFocused();
  await page.keyboard.press('j');
  const api = page.locator('[data-review-file="src/search/api.ts"]');
  await expect(api.getByTestId('diff-file-toggle')).toBeFocused();
  await page.keyboard.press('k');
  await expect(doc.getByTestId('diff-file-toggle')).toBeFocused();
  await page.keyboard.press('v');
  await expect(doc.getByTestId('diff-file')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('review-viewed-count')).toHaveText('1 of 3 viewed');

  // `c` on a file goes to its first changed line; `c` there opens the box; arrows move lines.
  await page.keyboard.press('j');
  await page.keyboard.press('c');
  const first = api.getByRole('button', { name: 'Comment on src/search/api.ts line 3 (before)' });
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    api.getByRole('button', { name: 'Comment on src/search/api.ts line 3 (after)' }),
  ).toBeFocused();
  await page.keyboard.press('c');
  await expect(api.getByTestId('review-comment-form').getByRole('textbox')).toBeFocused();
  // Typing in the box never triggers the keys.
  await page.keyboard.type('j k v');
  await expect(api.getByTestId('review-comment-form').getByRole('textbox')).toHaveValue('j k v');
  await page.keyboard.press('Escape');
  await expect(api.getByTestId('review-comment-form')).toHaveCount(0);
  await expect(
    api.getByRole('button', { name: 'Comment on src/search/api.ts line 3 (after)' }),
  ).toBeFocused();
});

test('the ticket branch’s files while agents work: Request changes waits, Comment posts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const posted = await serve(page, withDiffs(loopWorkingScenario()));
  await page.goto(`/${FILES_HASH}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Files changed on the ticket branch',
  );
  await expect(page.getByTestId('review-context')).toContainText('acp/WEB-21');

  const api = page.locator('[data-review-file="src/search/api.ts"]');
  await api.locator('tr[data-kind="change"]').first().hover();
  await api.getByRole('button', { name: 'Comment on src/search/api.ts line 3 (before)' }).click();
  await api.getByTestId('review-comment-form').getByRole('textbox').fill('Why 50 before?');
  await api.getByRole('button', { name: 'Add to review' }).click();

  // Edit, then keep it.
  await api.getByRole('button', { name: 'Edit your comment on line 3 (before)' }).click();
  const edit = api.getByTestId('review-comment-edit').getByRole('textbox');
  await edit.fill('Why was it 50 before?');
  await api.getByRole('button', { name: 'Save' }).click();
  await expect(api.getByTestId('review-comment')).toContainText('Why was it 50 before?');

  await page.getByTestId('review-changes').click();
  const pop = page.getByTestId('review-popover');
  const request = pop.getByRole('radio', { name: 'Request changes' });
  await expect(request).toBeDisabled();
  await expect(pop.getByTestId('review-choice-request-changes')).toContainText(
    'The agents are still working.',
  );
  await expect(pop.getByRole('radio', { name: 'Comment' })).toBeChecked();
  await shoot(page, 'branch-popover');
  await pop.getByTestId('review-submit').click();

  await expect(page.getByTestId('review-sent')).toContainText('Added to the ticket’s comments.');
  const comment = posted.find((p) => p.path === `/api/tickets/${LOOP_TICKET_ID}/comments`);
  expect(comment?.body).toEqual({
    body: 'Review comments:\n- src/search/api.ts:3 (old): Why was it 50 before?',
  });
  expect(posted.some((p) => p.path.endsWith('/ticket-branch'))).toBe(false);
  await shoot(page, 'branch');
});

test('a phone: unified, the tree behind its toggle, and no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serve(page, withDiffs(loopNeedsYouScenario()));
  await page.goto(`/${CHANGE_HASH}`);
  const files = page.getByTestId('review-files');
  await expect(files).toHaveAttribute('data-view', 'unified');
  await expect(files).toHaveAttribute('data-narrow', '');
  await expect(page.getByTestId('review-tree')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show file tree' }).click();
  await expect(page.getByTestId('review-tree-file')).toHaveCount(3);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("entry points: the ticket page's Files changed tab links to the review pages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await serve(page, withDiffs(loopNeedsYouScenario()));
  // D-B: the ticket page's Files changed tab holds the ways into the review pages.
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}?tab=files`);
  await expect(page.getByTestId('review-all-files')).toHaveAttribute(
    'href',
    `${FILES_HASH}?run=${LOOP_RUN_ID}`,
  );
  const link = page.getByRole('link', { name: 'Files changed by the Search UI' });
  await expect(link).toHaveAttribute('href', `${CHANGE_HASH}?run=${LOOP_RUN_ID}`);
  await link.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Files changed by Search UI');
});
