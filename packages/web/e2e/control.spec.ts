import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/*
 * P3-F: the control panel end to end, in the browser, against the real server and the built UI.
 * The managed adapter is the scripted fake (packages/server/tests/verification/control/
 * e2e-server.ts): this spec plays each agent's part through the test-only driver, and plays the
 * owner through the UI only. Neither the Agent SDK nor `claude` runs. The project "e2e-app" is a
 * throwaway git repo; its `main` branch is checked through the driver after merging.
 *
 * The flows reload to observe agent-driven changes (`seen`) so they don't depend on timing. Live
 * updates without a reload are covered by the last test (the SSE bug P3-F found: the server used
 * to send named `event: notice` frames, which `EventSource.onmessage` never receives; fixed by
 * sending unnamed events).
 */

const DRIVER = process.env.ACP_E2E_DRIVER_URL ?? 'http://127.0.0.1:7442';

// --- U-F (UI refresh): with ACP_SCREENSHOT_DIR set, light and dark screenshots of the control
// panel at 1440 and 1024 pixels wide. Nothing is asserted by them.
const SHOTS = process.env.ACP_SCREENSHOT_DIR;

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/control-${name}-${width}-${scheme}.png`, fullPage });
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: 'light' });
}
// --- end U-F

interface FakeView {
  id: string;
  kind: 'lead' | 'worker';
  prompt: string;
  sent: string[];
  ended: boolean;
  aborted: boolean;
  interrupts: number;
  answers: { tool: string; allow: boolean | null }[];
}
interface AgentDto {
  id: string;
  kind: 'lead' | 'worker';
  role: string;
  status: string;
}
interface RunDto {
  id: string;
  status: string;
  agents: AgentDto[];
}

async function fakes(request: APIRequestContext): Promise<FakeView[]> {
  const res = await request.get(`${DRIVER}/agents`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as FakeView[];
}

async function fakeAgent(request: APIRequestContext, id: string): Promise<FakeView> {
  let found: FakeView | undefined;
  await expect(async () => {
    found = (await fakes(request)).find((a) => a.id === id);
    expect(found, `fake agent ${id}`).toBeDefined();
  }).toPass();
  if (found === undefined) throw new Error('unreachable: toPass checked it');
  return found;
}

/** Plays one step of an agent's part. */
async function act(
  request: APIRequestContext,
  id: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await request.post(`${DRIVER}/agents/${id}/${action}`, { data: body });
  expect(res.ok(), `${action} -> ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as Record<string, unknown>;
}

async function run(request: APIRequestContext, runId: string): Promise<RunDto> {
  const res = await request.get(`/api/runs/${runId}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as RunDto;
}

/** The agent with this role, once the server has it (workers appear as the lead starts them). */
async function agentByRole(request: APIRequestContext, runId: string, role: string) {
  let agent: AgentDto | undefined;
  await expect(async () => {
    agent = (await run(request, runId)).agents.find((a) => a.role === role);
    expect(agent, role).toBeDefined();
  }).toPass();
  if (agent === undefined) throw new Error('unreachable: toPass checked it');
  return agent;
}

async function showOnMain(request: APIRequestContext, path: string): Promise<string | null> {
  const res = await request.get(`${DRIVER}/repo/show?ref=main&path=${encodeURIComponent(path)}`);
  return ((await res.json()) as { content: string | null }).content;
}

/**
 * Owner: start a run from #/control/new and return its id. Redesign (R-A): that address redirects
 * to the project's `runs/new`, and a run without a ticket opens at `#/p/:projectId/runs/:runId`.
 */
async function startRun(page: Page, text: string, budget?: string): Promise<string> {
  await page.goto('/#/control/new');
  await expect(page).toHaveURL(/#\/p\/[^/]+\/runs\/new$/);
  const form = page.getByTestId('start-run');
  await form.getByLabel('Project').selectOption({ label: 'e2e-app' });
  await form.getByLabel('What should the agents do?').fill(text);
  if (budget !== undefined) {
    await form.getByText('Budget per agent', { exact: false }).first().click();
    await form.getByLabel('Budget per agent').fill(budget);
  }
  await form.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/runs\/(?!new$)[^/]+$/);
  const runId = /#\/p\/[^/]+\/runs\/([^/]+)$/.exec(page.url())?.[1];
  if (runId === undefined) throw new Error('no run id in the URL');
  return runId;
}

const SHORT = { timeout: 2_000 };

/** Agent-driven changes: reload until the UI shows them (see the SSE note above). */
async function seen(page: Page, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 15_000 });
}

const card = (page: Page, agentId: string): Locator => page.getByTestId(`agent-${agentId}`);
const statusOf = (page: Page, agentId: string): Locator =>
  card(page, agentId).locator('header [data-status]');
const runStatus = (page: Page): Locator =>
  page.getByTestId('run-facts').locator('[data-status]').first();
const helpers = (page: Page): Locator =>
  page
    .getByTestId('agent-tree')
    .getByRole('list', { name: /Started by/ })
    .getByRole('article');

/** Owner: Stop all, confirmed; waits for the server's answer before any reload can cut it off. */
async function stopAll(page: Page, runId: string): Promise<void> {
  await page.getByRole('button', { name: 'Stop all' }).click();
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/api/runs/${runId}/stop`),
  );
  await page.getByRole('button', { name: 'Stop everything' }).click();
  expect((await answered).status()).toBe(200);
}

/** The lead, started and running. */
async function startLead(page: Page, request: APIRequestContext, runId: string) {
  const leadDto = (await run(request, runId)).agents.find((a) => a.kind === 'lead');
  if (leadDto === undefined) throw new Error('no lead');
  const lead = await fakeAgent(request, leadDto.id);
  await act(request, lead.id, 'started');
  await seen(page, () => expect(runStatus(page)).toHaveAttribute('data-status', 'RUNNING', SHORT));
  return lead;
}

async function startWorker(
  page: Page,
  request: APIRequestContext,
  runId: string,
  leadId: string,
  role: string,
  task: string,
): Promise<AgentDto> {
  const reply = await act(request, leadId, 'call-lead', {
    name: 'start_agent',
    input: { role, task },
  });
  expect(reply).toMatchObject({ ok: true });
  const worker = await agentByRole(request, runId, role);
  await fakeAgent(request, worker.id);
  await act(request, worker.id, 'started');
  await seen(page, async () => {
    await expect(statusOf(page, worker.id)).toHaveAttribute('data-status', 'RUNNING', SHORT);
    await expect(statusOf(page, worker.id)).toContainText('Working', SHORT);
  });
  return worker;
}

test('two helper agents: approve, deny, stop, review, merge one and discard the other', async ({
  page,
  request,
}) => {
  const ownerText = 'Spin up two agents: one adds a greeting file, one writes notes';
  const runId = await startRun(page, ownerText);
  await expect(page.getByTestId('chat').getByText(ownerText)).toBeVisible();

  // The lead got the owner's message as its prompt, answers, and starts two helper agents.
  const lead = await startLead(page, request, runId);
  expect(lead.prompt).toContain(ownerText);
  await act(request, lead.id, 'lead-text', { text: 'I will start two helper agents.' });
  await seen(page, () =>
    expect(page.getByTestId('chat').getByText('I will start two helper agents.')).toBeVisible(
      SHORT,
    ),
  );

  // Both appear in the tree beneath the lead, with their status.
  const builder = await startWorker(page, request, runId, lead.id, 'Builder', 'Add greeting.txt');
  const writer = await startWorker(page, request, runId, lead.id, 'Writer', 'Write notes.txt');
  await expect(helpers(page)).toHaveCount(2);
  await expect(helpers(page).nth(0)).toHaveAccessibleName('Builder');
  await expect(helpers(page).nth(1)).toHaveAccessibleName('Writer');

  // The builder asks to edit a file: the owner approves in the tray.
  await act(request, builder.id, 'ask', { toolName: 'Edit', summary: 'Edit greeting.txt' });
  const tray = page.getByTestId('approvals');
  await seen(page, async () => {
    await expect(tray).toContainText('The Builder wants to:', SHORT);
    await expect(statusOf(page, builder.id)).toHaveAttribute(
      'data-status',
      'WAITING_APPROVAL',
      SHORT,
    );
  });
  await tray
    .getByRole('listitem')
    .filter({ hasText: 'Edit greeting.txt' })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect
    .poll(async () => (await fakeAgent(request, builder.id)).answers)
    .toEqual([{ tool: 'Edit', allow: true }]);
  await expect(statusOf(page, builder.id)).toHaveAttribute('data-status', 'RUNNING');

  // The writer drafted notes, then asks to run a command: the owner denies.
  await act(request, writer.id, 'write', { path: 'notes.txt', content: 'draft notes\n' });
  await act(request, writer.id, 'ask', { toolName: 'Bash', summary: 'Run npm install' });
  await seen(page, () => expect(tray).toContainText('The Writer wants to:', SHORT));
  await tray
    .getByRole('listitem')
    .filter({ hasText: 'Run npm install' })
    .getByRole('button', { name: 'Deny' })
    .click();
  await expect
    .poll(async () => (await fakeAgent(request, writer.id)).answers)
    .toEqual([{ tool: 'Bash', allow: false }]);
  await expect(page.getByTestId('approvals')).toHaveCount(0);
  await expect(page.getByTestId('approval-history')).toContainText('Denied');

  // The owner stops the writer.
  await card(page, writer.id).getByRole('button', { name: 'Stop', exact: true }).click();
  await card(page, writer.id).getByRole('button', { name: 'Stop agent' }).click();
  await expect(statusOf(page, writer.id)).toHaveAttribute('data-status', 'CANCELLED');
  expect((await fakeAgent(request, writer.id)).aborted).toBe(true);

  // The builder makes a real change in its worktree and finishes.
  await act(request, builder.id, 'write', {
    path: 'greeting.txt',
    content: 'hello from the builder\n',
  });
  await act(request, builder.id, 'activity', { summary: 'Wrote greeting.txt' });
  await act(request, builder.id, 'usage', {
    messageId: 'b-1',
    tokens: { input: 1200, output: 340, cacheCreation: 0, cacheRead: 5000 },
  });
  await act(request, builder.id, 'finish', { outcome: 'success', cost: 0.12 });
  await seen(page, async () => {
    await expect(statusOf(page, builder.id)).toHaveAttribute('data-status', 'SUCCEEDED', SHORT);
    // 1,200 input + 340 output; the 5,000 cache read tokens are not counted (ADR-0014).
    await expect(card(page, builder.id).getByTestId('budget')).toContainText(
      '1,540 of 500,000 budget tokens',
      SHORT,
    );
  });

  // The lead hands over for review.
  expect(
    await act(request, lead.id, 'call-lead', { name: 'request_review', input: {} }),
  ).toMatchObject({ ok: true });
  await seen(page, () => expect(runStatus(page)).toHaveAttribute('data-status', 'REVIEW', SHORT));
  await expect(runStatus(page)).toContainText('Ready for your review');

  // The review panel shows each helper's changed files and diff.
  const builderReview = page.getByTestId(`review-${builder.id}`);
  const writerReview = page.getByTestId(`review-${writer.id}`);
  await expect(builderReview).toContainText('1 changed file');
  await expect(builderReview).toContainText('greeting.txt');
  await expect(builderReview.getByTestId('diff')).toContainText('+hello from the builder');
  await expect(writerReview).toContainText('notes.txt');
  await expect(writerReview.getByTestId('diff')).toContainText('+draft notes');
  await shoot(page, 'review', true); // U-F

  // Merge the builder, discard the writer.
  await builderReview.getByRole('button', { name: 'Merge', exact: true }).click();
  await builderReview.getByRole('button', { name: 'Merge changes' }).click();
  await expect(builderReview).toContainText('Merged into your project');
  await writerReview.getByRole('button', { name: 'Discard', exact: true }).click();
  await writerReview.getByRole('button', { name: 'Discard changes' }).click();
  await expect(writerReview).toContainText('Discarded');

  await expect(runStatus(page)).toHaveAttribute('data-status', 'COMPLETED');
  await expect(runStatus(page)).toContainText('Finished — all changes reviewed');
  expect(await showOnMain(request, 'greeting.txt')).toBe('hello from the builder\n');
  expect(await showOnMain(request, 'notes.txt')).toBeNull();

  // The server log never holds chat or task text (ADR-0015: stored, never logged).
  const logs = ((await (await request.get(`${DRIVER}/logs`)).json()) as { text: string }).text;
  expect(logs).toContain('review recorded');
  for (const text of [ownerText, 'I will start two helper agents.', 'Add greeting.txt']) {
    expect(logs).not.toContain(text);
  }
});

test('budget soft cap: the agent pauses over budget and asks to continue; Stop all stops the run', async ({
  page,
  request,
}) => {
  const runId = await startRun(page, 'Spin up one agent to write tests', '1,000');
  await expect(page.getByTestId('run-facts')).toContainText('1,000 budget tokens');
  const lead = await startLead(page, request, runId);
  const tester = await startWorker(page, request, runId, lead.id, 'Tester', 'Write tests');

  // 700 input + 500 output = 1,200 budget tokens; cache reads are not counted (ADR-0014).
  await act(request, tester.id, 'usage', {
    messageId: 't-1',
    tokens: { input: 700, output: 500, cacheCreation: 0, cacheRead: 90_000 },
  });
  const budget = card(page, tester.id).getByTestId('budget');
  const tray = page.getByTestId('approvals');
  await seen(page, async () => {
    await expect(statusOf(page, tester.id)).toHaveAttribute('data-status', 'BLOCKED', SHORT);
  });
  await expect(statusOf(page, tester.id)).toContainText('Paused at its budget');
  await expect(budget).toContainText('1,200 of 1,000 budget tokens');
  await expect(budget).toContainText('200 budget tokens over its budget');
  await expect(tray).toContainText('The Tester used up its budget.');
  expect((await fakeAgent(request, tester.id)).interrupts).toBe(1);

  await tray.getByRole('button', { name: 'Approve' }).click();
  await expect(statusOf(page, tester.id)).toHaveAttribute('data-status', 'RUNNING');
  await expect(budget).toContainText('1,200 of 2,000 budget tokens');
  await expect
    .poll(async () => (await fakeAgent(request, tester.id)).sent)
    .toEqual(['The owner raised your budget. Continue your task.']);

  // Stop all.
  await stopAll(page, runId);
  await seen(page, () =>
    expect(runStatus(page)).toHaveAttribute('data-status', 'CANCELLED', SHORT),
  );
  await expect(runStatus(page)).toContainText('Stopped');
  await expect(statusOf(page, tester.id)).toHaveAttribute('data-status', 'CANCELLED');
  await expect(statusOf(page, lead.id)).toHaveAttribute('data-status', 'CANCELLED');
  for (const id of [lead.id, tester.id]) expect((await fakeAgent(request, id)).aborted).toBe(true);
  await expect(page.getByTestId('chat')).toContainText(
    'This run has ended, so the chat is closed.',
  );
});

test('a 4th helper agent is refused with a clear reason the lead passes on', async ({
  page,
  request,
}) => {
  const runId = await startRun(page, 'Spin up four agents');
  const lead = await startLead(page, request, runId);
  for (const role of ['One', 'Two', 'Three']) {
    await startWorker(page, request, runId, lead.id, role, `Task ${role}`);
  }
  const fourth = await act(request, lead.id, 'call-lead', {
    name: 'start_agent',
    input: { role: 'Four', task: 'Task Four' },
  });
  expect(fourth).toEqual({
    ok: false,
    error: 'At most 3 agents can work at once; wait for one to finish.',
  });
  // The refusal reaches the model as the tool's error; the lead tells the owner.
  await act(request, lead.id, 'lead-text', {
    text: `I could not start a fourth helper agent: ${String(fourth['error'])}`,
  });
  await seen(page, () =>
    expect(page.getByTestId('chat')).toContainText(
      'I could not start a fourth helper agent: At most 3 agents can work at once; wait for one to finish.',
      SHORT,
    ),
  );
  await expect(helpers(page)).toHaveCount(3);
  await expect(page.getByTestId('agent-tree').getByRole('article', { name: 'Four' })).toHaveCount(
    0,
  );
  expect((await run(request, runId)).agents.filter((a) => a.kind === 'worker')).toHaveLength(3);

  await stopAll(page, runId);
  await seen(page, () =>
    expect(runStatus(page)).toHaveAttribute('data-status', 'CANCELLED', SHORT),
  );
});

// Regression test for the SSE bug P3-F found (fixed: the server sends unnamed events): an
// agent-driven change must appear without a reload.
test('the open run page updates live when an agent changes something (no reload)', async ({
  page,
  request,
}) => {
  const runId = await startRun(page, 'Live update check');
  // An old control-panel link to a run without a ticket opens its run page (redesign R-A).
  const runPage = page.url();
  await page.goto(`/#/control/${runId}`);
  await expect(page).toHaveURL(runPage);
  const leadDto = (await run(request, runId)).agents.find((a) => a.kind === 'lead');
  if (leadDto === undefined) throw new Error('no lead');
  await fakeAgent(request, leadDto.id);
  await expect(runStatus(page)).toHaveAttribute('data-status', 'QUEUED');
  await act(request, leadDto.id, 'started');
  await expect(runStatus(page)).toHaveAttribute('data-status', 'RUNNING', { timeout: 5_000 });
});
