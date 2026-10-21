import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  PROJECT_GRAPH_PATH,
  PROJECT_ID,
  PROJECT_WORKFLOW_PATH,
  RUN_ID,
  TICKET_ID,
  doneScenario,
  fixtureProject,
  type TicketScenario,
} from './ticket-fixtures.js';

/*
 * v0.3.0 S-B (ADR-0024): session names and the run summary card in the browser, on the demo
 * server's built UI. The sessions list and one session are answered from synthetic sessions
 * (page.route) of each kind: started by the app, titled by Claude Code, a helper agent, and one
 * with no name. The ticket page is P4-G's done scenario with the app's run summary and merge line
 * added. With ACP_SCREENSHOT_DIR set, it saves light and dark screenshots at 1440 and 1024 wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;

// The fallback name has a local time in it: one time zone, so the expected text is fixed.
test.use({ timezoneId: 'UTC' });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

type Json = Record<string, unknown>;

const STARTED = '2026-10-21T09:00:00.000Z';
const usage = {
  tokens: { input: 1_240, output: 3_410, cacheCreation: 12_000, cacheRead: 98_000 },
  recordCount: 12,
  recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
  provenance: 'derived',
};

function session(projectId: string, over: Json & { id: string }): Json {
  return {
    provider: 'claude-code',
    providerSessionId: `prov-${over.id}`,
    providerAgentId: null,
    origin: 'external',
    projectId,
    title: null,
    agentType: null,
    description: null,
    launchCwd: '/work/demo-api',
    gitBranch: 'main',
    entrypoint: 'sdk-cli',
    providerVersion: '2.1.0',
    models: ['claude-sonnet-4-5'],
    status: {
      value: 'stale',
      provenance: 'derived',
      basis: { lastEventAt: STARTED, endedAt: null, evaluatedAt: STARTED },
    },
    firstSeenAt: STARTED,
    lastEventAt: STARTED,
    endedAt: null,
    endReason: null,
    lastAttentionAt: null,
    directUsage: usage,
    childCount: 0,
    ...over,
  };
}

const IDS = {
  managed: '5a1e0c3d-1111-4c4c-9a9a-000000000001',
  titled: '7f3c2a10-2222-4c4c-9a9a-000000000002',
  helper: 'b81e44d2-3333-4c4c-9a9a-000000000003',
  unnamed: '0c9d1f37-4444-4c4c-9a9a-000000000004',
} as const;

function sessions(projectId: string): Json[] {
  return [
    session(projectId, {
      id: IDS.managed,
      origin: 'managed',
      gitBranch: 'acp/run-2/ag-ui',
      title: 'Claude Code’s own summary of the first prompt',
      managed: {
        runId: RUN_ID,
        agentRunId: 'ag-ui',
        ticketKey: 'WEB-12',
        kind: 'worker',
        label: 'Frontend helper',
      },
    }),
    session(projectId, { id: IDS.titled, title: 'Fix the webhook retry loop' }),
    session(projectId, {
      id: IDS.helper,
      providerAgentId: 'agent-a1b2c3',
      agentType: 'Explore',
      description: 'Find where retries are scheduled',
    }),
    session(projectId, { id: IDS.unnamed, gitBranch: 'feature/login' }),
  ];
}

const NAMES: Record<keyof typeof IDS, string> = {
  managed: 'WEB-12 · Frontend helper',
  titled: 'Fix the webhook retry loop',
  helper: 'Helper agent: Explore',
  unnamed: 'Session on feature/login · Oct 21, 9:00 AM',
};

interface Project {
  id: string;
  name: string;
}

async function demoApi(request: APIRequestContext): Promise<Project> {
  const res = await request.get('/api/projects');
  expect(res.ok()).toBe(true);
  const project = ((await res.json()) as Project[]).find((p) => p.name === 'demo-api');
  if (project === undefined) throw new Error('demo-api project missing');
  return project;
}

/** Answers the sessions list, and each session's page, from the synthetic sessions. */
async function serveSessions(page: Page, projectId: string): Promise<void> {
  const all = sessions(projectId);
  await page.route(/\/api\/sessions(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: all, page: { nextCursor: null } } }),
  );
  await page.route(/\/api\/sessions\/[^/?]+(\/[a-z]+)?(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const [, , , id, sub] = url.pathname.split('/');
    const s = all.find((x) => x['id'] === id);
    if (s === undefined) {
      await route.fulfill({
        status: 404,
        json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
      });
      return;
    }
    if (sub === 'events') {
      await route.fulfill({ json: { items: [], page: { nextCursor: null } } });
    } else if (sub === 'tree') {
      await route.fulfill({
        json: { rootId: id, nodes: [{ session: s, aggregateUsage: usage }], edges: [] },
      });
    } else {
      await route.fulfill({
        json: {
          ...s,
          parent: { state: 'unknown' },
          aggregateUsage: usage,
          latestSnapshot: null,
          continuationIds: [],
          ambiguousAttributionCount: 0,
        },
      });
    }
  });
}

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      // Let the theme's color transitions finish before the picture.
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${SHOTS}/session-names-${name}-${width}-${scheme}.png`,
        fullPage,
      });
    }
  }
}

test('the Sessions page names every session, and marks the ones the app started', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  await serveSessions(page, project.id);
  await page.goto(`/#/p/${project.id}/sessions`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Sessions' });
  for (const [kind, id] of Object.entries(IDS) as [keyof typeof IDS, string][]) {
    const row = table.locator(`tr[data-session-id="${id}"]`);
    await expect(row.getByTestId('session-name')).toHaveText(NAMES[kind]);
    // The short id stays visible under the name.
    await expect(row).toContainText(id.slice(0, 8));
  }
  const managed = table.locator(`tr[data-session-id="${IDS.managed}"]`);
  await expect(managed.getByTestId('started-by-app')).toHaveText('Started by Agent Control Plane');
  await expect(table.getByTestId('started-by-app')).toHaveCount(1);
  await expect(table.locator(`tr[data-session-id="${IDS.helper}"]`)).toContainText(
    'Find where retries are scheduled',
  );
  await expect(table).not.toContainText(/untitled/i);
  await shoot(page, 'list', true);

  // The relationships diagram draws the same name and the marker on the id line.
  await page.getByRole('link', { name: 'Diagram' }).click();
  const node = page.getByTestId(`node-${IDS.managed}`);
  await expect(node.getByRole('link')).toHaveText(NAMES.managed);
  await expect(node.getByTestId('started-by-app')).toBeVisible();
  await node.scrollIntoViewIfNeeded();
  if (SHOTS !== undefined) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await node.screenshot({ path: `${SHOTS}/session-names-diagram-node-${scheme}.png` });
    }
  }
});

test('a session the app started is titled after its ticket and links to it', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  await serveSessions(page, project.id);
  await page.goto(`/#/sessions/${IDS.managed}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAMES.managed);
  await expect(page.getByTestId('started-by-app').first()).toBeVisible();
  await expect(page.getByTestId('managed-link')).toHaveText('Open WEB-12');
  await expect(page.getByTestId('managed-link')).toHaveAttribute('href', `#/control/${RUN_ID}`);
  await expect(page.getByTestId('session-facts')).toContainText(IDS.managed.slice(0, 8));
  await shoot(page, 'detail');

  await page.goto(`/#/sessions/${IDS.unnamed}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAMES.unnamed);
});

// --- The ticket page: the run summary and the merge line ---------------------------------------

const SUMMARY = [
  'Run summary',
  '',
  'What the lead says:',
  'The settings page has a dark mode switch that follows the system until you pick one.',
  'The choice is kept in local storage. The store helper also added a small migration.',
  '',
  'Plan:',
  '- 3 steps: Theme store, Settings switch, Tests',
  '',
  'Changes:',
  '- Theme store: 2 files, +54 −3; checks passed; merged',
  '- Settings switch: 3 files, +88 −12; checks passed; 1 rework round (reviewer); merged',
  '  - Rework: the switch had no label for screen readers',
  '- Tests: 1 file, +61 −0; checks passed; merged',
  '',
  'Ticket branch:',
  '- acp/WEB-12: 3 changes merged, checks passed on the tip',
  '',
  'Tokens:',
  '- Lead: 41,200 · Helpers: 96,800 · Reviewer: 18,300',
].join('\n');

function withAppComments(sc: TicketScenario): TicketScenario {
  const path = `/api/tickets/${TICKET_ID}`;
  const detail = sc.routes[path] as Json;
  const comments = [
    ...(detail['comments'] as Json[]),
    {
      id: 'c-app-summary',
      ticketId: TICKET_ID,
      runId: RUN_ID,
      planId: null,
      author: 'app',
      body: SUMMARY,
      createdAt: '2026-10-15T09:49:00.000Z',
    },
    {
      id: 'c-app-merge',
      ticketId: TICKET_ID,
      runId: RUN_ID,
      planId: null,
      author: 'app',
      body: 'Merged acp/WEB-12 into main at 4f2a9c1',
      createdAt: '2026-10-15T09:55:00.000Z',
    },
  ];
  return { routes: { ...sc.routes, [path]: { ...detail, comments } } };
}

/** P4-G's serving of a ticket scenario (ticket.spec.ts), GET routes only. */
async function serveTicket(page: Page, sc: TicketScenario): Promise<void> {
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route(`**${PROJECT_WORKFLOW_PATH}`, (route) =>
    route.fulfill({ json: sc.routes[PROJECT_WORKFLOW_PATH] }),
  );
  await page.route(`**${PROJECT_GRAPH_PATH}`, (route) =>
    route.fulfill({ json: sc.routes[PROJECT_GRAPH_PATH] }),
  );
  await page.route(/\/api\/(tickets|runs|control)\//, async (route) => {
    const body = sc.routes[new URL(route.request().url()).pathname];
    if (body === undefined) {
      await route.fulfill({
        status: 404,
        json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
      });
      return;
    }
    await route.fulfill({ status: 200, json: body });
  });
}

test('the ticket shows the run summary as a card and the merge as a small line', async ({
  page,
}) => {
  await serveTicket(page, withAppComments(doneScenario()));
  await page.goto(`/#/p/${PROJECT_ID}/tickets/${TICKET_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Dark mode toggle');

  const comments = page.getByTestId('comments');
  const card = comments.getByTestId('run-summary');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading', { name: 'Run summary', level: 4 })).toBeVisible();
  await expect(card.getByTestId('comment-author')).toHaveText('Agent Control Plane');
  await expect(card).toContainText('Run 2');
  await expect(card.getByRole('heading', { level: 5 })).toHaveText([
    'What the lead says',
    'Plan',
    'Changes',
    'Ticket branch',
    'Tokens',
  ]);
  await expect(card.getByRole('listitem')).toHaveCount(7);
  await expect(card).toContainText('Rework: the switch had no label for screen readers');

  const merge = comments.getByTestId('merge-line');
  await expect(merge).toContainText('Merged acp/WEB-12 into main at 4f2a9c1');
  // The owner's and the lead's comments are as they were.
  await expect(comments.locator('li[data-author="owner"]').first()).toContainText('You');

  if (SHOTS !== undefined) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await comments.scrollIntoViewIfNeeded();
      await comments.screenshot({ path: `${SHOTS}/session-names-run-summary-${scheme}.png` });
    }
  }
});
