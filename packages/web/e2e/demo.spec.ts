import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/*
 * P1-F task F5: the brief's first end-to-end workflow, in demo mode, against the real server and the
 * built UI. Expected values are never hardcoded: each check reads the same data from the API and
 * requires the UI to show it. Demo records keep appearing for about a minute after the server
 * starts (fixture offsets), so UI-vs-API comparisons retry until they agree.
 */

type Tokens = Record<'input' | 'output' | 'cacheCreation' | 'cacheRead', number | null>;
interface Usage {
  tokens: Tokens;
  recordCount: number;
}
interface Session {
  id: string;
  providerAgentId: string | null;
  title: string | null;
  agentType: string | null;
  childCount: number;
  projectId: string | null;
  directUsage: Usage;
}
interface Edge {
  parentId: string;
  childId: string;
  kind: 'subagent' | 'continuation';
}
interface Detail extends Session {
  parent: { state: 'known' | 'unknown'; kind?: string };
  aggregateUsage: Usage;
  latestSnapshot: { reportedCostUsd: { provenance: string; value?: number } } | null;
  continuationIds: string[];
}

const CATEGORIES = ['input', 'output', 'cacheCreation', 'cacheRead'] as const;
const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);

async function api<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`/api${path}`);
  expect(res.ok(), `${path} -> ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

/** The text a full (non-compact) TokenCount renders for a category value. */
async function expectTotals(section: Locator, usage: Usage, timeout = 1_000) {
  for (const c of CATEGORIES) {
    const cell = section.locator(`dd[data-category="${c}"]`);
    const v = usage.tokens[c];
    if (v === null) await expect(cell).toHaveText('unavailable', { timeout });
    else await expect(cell).toContainText(fmt(v), { timeout });
  }
}

/** The demo root session: a top-level session with subagent children and a fork. */
async function findRoot(request: APIRequestContext) {
  let root: Detail | undefined;
  await expect(async () => {
    const page = await api<{ items: Session[] }>(request, '/sessions?limit=200');
    for (const s of page.items.filter((x) => x.providerAgentId === null && x.childCount > 0)) {
      const d = await api<Detail>(request, `/sessions/${s.id}`);
      if (d.parent.state === 'unknown' && d.continuationIds.length > 0) root = d;
    }
    expect(root).toBeDefined();
  }).toPass();
  // toPass above guarantees it; this narrows the type.
  if (root === undefined) throw new Error('no demo root session');
  return root;
}

async function open(page: Page, hash: string) {
  await page.goto(`/#${hash}`);
  await expect(page.getByTestId('demo-banner')).toBeVisible();
}

test('DEMO banner and demo mode are always visible', async ({ page }) => {
  for (const hash of ['/', '/sessions', '/usage']) {
    await open(page, hash);
    await expect(page.getByTestId('demo-banner')).toContainText('DEMO DATA');
    await expect(page.getByTestId('server-status')).toContainText('demo mode');
  }
});

test('Command Center shows the demo projects and status counts from the API', async ({
  page,
  request,
}) => {
  await open(page, '/');
  await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByText('demo-api')).toBeVisible();
  await expect(nav.getByText('demo-web')).toBeVisible();

  await expect(async () => {
    const overview = await api<{ projectCount: number; sessionsByStatus: Record<string, number> }>(
      request,
      '/overview',
    );
    expect(overview.projectCount).toBe(2);
    const counts = page.getByTestId('sessions-by-status');
    for (const [status, n] of Object.entries(overview.sessionsByStatus)) {
      await expect(counts.locator(`[data-status-count="${status}"]`)).toContainText(fmt(n), {
        timeout: 1_000,
      });
    }
    // "completed" is not a status the product can show (only active/idle/stale/ended/unknown).
    await expect(counts.locator('[data-status-count="completed"]')).toHaveCount(0);
  }).toPass();
  await expect(page.getByRole('region', { name: 'Total usage' })).toBeVisible();
});

test('Session Explorer lists sessions and draws subagent and continuation edges', async ({
  page,
  request,
}) => {
  const root = await findRoot(request);
  await open(page, '/sessions');
  await expect(page.getByRole('heading', { name: 'Session Explorer' })).toBeVisible();

  await expect(async () => {
    const list = await api<{ items: Session[] }>(request, '/sessions?limit=50');
    await expect(page.locator('tr[data-session-id]')).toHaveCount(list.items.length, {
      timeout: 1_000,
    });
  }).toPass();

  await page
    .locator(`tr[data-session-id="${root.id}"]`)
    .getByRole('button', { name: 'graph' })
    .click();
  const tree = await api<{ nodes: unknown[]; edges: Edge[] }>(request, `/sessions/${root.id}/tree`);
  const subagentEdges = tree.edges.filter((e) => e.kind === 'subagent').length;
  const continuationEdges = tree.edges.filter((e) => e.kind === 'continuation').length;
  expect(subagentEdges).toBeGreaterThan(0);
  expect(continuationEdges).toBeGreaterThan(0);

  await expect(page.locator('.react-flow__node')).toHaveCount(tree.nodes.length);
  await expect(page.locator('.react-flow__edge')).toHaveCount(tree.edges.length);
  const labels = page.locator('.react-flow__edge-text');
  await expect(labels.filter({ hasText: /^subagent$/ })).toHaveCount(subagentEdges);
  await expect(labels.filter({ hasText: /^continuation \(fork\)$/ })).toHaveCount(
    continuationEdges,
  );
  // The root has no verified parent: it says so explicitly instead of hiding the fact.
  await expect(page.getByTestId(`node-${root.id}`).getByTestId('node-parent-unknown')).toHaveText(
    'parent: unknown',
  );

  await page.getByRole('link', { name: 'concurrency timeline' }).click();
  await expect(page.getByTestId('gantt')).toBeVisible();
});

test('session detail separates direct and aggregate usage and labels cost as estimated', async ({
  page,
  request,
}) => {
  const root = await findRoot(request);
  await open(page, `/sessions/${root.id}`);
  const metadata = page.getByTestId('session-metadata');
  await expect(metadata.getByTestId('parent-unknown')).toHaveText('parent: unknown');

  await expect(async () => {
    const d = await api<Detail>(request, `/sessions/${root.id}`);
    await expectTotals(page.getByTestId('usage-direct'), d.directUsage);
    await expectTotals(page.getByTestId('usage-aggregate'), d.aggregateUsage);
    // With subagents, aggregate is strictly more than direct: the two views are distinguishable.
    expect(d.aggregateUsage.recordCount).toBeGreaterThan(d.directUsage.recordCount);
  }).toPass();
  await expect(page.getByRole('region', { name: 'Direct usage' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Aggregate usage' })).toBeVisible();

  const detail = await api<Detail>(request, `/sessions/${root.id}`);
  expect(detail.latestSnapshot?.reportedCostUsd.provenance).toBe('estimated');
  const cost = page.getByTestId('snapshot').getByTestId('cost');
  await expect(cost).toContainText('estimated (provider-reported)');
  await expect(cost).toContainText('~$');

  // The fork: a continuation child with a known parent and no snapshot (cost unavailable, not 0).
  const forkId = root.continuationIds[0];
  if (forkId === undefined) throw new Error('demo root has no fork');
  await open(page, `/sessions/${forkId}`);
  await expect(page.getByTestId('parent-known')).toContainText('continuation');
  const fork = await api<Detail>(request, `/sessions/${forkId}`);
  if (fork.latestSnapshot === null) await expect(page.getByTestId('no-snapshot')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Event timeline (newest first)' })).toBeVisible();
});

test('a category no record reported renders as "unavailable", never 0', async ({
  page,
  request,
}) => {
  // The demo set has a session with missing usage categories (fixtures README).
  let target: Session | undefined;
  await expect(async () => {
    const list = await api<{ items: Session[] }>(request, '/sessions?limit=200');
    target = list.items.find((s) => CATEGORIES.some((c) => s.directUsage.tokens[c] === null));
    expect(target).toBeDefined();
  }).toPass();
  if (target === undefined) throw new Error('no session with an unavailable category');
  const id = target.id;
  await open(page, `/sessions/${id}`);
  await expect(async () => {
    const d = await api<Detail>(request, `/sessions/${id}`);
    await expectTotals(page.getByTestId('usage-direct'), d.directUsage);
    const nullCategory = CATEGORIES.find((c) => d.directUsage.tokens[c] === null);
    expect(nullCategory).toBeDefined();
    await expect(
      page.getByTestId('usage-direct').locator(`dd[data-category="${nullCategory}"]`),
    ).toHaveText('unavailable', { timeout: 1_000 });
  }).toPass();
});

test('usage page renders both charts, the chart table, and direct totals from the API', async ({
  page,
  request,
}) => {
  await open(page, '/usage?groupBy=model');
  await expect(page.getByRole('heading', { name: 'Usage', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Input and output tokens' })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Cache creation and cache read tokens' }),
  ).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await expect(page.getByTestId('direct-note')).toContainText('DIRECT usage');

  await page.getByText('Chart data as a table').click();
  await expect(async () => {
    const byDay = await api<{ groups: { key: string }[] }>(request, '/usage/summary?groupBy=day');
    const days = byDay.groups.filter((g) => g.key !== 'unknown').length;
    await expect(page.getByTestId('chart-table').locator('tbody tr')).toHaveCount(days, {
      timeout: 1_000,
    });

    const byModel = await api<{ groups: { key: string }[]; totals: Usage }>(
      request,
      '/usage/summary?groupBy=model',
    );
    await expect(page.locator('tr[data-group]')).toHaveCount(byModel.groups.length, {
      timeout: 1_000,
    });
    await expectTotals(page.getByTestId('usage-totals'), byModel.totals);
  }).toPass();
});

test('project page shows the project, its direct usage totals and its sessions', async ({
  page,
  request,
}) => {
  await open(page, '/');
  await page.getByRole('navigation', { name: 'Main' }).getByText('demo-api').click();
  await expect(page.getByRole('heading', { name: 'demo-api' })).toBeVisible();

  const projects = await api<{ id: string; name: string; rootPath: string }[]>(
    request,
    '/projects',
  );
  const project = projects.find((p) => p.name === 'demo-api');
  if (project === undefined) throw new Error('demo-api project missing');
  await expect(page.getByText(project.rootPath)).toBeVisible();

  await expect(async () => {
    const usage = await api<{ totals: Usage }>(
      request,
      `/usage/summary?groupBy=session&projectId=${project.id}`,
    );
    await expectTotals(page.getByTestId('project-usage'), usage.totals);
    const sessions = await api<{ items: Session[] }>(request, `/projects/${project.id}/sessions`);
    await expect(page.locator('tr[data-session-id]')).toHaveCount(sessions.items.length, {
      timeout: 1_000,
    });
  }).toPass();
});
