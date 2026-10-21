import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/*
 * WG-D: the Workflow page's graph editor against the REAL routes (WG-C), on the workspace e2e
 * server (packages/server/tests/verification/redesign/e2e-server.ts: live mode over an empty temp
 * Claude dir, scripted fake agents, repositories only in its temp parent folder). Nothing here is
 * mocked except one request body in the 422 test, which is altered on its way to the real server
 * so the server refuses it with its own issues.
 *
 * Covered: a default project, a version 1 project and a version 2 project load; a graph saves and
 * is stored as version 2 (the version 1 route then answers 409); a 422 lists the server's issues;
 * the new-project wizard's template choice is saved; WG-F: the run options read a saved graph's
 * defaults. With ACP_SCREENSHOT_DIR set, it saves light and dark screenshots at 1440 and 1024
 * pixels wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;
const DRIVER = process.env.ACP_E2E_WORKSPACE_DRIVER_URL ?? 'http://127.0.0.1:7872';

type Json = Record<string, unknown>;
interface GraphDto {
  stored: string;
  graph: {
    template: string;
    nodes: { id: string; type: string; label: string }[];
    edges: { id: string; type: string; from: string; to: string }[];
    legacyV1?: unknown;
  };
}

test.describe.configure({ mode: 'serial' });

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/control/token');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { token: string }).token;
}

/** A new repository registered as a project, through the real route (like the wizard). */
async function newProject(request: APIRequestContext, name: string): Promise<string> {
  const { parentDir } = (await (await request.get(`${DRIVER}/parent`)).json()) as {
    parentDir: string;
  };
  const res = await request.post('/api/projects/new', {
    data: { parentDir, name },
    headers: { 'X-ACP-CSRF': await token(request) },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

async function graphOf(request: APIRequestContext, projectId: string): Promise<GraphDto> {
  const res = await request.get(`/api/projects/${projectId}/workflow-graph`);
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as GraphDto;
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 1240 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/workflow-live-${name}-${width}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1240 });
  await page.emulateMedia({ colorScheme: 'light' });
}

const block = (page: Page, id: string) => page.getByTestId(`block-${id}`);
const panel = (page: Page) => page.getByRole('complementary', { name: 'Block settings' });

async function openWorkflow(page: Page, projectId: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1240 });
  await page.goto(`/#/p/${projectId}/workflow`);
  await expect(page.getByTestId('graph-editor')).toBeVisible();
}

/** Adds a link from the selected block with the block panel's form (the keyboard way). */
async function addLink(page: Page, to: string, kind: string): Promise<void> {
  const form = panel(page).getByTestId('add-link');
  await form.getByRole('combobox', { name: 'To' }).selectOption(to);
  await form.getByRole('combobox', { name: 'Kind of link' }).selectOption(kind);
  await form.getByRole('button', { name: 'Add link' }).click();
}

test('a default project: the migrated workflow loads; a saved graph is stored as version 2', async ({
  page,
  request,
}) => {
  const projectId = await newProject(request, 'alpha');
  const before = await graphOf(request, projectId);
  expect(before.stored).toBe('default');
  await openWorkflow(page, projectId);
  for (const id of ['ticket', 'orchestrate', 'helpers', 'review', 'checks', 'owner-merge']) {
    await expect(block(page, id)).toBeVisible();
  }
  await expect(page.getByTestId('issues-none')).toBeVisible();
  await expect(page.getByTestId('save-workflow')).toBeDisabled();
  await shoot(page, 'default');

  // A named helper, linked from the lead and reviewed by the change reviewer.
  await page.getByRole('button', { name: 'Add Named helper' }).click();
  await panel(page).getByRole('textbox', { name: 'Name' }).fill('Frontend helper');
  await addLink(page, 'review', 'review');
  await block(page, 'orchestrate').click();
  await addLink(page, 'helper-1', 'assigns');
  await expect(page.getByTestId('issues-none')).toBeVisible();
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('saved')).toHaveText('Saved');

  const after = await graphOf(request, projectId);
  expect(after.stored).toBe('v2');
  expect(after.graph.nodes.find((n) => n.id === 'helper-1')).toMatchObject({
    type: 'helper',
    label: 'Frontend helper',
  });
  expect(after.graph.legacyV1).toBeDefined();
  // The version 1 route can no longer overwrite it.
  const v1 = await request.get(`/api/projects/${projectId}/workflow`);
  expect(v1.status()).toBe(409);
  expect(((await v1.json()) as { error: { code: string } }).error.code).toBe('workflow_is_graph');

  // A reload reads the stored graph back: nothing unsaved.
  await page.reload();
  await expect(block(page, 'helper-1')).toBeVisible();
  await expect(block(page, 'helper-1').getByTestId('block-label')).toHaveText('Frontend helper');
  await expect(page.getByTestId('unsaved')).toHaveCount(0);
  await expect(page.getByTestId('save-workflow')).toBeDisabled();
  await block(page, 'helper-1').click();
  await shoot(page, 'saved-v2');
});

test('a version 1 project: its stages load as blocks; a template, then the earlier setup', async ({
  page,
  request,
}) => {
  const projectId = await newProject(request, 'bravo');
  // Store a version 1 workflow with the version 1 route: a separate planner and the final review.
  const v1 = (await (await request.get(`/api/projects/${projectId}/workflow`)).json()) as {
    workflow: { stages: Record<string, Json> };
  };
  const stages = v1.workflow.stages;
  const put = await request.put(`/api/projects/${projectId}/workflow`, {
    data: {
      plannerMode: 'separate',
      stages: { ...stages, 'code-review': { ...stages['code-review'], enabled: true } },
    },
    headers: { 'X-ACP-CSRF': await token(request) },
  });
  expect(put.ok(), await put.text()).toBe(true);
  expect((await graphOf(request, projectId)).stored).toBe('v1');

  await openWorkflow(page, projectId);
  await expect(block(page, 'plan')).toHaveAttribute('data-kind', 'planner');
  await expect(block(page, 'code-review')).toBeVisible();
  await expect(page.getByTestId('issues-none')).toBeVisible();
  await shoot(page, 'v1');

  const picker = page.getByRole('dialog', { name: 'Start from a template' });
  await page.getByTestId('open-templates').click();
  await picker.getByLabel(/^Lead only/).check();
  await picker.getByRole('button', { name: 'Use this template' }).click();
  await expect(picker).toHaveCount(0);
  await expect(block(page, 'review')).toHaveCount(0);
  await expect(block(page, 'code-review')).toHaveCount(0);
  await page.getByTestId('open-templates').click();
  await picker.getByRole('button', { name: 'Restore my earlier setup' }).click();
  await picker.getByRole('button', { name: 'Replace' }).click();
  await expect(picker).toHaveCount(0);
  await expect(block(page, 'plan')).toBeVisible();
  await expect(block(page, 'code-review')).toBeVisible();
  await expect(page.getByTestId('unsaved')).toHaveCount(0);
});

test('a refused save (422) lists the server’s own issues and stores nothing', async ({
  page,
  request,
}) => {
  const projectId = await newProject(request, 'charlie');
  // The editor never sends a graph with an error; to see the server refuse one, the request body
  // loses the helpers' review link on its way to the real PUT and validate routes.
  const drop = (body: string): string => {
    const parsed = JSON.parse(body) as { graph: GraphDto['graph'] };
    parsed.graph.edges = parsed.graph.edges.filter(
      (e) => !(e.type === 'review' && e.from === 'helpers'),
    );
    return JSON.stringify(parsed);
  };
  for (const path of ['workflow-graph', 'workflow-graph/validate']) {
    await page.route(`**/api/projects/${projectId}/${path}`, async (route) => {
      const req = route.request();
      if (req.method() === 'GET') return route.continue();
      await route.continue({ postData: drop(req.postData() ?? '{}') });
    });
  }
  await openWorkflow(page, projectId);
  await block(page, 'helpers').click();
  await panel(page).getByRole('textbox', { name: 'Name' }).fill('Workers');
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('server-issues')).toContainText('"Workers" has no review link');
  await expect(page.getByTestId('save-refusal')).toContainText('The workflow wasn’t saved.');
  expect((await graphOf(request, projectId)).stored).toBe('default');
  await shoot(page, 'refused');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('the new-project wizard saves the chosen template as the project’s graph', async ({
  page,
  request,
}) => {
  const { parentDir } = (await (await request.get(`${DRIVER}/parent`)).json()) as {
    parentDir: string;
  };
  await page.setViewportSize({ width: 1440, height: 1240 });
  await page.goto('/#/projects/new');
  await page.getByText('Create a new repository').click();
  await page.getByLabel('Create it inside').fill(parentDir);
  await page.getByLabel('Repository name').fill('delta');
  await page.getByRole('button', { name: 'Create repository' }).click();
  const wizard = page.getByRole('form', { name: 'New project' });
  const choice = wizard.getByTestId('wizard-workflow');
  await expect(choice).toBeVisible();
  await choice.getByLabel(/^Reviewer ↔ helper loop/).check();
  await choice.getByRole('checkbox', { name: 'Add a planner' }).check();
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 3 of 5');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 4 of 5');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 5 of 5');
  await wizard.getByRole('button', { name: 'Finish and open the board' }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/board$/);
  const projectId = /#\/p\/([^/]+)\/board$/.exec(page.url())?.[1] ?? '';

  const dto = await graphOf(request, projectId);
  expect(dto.stored).toBe('v2');
  expect(dto.graph.template).toBe('reviewer-helper-loop');
  expect(dto.graph.nodes.some((n) => n.type === 'planner')).toBe(true);
  expect(dto.graph.edges).toContainEqual(
    expect.objectContaining({ type: 'rework', from: 'review', to: 'helpers' }),
  );

  await openWorkflow(page, projectId);
  await expect(block(page, 'plan')).toHaveAttribute('data-kind', 'planner');
  await expect(page.getByTestId('issues-none')).toBeVisible();
  await expect(page.getByText('Rework ×2').first()).toBeVisible();
  await shoot(page, 'wizard-template');
});

/*
 * WG-F: once a project stores a graph, the version 1 `GET /workflow` answers 409; the run options
 * read the project's defaults from the graph instead. The owner saves "Lead only" with 4 rework
 * rounds in the editor; the New ticket dialog, the ticket's Run options and "Start with options…"
 * show the lead and 4 rounds as the project's settings, and nothing asks the version 1 route.
 * Start is never clicked (Cancel only), so no agent runs.
 */
test('run options read the defaults of a graph saved in the editor', async ({ page, request }) => {
  const projectId = await newProject(request, 'echo');
  const v1Requests: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === `/api/projects/${projectId}/workflow`) {
      v1Requests.push(req.url());
    }
  });

  // ---- The editor: "Lead only", its lead → helpers rework link set to 4 rounds, saved.
  await openWorkflow(page, projectId);
  const picker = page.getByRole('dialog', { name: 'Start from a template' });
  await page.getByTestId('open-templates').click();
  await picker.getByLabel(/^Lead only/).check();
  await picker.getByRole('button', { name: 'Use this template' }).click();
  await expect(picker).toHaveCount(0);
  await block(page, 'orchestrate').click();
  await panel(page)
    .getByRole('button', {
      name: 'Remove link Sends the change back for rework: from Lead to Helpers',
    })
    .click();
  await addLink(page, 'helpers', 'rework');
  await expect(panel(page).getByTestId('edge-panel')).toHaveAttribute('data-type', 'rework');
  await panel(page).getByRole('radio', { name: '4 rework rounds' }).check({ force: true });
  await expect(page.getByTestId('issues-none')).toBeVisible();
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('saved')).toHaveText('Saved');
  const saved = await graphOf(request, projectId);
  expect(saved.stored).toBe('v2');
  expect(saved.graph.nodes.some((n) => n.type === 'reviewer')).toBe(false);
  expect(saved.graph.edges).toContainEqual(
    expect.objectContaining({ type: 'rework', from: 'orchestrate', to: 'helpers', maxRounds: 4 }),
  );
  expect((await request.get(`/api/projects/${projectId}/workflow`)).status()).toBe(409);

  // ---- New ticket: "Project default" names the graph's values.
  await page.goto(`/#/p/${projectId}/board`);
  await page.getByRole('button', { name: 'New ticket' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Title').fill('Tidy the readme');
  await dialog.getByText('More options').click();
  await expect(dialog.getByLabel('Who reviews each change').locator('option').first()).toHaveText(
    'Project default (Lead)',
  );
  await expect(dialog.getByLabel('Rework rounds').locator('option').first()).toHaveText(
    'Project default (4 rework rounds)',
  );
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  const created = page.getByRole('status').filter({ hasText: /^Created [A-Z]+-1 in Backlog\./ });
  await expect(created).toBeVisible();
  const key = /Created ([A-Z]+-1)/.exec((await created.textContent()) ?? '')?.[1] ?? '';
  expect(key).not.toBe('');

  // ---- Start with options…: the project's settings, then Cancel.
  const move = async (item: string) => {
    await page.getByRole('button', { name: `Move ${key}` }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  await move('Move to Ready');
  await expect(
    page.getByRole('status').filter({ hasText: `Moved ${key} to Ready.` }),
  ).toBeVisible();
  await move('Start with options…');
  const start = page.getByTestId('start-dialog');
  await expect(start.getByRole('radio', { name: /^The lead · Project setting/ })).toBeChecked();
  await expect(start.getByRole('radio', { name: /^Review agent/ })).not.toBeChecked();
  await expect(start).toContainText('Project setting: 4.');
  await expect(start.getByRole('radio', { name: '4 rework rounds' })).toBeChecked();
  await expect(start.getByTestId('start-dialog-summary')).toHaveText(
    'Same as the project’s settings.',
  );
  await expect(start.getByText(/settings couldn’t be loaded/)).toHaveCount(0);
  if (SHOTS !== undefined) {
    await start.screenshot({ path: `${SHOTS}/workflow-live-start-defaults.png` });
  }
  await start.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(start).toHaveCount(0);

  // ---- The ticket page's Run options.
  await page.getByRole('link', { name: /Tidy the readme/ }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/tickets\/[^/]+$/);
  const options = page.getByTestId('ticket-run-options');
  await expect(options.getByTestId('run-option-reviewer')).toHaveText('Project default (Lead)');
  await expect(options.getByTestId('run-option-rounds')).toHaveText(
    'Project default (4 rework rounds)',
  );

  // Nothing asked the version 1 route, which answers 409 for this project; nothing started.
  expect(v1Requests).toEqual([]);
  const ticketId = /tickets\/([^/]+)$/.exec(page.url())?.[1] ?? '';
  const detail = (await (await request.get(`/api/tickets/${ticketId}`)).json()) as {
    currentRun: unknown;
  };
  expect(detail.currentRun).toBeNull();
});
