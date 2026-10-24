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
  BRANCH_DELETE_PATH,
  MERGE_PR_PATH,
  ghFinishedScenario,
  type BranchPresence,
} from './github-fixtures.js';
import {
  CSRF,
  LOOP_BRANCH_PATH,
  LOOP_PROJECT_GRAPH_PATH,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_TICKET_ID,
  PROJECT_ID,
  type LoopScenario,
} from './review-loop-fixtures.js';
import { TOTALS_PATH, ticketTotals, type TotalsKind } from './totals-fixtures.js';
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
    'The GitHub CLI (gh) isn’t installed.',
  );
  await expect(gh.getByText('brew install gh', { exact: true })).toBeVisible();
  await expect(gh.getByRole('link', { name: /cli\.github\.com/ })).toHaveAttribute(
    'href',
    'https://cli.github.com',
  );
  await expect(gh.getByTestId('code-host-state')).toHaveText('Not connected');
  await shootPart(page, 'code-host-problem', 'settings-code-host');
  host = 'ready';
  await gh.getByRole('button', { name: 'Check again' }).click();
  await expect(gh.getByTestId('code-host-message')).toContainText(
    'Connected to GitHub: acme/web-app',
  );
  await expect(gh.getByTestId('code-host-repo-link')).toHaveAttribute(
    'href',
    'https://github.com/acme/web-app',
  );
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

/**
 * G-E: the Settings page with the code host answered from `host`, and create and connect recorded
 * (CSRF checked) and answered as the server would: the new status, connected.
 */
async function withConnectRoutes(page: Page, start: CodeHostKind) {
  await withFixtureProject(page);
  await withSetup(page, setupFixture());
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) =>
    route.fulfill({ json: fixtureProject() }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/context-candidates`, (route) =>
    route.fulfill({ json: [] }),
  );
  const state: { host: Json; sent: { path: string; body: Json }[] } = {
    host: codeHost(start),
    sent: [],
  };
  await page.route(`**${CODE_HOST_PATH}`, (route) => route.fulfill({ json: state.host }));
  for (const [path, repo] of [
    ['repository', 'octo/web-app'],
    ['remote', 'acme/widgets'],
  ] as const) {
    await page.route(`**${CODE_HOST_PATH}/${path}`, async (route) => {
      const req = route.request();
      expect(req.method()).toBe('POST');
      expect(req.headers()['x-acp-csrf']).toBe(CSRF);
      state.sent.push({ path, body: req.postDataJSON() as Json });
      state.host = { ...codeHost('ready'), repo };
      await route.fulfill({ json: state.host });
    });
  }
  return state;
}

test('G-E: Settings connects GitHub: sign in first, then create a repository', async ({ page }) => {
  const state = await withConnectRoutes(page, 'not-logged-in');
  await page.goto(`/#/p/${PROJECT_ID}/settings`);
  const gh = page.getByTestId('settings-code-host');

  // Not signed in: the command to run, and why the app doesn't run it.
  const login = gh.getByTestId('code-host-login');
  await expect(login.getByText('gh auth login', { exact: true })).toBeVisible();
  await expect(login.getByRole('button', { name: 'Copy command' })).toBeVisible();
  await expect(login).toContainText('the app never handles your GitHub credentials');
  await shootPart(page, 'code-host-login', 'settings-code-host');

  // Signed in now: Check again offers to create one, named after the folder.
  state.host = codeHost('no-remote');
  await gh.getByRole('button', { name: 'Check again' }).click();
  const create = gh.getByTestId('code-host-create');
  await expect(create.getByLabel('Repository name')).toHaveValue('web-app');
  await expect(create.getByLabel('Owner')).toHaveAttribute('placeholder', 'Your account');
  await expect(create.getByLabel('Private', { exact: true })).toBeChecked();
  await expect(create.getByLabel('Push the current branch now')).toBeChecked();
  await expect(create.getByTestId('code-host-create-summary')).toHaveText(
    'Creates github.com/you/web-app as a private repository and sets it as origin, then pushes the current branch.',
  );
  // A name GitHub won't take is said as typed, and nothing is sent.
  await create.getByLabel('Repository name').fill('my app');
  await expect(create).toContainText('Use letters, digits, dots, dashes and underscores');
  await create.getByRole('button', { name: 'Create repository' }).click();
  await expect(create.getByLabel('Repository name')).toBeFocused();
  expect(state.sent).toEqual([]);
  await create.getByLabel('Repository name').fill('web-app');
  await shootPart(page, 'code-host-create', 'settings-code-host');

  // Keyboard: the button is reached with Tab and pressed with Enter.
  await create.getByLabel('Push the current branch now').focus();
  await page.keyboard.press('Tab');
  await expect(create.getByRole('button', { name: 'Create repository' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(gh.getByTestId('code-host-repo-link')).toHaveAttribute(
    'href',
    'https://github.com/octo/web-app',
  );
  await expect(gh.getByTestId('code-host-message')).toBeFocused();
  await expect(gh.getByTestId('code-host-state')).toHaveText('Connected');
  expect(state.sent).toEqual([
    { path: 'repository', body: { name: 'web-app', visibility: 'private', push: true } },
  ]);
});

test('G-E: Settings connects an existing repository, read as typed', async ({ page }) => {
  const state = await withConnectRoutes(page, 'no-remote');
  await page.goto(`/#/p/${PROJECT_ID}/settings`);
  const gh = page.getByTestId('settings-code-host');
  await gh.getByRole('button', { name: 'Connect an existing repository' }).click();
  await expect(gh.getByRole('button', { name: 'Connect an existing repository' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const form = gh.getByTestId('code-host-existing');
  const field = form.getByLabel('Repository', { exact: true });
  await field.fill('https://gitlab.com/acme/widgets');
  await expect(form.getByTestId('code-host-existing-read')).toHaveText(
    'Use owner/name, https://github.com/owner/name or git@github.com:owner/name.git.',
  );
  await field.fill('git@github.com:acme/widgets.git');
  await expect(form.getByTestId('code-host-existing-read')).toHaveText(
    'Connects github.com/acme/widgets as origin, over SSH. Nothing is pushed.',
  );
  await shootPart(page, 'code-host-existing', 'settings-code-host');
  await field.press('Enter');
  await expect(gh.getByTestId('code-host-repo-link')).toHaveText(/acme\/widgets/);
  expect(state.sent).toEqual([
    { path: 'remote', body: { repository: 'git@github.com:acme/widgets.git' } },
  ]);
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
  // On Conversation since v0.3.0 C-B (ADR-0026).
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}?tab=conversation`);
  const comments = page.getByTestId('activity');
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
  await shootPart(page, 'pr-lines', 'activity');
});

// --- G-F (ADR-0025 §8): a project's branches, created from the app -------------------------------

const BRANCHES_PATH = `/api/projects/${PROJECT_ID}/branches`;

/**
 * `GET`/`POST /api/projects/:id/branches` as the server answers them (CSRF checked): the list,
 * and a create that adds the branch (on origin when pushed) and answers the new list.
 */
async function withBranches(
  page: Page,
  names: string[],
  options: { current?: string; hasOrigin?: boolean; onOrigin?: string[] } = {},
): Promise<Json[]> {
  const hasOrigin = options.hasOrigin ?? true;
  const current = options.current ?? names[0] ?? null;
  const all = [...names];
  const origin = new Set(options.onOrigin ?? []);
  const list = (): Json => ({
    current,
    hasOrigin,
    truncated: false,
    branches: [...all].sort().map((name, i) => ({
      name,
      commit: String((i % 9) + 1).repeat(40),
      current: name === current,
      onOrigin: hasOrigin ? origin.has(name) : null,
    })),
  });
  const posts: Json[] = [];
  await page.route(`**${BRANCHES_PATH}`, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      expect(req.headers()['x-acp-csrf']).toBe(CSRF);
      const body = req.postDataJSON() as Json;
      posts.push(body);
      const name = String(body['name']);
      all.push(name);
      if (body['push'] === true) origin.add(name);
      await route.fulfill({ status: 201, json: list() });
      return;
    }
    await route.fulfill({ json: list() });
  });
  return posts;
}

test('G-F: Settings lists the branches and creates one; a missing base offers Create it', async ({
  page,
}) => {
  await withFixtureProject(page);
  await withSetup(
    page,
    setupFixture({
      branching: { ...githubFlowStrategy(), preset: 'custom', baseBranch: 'develop' },
    }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) =>
    route.fulfill({ json: fixtureProject() }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/context-candidates`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**${CODE_HOST_PATH}`, (route) => route.fulfill({ json: codeHost('ready') }));
  const posts = await withBranches(page, ['main', 'feature/search'], { onOrigin: ['main'] });
  await page.goto(`/#/p/${PROJECT_ID}/settings`);

  const card = page.getByTestId('settings-branches');
  const rows = card.getByTestId('branch-row');
  await expect(rows).toHaveCount(2);
  const main = rows.filter({ hasText: 'main' });
  await expect(main.getByTestId('branch-current')).toHaveText('Current');
  await expect(main.getByTestId('branch-on-origin')).toHaveText('On GitHub');
  // Sorted by name, main is the second row: its fixture commit is 2222….
  await expect(main).toContainText('2222222');
  await shootPart(page, 'branches', 'settings-branches');

  // New branch: a bad name is said as typed; a good one is created from main and pushed.
  const form = card.getByTestId('branch-new');
  const name = form.getByLabel('Name', { exact: true });
  await name.fill('bad name');
  await name.blur();
  await expect(form).toContainText('Use letters, digits');
  await name.fill('release/2.0');
  await expect(form.getByLabel('From', { exact: true })).toHaveValue('main');
  await expect(form.getByLabel('Also push to GitHub')).toBeChecked();
  await form.getByRole('button', { name: 'Create branch' }).click();
  await expect(form.getByTestId('branch-created')).toHaveText(
    'Created release/2.0 and pushed it to origin.',
  );
  await expect(rows).toHaveCount(3);
  await expect(
    rows.filter({ hasText: 'release/2.0' }).getByTestId('branch-on-origin'),
  ).toBeVisible();

  // The strategy's base branch, develop, isn't in the folder: Create it.
  const strategy = page.getByTestId('settings-branching');
  const note = strategy.getByTestId('branching-base-missing');
  await expect(note).toContainText('develop isn’t a branch in the project folder yet.');
  await note.getByRole('button', { name: 'Create it' }).click();
  const create = note.getByRole('button', { name: 'Create develop from main' });
  await expect(create).toBeFocused();
  await shootPart(page, 'branching-missing', 'settings-branching');
  await note.getByLabel('Also push to GitHub').uncheck();
  await create.click();
  await expect(strategy.getByTestId('branching-base-missing-created')).toHaveText(
    'Created develop.',
  );
  expect(posts).toEqual([
    { name: 'release/2.0', from: 'main', push: true },
    { name: 'develop', from: 'main' },
  ]);
});

test('G-F: Start refused for a missing target creates it, then starts once more', async ({
  page,
  request,
}) => {
  const demoId = await demoApi(request);
  await withFixtureProject(page);
  await withSetup(
    page,
    setupFixture({ branching: { ...githubFlowStrategy(), defaultTargetBranch: 'dev' } }),
  );
  await page.route(`**${CODE_HOST_PATH}`, (route) => route.fulfill({ json: codeHost('ready') }));
  const card: Json = {
    ...createdTicket({ title: 'Saved searches' }),
    status: 'READY',
    stage: 'READY',
    activeHelpers: 0,
    budgetTokensUsed: null,
    needsYou: 0,
    latestEstimatedCost: null,
    lastActivityAt: null,
    lastRunOutcome: null,
  };
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
        columns: stages.map((stage) => ({ stage, tickets: stage === 'READY' ? [card] : [] })),
      },
    });
  });
  const posts = await withBranches(page, ['main']);
  let starts = 0;
  await page.route('**/api/tickets/t-30/start', async (route) => {
    expect(route.request().headers()['x-acp-csrf']).toBe(CSRF);
    starts += 1;
    if (starts === 1) {
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'target_branch_missing',
            message: 'The target branch dev does not exist in the project yet',
            requestId: 'e2e',
          },
        },
      });
      return;
    }
    await route.fulfill({ json: ghReviewScenario().routes[`/api/tickets/${LOOP_TICKET_ID}`] });
  });
  await page.goto(`/#/p/${PROJECT_ID}/board`);
  await page.getByRole('button', { name: 'Move WEB-30' }).click();
  await page.getByRole('menuitem', { name: 'Start (the lead agent plans it)' }).click();
  const fix = page.getByTestId('start-fix');
  await expect(fix).toContainText('dev isn’t a branch in the project folder yet.');
  await expect(page.getByRole('alert').first()).toContainText("WEB-30 didn't start.");
  await expect(fix.getByLabel('Also push to GitHub')).toBeChecked();
  await shootPart(page, 'start-fix', 'start-fix');
  await fix.getByRole('button', { name: 'Create dev from main' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Started WEB-30. The lead agent is planning it.' }),
  ).toBeVisible();
  await expect(fix).toHaveCount(0);
  expect(posts).toEqual([{ name: 'dev', from: 'main', push: true }]);
  expect(starts).toBe(2);
});

// --- G-G (ADR-0025 §9): Merge pull request and Delete branch; T-A: the ticket badge ------------

type MergeStage = 'open' | 'merged' | 'gone';

/**
 * Serves the ticket from an open pull request (or already merged with its branch still there):
 * Merge pull request takes it to merged on GitHub with `afterMerge` presence, Delete branch to
 * gone everywhere. Each stage has its badge totals (running while open, done once merged).
 */
async function serveMerge(
  page: Page,
  start: MergeStage,
  afterMerge: BranchPresence,
): Promise<{ posts: { path: string; body: unknown }[] }> {
  const totals = (sc: LoopScenario, kind: TotalsKind): LoopScenario => ({
    routes: { ...sc.routes, [TOTALS_PATH]: ticketTotals(kind) },
  });
  const scenarios: Record<MergeStage, LoopScenario> = {
    open: totals(ghOpenScenario(false), 'running'),
    merged: totals(ghFinishedScenario(afterMerge), 'done'),
    gone: totals(ghFinishedScenario({ localExists: false, headOnOrigin: false }), 'done'),
  };
  let stage = start;
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
      if (url.pathname === MERGE_PR_PATH) stage = 'merged';
      if (url.pathname === BRANCH_DELETE_PATH) stage = 'gone';
      // The answer carries what git says now, as the server's does.
      const review = scenarios[stage].routes[LOOP_BRANCH_PATH] as Json | undefined;
      const detail = scenarios[stage].routes[`/api/tickets/${LOOP_TICKET_ID}`] as Json;
      await route.fulfill({
        json: review?.['ticketBranch'] ?? (detail['currentRun'] as Json)['ticketBranch'],
      });
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

test('G-G: Merge pull request with the chosen method and Delete branch; then done, branch deleted', async ({
  page,
}) => {
  const { posts } = await serveMerge(page, 'open', { localExists: false, headOnOrigin: false });
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`);
  const card = page.getByTestId('ticket-branch');
  await expect(page.getByTestId('final-step-shortcut')).toHaveText('Merge pull request');
  const box = card.getByTestId('merge-pr');
  await expect(box.getByLabel('Merge method')).toHaveValue('merge');
  await expect(box.getByLabel('Delete branch')).toBeChecked();
  await box.getByLabel('Merge method').selectOption('squash');
  await shootPart(page, 'merge-box', 'ticket-branch');
  await box.getByRole('button', { name: 'Squash and merge' }).click();
  const confirm = card.getByTestId('merge-confirm');
  await expect(confirm).toContainText(
    `Merges #42 into main on GitHub as one squashed commit and deletes ${GH_BRANCH} there and in the project folder. The ticket is done once GitHub reports it merged.`,
  );
  // Cancel has the focus: a stray Enter never merges.
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await shootPart(page, 'merge-confirm', 'ticket-branch');
  await confirm.getByRole('button', { name: 'Confirm squash and merge' }).click();

  await expect(card.getByTestId('branch-state')).toHaveText('Merged into main on GitHub');
  await expect(page.getByTestId('ticket-stage')).toContainText('Done');
  await expect(card.getByTestId('branch-deleted')).toHaveText('Branch deleted');
  await expect(card.getByRole('button', { name: 'Delete branch' })).toHaveCount(0);
  // The method is remembered for the project, in this browser only.
  expect(
    await page.evaluate((id) => window.localStorage.getItem(`acp.merge-method.${id}`), PROJECT_ID),
  ).toBe('squash');
  expect(posts).toEqual([
    { path: PR_REFRESH_PATH, body: {} },
    { path: MERGE_PR_PATH, body: { method: 'squash', deleteBranch: true } },
  ]);
});

test('G-G: Delete branch once merged, while it is still on GitHub and in the project', async ({
  page,
}) => {
  const { posts } = await serveMerge(page, 'merged', { localExists: true, headOnOrigin: true });
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`);
  const card = page.getByTestId('ticket-branch');
  await expect(card.getByTestId('branch-state')).toHaveText('Merged into main on GitHub');
  const del = card.getByRole('button', { name: 'Delete branch' });
  await expect(del).toBeVisible();
  await shootPart(page, 'delete-branch', 'ticket-branch');
  await del.click();
  const confirm = card.getByTestId('delete-confirm');
  await expect(confirm).toContainText(
    `Deletes ${GH_BRANCH} on GitHub and in the project folder. Its commits stay in the ticket’s history here.`,
  );
  await shootPart(page, 'delete-confirm', 'ticket-branch');
  await confirm.getByRole('button', { name: 'Delete branch' }).click();
  await expect(card.getByTestId('branch-deleted')).toHaveText('Branch deleted');
  await expect(card.getByRole('button', { name: 'Delete branch' })).toHaveCount(0);
  expect(posts).toEqual([{ path: BRANCH_DELETE_PATH, body: {} }]);
});

test('T-A: the ticket badge shows the time taken and the tokens, with details', async ({
  page,
}) => {
  await serveMerge(page, 'merged', { localExists: false, headOnOrigin: false });
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`);
  const badge = page.getByTestId('ticket-totals-badge');
  await expect(badge.getByTestId('ticket-totals-time')).toHaveText('Took 1h 12m');
  await expect(badge.getByTestId('ticket-totals-tokens')).toHaveText('1.2M tokens');
  await expect(badge).toHaveAttribute(
    'aria-label',
    'Took 1h 12m, 1,234,567 tokens used. Show details',
  );
  await expect(badge).not.toContainText('$');
  // On the state line, to the right of the state.
  const stage = await page.getByTestId('ticket-stage').boundingBox();
  const box = await badge.boundingBox();
  expect(box !== null && stage !== null && box.x > stage.x).toBe(true);
  await shootPart(page, 'ticket-badge', 'ticket-header');

  // Keyboard: focus and Enter open the details; Escape closes them.
  await badge.focus();
  await page.keyboard.press('Enter');
  const details = page.getByTestId('ticket-totals-details');
  await expect(details).toBeVisible();
  await expect(details.getByTestId('totals-elapsed')).toHaveText('1h 12m');
  await expect(details.getByTestId('totals-runs')).toContainText('Run 1');
  await expect(details.getByTestId('totals-total')).toContainText('1,234,567');
  await expect(details.getByTestId('totals-open-tokens')).toHaveAttribute(
    'href',
    `#/p/${PROJECT_ID}/tokens?by=ticket`,
  );
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);

  // A phone: the badge wraps under the state, inside the screen.
  await page.setViewportSize({ width: 390, height: 900 });
  const narrow = await badge.boundingBox();
  expect(narrow !== null && narrow.x >= 0 && narrow.x + narrow.width <= 390).toBe(true);
});

// --- G-H (ADR-0025 §10): where ticket branches start ---------------------------------------------

test('G-H: Settings saves where ticket branches start; New ticket starts one from its own branch', async ({
  page,
  request,
}) => {
  const demoId = await demoApi(request);
  await withFixtureProject(page);
  const puts = await withSetup(
    page,
    setupFixture({ branching: { ...githubFlowStrategy(), defaultTargetBranch: 'dev' } }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) =>
    route.fulfill({ json: fixtureProject() }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/context-candidates`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**${CODE_HOST_PATH}`, (route) => route.fulfill({ json: codeHost('ready') }));
  const branchPosts = await withBranches(page, ['main', 'dev', 'release/1.0']);
  await page.goto(`/#/p/${PROJECT_ID}/settings`);

  // Settings: "Same as the target branch" first and chosen; release/1.0 picked and saved.
  const strategy = page.getByTestId('settings-branching');
  const from = strategy.getByLabel('Start ticket branches from');
  await expect(from).toHaveValue('');
  await expect(from.locator('option').first()).toHaveText('Same as the target branch (dev)');
  await from.selectOption('release/1.0');
  await expect(strategy.getByTestId('branching-source-missing')).toHaveCount(0);
  await shootPart(page, 'branching-source', 'branching-source');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({
    branching: { defaultTargetBranch: 'dev', defaultSourceBranch: 'release/1.0' },
  });

  // New ticket: "Start from" follows the project's, offers the local branches, and creates a
  // typed branch the folder doesn't have (from the ticket's target).
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
  await dialog.getByLabel('Title').fill('Release notes');
  await dialog.getByTestId('run-options-more').locator('summary').click();
  const start = dialog.getByLabel('Start from');
  await expect(start).toHaveAttribute('placeholder', 'Project default (release/1.0)');
  await dialog.getByLabel('Target branch').fill('main');
  await start.fill('hotfix/base');
  const missing = dialog.getByTestId('ticket-branch-from-missing');
  await expect(missing).toContainText('hotfix/base isn’t a branch in the project folder yet.');
  await missing.getByLabel('Also push to GitHub').uncheck();
  await shootPart(page, 'new-ticket-from', 'new-ticket');
  await missing.getByRole('button', { name: 'Create hotfix/base from main' }).click();
  await expect(dialog.getByTestId('ticket-branch-from-missing-created')).toHaveText(
    'Created hotfix/base.',
  );
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  await expect(dialog).toHaveCount(0);
  expect(branchPosts).toEqual([{ name: 'hotfix/base', from: 'main' }]);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    title: 'Release notes',
    branch: { target: 'main', from: 'hotfix/base' },
  });
});
