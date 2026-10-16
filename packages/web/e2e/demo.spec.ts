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

/** A TokenBreakdown shows the API's value per token type, and "Not reported" (never 0) for null. */
async function expectTotals(section: Locator, usage: Usage, timeout = 1_000) {
  for (const c of CATEGORIES) {
    const cell = section.locator(`dd[data-category="${c}"]`);
    const v = usage.tokens[c];
    if (v === null) await expect(cell).toHaveText('Not reported', { timeout });
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

interface Project {
  id: string;
  name: string;
  rootPath: string;
}

async function demoProject(request: APIRequestContext, name: string): Promise<Project> {
  const projects = await api<Project[]>(request, '/projects');
  const project = projects.find((p) => p.name === name);
  if (project === undefined) throw new Error(`${name} project missing`);
  return project;
}

async function open(page: Page, hash: string) {
  await page.goto(`/#${hash}`);
  await expect(page.getByTestId('demo-banner')).toBeVisible();
}

test('sample-data banner and demo mode are always visible', async ({ page }) => {
  // Old addresses redirect to their new home (redesign R-A); the banner is on every page.
  for (const hash of ['/', '/sessions', '/usage', '/projects', '/setup', '/health']) {
    await open(page, hash);
    await expect(page.getByTestId('demo-banner')).toContainText("You're looking at sample data");
    await expect(page.getByTestId('server-status')).toContainText('demo mode');
  }
});

// Redesign (R-A): the Overview is now the "Across your projects" part of All projects.
test('All projects shows the demo projects, status counts, tokens and estimated costs from the API', async ({
  page,
  request,
}) => {
  await open(page, '/projects');
  await expect(page.getByRole('heading', { level: 1, name: 'All projects' })).toBeVisible();
  const cards = page.getByRole('list', { name: 'Your projects' });
  await expect(cards.getByRole('link', { name: 'demo-api' })).toBeVisible();
  await expect(cards.getByRole('link', { name: 'demo-web' })).toBeVisible();

  await expect(async () => {
    const overview = await api<{
      projectCount: number;
      sessionsByStatus: Record<string, number>;
      totals: Usage;
    }>(request, '/overview');
    expect(overview.projectCount).toBe(2);
    await expect(page.getByTestId('stat-projects')).toContainText(
      `${overview.projectCount} folders`,
      {
        timeout: 1_000,
      },
    );
    const counts = page.getByTestId('sessions-by-status');
    for (const [status, n] of Object.entries(overview.sessionsByStatus)) {
      // "Unknown" is only shown when some session has it.
      if (status === 'unknown' && n === 0) continue;
      await expect(counts.locator(`[data-status-count="${status}"]`)).toContainText(fmt(n), {
        timeout: 1_000,
      });
    }
    // "completed" is not a status the product can show (only active/idle/stale/ended/unknown).
    await expect(counts.locator('[data-status-count="completed"]')).toHaveCount(0);

    // Token types side by side, straight from the API; a missing type reads "Not reported".
    const tokens = page.getByRole('region', { name: 'Tokens used' });
    for (const c of CATEGORIES) {
      const cell = tokens.locator(`dd[data-category="${c}"]`);
      const v = overview.totals.tokens[c];
      if (v === null) await expect(cell).toHaveText('Not reported', { timeout: 1_000 });
      else await expect(cell).toContainText(fmt(v), { timeout: 1_000 });
    }
  }).toPass();

  // Provider-reported cost: one row per session from the API, labeled estimated, never totaled.
  await expect(page.getByRole('region', { name: 'Estimated cost by session' })).toContainText(
    'never added together',
  );
  await expect(async () => {
    const overview = await api<{
      latestSnapshots: { sessionId: string; reportedCostUsd: { provenance: string } }[];
    }>(request, '/overview');
    expect(overview.latestSnapshots.length).toBeGreaterThan(0);
    const rows = page.getByTestId('latest-snapshots').locator('li');
    await expect(rows).toHaveCount(overview.latestSnapshots.length, { timeout: 1_000 });
    for (const s of overview.latestSnapshots) {
      const cost = page.locator(`li[data-session="${s.sessionId}"]`).getByTestId('cost');
      await expect(cost).toHaveAttribute('data-provenance', s.reportedCostUsd.provenance, {
        timeout: 1_000,
      });
      if (s.reportedCostUsd.provenance === 'estimated') await expect(cost).toContainText('~$');
      else await expect(cost).toContainText('Not reported');
    }
  }).toPass();
  await expect(page.getByText(/total cost/i)).toHaveCount(0);
});

test('Sessions page lists sessions, nests helpers and draws only the /tree edges', async ({
  page,
  request,
}) => {
  const root = await findRoot(request);
  if (root.projectId === null) throw new Error('demo root has no project');
  // Redesign (R-A): Sessions is a project page.
  await open(page, `/p/${root.projectId}/sessions`);
  await expect(page.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible();

  await expect(async () => {
    const list = await api<{ items: Session[] }>(
      request,
      `/sessions?limit=50&projectId=${root.projectId}`,
    );
    await expect(page.locator('tr[data-session-id]')).toHaveCount(list.items.length, {
      timeout: 1_000,
    });
  }).toPass();

  const tree = await api<{ nodes: unknown[]; edges: Edge[] }>(request, `/sessions/${root.id}/tree`);
  const subagentEdges = tree.edges.filter((e) => e.kind === 'subagent');
  const continuationEdges = tree.edges.filter((e) => e.kind === 'continuation');
  expect(subagentEdges.length).toBeGreaterThan(0);
  expect(continuationEdges.length).toBeGreaterThan(0);

  const relate = page.getByRole('region', { name: 'How sessions relate' });
  await relate.getByRole('combobox', { name: 'Show relationships for' }).selectOption(root.id);

  // Default view: the family tree. Every session in /tree appears once; each subagent edge's child
  // sits in its parent's "Helper agents" list; each continuation child is under "Continued as".
  const family = relate.getByTestId('family-tree');
  await expect(family.locator('[data-testid^="family-member-"]')).toHaveCount(tree.nodes.length);
  for (const e of subagentEdges) {
    const parentCard = family.getByTestId(`family-member-${e.parentId}`);
    const parentName = (await parentCard.getByRole('link').first().textContent()) ?? '';
    await expect(
      family
        .getByRole('list', { name: `Helper agents: ${parentName}` })
        .getByTestId(`family-member-${e.childId}`),
    ).toHaveCount(1);
  }
  await expect(family.getByTestId('family-continued-as')).toHaveCount(continuationEdges.length);
  // The root has no verified parent: it says so explicitly instead of hiding the fact.
  await expect(
    family.getByTestId(`family-member-${root.id}`).getByTestId('family-no-known-parent'),
  ).toHaveText('No known parent');

  // The diagram shows the same edges, no more.
  await relate.getByRole('link', { name: 'Diagram' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(tree.nodes.length);
  await expect(page.locator('.react-flow__edge')).toHaveCount(tree.edges.length);
  await expect(page.locator('.react-flow__edge.edge-subagent')).toHaveCount(subagentEdges.length);
  await expect(page.locator('.react-flow__edge.edge-continuation')).toHaveCount(
    continuationEdges.length,
  );
  await expect(page.getByTestId(`node-${root.id}`).getByTestId('node-parent-unknown')).toHaveText(
    'No known parent',
  );

  await relate.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByTestId('gantt')).toBeVisible();
});

test('session detail shows both token views apart and labels cost as estimated', async ({
  page,
  request,
}) => {
  const root = await findRoot(request);
  await open(page, `/sessions/${root.id}`);
  await expect(page.getByTestId('parent-unknown')).toHaveText('No known parent');

  await expect(async () => {
    const d = await api<Detail>(request, `/sessions/${root.id}`);
    await expectTotals(page.getByTestId('usage-direct'), d.directUsage);
    await expectTotals(page.getByTestId('usage-aggregate'), d.aggregateUsage);
    // With helper agents, "with helpers" is strictly more than "this session": distinguishable.
    expect(d.aggregateUsage.recordCount).toBeGreaterThan(d.directUsage.recordCount);
  }).toPass();
  await expect(page.getByRole('region', { name: 'Tokens (this session)' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tokens (with helpers)' })).toBeVisible();

  const detail = await api<Detail>(request, `/sessions/${root.id}`);
  expect(detail.latestSnapshot?.reportedCostUsd.provenance).toBe('estimated');
  const snapshot = page.getByTestId('snapshot');
  await expect(snapshot.getByRole('heading', { name: 'Estimated cost' })).toBeVisible();
  const cost = snapshot.getByTestId('cost');
  await expect(cost).toHaveAttribute('data-provenance', 'estimated');
  await expect(cost).toContainText('~$');

  // The session's own family tree, with this session outlined.
  await expect(page.getByTestId(`family-member-${root.id}`)).toHaveAttribute(
    'data-current',
    'true',
  );

  // The fork: a continuation child with a known parent and no report (cost not reported, not 0).
  const forkId = root.continuationIds[0];
  if (forkId === undefined) throw new Error('demo root has no fork');
  await open(page, `/sessions/${forkId}`);
  await expect(page.getByTestId('parent-known')).toContainText('Continued from');
  const fork = await api<Detail>(request, `/sessions/${forkId}`);
  if (fork.latestSnapshot === null) await expect(page.getByTestId('no-snapshot')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
});

test('a token type no record reported reads "Not reported", never 0', async ({ page, request }) => {
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
    ).toHaveText('Not reported', { timeout: 1_000 });
  }).toPass();
});

test('usage page renders both charts, the chart table, and direct totals from the API', async ({
  page,
  request,
}) => {
  /** Each token type's stat card shows the API value (exact, with separators) or "Not reported". */
  async function expectStats(section: Locator, usage: Usage) {
    for (const c of CATEGORIES) {
      const v = usage.tokens[c];
      const card = section.getByTestId(`stat-${c}`);
      if (v === null) {
        await expect(card.locator(`[data-category="${c}"]`)).toHaveText('Not reported', {
          timeout: 1_000,
        });
      } else await expect(card).toContainText(fmt(v), { timeout: 1_000 });
    }
  }

  // Redesign (R-A): Tokens is a project page; the API comparisons use the same project filter.
  const project = await demoProject(request, 'demo-api');
  const scope = `projectId=${project.id}`;
  await open(page, `/p/${project.id}/tokens?groupBy=model`);
  await expect(page.getByRole('heading', { name: 'Tokens', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByTestId('token-explainer')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Input and output tokens per day' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Prompt cache tokens per day' })).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  // Groups and stats sum each session's own (direct) usage: helpers count under themselves.
  await expect(page.getByTestId('direct-note')).toContainText(
    "Each session's own tokens are counted once; helper agents count under themselves.",
  );

  await page.getByRole('button', { name: 'Show as table' }).click();
  await expect(async () => {
    const byDay = await api<{ groups: { key: string }[] }>(
      request,
      `/usage/summary?groupBy=day&${scope}`,
    );
    const days = byDay.groups.filter((g) => g.key !== 'unknown').length;
    await expect(page.getByTestId('chart-table').locator('tbody tr')).toHaveCount(days, {
      timeout: 1_000,
    });

    const byModel = await api<{ groups: { key: string }[]; totals: Usage }>(
      request,
      `/usage/summary?groupBy=model&${scope}`,
    );
    await expect(page.locator('tr[data-group]')).toHaveCount(byModel.groups.length, {
      timeout: 1_000,
    });
    await expectStats(page.getByTestId('usage-totals'), byModel.totals);
  }).toPass();
});

// Redesign (R-A): the old project page became the project's own pages. A project card on All
// projects opens its board; Tokens and Sessions in the sidebar show its usage and sessions.
test('a project card opens the project; its Tokens and Sessions pages show its usage and sessions', async ({
  page,
  request,
}) => {
  /** Each token type's stat card shows the API value (exact, with separators) or "Not reported". */
  async function expectStats(section: Locator, usage: Usage) {
    for (const c of CATEGORIES) {
      const v = usage.tokens[c];
      const card = section.getByTestId(`stat-${c}`);
      if (v === null) {
        await expect(card.locator(`[data-category="${c}"]`)).toHaveText('Not reported', {
          timeout: 1_000,
        });
      } else await expect(card).toContainText(fmt(v), { timeout: 1_000 });
    }
  }

  const project = await demoProject(request, 'demo-api');
  await open(page, '/projects');
  const card = page.locator(`[data-project-id="${project.id}"]`);
  await expect(card.getByText(project.rootPath)).toBeVisible();
  await card.getByRole('link', { name: 'demo-api' }).click();
  await expect(page).toHaveURL(new RegExp(`#/p/${project.id}/board$`));
  await expect(
    page.getByRole('button', { name: 'Project: demo-api. Switch project' }),
  ).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Tokens' }).click();
  await expect(page.getByRole('heading', { name: 'Tokens', exact: true, level: 1 })).toBeVisible();
  await expect(async () => {
    const usage = await api<{ totals: Usage }>(
      request,
      `/usage/summary?groupBy=project&projectId=${project.id}`,
    );
    await expectStats(page.getByTestId('usage-totals'), usage.totals);
  }).toPass();

  await nav.getByRole('link', { name: 'Sessions' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible();
  await expect(async () => {
    const sessions = await api<{ items: Session[] }>(
      request,
      `/sessions?limit=50&projectId=${project.id}`,
    );
    await expect(page.locator('tr[data-session-id]')).toHaveCount(sessions.items.length, {
      timeout: 1_000,
    });
  }).toPass();
});
