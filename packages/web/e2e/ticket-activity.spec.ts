import { expect, test, type Page } from '@playwright/test';
import { ACTIVITY_ITEMS, ATTACHMENTS_PATH, attachment, withActivity } from './activity-fixtures.js';
import {
  CSRF,
  L_API,
  LOOP_BRANCH_PATH,
  LOOP_PROJECT_GRAPH_PATH,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_RUN_ID,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  PROJECT_ID,
  loopDoneScenario,
  loopReviewScenario,
  ticketBranchReview,
  type LoopScenario,
} from './review-loop-fixtures.js';
import { fixtureProject } from './ticket-fixtures.js';

/*
 * v0.3.0 C-B (ADR-0026): the ticket page's Comments and Conversation tabs and attachments in the
 * browser, on the demo server's built UI, with the ticket, activity and attachment routes answered
 * from synthetic fixtures (page.route) while C-A builds the real ones. Mutations never reach a
 * server. With ACP_SCREENSHOT_DIR set, it saves light and dark pictures at 1440 pixels wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;
const TICKET_HASH = `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`;

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SHOTS}/c-b-${name}-1440-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

interface Sent {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A tiny PNG (1×1, synthetic), served for every image attachment. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function serve(
  page: Page,
  sc: LoopScenario,
  answer: (req: Sent) => unknown = () => ({}),
): Promise<{ sent: () => Sent[] }> {
  const sent: Sent[] = [];
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
  await page.route(/\/api\/(tickets|runs|control|attachments)\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/api/control/token') {
      await route.fulfill({ json: { token: CSRF } });
      return;
    }
    if (req.method() !== 'GET') {
      const s: Sent = {
        method: req.method(),
        path: `${url.pathname}${url.search}`,
        headers: req.headers(),
        body: req.postData(),
      };
      sent.push(s);
      const out = answer(s);
      await (out === null
        ? route.fulfill({ status: 204, body: '' })
        : route.fulfill({ status: 200, json: out }));
      return;
    }
    if (/^\/api\/attachments\/[^/]+\/content$/.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      return;
    }
    const body = sc.routes[url.pathname];
    await (body === undefined
      ? route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
        })
      : route.fulfill({ status: 200, json: body }));
  });
  return { sent: () => [...sent] };
}

async function open(page: Page, tab?: string): Promise<void> {
  await page.goto(`/${TICKET_HASH}${tab ? `?tab=${tab}` : ''}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Saved searches');
}

test('the tabs: Comments first and by default, Conversation last; keys move between them', async ({
  page,
}) => {
  await serve(page, withActivity(loopReviewScenario()));
  await open(page);
  const tabs = page.getByRole('tablist', { name: 'Ticket sections' }).getByRole('tab');
  await expect(tabs).toHaveText([
    /^Comments/,
    /^Agents/,
    /^Files changed/,
    /^Checks/,
    /^Conversation/,
  ]);
  await expect(page.getByTestId('ticket-tab-comments')).toHaveAttribute('aria-selected', 'true');
  // What waits for you stays on the default tab: the final step is there.
  await expect(page.getByTestId('comments-tab').getByTestId('ticket-branch')).toBeVisible();
  await page.getByTestId('ticket-tab-comments').focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('ticket-tab-conversation')).toBeFocused();
  await expect(page.getByTestId('ticket-tab-conversation')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page).toHaveURL(/\?tab=conversation$/);
  await expect(page.getByTestId('activity')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page).toHaveURL(new RegExp(`${LOOP_TICKET_ID}$`));
  await expect(page.getByTestId('comments-tab')).toBeVisible();
});

test('Comments: the summary, attachments, and a comment with an uploaded file', async ({
  page,
}) => {
  const uploaded = attachment({ id: 'att-up', name: 'notes.md', mimeType: 'text/markdown' });
  const server = await serve(page, withActivity(loopReviewScenario()), (req) => {
    if (req.path === ATTACHMENTS_PATH) return uploaded;
    if (req.path.endsWith('/comments')) {
      return {
        id: 'c-new',
        ticketId: LOOP_TICKET_ID,
        runId: null,
        planId: null,
        author: 'owner',
        body: 'With notes',
        createdAt: '2026-10-17T10:00:00.000Z',
        kind: 'comment',
      };
    }
    return {};
  });
  await open(page);
  const thread = page.getByTestId('comments');
  // The lead's summary: one card, the newest version, marked updated.
  const summary = thread.getByTestId('ticket-summary-comment');
  await expect(summary.getByTestId('summary-body')).toContainText('Built the search API');
  await expect(summary.getByTestId('summary-updated')).toHaveText('Updated');
  // The ticket's image previews and opens in a new tab; the log downloads.
  const files = thread.getByTestId('ticket-attachments');
  const shot = files.getByRole('link', { name: 'Open search-mock.png' });
  await expect(shot).toHaveAttribute('target', '_blank');
  await expect(shot.getByRole('img')).toHaveJSProperty('naturalWidth', 1);
  await expect(files.getByRole('link', { name: 'Download slow-query.log' })).toHaveAttribute(
    'download',
    'slow-query.log',
  );
  // HTML in a comment is text; a link opens in a new tab.
  const comment = thread.getByTestId('comment').first();
  await expect(comment.getByTestId('comment-body')).toContainText('<b>not bold</b>');
  await expect(
    comment.getByRole('link', { name: 'https://example.com/search-notes' }),
  ).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await shoot(page, 'comments');

  // Attach a file: uploaded at once as raw bytes, then its id goes with the comment.
  const form = page.getByTestId('comment-form');
  await form.getByTestId('attachment-input').setInputFiles({
    name: 'notes.md',
    mimeType: '',
    buffer: Buffer.from('# Notes\n'),
  });
  await expect(form.getByTestId('upload')).toHaveAttribute('data-status', 'done');
  const upload = server.sent().find((s) => s.path === ATTACHMENTS_PATH);
  expect(upload?.headers['content-type']).toBe('text/markdown');
  expect(upload?.headers['x-attachment-name']).toBe('notes.md');
  expect(upload?.headers['x-acp-csrf']).toBe(CSRF);
  expect(upload?.body).toBe('# Notes\n');
  await form.getByLabel('Add a comment').fill('With notes');
  await form.getByRole('button', { name: 'Comment' }).click();
  await expect
    .poll(() => server.sent().find((s) => s.path.endsWith('/comments'))?.body)
    .toBe(JSON.stringify({ body: 'With notes', attachmentIds: ['att-up'] }));

  // A type that may not be attached is refused before it is sent.
  await form.getByTestId('attachment-input').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(form.getByTestId('upload').last()).toHaveAttribute('data-status', 'failed');
  expect(server.sent().filter((s) => s.path === ATTACHMENTS_PATH)).toHaveLength(1);
});

test('Comments: an attachment is deleted after a confirmation', async ({ page }) => {
  const server = await serve(page, withActivity(loopReviewScenario()), () => null);
  await open(page);
  const files = page.getByTestId('ticket-attachments');
  await files.getByRole('button', { name: 'Delete slow-query.log' }).click();
  const confirm = files.getByRole('group', { name: /Delete slow-query.log\?/ });
  await expect(confirm.getByRole('button', { name: 'Delete' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect
    .poll(() => server.sent().map((s) => `${s.method} ${s.path}`))
    .toEqual(['DELETE /api/attachments/att-log']);
});

test('Conversation: the timeline, its links and the filter chips', async ({ page }) => {
  await serve(page, withActivity(loopReviewScenario()));
  await open(page, 'conversation');
  const activity = page.getByTestId('activity');
  await expect(activity.locator('li[data-type]')).toHaveCount(ACTIVITY_ITEMS.length);
  await expect(page.getByTestId('tab-count-conversation')).toHaveText(
    String(ACTIVITY_ITEMS.length),
  );
  const note = activity.locator('li[data-type="agent-note"]');
  await expect(note).toContainText('Checked it with two unit tests');
  await expect(note.getByTestId('activity-link')).toHaveAttribute(
    'href',
    `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}/changes/${L_API}?run=${LOOP_RUN_ID}`,
  );
  await expect(
    activity.locator('li[data-type="run-facts"]').getByTestId('run-summary'),
  ).toBeVisible();
  await expect(
    activity.locator('li[data-type="pull-request"]').getByTestId('activity-link'),
  ).toHaveAttribute('href', 'https://github.com/example/app/pull/7');
  await shoot(page, 'conversation');

  const chips = activity.getByRole('group', { name: 'Show' });
  await chips.getByRole('button', { name: /^Reviewer/ }).click();
  await expect(chips.getByRole('button', { name: /^Reviewer/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(activity.locator('li[data-type]')).toHaveCount(1);
  await expect(activity.locator('li[data-type="review"]')).toContainText('Cap pageSize at 100');
  await chips.getByRole('button', { name: /^Everyone/ }).click();
  await expect(activity.locator('li[data-type]')).toHaveCount(ACTIVITY_ITEMS.length);
});

test('Files changed after the merge: read only, or no longer available', async ({ page }) => {
  const done = loopDoneScenario();
  const run = (done.routes[LOOP_TICKET_PATH] as Record<string, unknown>)['currentRun'] as Record<
    string,
    unknown
  >;
  const withFiles: LoopScenario = {
    routes: {
      ...done.routes,
      [LOOP_BRANCH_PATH]: { ...ticketBranchReview(), ticketBranch: run['ticketBranch'] },
    },
  };
  await serve(page, withFiles);
  await open(page, 'files');
  await expect(page.getByTestId('merged-read-only')).toHaveText('Merged: read only');
  await expect(page.getByTestId('merged-files')).toContainText('3 changed files');
  await expect(page.getByTestId('review-all-files')).toHaveCount(0);
  await expect(page.getByTestId('change-files-link')).toHaveCount(0);
  await shoot(page, 'merged-files');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await serve(page, {
    routes: {
      ...done.routes,
    },
  });
  await page.route(`**${LOOP_BRANCH_PATH}`, (route) =>
    route.fulfill({
      status: 410,
      json: { error: { code: 'commits_unavailable', message: 'gone', requestId: 'e2e' } },
    }),
  );
  await page.reload();
  await expect(page.getByTestId('merged-files-unavailable')).toContainText(
    'The files of this merge are no longer available',
  );
});
