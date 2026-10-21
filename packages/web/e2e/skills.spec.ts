import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';

/*
 * Redesign R-D: the Skills & Agents page in the browser, on the demo server's built UI and its real
 * demo-api project. The demo project's folder does not exist on this machine, so the skills and
 * agents routes are answered from synthetic, stateful fixtures (page.route): a write is what the
 * next read returns, a delete removes it, a commit clears "uncommitted". Nothing reaches a real
 * repository. Every mutation is checked for the CSRF header. With ACP_SCREENSHOT_DIR set, it saves
 * light and dark screenshots at 1440 and 1024 pixels wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;
const CSRF = 'e2e-csrf-0123456789abcdef0123456789abcdef0123456789abcdef';
const T = (min: number) => new Date(Date.UTC(2026, 9, 16, 9, min)).toISOString();

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

type Json = Record<string, unknown>;

function skill(name: string, over: Json = {}): Json {
  return {
    name,
    description: `Use ${name} when the task needs it.`,
    path: `.claude/skills/${name}/SKILL.md`,
    usedBy: [],
    sizeBytes: 900,
    lastCommittedAt: T(5),
    uncommitted: false,
    problems: [],
    instructions: `# ${name}\n\n## Steps\n\n1. Read the **diff**.\n2. Run \`pnpm test\`.\n\n> Report bugs first.\n`,
    ...over,
  };
}

function agent(name: string, over: Json = {}): Json {
  return {
    name,
    description: `Hand work to ${name} when it fits.`,
    path: `.claude/agents/${name}.md`,
    tools: ['Read', 'Grep', 'Glob'],
    model: null,
    sizeBytes: 700,
    lastCommittedAt: T(8),
    uncommitted: false,
    problems: [],
    instructions: `You are ${name}.\n`,
    ...over,
  };
}

const summary = ({ instructions: _i, ...rest }: Json) => rest;

interface Fixture {
  skills: Map<string, Json>;
  agents: Map<string, Json>;
  mutations: { method: string; path: string; csrf: string | null; body: unknown }[];
}

/** Answers `/api/projects/:id/{skills,agents}…` and the CSRF token from in-memory state. */
async function serve(page: Page, projectId: string, skills: Json[], agents: Json[]) {
  const fx: Fixture = {
    skills: new Map(skills.map((s) => [s['name'] as string, s])),
    agents: new Map(agents.map((a) => [a['name'] as string, a])),
    mutations: [],
  };
  await page.route('**/api/control/token', (route) => route.fulfill({ json: { token: CSRF } }));
  const base = `/api/projects/${encodeURIComponent(projectId)}/`;
  await page.route(/\/api\/projects\/[^/]+\/(skills|agents)(\/.*)?$/, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const rest = url.pathname.slice(base.length).split('/');
    const kind = rest[0] === 'agents' ? fx.agents : fx.skills;
    const name = rest[1] === undefined ? undefined : decodeURIComponent(rest[1]);
    const method = req.method();
    const body = req.postData() === null ? undefined : (JSON.parse(req.postData() ?? '') as Json);
    if (method !== 'GET') {
      fx.mutations.push({
        method,
        path: url.pathname,
        csrf: req.headers()['x-acp-csrf'] ?? null,
        body,
      });
    }
    const make = rest[0] === 'agents' ? agent : skill;
    if (name === undefined) {
      if (method === 'GET') return route.fulfill({ json: [...kind.values()].map(summary) });
      const created = make(String(body?.['name']), {
        ...body,
        uncommitted: true,
        lastCommittedAt: null,
      });
      kind.set(String(body?.['name']), created);
      return route.fulfill({ status: 201, json: created });
    }
    const current = kind.get(name);
    if (rest[2] === 'commit') {
      if (current) kind.set(name, { ...current, uncommitted: false, lastCommittedAt: T(30) });
      return route.fulfill({ json: { name, commit: '9f1c2ab7d3e4', branch: 'main' } });
    }
    if (current === undefined) {
      return route.fulfill({
        status: 404,
        json: { error: { code: 'not_found', message: 'No such file', requestId: 'e2e' } },
      });
    }
    if (method === 'GET') return route.fulfill({ json: current });
    if (method === 'PUT') {
      const next = { ...current, ...body, uncommitted: true };
      kind.set(name, next);
      return route.fulfill({ json: next });
    }
    kind.delete(name);
    return route.fulfill({ status: 204, body: '' });
  });
  return fx;
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      // Let the theme's color transitions finish before the picture.
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${SHOTS}/skills-${name}-${width}-${scheme}.png`,
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

const SKILLS = [
  skill('code-review', { usedBy: ['plan', 'code-review'], uncommitted: true }),
  skill('plan', { usedBy: ['orchestrate'] }),
  skill('docs', {
    description: '',
    lastCommittedAt: null,
    problems: [
      'The front matter has no description, so Claude Code cannot tell when to use the skill.',
    ],
  }),
];
const AGENTS = [
  agent('reviewer', {
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    model: 'sonnet',
    uncommitted: true,
  }),
  agent('chores', {
    tools: null,
    problems: ['The front matter has other keys (hooks): kept as is, not used by the app.'],
  }),
];

test('skills: list, a skill with its git state, and the Markdown preview', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  await serve(page, project.id, SKILLS, AGENTS);
  await page.goto(`/#/p/${project.id}/skills`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Skills & Agents');
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Skills & Agents' }),
  ).toHaveAttribute('aria-current', 'page');
  const card = page.getByTestId('skill-card-code-review');
  await expect(card).toContainText('Final code review');
  await expect(card).toContainText('Uncommitted');
  await expect(page.getByTestId('skill-card-docs')).toContainText('no description');
  await shoot(page, 'list');

  await card.getByRole('button', { name: 'Open skill code-review' }).click();
  await expect(page).toHaveURL(new RegExp(`#/p/${project.id}/skills/code-review$`));
  await expect(page.getByTestId('skill-commit')).toContainText("only this skill's folder");
  await expect(
    page.getByTestId('skill-delete').getByRole('button', { name: 'Delete skill' }),
  ).toBeDisabled();
  await shoot(page, 'edit');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(
    page.getByTestId('skill-preview').getByRole('heading', { name: 'Steps' }),
  ).toBeVisible();
  await shoot(page, 'preview');
});

test('skills: create from a template, save, commit, with CSRF on every write', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  const fx = await serve(page, project.id, [], []);
  await page.goto(`/#/p/${project.id}/skills`);
  await expect(page.getByTestId('skills-empty')).toContainText('No skills yet');
  await shoot(page, 'empty');
  await page.getByTestId('skills-empty').getByRole('button', { name: 'Unit tests' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('unit-tests');
  await page.getByRole('button', { name: 'Save' }).click();
  const commit = page.getByTestId('skill-commit').getByRole('button', { name: 'Commit' });
  await expect(commit).toBeEnabled();
  await commit.click();
  await expect(page.getByTestId('skill-commit')).toContainText('Committed 9f1c2ab on main.');
  expect(fx.mutations.map((m) => [m.method, m.path.split('/').slice(4).join('/'), m.csrf])).toEqual(
    [
      ['POST', 'skills', CSRF],
      ['POST', 'skills/unit-tests/commit', CSRF],
    ],
  );
});

test('agents: the tab, the list, an agent with tools, and a new one from a template', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  const fx = await serve(page, project.id, SKILLS, AGENTS);
  await page.goto(`/#/p/${project.id}/skills`);
  await page.getByRole('tab', { name: 'Agents' }).click();
  await expect(page).toHaveURL(/\?tab=agents$/);
  const reviewer = page.getByTestId('agent-card-reviewer');
  await expect(reviewer).toContainText('sonnet');
  await expect(page.getByTestId('agent-card-chores')).toContainText('All tools');
  await shoot(page, 'agents-list');

  await reviewer.getByRole('button', { name: 'Open agent reviewer' }).click();
  await expect(page.getByTestId('agent-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Bash' })).toBeVisible();
  await shoot(page, 'agent-edit');

  await page.getByRole('button', { name: /All agents/ }).click();
  await page.getByRole('button', { name: 'New agent' }).click();
  await page
    .getByRole('group', { name: 'Start from a template' })
    .getByRole('button', { name: 'Planner' })
    .click();
  await expect(page.getByLabel('Name')).toHaveValue('planner');
  await shoot(page, 'agent-new');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('skill-commit')).toContainText('only this agent file');
  const post = fx.mutations.find((m) => m.method === 'POST');
  expect(post?.csrf).toBe(CSRF);
  expect(post?.body).toMatchObject({
    name: 'planner',
    tools: ['Read', 'Grep', 'Glob'],
    model: null,
  });
});

// --- Agent files on stages (redesign R-I, wp/r-i-web) -------------------------------------------

test('agents: "Used by" shows the blocks using each file and links to the Workflow page', async ({
  page,
  request,
}) => {
  const project = await demoApi(request);
  await serve(page, project.id, SKILLS, AGENTS);
  // The demo project's workflow, with `reviewer` on two stages (synthetic).
  await page.route(`**/api/projects/${project.id}/workflow`, async (route) => {
    const real = (await (await route.fetch()).json()) as {
      workflow: { stages: Record<string, Json> };
    };
    const stages = real.workflow.stages;
    stages['code-review'] = { ...stages['code-review'], enabled: true, agent: 'reviewer' };
    stages['plan'] = { ...stages['plan'], agent: 'reviewer' };
    await route.fulfill({ json: real });
  });
  // ADR-0023: with the graph endpoints served, "Used by" names the workflow's blocks.
  await page.route(`**/api/projects/${project.id}/workflow-graph`, async (route) => {
    const real = (await (await route.fetch()).json()) as {
      graph: { nodes: { id: string; agent?: string | null }[] };
    };
    for (const node of real.graph.nodes) {
      if (node.id === 'orchestrate' || node.id === 'review') node.agent = 'reviewer';
    }
    await route.fulfill({ json: real });
  });
  await page.goto(`/#/p/${project.id}/skills?tab=agents`);
  const used = page.getByTestId('agent-card-reviewer').getByTestId('agent-used-by');
  await expect(used.getByRole('link')).toHaveText(['Lead', 'Change reviewer']);
  await expect(page.getByTestId('agent-card-chores').getByTestId('agent-used-by')).toHaveText(
    'Not used by any stage',
  );
  await shoot(page, 'agents-used-by');
  await used.getByRole('link', { name: 'Open Change reviewer on the Workflow page' }).click();
  await expect(page).toHaveURL(new RegExp(`#/p/${project.id}/workflow$`));
  // R-V: let the Workflow page finish loading, and drop the routes, so no handler is still in
  // `route.fetch()` when the test ends ("Response has been disposed", seen once under load).
  await expect(page.getByRole('heading', { level: 1, name: /Workflow/ })).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
