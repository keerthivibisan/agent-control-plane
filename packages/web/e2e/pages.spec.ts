import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/*
 * R-V: every page of the new UI on the demo server's built UI and real demo data — the sidebar
 * reaches each project page, every pre-redesign address lands on its new home, the project's
 * Sessions page, a session, Data health and its Connection tab, and an unknown address. The
 * page-specific behaviour is in each page's own spec; this one checks that the whole app holds
 * together. With ACP_SCREENSHOT_DIR set, it saves light and dark screenshots at 1440 and 1024
 * pixels wide of the pages no other spec photographs.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;

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

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/pages-${name}-${width}-${scheme}.png`, fullPage });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

test('the sidebar opens every project page, each with its heading and the entry marked', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  await page.goto(`/#/p/${project.id}/board`);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const pages: [string, string, RegExp][] = [
    ['Board', 'board', /demo-api/],
    ['Workflow', 'workflow', /Workflow/],
    ['Skills & Agents', 'skills', /Skills & Agents/],
    ['Harness', 'harness', /Harness/],
    ['Tokens', 'tokens', /Tokens/],
    ['Sessions', 'sessions', /Sessions/],
    ['Settings', 'settings', /Settings/],
  ];
  for (const [label, path, heading] of pages) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/p/${project.id}/${path}(\\?.*)?$`));
    await expect(h1(page)).toContainText(heading);
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // No page is a placeholder: none says "coming soon" or "not found".
    await expect(page.getByText(/coming soon|page not found/i)).toHaveCount(0);
  }
  // The global entries.
  await nav.getByRole('link', { name: 'All projects' }).click();
  await expect(h1(page)).toHaveText('All projects');
  await nav.getByRole('link', { name: 'Data health' }).click();
  await expect(page).toHaveURL(/#\/health$/);
  await expect(h1(page)).toContainText('Data health');
});

test('every pre-redesign address lands on its new home', async ({ page, request }) => {
  const project = await demoApi(request);
  // The remembered project is the one last opened.
  await page.goto(`/#/p/${project.id}/board`);
  await expect(h1(page)).toContainText('demo-api');
  const cases: [string, RegExp][] = [
    ['#/', new RegExp(`#/p/${project.id}/board$`)],
    ['#/board', new RegExp(`#/p/${project.id}/board$`)],
    [`#/board/${project.id}`, new RegExp(`#/p/${project.id}/board$`)],
    [`#/projects/${project.id}`, new RegExp(`#/p/${project.id}/`)],
    [`#/projects/${project.id}/settings`, new RegExp(`#/p/${project.id}/settings$`)],
    [`#/usage?projectId=${project.id}`, new RegExp(`#/p/${project.id}/tokens$`)],
    [`#/sessions?projectId=${project.id}`, new RegExp(`#/p/${project.id}/sessions$`)],
    ['#/usage', new RegExp(`#/p/${project.id}/tokens$`)],
    ['#/setup', /#\/health\/connection$/],
    ['#/control', new RegExp(`#/p/${project.id}/board$`)],
  ];
  for (const [from, to] of cases) {
    await page.goto(`/${from}`);
    await expect(page, `${from} redirects`).toHaveURL(to);
    await expect(h1(page)).toBeVisible();
  }
});

test('Sessions in the project, one session, and back', async ({ page, request }) => {
  const project = await demoApi(request);
  await page.goto(`/#/p/${project.id}/sessions`);
  await expect(h1(page)).toContainText('Sessions');
  const res = await request.get(`/api/projects/${project.id}/sessions`);
  expect(res.ok()).toBe(true);
  const listed = (await res.json()) as { items?: { id: string }[] } | { id: string }[];
  const items = Array.isArray(listed) ? listed : (listed.items ?? []);
  expect(items.length).toBeGreaterThan(0);
  await shoot(page, 'sessions');
  // The page is scoped to this project: its filter starts on it, and the API's sessions are the
  // ones listed.
  await expect(page.getByRole('main').getByRole('combobox', { name: 'Project' })).toHaveValue(
    project.id,
  );
  for (const s of items.slice(0, 3)) {
    await expect(page.getByRole('main')).toContainText(s.id.slice(0, 8));
  }

  const first = items[0]?.id ?? '';
  await page.goto(`/#/sessions/${encodeURIComponent(first)}`);
  await expect(h1(page)).toBeVisible();
  await expect(page.getByText(/estimated/i).first()).toBeVisible();
  await shoot(page, 'session');
});

test('Data health and its Connection tab', async ({ page }) => {
  await page.goto('/#/health');
  await expect(h1(page)).toContainText('Data health');
  await shoot(page, 'health');
  await page.goto('/#/health/connection');
  await expect(h1(page)).toContainText('Connection');
  await shoot(page, 'health-connection');
});

test('an unknown address says so, with a way back', async ({ page }) => {
  await page.goto('/#/no/such/page');
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /All projects/ }).first()).toBeVisible();
  await shoot(page, 'not-found', false);
});
