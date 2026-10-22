import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/*
 * R-V (P4-H's deferred browser e2e): the owner's whole flow in the new UI against the REAL server
 * routes — a live-mode server over an empty temp Claude dir, with the scripted fake managed
 * adapter (packages/server/tests/verification/redesign/e2e-server.ts), so neither the Agent SDK
 * nor `claude` ever runs. Agents are driven through the test-only driver; everything the owner
 * does goes through the page.
 *
 * Flow: New project (a new repository in a temp folder) → Skills & Agents (a skill and an agent
 * file, saved and committed) → Workflow (final code review on, with the agent file) → New ticket
 * → Start → plan review → Approve → a helper works → review & merge → the reviewer's findings →
 * Done → a follow-up question to the ended lead, answered with no reload.
 *
 * With ACP_SCREENSHOT_DIR set, it saves light and dark screenshots at 1440 and 1024 pixels wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;
const DRIVER = process.env.ACP_E2E_WORKSPACE_DRIVER_URL ?? 'http://127.0.0.1:7872';

interface DriverAgent {
  id: string;
  kind: string;
  followUp: boolean;
  resumeSessionId: string | null;
  profile: string | null;
  skills: string[];
  model: string | null;
  prompt: string;
  sent: string[];
  ended: boolean;
}

async function agents(request: APIRequestContext): Promise<DriverAgent[]> {
  return (await (await request.get(`${DRIVER}/agents`)).json()) as DriverAgent[];
}

async function agentOf(
  request: APIRequestContext,
  match: (a: DriverAgent) => boolean,
): Promise<DriverAgent> {
  let found: DriverAgent | undefined;
  await expect
    .poll(async () => {
      found = (await agents(request)).find(match);
      return found !== undefined;
    })
    .toBe(true);
  if (found === undefined) throw new Error('no agent');
  return found;
}

async function act(
  request: APIRequestContext,
  id: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await request.post(`${DRIVER}/agents/${id}/${action}`, { data: body });
  expect(res.ok(), await res.text()).toBe(true);
  const out = (await res.json()) as { ok?: boolean; error?: string };
  if (out.ok === false) throw new Error(`call-lead failed: ${out.error ?? ''}`);
  return out;
}

/** One of the ticket page's tabs (v0.3.0 D-B), not the side panel's. */
function ticketTab(page: Page, name: RegExp) {
  return page.getByRole('tablist', { name: 'Ticket sections' }).getByRole('tab', { name });
}

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${SHOTS}/workspace-${name}-${width}-${scheme}.png`,
        fullPage,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

test.describe.configure({ mode: 'serial' });

test('the owner flow: new project → skills & agents → workflow → ticket → plan → work → merge → review → follow-up', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { parentDir } = (await (await request.get(`${DRIVER}/parent`)).json()) as {
    parentDir: string;
  };

  // ---- New project: a new repository, then the setup steps, then the board.
  await page.goto('/#/projects/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New project' })).toBeVisible();
  await page.getByText('Create a new repository').click();
  await page.getByLabel('Create it inside').fill(parentDir);
  await page.getByLabel('Repository name').fill('shop');
  await shoot(page, 'new-project');
  await page.getByRole('button', { name: 'Create repository' }).click();
  const wizard = page.getByRole('form', { name: 'New project' });
  await expect(wizard.getByRole('heading', { level: 2, name: 'How agents work' })).toBeVisible();
  await expect(wizard.getByRole('textbox', { name: 'Ticket prefix' })).toHaveValue('SHOP');
  await wizard.getByRole('radio', { name: '2 helpers' }).check({ force: true });
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 3 of 5');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 4 of 5');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 5 of 5');
  await shoot(page, 'new-project-harness');
  await wizard.getByRole('button', { name: 'Finish and open the board' }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/board$/);
  const projectId = /#\/p\/([^/]+)\/board$/.exec(page.url())?.[1] ?? '';
  await expect(page.getByRole('heading', { level: 1, name: 'shop' })).toBeVisible();
  // R-R visual: an empty board is the empty state alone, without nine empty columns.
  await expect(page.getByTestId('board-empty')).toBeVisible();
  await expect(page.getByTestId('board-columns')).toHaveCount(0);
  await shoot(page, 'board-empty');
  const nav = page.getByRole('navigation', { name: 'Main' });

  // ---- Skills & Agents: a skill and an agent file, saved and committed into the new repo.
  await nav.getByRole('link', { name: 'Skills & Agents' }).click();
  await expect(page).toHaveURL(new RegExp(`#/p/${projectId}/skills`));
  await expect(page.getByTestId('skills-empty')).toBeVisible();
  await page.getByTestId('skills-empty').getByRole('button', { name: 'Code review' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('code-review');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByTestId('skill-commit').getByRole('button', { name: 'Commit' }).click();
  await expect(page.getByTestId('skill-commit')).toContainText(/Committed [0-9a-f]{7} on main\./);
  await page.getByRole('tab', { name: 'Agents' }).click();
  // No agent files yet: the empty state offers the templates.
  await page
    .getByRole('tabpanel', { name: 'Agents' })
    .getByRole('button', { name: 'Code reviewer' })
    .click();
  await expect(page.getByLabel('Name')).toHaveValue('reviewer');
  // The template only reads, like the Final code review stage (ADR-0019 §7): no Bash.
  await expect(page.getByRole('button', { name: 'Remove Read' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Bash' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByTestId('skill-commit').getByRole('button', { name: 'Commit' }).click();
  await expect(page.getByTestId('skill-commit')).toContainText(/Committed [0-9a-f]{7} on main\./);
  await shoot(page, 'agent-committed');

  // ---- Workflow (WG-D's graph editor): a planner, and a final reviewer with the skill and the file.
  await nav.getByRole('link', { name: 'Workflow' }).click();
  await expect(page.getByTestId('graph-editor')).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'Block settings' });
  await page.getByRole('button', { name: 'Add Planner' }).click();
  await expect(page.getByTestId('block-plan')).toHaveAttribute('data-kind', 'planner');
  await page.getByRole('button', { name: 'Add Final reviewer' }).click();
  await expect(panel.getByTestId('node-panel')).toHaveAttribute('data-node', 'code-review');
  await panel.getByTestId('skills-field').getByLabel('code-review').check();
  await panel.getByRole('combobox', { name: 'Agent file' }).selectOption('reviewer');
  await expect(page.getByTestId('issues').getByTestId('issues-none')).toBeVisible();
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('saved')).toHaveText('Saved');
  await expect(page.getByTestId('block-code-review').getByTestId('block-agent')).toHaveText(
    'reviewer',
  );
  // The server now stores the graph (version 2).
  const stored = (await (
    await request.get(`/api/projects/${projectId}/workflow-graph`)
  ).json()) as { stored: string };
  expect(stored.stored).toBe('v2');
  // R-R visual: at 1440 × 900 the whole flow, Done included, is on screen, and the zoom controls
  // stay clear of the Done block; Save stays on screen.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByTestId('block-done')).toBeInViewport({ ratio: 1 });
  const doneBox = await page.getByTestId('block-done').boundingBox();
  const controlsBox = await page.locator('.react-flow__controls').boundingBox();
  if (doneBox === null || controlsBox === null) throw new Error('no Done block or controls');
  const apart =
    controlsBox.x + controlsBox.width <= doneBox.x ||
    doneBox.x + doneBox.width <= controlsBox.x ||
    controlsBox.y + controlsBox.height <= doneBox.y ||
    doneBox.y + doneBox.height <= controlsBox.y;
  expect(apart).toBe(true);
  await expect(page.getByTestId('save-workflow')).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 720 });
  await shoot(page, 'workflow-saved', false);
  // The agent file now says which block uses it.
  await nav.getByRole('link', { name: 'Skills & Agents' }).click();
  await page.getByRole('tab', { name: 'Agents' }).click();
  await expect(
    page.getByTestId('agent-card-reviewer').getByTestId('agent-used-by').getByRole('link'),
  ).toHaveText(['Code reviewer']);

  // ---- Board: a new ticket, moved to Ready and started.
  await nav.getByRole('link', { name: 'Board' }).click();
  // The header's button (the empty board offers a second one).
  await page.getByRole('button', { name: 'New ticket' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Title').fill('Add a discount code field');
  await dialog.getByLabel('Description').fill('Synthetic R-V ticket: a field at checkout.');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Created SHOP-1 in Backlog.' }),
  ).toBeVisible();
  const move = async (item: string) => {
    await page.getByRole('button', { name: 'Move SHOP-1' }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  await move('Move to Ready');
  await expect(
    page.getByRole('status').filter({ hasText: 'Moved SHOP-1 to Ready.' }),
  ).toBeVisible();
  await move('Start (the lead agent plans it)');
  await expect(
    page.getByRole('status').filter({ hasText: 'Started SHOP-1. The lead agent is planning it.' }),
  ).toBeVisible();
  await shoot(page, 'board-started');
  await page.getByRole('link', { name: /Add a discount code field/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Add a discount code field');
  const ticketUrl = page.url();

  // ---- Plan: the separate planner submits a plan; the page shows it without a reload.
  const planner = await agentOf(request, (a) => a.kind === 'planner');
  expect(planner.skills).toEqual([]);
  await act(request, planner.id, 'started');
  await act(request, planner.id, 'call-lead', {
    name: 'submit_plan',
    input: {
      summary: 'Add the field and check the code at checkout',
      steps: [{ title: 'Build the field', role: 'Builder', detail: 'One helper' }],
    },
  });
  const card = page.getByTestId('plan-card');
  await expect(card).toContainText('Add the field and check the code at checkout');
  // v0.3.0 D-B: the plan is on Conversation, the graph and the chat on Agents.
  await ticketTab(page, /Agents/).click();
  await expect(page.getByTestId('live-block-plan-approval')).toHaveAttribute(
    'data-state',
    'needs-you',
  );
  // R-R visual: the planner holds the chat, and the side panel says so.
  const planPanel = page.getByTestId('side-panel');
  await expect(
    planPanel.getByRole('heading', { name: 'Chat with the planner agent' }),
  ).toBeVisible();
  await expect(
    planPanel.getByRole('textbox', { name: 'Message to the planner agent' }),
  ).toBeVisible();
  await expect(planPanel).not.toContainText('lead agent');
  await shoot(page, 'plan-review');
  await ticketTab(page, /Conversation/).click();
  // Request changes: the comment reaches the planner, which writes version 2.
  const change = 'Also limit the code to 20 characters.';
  await card.getByLabel('What should change?').fill(change);
  await card.getByRole('button', { name: 'Request changes' }).click();
  await expect
    .poll(async () => (await agentOf(request, (a) => a.id === planner.id)).sent.join('\n'))
    .toContain(change);
  await act(request, planner.id, 'call-lead', {
    name: 'submit_plan',
    input: {
      summary: 'Add the field, limit the code and check it at checkout',
      steps: [{ title: 'Build the field', role: 'Builder', detail: 'One helper' }],
    },
  });
  await expect(card).toContainText('Version 2');
  await card.getByRole('button', { name: 'Approve plan' }).click();

  // ---- Work: the lead starts one helper, which writes a file and finishes.
  const lead = await agentOf(request, (a) => a.kind === 'lead');
  expect(lead.prompt).toContain('Add the field, limit the code and check it at checkout');
  await act(request, lead.id, 'started', { sessionId: 'sess-rv-lead' });
  await act(request, lead.id, 'call-lead', {
    name: 'start_agent',
    input: { role: 'Builder', task: 'Build the discount field' },
  });
  const helper = await agentOf(request, (a) => a.kind === 'worker');
  await act(request, helper.id, 'started');
  await ticketTab(page, /Agents/).click();
  await expect(page.getByRole('article', { name: 'Builder' })).toBeVisible();
  await expect(page.getByTestId('live-block-helpers')).toHaveAttribute('data-state', 'active');
  await shoot(page, 'working');
  await act(request, helper.id, 'write', {
    path: 'discount.ts',
    content: 'export const discount = 1;\n',
  });
  await act(request, helper.id, 'finish');
  await act(request, lead.id, 'call-lead', { name: 'request_review', input: {} });

  // ---- Review & merge: the owner merges the helper's change.
  await ticketTab(page, /Conversation/).click();
  const reviewItem = page
    .getByTestId('review-list')
    .getByRole('listitem')
    .filter({ hasText: 'Builder' });
  await reviewItem.getByRole('button', { name: 'Review' }).click();
  const side = page.getByTestId('side-panel');
  await shoot(page, 'review');
  await side.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(side).toContainText("Merge the Builder's changes into main?");
  await side.getByRole('button', { name: 'Merge changes' }).click();

  const repo = `${parentDir}/shop`;
  const onMain = async (path: string) =>
    (
      (await (
        await request.get(`${DRIVER}/repo/show`, { params: { root: repo, ref: 'main', path } })
      ).json()) as { content: string | null }
    ).content;
  await expect.poll(() => onMain('discount.ts')).toBe('export const discount = 1;\n');
  // The owner's skill and agent file were committed on main through the page.
  expect(await onMain('.claude/skills/code-review/SKILL.md')).toContain('name: code-review');
  expect(await onMain('.claude/agents/reviewer.md')).toContain('name: reviewer');

  // ---- Final code review: the reviewer (read-only, its file applied) posts its findings.
  const reviewer = await agentOf(request, (a) => a.kind === 'reviewer');
  expect(reviewer.profile).toBe('reviewer');
  expect(reviewer.skills).toEqual(['acp-skills:code-review']);
  await act(request, reviewer.id, 'started');
  await expect(page.getByTestId('live-block-code-review')).toHaveAttribute('data-state', 'active');
  await act(request, reviewer.id, 'call-lead', {
    name: 'post_review',
    input: { text: 'The discount field has no limit on its length.' },
  });
  await ticketTab(page, /Conversation/).click();
  const comment = page.getByTestId('comments').locator('[data-author="reviewer"]');
  await expect(comment).toContainText('The discount field has no limit on its length.');
  await expect(comment.getByTestId('comment-author')).toHaveText('Reviewer');
  await act(request, reviewer.id, 'finish');
  await ticketTab(page, /Agents/).click();
  await expect(page.getByTestId('live-block-code-review')).toHaveAttribute('data-state', 'done');
  await expect(page.getByRole('button', { name: 'About status Done' })).toBeVisible();
  // R-R visual: the run completed, so the Done node is lit, and the lead the engine closed when
  // the review started reads "Finished" (its status stays CANCELLED).
  await expect(page.getByTestId('live-block-done')).toHaveAttribute('data-state', 'done');
  const leadCard = page.getByRole('article', { name: 'Lead' });
  await expect(leadCard.locator('[data-status="CANCELLED"]')).toHaveText('Finished');
  // The helper's branch is the engine's UUID branch, shown short with the full one as its title.
  const branch = page.getByRole('article', { name: 'Builder' }).getByTestId('agent-branch');
  await expect(branch).toHaveText(/^…\/[0-9a-f]{8}$/);
  await expect(branch.locator('[title^="acp/"]')).toHaveCount(1);
  await shoot(page, 'done');

  // ---- Follow-up: the ended lead answers a question; the page updates with no reload.
  expect(page.url().split('?')[0]).toBe(ticketUrl);
  // The agent tree's card; the live graph has a button with the same name on the block.
  await page
    .getByRole('button', { name: 'Show the Lead in the side panel' })
    .and(page.locator(':not([data-testid="live-agent"])'))
    .click();
  await side.getByRole('tab', { name: 'Chat' }).click();
  const box = side.getByRole('textbox', { name: 'Message to the lead agent' });
  await expect(side.getByTestId('chat-notice')).toContainText('The lead has finished.');
  await box.fill('Where is the discount applied?');
  await box.press('Enter');
  await expect(side.getByRole('status')).toHaveText('The lead is answering…');
  await expect(box).toBeDisabled();
  const turn = await agentOf(request, (a) => a.followUp);
  expect(turn).toMatchObject({ id: lead.id, kind: 'lead', resumeSessionId: 'sess-rv-lead' });
  await act(request, turn.id, 'started', { sessionId: 'sess-rv-lead' });
  await act(request, turn.id, 'lead-text', { text: 'In discount.ts, at checkout.' });
  await expect(side.getByText('In discount.ts, at checkout.')).toBeVisible();
  await shoot(page, 'follow-up-answered');
  await act(request, turn.id, 'finish');
  // No reload: the run stream's notice brings the box back.
  await expect(box).toBeEnabled();
  await expect(side.getByRole('status')).toHaveCount(0);
  expect(page.url().split('?')[0]).toBe(ticketUrl);

  // The board shows the ticket in Done.
  await nav.getByRole('link', { name: 'Board' }).click();
  await expect(page.getByRole('region', { name: 'Done' })).toContainText('SHOP-1');
  // R-R visual: the empty columns fold, so the Done ticket is on screen.
  await expect(page.getByRole('region', { name: 'Done' }).getByText('SHOP-1')).toBeInViewport();
  await shoot(page, 'board-done');

  // The other project pages on a real, new project.
  await nav.getByRole('link', { name: 'Harness' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Harness');
  await shoot(page, 'harness');
  await nav.getByRole('link', { name: 'Tokens' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tokens');
  // R-R visual: a run but no observed session: the counts stay, with why there is no usage.
  await expect(page.getByText('No token usage yet')).toBeVisible();
  await expect(page.getByTestId('tile-runs')).toContainText('for 1 ticket');
  await expect(page.getByText(/once the app observes these Claude Code sessions/)).toBeVisible();
  await expect(page.getByTestId('tile-new-work')).toHaveCount(0);
  await shoot(page, 'tokens');
  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-project').getByLabel('Board key')).toHaveValue('SHOP');

  // Chat text never reaches the server's log.
  const { text: logs } = (await (await request.get(`${DRIVER}/logs`)).json()) as { text: string };
  expect(logs).not.toContain('Where is the discount applied?');
  expect(logs).not.toContain('In discount.ts, at checkout.');
});
