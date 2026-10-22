import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  CODE_HOST_PATH,
  GH_BRANCH,
  GH_PR_URL,
  PROJECT_SETUP_PATH,
  PR_PATH,
  PR_REFRESH_PATH,
  codeHost,
  createdTicket,
  GH_APP_LINES,
  ghMergedScenario,
  ghOpenScenario,
  ghReviewScenario,
  githubFlowStrategy,
  withPullRequestLines,
  type CodeHostKind,
} from './github-fixtures.js';
import {
  CSRF,
  LOOP_PROJECT_GRAPH_PATH,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_TICKET_ID,
  PROJECT_ID,
  type LoopScenario,
} from './review-loop-fixtures.js';
import { fixtureProject } from './ticket-fixtures.js';
import { setupFixture } from './workflow-fixtures.js';

/*
 * G-B (ADR-0025): GitHub and branching in the browser, on the demo server's built UI, with the
 * project, setup, code host, ticket and run routes answered from synthetic fixtures (page.route)
 * while G-A builds the real ones. Nothing reaches GitHub: Push & open PR and Refresh are fakes
 * that move the fixtures on as the server would. With ACP_SCREENSHOT_DIR set, it saves light and
 * dark screenshots at 1440, 1024 and 390 pixels wide.
 */

type Json = Record<string, unknown>;

const SHOTS = process.env.ACP_SCREENSHOT_DIR;

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/** A picture of one element (a card or a dialog), in both themes at each width. */
async function shootPart(page: Page, name: string, testId: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 2000 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      const part = page.getByTestId(testId).first();
      await part.scrollIntoViewIfNeeded();
      await part.screenshot({ path: `${SHOTS}/gh-${name}-${width}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

/** Lists the fixtures' project next to the server's own, with the CSRF token for mutations. */
async function withFixtureProject(page: Page): Promise<void> {
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: CSRF } }));
}

/** The project's setup: GET answers the current one; PUT saves the body as the server would. */
async function withSetup(page: Page, initial: Json): Promise<Json[]> {
  let current = initial;
  const puts: Json[] = [];
  await page.route(`**${PROJECT_SETUP_PATH}`, async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      expect(req.headers()['x-acp-csrf']).toBe(CSRF);
      const body = req.postDataJSON() as Json;
      puts.push(body);
      // Absent keeps the stored strategy; null removes it.
      const { branching, ...rest } = body;
      const next: Json = { ...current, ...rest };
      if (branching === null) delete next['branching'];
      else if (branching !== undefined) next['branching'] = branching;
      current = next;
    }
    await route.fulfill({ json: current });
  });
  return puts;
}

async function demoApi(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/projects');
  expect(res.ok()).toBe(true);
  const project = ((await res.json()) as { id: string; name: string }[]).find(
    (p) => p.name === 'demo-api',
  );
  if (project === undefined) throw new Error('demo-api project missing');
  return project.id;
}

test('Settings: GitHub’s status with Check again, and a branching strategy saved', async ({
  page,
}) => {
  await withFixtureProject(page);
  const puts = await withSetup(page, setupFixture());
  let host: CodeHostKind = 'no-cli';
  let asked = 0;
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) =>
    route.fulfill({ json: fixtureProject() }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/context-candidates`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**${CODE_HOST_PATH}`, (route) => {
    asked += 1;
    return route.fulfill({ json: codeHost(host) });
  });
  await page.goto(`/#/p/${PROJECT_ID}/settings`);

  // GitHub: the CLI is missing; once installed, Check again shows the connection.
  const gh = page.getByTestId('settings-code-host');
  await expect(gh.getByTestId('code-host-message')).toContainText(
    'The GitHub CLI isn’t installed. Install the GitHub CLI (gh) and run gh auth login',
  );
  await expect(gh.getByTestId('code-host-state')).toHaveText('Not connected');
  await shootPart(page, 'code-host-problem', 'settings-code-host');
  host = 'ready';
  await gh.getByRole('button', { name: 'Check again' }).click();
  await expect(gh.getByTestId('code-host-message')).toHaveText('Connected to GitHub: acme/web-app');
  await expect(gh.getByTestId('code-host-state')).toHaveText('Connected');
  await shootPart(page, 'code-host', 'settings-code-host');

  // Branches: None as before, then GitHub flow with a preview, then Custom.
  const card = page.getByTestId('settings-branching');
  await expect(card.getByLabel(/None, keep acp/)).toBeChecked();
  await card.getByText('GitHub flow', { exact: true }).click();
  const names = card.getByTestId('branching-preview-name');
  await expect(names).toHaveText([
    'feature/WEB-12-add-saved-searches',
    'fix/WEB-13-login-fails-on-safari',
  ]);
  await expect(card.getByLabel('Ticket branch name')).toHaveAttribute('readonly', '');
  await card.getByText('Custom', { exact: true }).click();
  const template = card.getByLabel('Ticket branch name');
  await template.fill('{type}/{slug}');
  await expect(card).toContainText('Include {key}, so every ticket gets its own branch.');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await template.fill('{type}/{key}-{slug}');
  await card.getByLabel('Bug', { exact: true }).fill('hotfix');
  await card.getByLabel('Default target branch').fill('release/2.0');
  await expect(names).toHaveText([
    'feature/WEB-12-add-saved-searches',
    'hotfix/WEB-13-login-fails-on-safari',
  ]);
  await shootPart(page, 'branching', 'settings-branching');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({
    branching: {
      preset: 'custom',
      baseBranch: 'main',
      defaultTargetBranch: 'release/2.0',
      ticketBranchTemplate: '{type}/{key}-{slug}',
      typeWords: { feature: 'feature', bug: 'hotfix', chore: 'chore', harness: 'chore' },
    },
  });
  // Opening the page and Check again asked GitHub twice; nothing else did.
  expect(asked).toBe(2);
});

test('New ticket: its own branch name and target under More options', async ({ page, request }) => {
  const demoId = await demoApi(request);
  await withFixtureProject(page);
  await withSetup(page, setupFixture({ branching: githubFlowStrategy() }));
  // The board: the demo server's board shape for the fixtures' project, with no tickets.
  await page.route(`**/api/board?projectId=${PROJECT_ID}`, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('projectId', demoId);
    const real = (await (await route.fetch({ url: url.toString() })).json()) as Json;
    const stages = ['BACKLOG', 'READY', 'WORKING', 'NEEDS_YOU', 'IN_REVIEW', 'DONE'];
    await route.fulfill({
      json: {
        ...real,
        project: { ...(real['project'] as object), ...fixtureProject() },
        projectKey: 'WEB',
        columns: stages.map((stage) => ({ stage, tickets: [] })),
      },
    });
  });
  const posts: Json[] = [];
  await page.route(`**/api/projects/${PROJECT_ID}/tickets`, async (route) => {
    const body = route.request().postDataJSON() as Json;
    posts.push(body);
    await route.fulfill({ status: 201, json: createdTicket(body) });
  });
  await page.goto(`/#/p/${PROJECT_ID}/board`);
  await page.getByRole('button', { name: 'New ticket' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Title').fill('Login fails on Safari');
  await dialog.getByLabel('Type').selectOption('bug');
  await dialog.getByTestId('run-options-more').locator('summary').click();
  const name = dialog.getByLabel('Branch name');
  const target = dialog.getByLabel('Target branch');
  await expect(name).toHaveAttribute('placeholder', 'fix/WEB-N-login-fails-on-safari');
  await expect(target).toHaveAttribute('placeholder', 'main');
  await name.fill('fix safari');
  await expect(dialog).toContainText('Use letters, digits, “.”, “_”, “-” and “/”');
  await name.fill('fix/safari-login');
  await target.fill('release/2.0');
  await shootPart(page, 'new-ticket', 'new-ticket');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    title: 'Login fails on Safari',
    type: 'bug',
    branch: { name: 'fix/safari-login', target: 'release/2.0' },
  });
});

type Stage = 'review' | 'open' | 'behind' | 'merged';

interface FinalStepFlow {
  /** Where the ticket starts. */
  start: Stage;
  /** Where Push & open PR (or Push new commits) takes it. */
  push: Stage;
  /** Where a refresh (the page's own on opening, or Refresh) takes it. */
  refresh: Stage;
}

/**
 * Serves the ticket in its final step; Push & open PR and Refresh move it on like the server
 * (by default: pushed → open, refreshed → merged on GitHub).
 */
async function serveFinalStep(
  page: Page,
  flow: FinalStepFlow = { start: 'review', push: 'open', refresh: 'merged' },
  decorate: (sc: LoopScenario) => LoopScenario = (sc) => sc,
): Promise<{ posts: { path: string; body: unknown }[] }> {
  const scenarios: Record<Stage, LoopScenario> = {
    review: decorate(ghReviewScenario()),
    open: decorate(ghOpenScenario(false)),
    behind: decorate(ghOpenScenario(true)),
    merged: decorate(ghMergedScenario()),
  };
  let stage: Stage = flow.start;
  const posts: { path: string; body: unknown }[] = [];
  await withFixtureProject(page);
  await withSetup(page, setupFixture({ branching: githubFlowStrategy() }));
  await page.route(`**${CODE_HOST_PATH}`, (route) => route.fulfill({ json: codeHost('ready') }));
  await page.route(`**${LOOP_PROJECT_WORKFLOW_PATH}`, (route) =>
    route.fulfill({ json: scenarios[stage].routes[LOOP_PROJECT_WORKFLOW_PATH] }),
  );
  await page.route(`**${LOOP_PROJECT_GRAPH_PATH}`, (route) =>
    route.fulfill({ json: scenarios[stage].routes[LOOP_PROJECT_GRAPH_PATH] }),
  );
  await page.route(/\/api\/(tickets|runs)\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') {
      expect(req.headers()['x-acp-csrf']).toBe(CSRF);
      posts.push({ path: url.pathname, body: req.postDataJSON() as unknown });
      if (url.pathname === PR_PATH) stage = flow.push;
      if (url.pathname === PR_REFRESH_PATH) stage = flow.refresh;
      const detail = scenarios[stage].routes[`/api/tickets/${LOOP_TICKET_ID}`] as Json;
      const run = detail['currentRun'] as Json;
      await route.fulfill({ json: run['ticketBranch'] });
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
  return { posts };
}

test('the final step: Push & open PR, then the pull request open, Refresh, merged', async ({
  page,
}) => {
  const { posts } = await serveFinalStep(page);
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`);
  const card = page.getByTestId('ticket-branch');
  await expect(page.getByTestId('pr-line-branch')).toHaveText(GH_BRANCH);
  await expect(card.getByRole('button', { name: 'Merge into main' })).toBeVisible();
  const push = card.getByRole('button', { name: 'Push & open PR' });
  await expect(push).toBeEnabled();
  // The ticket's branch section shows the branch the run created, read-only.
  await expect(page.getByTestId('ticket-branch-actual')).toHaveText(GH_BRANCH);
  await shootPart(page, 'card-ready', 'ticket-branch');

  // Asked first: what will happen, the title and the draft choice.
  await push.click();
  const confirm = card.getByTestId('push-confirm');
  await expect(confirm).toContainText(
    `Push ${GH_BRANCH} to origin and open a pull request against main on GitHub. The pull request description is this ticket’s run summary.`,
  );
  await expect(confirm.getByLabel('Pull request title')).toHaveValue('WEB-21: Saved searches');
  await confirm.getByLabel('Open it as a draft').check();
  await shootPart(page, 'card-confirm', 'ticket-branch');
  await confirm.getByRole('button', { name: 'Push & open PR' }).click();

  // Open on GitHub: the number links out in a new tab; the local merge waits.
  const pr = page.getByTestId('sidebar-pull-request').getByTestId('pull-request');
  await expect(pr.getByTestId('pr-state')).toHaveText('Open');
  const link = pr.getByRole('link', { name: /Pull request #42/ });
  await expect(link).toHaveAttribute('href', GH_PR_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(pr.getByTestId('pr-checked')).toContainText('Checked');
  await expect(card.getByRole('button', { name: 'Merge into main' })).toHaveCount(0);
  await shootPart(page, 'card-open', 'ticket-branch');

  // Refresh reads it again: merged on GitHub, the ticket is done.
  await pr.getByRole('button', { name: 'Refresh' }).click();
  await expect(card.getByTestId('branch-state')).toHaveText('Merged into main on GitHub');
  await expect(
    page.getByTestId('sidebar-pull-request').getByTestId('pull-request').getByTestId('pr-state'),
  ).toHaveText('Merged');
  await expect(page.getByTestId('ticket-stage')).toContainText('Done');
  await shootPart(page, 'card-merged', 'ticket-branch');

  expect(posts).toEqual([
    { path: PR_PATH, body: { title: 'WEB-21: Saved searches', draft: true } },
    { path: PR_REFRESH_PATH, body: {} },
  ]);
});

test('G-D: opening the ticket reads its open pull request once; merged there, the ticket is done', async ({
  page,
}) => {
  const { posts } = await serveFinalStep(page, { start: 'open', push: 'open', refresh: 'merged' });
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`);
  const card = page.getByTestId('ticket-branch');
  await expect(card.getByTestId('branch-state')).toHaveText('Merged into main on GitHub');
  await expect(page.getByTestId('ticket-stage')).toContainText('Done');
  // Nothing else asks: not the refetches after it, not a wait.
  await page.waitForTimeout(1500);
  expect(posts).toEqual([{ path: PR_REFRESH_PATH, body: {} }]);
});

test('G-D: the pull request is read once per visit; Refresh stays the owner’s', async ({
  page,
}) => {
  const { posts } = await serveFinalStep(page, { start: 'open', push: 'open', refresh: 'open' });
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`);
  const pr = page.getByTestId('sidebar-pull-request').getByTestId('pull-request');
  await expect(pr.getByTestId('pr-state')).toHaveText('Open');
  await expect.poll(() => posts.length).toBe(1);
  await expect(pr.getByTestId('pr-checked')).toContainText('Checked');
  await page.waitForTimeout(1500);
  expect(posts).toHaveLength(1);
  await pr.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => posts.length).toBe(2);
  // Opening the page again is a new visit.
  await page.reload();
  await expect(pr.getByTestId('pr-state')).toHaveText('Open');
  await expect.poll(() => posts.length).toBe(3);
  await page.waitForTimeout(1000);
  expect(posts.every((p) => p.path === PR_REFRESH_PATH)).toBe(true);
  expect(posts).toHaveLength(3);
});

test('G-D: Push new commits when the branch moved on since the last push', async ({ page }) => {
  const { posts } = await serveFinalStep(page, {
    start: 'behind',
    push: 'open',
    refresh: 'behind',
  });
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`);
  const card = page.getByTestId('ticket-branch');
  await expect(
    page.getByTestId('sidebar-pull-request').getByTestId('pull-request').getByTestId('pr-state'),
  ).toHaveText('Open');
  const push = card.getByRole('button', { name: 'Push new commits' });
  await expect(push).toBeEnabled();
  await expect(card.getByRole('button', { name: 'Merge into main' })).toHaveCount(0);
  await shootPart(page, 'push-new', 'ticket-branch');
  await push.click();
  const confirm = card.getByTestId('confirm');
  await expect(confirm).toContainText(
    `Push the new commits on ${GH_BRANCH} to the open pull request #42.`,
  );
  await shootPart(page, 'push-new-confirm', 'ticket-branch');
  await confirm.getByRole('button', { name: 'Push new commits' }).click();
  // Up to date: nothing more to push.
  await expect(card.getByRole('button', { name: 'Push new commits' })).toHaveCount(0);
  await expect(
    page.getByTestId('sidebar-pull-request').getByTestId('pull-request').getByTestId('pr-state'),
  ).toHaveText('Open');
  expect(posts).toEqual([
    { path: PR_REFRESH_PATH, body: {} },
    { path: PR_PATH, body: {} },
  ]);
});

test('G-D: a refused push says GitHub’s branch has commits the app won’t overwrite', async ({
  page,
}) => {
  await serveFinalStep(page, { start: 'behind', push: 'behind', refresh: 'behind' });
  await page.route(`**${PR_PATH}`, (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: 'push-rejected', message: 'raw', requestId: 'e2e' } },
    }),
  );
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`);
  const card = page.getByTestId('ticket-branch');
  await card.getByRole('button', { name: 'Push new commits' }).click();
  await card.getByTestId('confirm').getByRole('button', { name: 'Push new commits' }).click();
  await expect(card.getByTestId('push-new-commits').getByRole('alert')).toHaveText(
    'The branch on GitHub has commits the app doesn’t have; it won’t overwrite them.',
  );
  await shootPart(page, 'push-new-rejected', 'ticket-branch');
});

test('G-D: the pull request lines in the comments', async ({ page }) => {
  await serveFinalStep(
    page,
    { start: 'merged', push: 'merged', refresh: 'merged' },
    withPullRequestLines,
  );
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`);
  const comments = page.getByTestId('comments');
  const lines = comments.getByTestId('merge-line');
  await expect(lines).toHaveCount(3);
  await expect(comments.locator('[data-kind="pr-merged"]')).toContainText(
    GH_APP_LINES.merged.replace(/\.$/, ''),
  );
  await expect(comments.locator('[data-kind="pr-pushed"]').first()).toContainText(
    'Pushed feature/WEB-21-saved-searches and opened pull request #42 into main',
  );
  await expect(comments.locator('[data-kind="pr-pushed"]').nth(1)).toContainText(
    'pull request #42 into main was already open',
  );
  await expect(comments.locator('[data-kind="pr-merged"] code')).toHaveText(['main', '9c8b7a6']);
  await shootPart(page, 'pr-lines', 'comments');
});
