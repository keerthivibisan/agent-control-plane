import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PROJECT_ID, TICKET_ID, fixtureProject, workingScenario } from './ticket-fixtures.js';

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
  // The page is scoped to this project: no Project filter (R-R visual), its copy says so, and
  // the API's sessions are the ones listed.
  await expect(page.getByRole('main').getByRole('combobox', { name: 'Project' })).toHaveCount(0);
  await expect(page.getByRole('main')).toContainText('Every Claude Code session in this project');
  await expect(page.getByRole('main')).not.toContainText('in your projects');
  for (const s of items.slice(0, 3)) {
    await expect(page.getByRole('main')).toContainText(s.id.slice(0, 8));
  }

  const first = items[0]?.id ?? '';
  await page.goto(`/#/sessions/${encodeURIComponent(first)}`);
  await expect(h1(page)).toBeVisible();
  await expect(page.getByText(/estimated/i).first()).toBeVisible();
  await shoot(page, 'session');
});

test('Data health and its Connection tab', async ({ page, request }) => {
  // A project used before: the global page keeps it in the switcher and the sidebar.
  const project = await demoApi(request);
  await page.goto(`/#/p/${project.id}/board`);
  await expect(h1(page)).toContainText('demo-api');
  await page.goto('/#/health');
  await expect(h1(page)).toContainText('Data health');
  await expect(
    page.getByRole('button', { name: 'Project: demo-api. Switch project' }),
  ).toBeVisible();
  // R-R visual: the section tabs sit under the page title, as on every other page.
  const tabs = page.getByRole('navigation', { name: 'Data health sections' });
  const titleBox = await h1(page).boundingBox();
  const tabsBox = await tabs.boundingBox();
  expect(titleBox && tabsBox && tabsBox.y > titleBox.y).toBe(true);
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

// --- U-V (UI refresh verification), add-only: every page at a phone width, and reduced motion.

/** The routes the ticket page reads, answered from the synthetic fixtures (as shell.spec does). */
async function withTicketFixtures(page: Page): Promise<void> {
  const sc = workingScenario();
  await page.route(/\/api\/projects$/, async (route) => {
    const real = (await (await route.fetch()).json()) as unknown[];
    await route.fulfill({ json: [...real, fixtureProject()] });
  });
  await page.route(/\/api\/(tickets|runs|control)\//, async (route) => {
    const body = sc.routes[new URL(route.request().url()).pathname];
    await (body === undefined
      ? route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', message: 'no fixture', requestId: 'e2e' } },
        })
      : route.fulfill({ status: 200, json: body }));
  });
}

test.describe('U-V', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('every page fits a 390px phone: no sideways scroll, titles wrap by words, actions below', async ({
    page,
    request,
  }) => {
    const project = await demoApi(request);
    const res = await request.get(`/api/projects/${project.id}/sessions`);
    const listed = (await res.json()) as { items?: { id: string }[] } | { id: string }[];
    const session = (Array.isArray(listed) ? listed : (listed.items ?? []))[0]?.id ?? '';
    await withTicketFixtures(page);
    const pages: [string, string][] = [
      ['all-projects', '#/projects'],
      ['board', `#/p/${project.id}/board`],
      ['workflow', `#/p/${project.id}/workflow`],
      ['skills', `#/p/${project.id}/skills`],
      ['harness', `#/p/${project.id}/harness`],
      ['tokens', `#/p/${project.id}/tokens`],
      ['sessions', `#/p/${project.id}/sessions`],
      ['session', `#/sessions/${encodeURIComponent(session)}`],
      ['settings', `#/p/${project.id}/settings`],
      ['ticket', `#/p/${PROJECT_ID}/tickets/${TICKET_ID}`],
      ['new-project', '#/projects/new'],
      ['health', '#/health'],
      ['health-connection', '#/health/connection'],
    ];
    // Every page is checked, so one run lists every page that doesn't fit.
    const soft = expect.configure({ soft: true });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [name, to] of pages) {
      await page.goto(`/${to}`);
      const title = h1(page);
      await expect(title, name).toBeVisible();
      // Let the page's cards load (their content is what grows), then measure.
      await page.waitForTimeout(800);
      // The page never scrolls sideways (wide content scrolls inside its own frame).
      soft(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        `${name} scrolls sideways`,
      ).toBeLessThanOrEqual(0);
      // The title keeps its width: words wrap, letters don't (the owner saw one letter per line).
      soft((await title.boundingBox())?.width ?? 0, name).toBeGreaterThan(200);
      // The header's actions, if any, sit under the title.
      const actions = page.locator('main header').first().locator(':scope > div').nth(1);
      if ((await actions.count()) > 0 && (await actions.isVisible())) {
        const t = await title.boundingBox();
        const a = await actions.boundingBox();
        soft(t !== null && a !== null && a.y >= t.y + t.height - 1, name).toBe(true);
      }
      if (SHOTS !== undefined) {
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme });
          await page.waitForTimeout(400);
          await page.screenshot({
            path: `${SHOTS}/narrow-${name}-390-${scheme}.png`,
            fullPage: true,
          });
        }
        await page.emulateMedia({ colorScheme: 'light' });
      }
    }
  });

  test('with reduced motion nothing moves: pages, the side panel, menus and dialogs', async ({
    page,
    request,
  }) => {
    const project = await demoApi(request);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await withTicketFixtures(page);
    await page.goto(`/#/p/${project.id}/board`);
    await expect(h1(page)).toContainText('demo-api');

    // An element's transform and opacity on every frame for 400ms.
    const watch = (selector: string) =>
      page.evaluate(async (sel) => {
        const seen = new Set<string>();
        const start = performance.now();
        await new Promise<void>((done) => {
          const tick = () => {
            const el = document.querySelector(sel);
            if (el !== null) {
              const s = getComputedStyle(el);
              seen.add(`${s.transform}|${s.opacity}`);
            }
            if (performance.now() - start < 400) requestAnimationFrame(tick);
            else done();
          };
          tick();
        });
        return [...seen];
      }, selector);

    // A page change: the page wrapper never fades or rises.
    const moving = watch('main > div');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Tokens' })
      .click();
    expect(await moving).toEqual(['none|1']);
    await expect(h1(page)).toContainText('Tokens');

    // The ticket page's side panel doesn't slide in.
    await page.goto(`/#/p/${PROJECT_ID}/tickets/${TICKET_ID}`);
    const slide = watch('[data-testid="side-panel"]');
    await expect(page.getByTestId('side-panel')).toBeVisible();
    expect((await slide).every((v) => v.startsWith('none|'))).toBe(true);

    // CSS animations (dialogs, menus, popovers) are cut to nothing.
    await page.goto(`/#/p/${project.id}/board`);
    await page.getByRole('button', { name: 'New ticket' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New ticket' });
    await expect(dialog).toBeVisible();
    const durations = await dialog.evaluate((el) =>
      [el, el.parentElement].map((e) => (e ? getComputedStyle(e).animationDuration : '0s')),
    );
    for (const d of durations) expect(parseFloat(d)).toBeLessThan(0.001);
  });
});
// --- end U-V
