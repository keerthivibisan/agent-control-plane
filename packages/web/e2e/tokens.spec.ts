import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/*
 * Redesign R-F: the project Tokens page in the browser, on the demo server's built UI. The demo
 * project is real; `GET /api/projects/:id/tokens` is answered from a synthetic ProjectTokensDto
 * (page.route), so the numbers are known and include agent roles, tickets and partial records the
 * demo data does not have. With ACP_SCREENSHOT_DIR set, it saves light and dark screenshots at 1440
 * and 1024 pixels wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;

type Counts = Record<'input' | 'output' | 'cacheCreation' | 'cacheRead', number | null>;

function usage(tokens: Counts, recordCount: number, missing: Partial<Counts> = {}) {
  return {
    tokens,
    recordCount,
    recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, ...missing },
    provenance: 'derived',
  };
}

/** The same figures `tokenHeadline()` gives (null when nothing was reported). */
function headline(t: Counts) {
  const sum = (xs: (number | null)[]) => {
    const known = xs.filter((x): x is number => x !== null);
    return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
  };
  const newWork = sum([t.input, t.output]);
  const totalProcessed = sum([t.input, t.output, t.cacheCreation, t.cacheRead]);
  const cacheReuseShare =
    totalProcessed === null || totalProcessed === 0 || t.cacheRead === null
      ? null
      : t.cacheRead / totalProcessed;
  return { newWork, totalProcessed, cacheReuseShare, provenance: 'derived' };
}

const row = (u: ReturnType<typeof usage>) => ({ usage: u, headline: headline(u.tokens) });
const c = (i: number | null, o: number | null, w: number | null, r: number | null): Counts => ({
  input: i,
  output: o,
  cacheCreation: w,
  cacheRead: r,
});

/** 21 days of synthetic usage; two days have no usage (no row), one has no cache write. */
function days() {
  const out = [];
  for (let d = 0; d < 21; d++) {
    if (d === 6 || d === 13) continue;
    const day = new Date(Date.UTC(2026, 8, 26 + d)).toISOString().slice(0, 10);
    const wave = 1 + Math.sin(d / 2.5);
    const input = Math.round(900 + 600 * wave);
    const output = Math.round(5_000 + 4_000 * wave + d * 120);
    const write = d === 9 ? null : Math.round(25_000 + 18_000 * wave);
    const read = Math.round(600_000 + 450_000 * wave + d * 9_000);
    out.push({
      day,
      ...row(
        usage(c(input, output, write, read), 20 + d, d === 9 ? { cacheCreation: 20 + d } : {}),
      ),
    });
  }
  return out;
}

function fixture(projectId: string) {
  const byDay = days();
  const sum = (k: keyof Counts) => byDay.reduce<number>((n, d) => n + (d.usage.tokens[k] ?? 0), 0);
  const records = byDay.reduce((n, d) => n + d.usage.recordCount, 0) + 1;
  const totals = usage(
    c(sum('input'), sum('output'), sum('cacheCreation'), sum('cacheRead')),
    records,
    { cacheCreation: 29, input: 1, output: 1, cacheRead: 1 },
  );
  return {
    projectId,
    range: { from: null, to: null },
    sessions: { total: 38, withUsage: 31 },
    runs: 6,
    ticketsWithRuns: 4,
    totals,
    headline: headline(totals.tokens),
    byDay,
    bySession: [
      {
        sessionId: '7f3c2a10-1111-4c4c-9a9a-000000000001',
        title: 'Rate limit the public API',
        latestEstimatedCost: { provenance: 'estimated', value: 4.87 },
        ...row(usage(c(4_210, 38_900, 210_400, 4_902_000), 182)),
      },
      {
        sessionId: 'b81e44d2-2222-4c4c-9a9a-000000000002',
        title: 'Fix the webhook retry loop',
        latestEstimatedCost: { provenance: 'estimated', value: 2.11 },
        ...row(usage(c(2_870, 21_300, null, 2_310_000), 96, { cacheCreation: 96 })),
      },
      {
        sessionId: '0c9d1f37-3333-4c4c-9a9a-000000000003',
        title: null,
        latestEstimatedCost: null,
        ...row(usage(c(1_140, 9_800, 61_000, 1_020_000), 41, { input: 3 })),
      },
      {
        sessionId: 'e4a07b65-4444-4c4c-9a9a-000000000004',
        title: 'Lead: rotate the signing keys',
        latestEstimatedCost: { provenance: 'unavailable', value: null },
        ...row(
          usage(c(null, null, null, null), 1, {
            input: 1,
            output: 1,
            cacheCreation: 1,
            cacheRead: 1,
          }),
        ),
      },
    ],
    byTicket: [
      {
        ticketId: 't-e2e-3',
        key: 'API-3',
        title: 'Rate limit the public API',
        ...row(usage(c(4_210, 38_900, 210_400, 4_902_000), 182)),
      },
      {
        ticketId: 't-e2e-2',
        key: 'API-2',
        title: 'Retry failed webhooks',
        ...row(usage(c(2_870, 21_300, null, 2_310_000), 96, { cacheCreation: 96 })),
      },
      {
        ticketId: 't-e2e-4',
        key: 'API-4',
        title: 'Rotate the signing keys',
        ...row(usage(c(null, null, null, null), 0)),
      },
    ],
    byRole: [
      { role: 'planner', ...row(usage(c(610, 4_100, 30_000, 410_000), 22)) },
      { role: 'lead', ...row(usage(c(1_900, 15_200, 88_000, 1_870_000), 74)) },
      {
        role: 'worker',
        ...row(usage(c(4_570, 40_900, 92_400, 4_932_000), 182, { cacheCreation: 96 })),
      },
      { role: 'reviewer', ...row(usage(c(380, 2_900, 16_000, 260_000), 9)) },
      { role: 'external', ...row(usage(c(1_140, 9_800, 61_000, 1_020_000), 41, { input: 3 })) },
    ],
    byModel: [
      { model: 'claude-opus-4-1', ...row(usage(c(6_100, 52_000, 201_000, 6_200_000), 240)) },
      { model: 'claude-sonnet-4-5', ...row(usage(c(2_500, 21_000, 86_400, 2_292_000), 87)) },
      { model: 'unknown', ...row(usage(c(null, null, null, null), 1)) },
    ],
  };
}

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

/** Answers the project's tokens route with `body`; records the query strings it was asked. */
async function serveTokens(page: Page, projectId: string, body: unknown): Promise<string[]> {
  const asked: string[] = [];
  await page.route(`**/api/projects/${projectId}/tokens*`, async (route) => {
    asked.push(new URL(route.request().url()).search);
    await route.fulfill({ json: body });
  });
  return asked;
}

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/tokens-${name}-${width}-${scheme}.png`, fullPage });
    }
  }
}

test('the Tokens page shows the tiles, two charts and the breakdowns', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  await serveTokens(page, project.id, fixture(project.id));
  await page.goto(`/#/p/${project.id}/tokens`);
  await expect(page.getByRole('heading', { level: 1, name: 'Tokens' })).toBeVisible();

  const tiles = page.getByRole('group', { name: 'Tokens at a glance' });
  await expect(tiles.getByTestId('tile-sessions')).toContainText('38');
  await expect(tiles.getByTestId('tile-runs')).toContainText('for 4 tickets');
  await expect(tiles.getByTestId('tile-share')).toContainText('%');
  await expect(tiles.getByTestId('share-why')).toBeVisible();
  await expect(page.getByRole('img', { name: 'New work per day' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Prompt cache per day' })).toBeVisible();
  await expect(page.getByTestId('undated-usage')).toBeVisible();

  const sessions = page.getByRole('table', { name: 'Tokens by session' });
  await expect(sessions.locator('tbody tr')).toHaveCount(4);
  await expect(sessions.getByText('estimated (provider-reported)')).toBeVisible();
  await expect(sessions.getByText('~$4.87')).toBeVisible();
  await shoot(page, 'overview', true);

  await page.getByRole('button', { name: 'Agent role' }).click();
  await expect(page).toHaveURL(/tokens\?by=role$/);
  const roles = page.getByRole('table', { name: 'Tokens by agent role' });
  await expect(roles.locator('tbody tr')).toHaveCount(5);
  await expect(roles.getByText('Outside the app')).toBeVisible();
  await page.getByRole('table', { name: 'Tokens by agent role' }).scrollIntoViewIfNeeded();
  if (SHOTS !== undefined) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByTestId('tokens-breakdown').screenshot({ path: `${SHOTS}/tokens-roles.png` });
  }

  await page.getByRole('button', { name: 'Ticket', exact: true }).click();
  const tickets = page.getByRole('table', { name: 'Tokens by ticket' });
  await expect(tickets.locator('tbody tr')).toHaveCount(3);
  await expect(tickets.locator('[data-row="t-e2e-4"]')).toContainText('Not reported');
});

test('the date range asks the server for whole UTC days and is kept in the address', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  const asked = await serveTokens(page, project.id, fixture(project.id));
  await page.goto(`/#/p/${project.id}/tokens`);
  const range = page.getByRole('form', { name: 'Date range' });
  await range.getByRole('button', { name: 'Last 7 days' }).click();
  await expect(page).toHaveURL(/tokens\?range=7d$/);
  await expect(range.getByText('Days are counted in UTC.')).toBeVisible();
  await expect
    .poll(() => asked.at(-1) ?? '')
    .toMatch(/^\?from=\d{4}-\d{2}-\d{2}T00%3A00%3A00\.000Z&to=/);

  await range.getByRole('button', { name: 'Custom' }).click();
  await range.getByLabel('From').fill('2026-10-01');
  await expect(page).toHaveURL(/from=2026-10-01/);
  await expect.poll(() => asked.at(-1) ?? '').toContain('from=2026-10-01T00%3A00%3A00.000Z');
  await shoot(page, 'custom-range');
});

test('a project without usage has one empty state', async ({ page, request }) => {
  const project = await demoApi(request);
  const empty = usage(c(null, null, null, null), 0);
  await serveTokens(page, project.id, {
    ...fixture(project.id),
    sessions: { total: 0, withUsage: 0 },
    runs: 0,
    ticketsWithRuns: 0,
    totals: empty,
    headline: headline(empty.tokens),
    byDay: [],
    bySession: [],
    byTicket: [],
    byRole: [],
    byModel: [],
  });
  await page.goto(`/#/p/${project.id}/tokens`);
  await expect(page.getByText('No token usage yet')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Tokens at a glance' })).toHaveCount(0);
  await shoot(page, 'empty');
});
