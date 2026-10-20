import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/*
 * RL-V (ADR-0021): the review loop in the browser against the REAL server routes — a live-mode
 * server over an empty temp Claude dir with review-loop ticket runs (ACP_E2E_REVIEW_LOOP=1) and
 * the scripted fake managed adapter (packages/server/tests/verification/redesign/e2e-server.ts),
 * so neither the Agent SDK nor `claude` ever runs. Agents are driven through the test-only
 * driver; everything the owner does goes through the page. Git and the harness checks are real.
 *
 * Flow: New project (Auto edits by default) → a harness committed on main → Workflow (the review
 * stage's defaults; final code review on) → New ticket → Start → plan with two helper steps →
 * Approve (the ticket branch acp/SHOP-1 is made) → two helpers work; the API builder's edit and
 * harness check run unasked (Auto edits) → a review agent approves one change and asks rework
 * for the other → the lead merges the first, sends the second back → the helper reworks → a
 * second review approves → the lead merges it → a third helper's change the lead hands to the
 * owner (needs-owner) → the owner merges it from its change card → the lead hands over → the
 * final code review runs on the ticket branch → the owner opens the ticket-branch card, sees the
 * combined diff and the checks on the tip → Merge into main → Done. Then: the files are on main,
 * the ticket branch is gone, no finding, note or diff text is in the server log, and no diff text
 * is in the database.
 *
 * With ACP_SCREENSHOT_DIR set, it saves light and dark screenshots at 1440 and 390 pixels wide.
 */

const SHOTS = process.env.ACP_SCREENSHOT_DIR;
const DRIVER = process.env.ACP_E2E_LOOP_DRIVER_URL ?? 'http://127.0.0.1:7882';
const DIFF_MARKER = 'RLV-DIFF-MARKER-7f3a';
const FINDING = 'The discount field has no label. Synthetic finding.';
const REWORK_NOTE = 'Add a label to the discount field. Synthetic note.';
const QUESTION = 'Should the docs change go in? Synthetic question.';
const FINAL_REVIEW = 'The combined change reads well. Synthetic final review.';

const HARNESS = {
  '.acp/harness.json': `${JSON.stringify(
    {
      version: 1,
      description: 'Synthetic RL-V harness',
      checks: [
        {
          id: 'test',
          name: 'Unit tests',
          argv: ['node', 'check.mjs'],
          timeoutSec: 30,
          required: true,
        },
      ],
    },
    null,
    2,
  )}\n`,
  'check.mjs': 'process.exit(0);\n',
};

interface DriverAgent {
  id: string;
  kind: string;
  reviewScope: 'change' | 'final' | null;
  rework: boolean;
  /** ADR-0022: the agent was started in Full auto (auto mode + sandbox). */
  fullAuto: boolean;
  prompt: string;
  sent: string[];
  ended: boolean;
}

interface Run {
  status: string;
  agents: { id: string; role: string; kind: string; status: string }[];
  approvals: { agentRunId: string; decidedBy?: string | null; allowRule?: string | null }[];
  ticketBranch?: { branch: string; state: string } | null;
  changes?: {
    agentRunId: string;
    role: string;
    state: string;
    reworkRounds: number;
    reviews: { round: number; reviewerAgentRunId: string | null; verdict: string | null }[];
  }[];
  reviewer?: string;
  maxReworkRounds?: number;
}

type Round = NonNullable<Run['changes']>[number]['reviews'][number];

/** The review agent's row of a round (a decider's note on the same round has its own row). */
function agentRound(reviews: readonly Round[] | undefined, round: number): Round | undefined {
  return reviews?.find((r) => r.round === round && r.reviewerAgentRunId !== null);
}

async function agents(request: APIRequestContext): Promise<DriverAgent[]> {
  return (await (await request.get(`${DRIVER}/agents`)).json()) as DriverAgent[];
}

/** The latest start of an agent run (a rework turn starts again under the helper's id). */
async function agentOf(
  request: APIRequestContext,
  match: (a: DriverAgent) => boolean,
): Promise<DriverAgent> {
  let found: DriverAgent | undefined;
  await expect
    .poll(async () => {
      found = (await agents(request)).findLast(match);
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
): Promise<{ ok?: boolean; text?: string; error?: string; decision?: unknown; pending?: true }> {
  const res = await request.post(`${DRIVER}/agents/${id}/${action}`, { data: body });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as {
    ok?: boolean;
    text?: string;
    error?: string;
    decision?: unknown;
    pending?: true;
  };
}

/** A lead tool call that must succeed; returns the tool's reply. */
async function lead(
  request: APIRequestContext,
  id: string,
  name: string,
  input: unknown,
): Promise<string> {
  const out = await act(request, id, 'call-lead', { name, input });
  if (out.ok !== true) throw new Error(`${name} refused: ${out.error ?? ''}`);
  return out.text ?? '';
}

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${SHOTS}/loop-live-${name}-${width}-${scheme}.png`,
        fullPage,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

/** A picture of one element (a card), in both themes at each width. */
async function shootPart(page: Page, name: string, testId: string): Promise<void> {
  if (SHOTS === undefined) return;
  for (const width of [1440, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 2000 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      const part = page.getByTestId(testId).first();
      await part.scrollIntoViewIfNeeded();
      await part.screenshot({ path: `${SHOTS}/loop-live-${name}-${width}-${scheme}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

test.describe.configure({ mode: 'serial' });

test('the review loop: two helpers, review, rework, an owner override, one final merge', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const { parentDir } = (await (await request.get(`${DRIVER}/parent`)).json()) as {
    parentDir: string;
  };
  const repo = `${parentDir}/shop`;

  // ---- New project: a new repository; Auto edits is the default for a new project.
  await page.goto('/#/projects/new');
  await page.getByText('Create a new repository').click();
  await page.getByLabel('Create it inside').fill(parentDir);
  await page.getByLabel('Repository name').fill('shop');
  await page.getByRole('button', { name: 'Create repository' }).click();
  const wizard = page.getByRole('form', { name: 'New project' });
  await expect(wizard.getByRole('textbox', { name: 'Ticket prefix' })).toHaveValue('SHOP');
  await wizard.getByRole('radio', { name: '3 helpers' }).check({ force: true });
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 3 of 5');
  await expect(wizard.getByRole('radio', { name: /^Auto edits/ })).toBeChecked();
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 4 of 5');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 5 of 5');
  await wizard.getByRole('button', { name: 'Finish and open the board' }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/board$/);
  const projectId = /#\/p\/([^/]+)\/board$/.exec(page.url())?.[1] ?? '';

  // The owner commits a harness with one required check (real `node`, real git).
  const committed = await request.post(`${DRIVER}/repo/commit`, {
    data: { root: repo, files: HARNESS },
  });
  expect(committed.ok(), await committed.text()).toBe(true);

  // ---- Workflow (WG-D's graph editor): the change reviewer's defaults; a final reviewer added.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Workflow' }).click();
  await expect(page).toHaveURL(new RegExp(`#/p/${projectId}/workflow`));
  const panel = page.getByRole('complementary', { name: 'Block settings' });
  await page.getByTestId('block-review').click();
  await expect(panel.getByTestId('node-panel')).toHaveAttribute('data-node', 'review');
  await expect(panel.getByRole('radio', { name: /^Each change/ })).toBeChecked();
  await expect(panel.getByTestId('node-links')).toContainText('Sends its findings → Lead');
  await page.getByRole('button', { name: 'Add Final reviewer' }).click();
  await expect(page.getByTestId('block-code-review')).toBeVisible();
  await page.getByTestId('save-workflow').click();
  await expect(page.getByTestId('saved')).toHaveText('Saved');

  // ---- Board: a new ticket, Ready, Start.
  await nav.getByRole('link', { name: 'Board' }).click();
  await page.getByRole('button', { name: 'New ticket' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Title').fill('Add a discount code field');
  await dialog.getByLabel('Description').fill('Synthetic RL-V ticket: an API and a field.');
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
  await page.getByRole('link', { name: /Add a discount code field/ }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/tickets\/[^/]+$/);
  const ticketId = /tickets\/([^/]+)$/.exec(page.url())?.[1] ?? '';
  const ticket = (await (await request.get(`/api/tickets/${ticketId}`)).json()) as {
    currentRun: { id: string } | null;
  };
  const runId = ticket.currentRun?.id ?? '';
  expect(runId).not.toBe('');
  const run = async (): Promise<Run> =>
    (await (await request.get(`/api/runs/${runId}`)).json()) as Run;
  const waitRun = async (what: (r: Run) => boolean) => {
    let last: Run | undefined;
    await expect
      .poll(async () => {
        last = await run();
        return what(last);
      })
      .toBe(true);
    return last as Run;
  };
  await expect(page.getByTestId('run-approval-mode')).toHaveText('Approvals: Auto edits');

  // ---- Plan: two steps, each for a helper. The owner approves; the ticket branch is made.
  const leadAgent = await agentOf(request, (a) => a.kind === 'lead');
  await act(request, leadAgent.id, 'started', { sessionId: 'sess-rlv-lead' });
  await lead(request, leadAgent.id, 'submit_plan', {
    summary: 'An API for discount codes and a field at checkout',
    steps: [
      { title: 'Build the discount API', role: 'API builder', detail: 'One helper' },
      { title: 'Build the discount field', role: 'UI builder', detail: 'Another helper' },
    ],
  });
  const card = page.getByTestId('plan-card');
  await expect(card).toContainText('An API for discount codes and a field at checkout');
  await card.getByRole('button', { name: 'Approve plan' }).click();
  const withBranch = await waitRun((r) => r.ticketBranch?.state === 'open');
  expect(withBranch.ticketBranch?.branch).toBe('acp/SHOP-1');
  // The run's own review settings (RL-V contract): a review agent, two rework rounds.
  expect(withBranch).toMatchObject({ reviewer: 'agent', maxReworkRounds: 2 });
  // The lead hears of the approval only once the branch exists (RL-B), then starts helpers.
  await expect
    .poll(async () => (await agentOf(request, (a) => a.id === leadAgent.id)).sent.join('\n'))
    .toContain('approved plan');

  // ---- Work: two helpers. Auto edits: an edit in its own copy and the exact harness check
  // run without asking, each recorded with its rule.
  await lead(request, leadAgent.id, 'start_agent', {
    role: 'API builder',
    task: 'Build the discount API',
  });
  await lead(request, leadAgent.id, 'start_agent', {
    role: 'UI builder',
    task: 'Build the discount field',
  });
  const helpers = await waitRun((r) => r.agents.filter((a) => a.kind === 'worker').length === 2);
  const apiId = helpers.agents.find((a) => a.role === 'API builder')?.id ?? '';
  const uiId = helpers.agents.find((a) => a.role === 'UI builder')?.id ?? '';
  const api = await agentOf(request, (a) => a.id === apiId);
  const ui = await agentOf(request, (a) => a.id === uiId);
  await act(request, api.id, 'started');
  await act(request, ui.id, 'started');
  await expect(page.getByRole('article', { name: 'API builder' })).toBeVisible();
  const edit = await act(request, api.id, 'ask', {
    toolName: 'Write',
    summary: 'Write discount-api.ts',
    input: { file_path: 'discount-api.ts' },
  });
  expect(edit.decision).toEqual({ allow: true });
  const check = await act(request, api.id, 'ask', {
    toolName: 'Bash',
    summary: 'node check.mjs',
    input: { command: 'node check.mjs' },
  });
  expect(check.decision).toEqual({ allow: true });
  await act(request, api.id, 'write', {
    path: 'discount-api.ts',
    content: `export const discount = (code: string) => code.length;\n// ${DIFF_MARKER}\n`,
  });
  await act(request, api.id, 'finish');
  await act(request, ui.id, 'write', {
    path: 'discount-field.ts',
    content: 'export const field = "<input>";\n',
  });
  await act(request, ui.id, 'finish');

  // ---- Review agents: one change approved, the other sent for rework.
  const reviewerOf = async (role: string, round: number) => {
    const r = await waitRun((x) => {
      const c = x.changes?.find((y) => y.role === role);
      return typeof agentRound(c?.reviews, round)?.reviewerAgentRunId === 'string';
    });
    const id =
      agentRound(r.changes?.find((y) => y.role === role)?.reviews, round)?.reviewerAgentRunId ?? '';
    return agentOf(request, (a) => a.id === id && a.reviewScope === 'change');
  };
  const reviewApi = await reviewerOf('API builder', 0);
  expect(reviewApi.prompt).toContain(DIFF_MARKER); // the diff reaches the reviewer, never a row
  await act(request, reviewApi.id, 'started');
  await lead(request, reviewApi.id, 'submit_review', {
    verdict: 'approve',
    findings: 'The API is small and clear. Synthetic finding.',
  });
  await act(request, reviewApi.id, 'finish');
  const reviewUi = await reviewerOf('UI builder', 0);
  await act(request, reviewUi.id, 'started');
  await lead(request, reviewUi.id, 'submit_review', { verdict: 'rework', findings: FINDING });
  await act(request, reviewUi.id, 'finish');
  await waitRun((r) => r.changes?.every((c) => c.state === 'decision') === true);
  const overview = page.getByTestId('changes-overview');
  await expect(overview.getByTestId('change-state')).toHaveText([
    'Needs lead decision',
    'Needs lead decision',
  ]);

  // ---- The lead merges the API builder's change into the ticket branch. A merge waits for
  // the required checks on the merged commit; the lead tries again once they have run.
  const leadMerges = async (agentId: string, role: string) => {
    await expect
      .poll(
        async () => {
          const out = await act(request, leadAgent.id, 'call-lead', {
            name: 'merge_change',
            input: { agentId },
          });
          return out.text ?? out.error ?? '';
        },
        { timeout: 45_000, intervals: [500] },
      )
      .toContain(`Merged ${role} into acp/SHOP-1`);
  };
  await leadMerges(api.id, 'API builder');

  // ---- … and sends the UI builder's change back; the helper reworks it in its own copy.
  expect(
    await lead(request, leadAgent.id, 'request_rework', { agentId: ui.id, comments: REWORK_NOTE }),
  ).toContain('round 1');
  const rework = await agentOf(request, (a) => a.id === ui.id && a.rework);
  expect(rework.prompt).toContain(REWORK_NOTE);
  await act(request, rework.id, 'started');
  await expect(overview.getByTestId('change-state').nth(1)).toHaveText('Rework round 1 of 2');
  await act(request, rework.id, 'write', {
    path: 'discount-field.ts',
    content: 'export const field = "<label>Discount code</label><input>";\n',
  });
  await act(request, rework.id, 'finish');
  const reviewUi2 = await reviewerOf('UI builder', 1);
  await act(request, reviewUi2.id, 'started');
  await lead(request, reviewUi2.id, 'submit_review', {
    verdict: 'approve',
    findings: 'The label is there now. Synthetic finding.',
  });
  await act(request, reviewUi2.id, 'finish');
  await leadMerges(ui.id, 'UI builder');

  // ---- A third helper's change: the lead asks the owner, who merges it from its card.
  await lead(request, leadAgent.id, 'start_agent', {
    role: 'Docs writer',
    task: 'Document the discount code',
  });
  const docsRun = await waitRun((r) => r.agents.some((a) => a.role === 'Docs writer'));
  const docsId = docsRun.agents.find((a) => a.role === 'Docs writer')?.id ?? '';
  const docs = await agentOf(request, (a) => a.id === docsId);
  await act(request, docs.id, 'started');
  await act(request, docs.id, 'write', {
    path: 'docs/discount.md',
    content: '# Discount codes\n\nEnter a code at checkout.\n',
  });
  await act(request, docs.id, 'finish');
  const reviewDocs = await reviewerOf('Docs writer', 0);
  await act(request, reviewDocs.id, 'started');
  await lead(request, reviewDocs.id, 'submit_review', {
    verdict: 'approve',
    findings: 'Short and right. Synthetic finding.',
  });
  await act(request, reviewDocs.id, 'finish');
  await waitRun((r) => r.changes?.find((c) => c.role === 'Docs writer')?.state === 'decision');
  await lead(request, leadAgent.id, 'ask_owner', { agentId: docs.id, question: QUESTION });

  const need = page.getByTestId('changes-need-you');
  await expect(need).toContainText('1 change needs your decision');
  await expect(page.getByTestId('live-block-owner-merge')).toHaveAttribute('data-state', 'waiting');
  await need.getByRole('button', { name: 'Open' }).click();
  const side = page.getByTestId('side-panel');
  const docsCard = side.getByTestId('change-card');
  await expect(docsCard.getByTestId('change-state')).toHaveAttribute('data-state', 'needs-owner');
  await expect(docsCard.getByTestId('owner-decision')).toContainText(
    'The lead asked you to decide.',
  );
  // The merge needs the required checks on its commit: they ran when it was sealed.
  await expect(docsCard.getByTestId('change-checks')).toHaveAttribute('data-checks', 'passed');
  await shoot(page, 'changes');
  await docsCard.getByRole('button', { name: 'Merge into acp/SHOP-1' }).click();
  await docsCard.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(docsCard.getByTestId('change-state')).toHaveAttribute('data-state', 'merged');
  await expect(page.getByTestId('changes-need-you')).toHaveCount(0);
  // The history keeps who decided what: the reviewer approved, the lead asked (with its
  // question), the owner merged.
  const docsRounds = docsCard.getByTestId('change-history').getByRole('listitem');
  await expect(docsRounds).toHaveText([
    /Review agent approved it/,
    /Lead asked you to decide.*Synthetic question/,
    /You merged it/,
  ]);

  // The UI builder's card: two rounds; the review agent's finding and the lead's note are both
  // kept (ticket comments), each on its own line; rework ×1.
  await overview
    .getByTestId('change-row')
    .filter({ hasText: 'UI builder' })
    .getByRole('button', { name: 'Open' })
    .click();
  const uiCard = side.getByTestId('change-card');
  await expect(uiCard.getByTestId('change-history').getByRole('listitem')).toHaveText([
    new RegExp(`Round 1.*Review agent asked for rework.*${FINDING}`),
    new RegExp(`Round 1.*Lead sent it back for rework.*${REWORK_NOTE}`),
    /Round 2.*Review agent approved it · Lead merged it/,
  ]);
  await expect(overview.getByTestId('change-row').filter({ hasText: 'UI builder' })).toContainText(
    'Rework ×1',
  );

  // The auto-recorded approvals show their rule.
  // The agent tree's card; the live graph has a button with the same name on the block.
  await page
    .getByRole('button', { name: 'Show the API builder in the side panel' })
    .and(page.locator(':not([data-testid="live-agent"])'))
    .click();
  await side.getByRole('tab', { name: /Approvals/ }).click();
  const history = side.getByTestId('approval-history');
  await expect(history).toContainText('Approved automatically: edit in its own copy');
  await expect(history).toContainText('Approved automatically: harness check');
  const approvals = (await run()).approvals.filter((a) => a.agentRunId === api.id);
  expect(approvals.map((a) => [a.decidedBy, a.allowRule])).toEqual([
    ['allowlist', 'edit-in-own-worktree'],
    ['allowlist', 'run-harness-check'],
  ]);

  // ---- Handover; the final code review runs on the ticket branch while the lead stays.
  await lead(request, leadAgent.id, 'request_review', {});
  const finalReviewer = await agentOf(
    request,
    (a) => a.kind === 'reviewer' && a.reviewScope === 'final',
  );
  await act(request, finalReviewer.id, 'started');
  await expect(page.getByTestId('live-block-code-review')).toHaveAttribute('data-state', 'active');
  await lead(request, finalReviewer.id, 'post_review', { text: FINAL_REVIEW });
  await act(request, finalReviewer.id, 'finish');
  await waitRun((r) => r.status === 'REVIEW');

  // ---- The owner's single merge: the combined diff, the checks on the tip, Merge into main.
  const branchCard = page.getByTestId('ticket-branch');
  await expect(branchCard.getByRole('button', { name: 'Merge into main' })).toBeVisible();
  await expect(page.getByTestId('live-block-owner-merge')).toHaveAttribute(
    'data-state',
    'needs-you',
  );
  await expect(branchCard.getByTestId('branch-checks')).toContainText('Passed');
  await expect(branchCard).toContainText('discount-api.ts');
  await expect(branchCard).toContainText('discount-field.ts');
  await expect(branchCard).toContainText('docs/discount.md');
  await expect(branchCard).toContainText('3 changes merged');
  await branchCard.getByTestId('branch-diff').locator('summary').click();
  await expect(branchCard.getByTestId('branch-diff')).toContainText(DIFF_MARKER);
  await shootPart(page, 'ticket-branch', 'ticket-branch');
  await branchCard.getByRole('button', { name: 'Merge into main' }).click();
  await expect(branchCard.getByTestId('confirm')).toContainText('Merge acp/SHOP-1 into main?');
  await branchCard.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(branchCard.getByTestId('branch-state')).toHaveText('Merged into main');
  await expect(page.getByTestId('ticket-stage')).toContainText('Done');
  await expect(page.getByTestId('live-block-owner-merge')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('live-block-done')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('review-counts')).toHaveText('3 merged');
  await expect(overview.getByTestId('change-state')).toHaveText([
    'Merged into acp/SHOP-1',
    'Merged into acp/SHOP-1',
    'Merged into acp/SHOP-1',
  ]);
  await shoot(page, 'done');
  expect((await run()).status).toBe('COMPLETED');

  // ---- On main: every change, once; the ticket branch is gone.
  const onMain = async (path: string) =>
    (
      (await (
        await request.get(`${DRIVER}/repo/show`, { params: { root: repo, ref: 'main', path } })
      ).json()) as { content: string | null }
    ).content;
  expect(await onMain('discount-api.ts')).toContain(DIFF_MARKER);
  expect(await onMain('discount-field.ts')).toContain('<label>Discount code</label>');
  expect(await onMain('docs/discount.md')).toContain('# Discount codes');
  const { branches } = (await (
    await request.get(`${DRIVER}/repo/branches`, { params: { root: repo } })
  ).json()) as { branches: string[] };
  expect(branches).toEqual(['main']);

  // The board shows the ticket in Done.
  await nav.getByRole('link', { name: 'Board' }).click();
  await expect(page.getByRole('region', { name: 'Done' })).toContainText('SHOP-1');

  // No finding, note, question, review or diff text in the log; no diff text in the database
  // (findings and the lead's notes are ticket comments by design, ADR-0021 §6).
  const { text: logs } = (await (await request.get(`${DRIVER}/logs`)).json()) as { text: string };
  for (const text of [DIFF_MARKER, FINDING, REWORK_NOTE, QUESTION, FINAL_REVIEW]) {
    expect(logs).not.toContain(text);
  }
  const db = (await (
    await request.get(`${DRIVER}/db/contains`, { params: { text: DIFF_MARKER } })
  ).json()) as { found: boolean };
  expect(db.found).toBe(false);
});

/*
 * RL-G (ADR-0022): Full auto in the browser against the real server routes. The owner picks Full
 * auto in the New project wizard; the lead's plan is approved automatically (no plan card asks);
 * the helper starts in Full auto (the fake adapter records its sandbox spec); an action that still
 * reaches the gate is denied at once with nothing waiting for the owner; the change goes through
 * the review agent and the lead's merge; the owner's only click is Merge into main.
 */
test('Full auto: plan approved automatically, nothing asks, one final merge', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { parentDir } = (await (await request.get(`${DRIVER}/parent`)).json()) as {
    parentDir: string;
  };
  const repo = `${parentDir}/cart`;

  // ---- New project with Full auto, and its plain warning.
  await page.goto('/#/projects/new');
  await page.getByText('Create a new repository').click();
  await page.getByLabel('Create it inside').fill(parentDir);
  await page.getByLabel('Repository name').fill('cart');
  await page.getByRole('button', { name: 'Create repository' }).click();
  const wizard = page.getByRole('form', { name: 'New project' });
  await expect(wizard.getByRole('textbox', { name: 'Ticket prefix' })).toHaveValue('CART');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 3 of 5');
  await wizard.getByRole('radio', { name: /^Full auto/ }).check({ force: true });
  await expect(wizard.getByTestId('full-auto-warning')).toContainText(
    'you review everything once in the final merge',
  );
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 4 of 5');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 5 of 5');
  await wizard.getByRole('button', { name: 'Finish and open the board' }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/board$/);
  const committed = await request.post(`${DRIVER}/repo/commit`, {
    data: { root: repo, files: HARNESS },
  });
  expect(committed.ok(), await committed.text()).toBe(true);

  // ---- A ticket, Ready, Start.
  await page.getByRole('button', { name: 'New ticket' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Title').fill('Show the cart total');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Created CART-1 in Backlog.' }),
  ).toBeVisible();
  const move = async (item: string) => {
    await page.getByRole('button', { name: 'Move CART-1' }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  await move('Move to Ready');
  await expect(
    page.getByRole('status').filter({ hasText: 'Moved CART-1 to Ready.' }),
  ).toBeVisible();
  await move('Start (the lead agent plans it)');
  await page.getByRole('link', { name: /Show the cart total/ }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/tickets\/[^/]+$/);
  const ticketId = /tickets\/([^/]+)$/.exec(page.url())?.[1] ?? '';
  const ticket = (await (await request.get(`/api/tickets/${ticketId}`)).json()) as {
    currentRun: { id: string } | null;
  };
  const runId = ticket.currentRun?.id ?? '';
  const run = async (): Promise<Run> =>
    (await (await request.get(`/api/runs/${runId}`)).json()) as Run;
  const waitRun = async (what: (r: Run) => boolean) => {
    let last: Run | undefined;
    await expect
      .poll(async () => {
        last = await run();
        return what(last);
      })
      .toBe(true);
    return last as Run;
  };
  await expect(page.getByTestId('run-approval-mode')).toHaveText('Approvals: Full auto');

  // ---- The plan is approved automatically: the run goes on, nothing waits for the owner.
  const leadAgent = await agentOf(
    request,
    (a) => a.kind === 'lead' && a.prompt.includes('Show the cart total'),
  );
  expect(leadAgent.fullAuto).toBe(false);
  expect(leadAgent.prompt).toContain('your plan is approved automatically');
  await act(request, leadAgent.id, 'started', { sessionId: 'sess-rlg-lead' });
  const reply = await lead(request, leadAgent.id, 'submit_plan', {
    summary: 'Compute and show the cart total',
    steps: [{ title: 'Show the total', role: 'Cart builder', detail: 'One helper' }],
  });
  expect(reply).toContain('approved automatically (Full auto)');
  const branched = await waitRun((r) => r.ticketBranch?.state === 'open');
  expect(branched.status).toBe('RUNNING');
  await expect(page.getByTestId('plan-card')).toHaveCount(0);
  await expect(page.getByTestId('plan-history')).toContainText(
    'Approved automatically (Full auto)',
  );
  await expect
    .poll(async () => (await agentOf(request, (a) => a.id === leadAgent.id)).sent.join('\n'))
    .toContain('approved automatically (Full auto)');

  // ---- The helper runs in Full auto; what reaches the gate is denied without asking.
  await lead(request, leadAgent.id, 'start_agent', { role: 'Cart builder', task: 'Show it' });
  const withHelper = await waitRun((r) => r.agents.some((a) => a.role === 'Cart builder'));
  const helperId = withHelper.agents.find((a) => a.role === 'Cart builder')?.id ?? '';
  const helper = await agentOf(request, (a) => a.id === helperId);
  expect(helper.fullAuto).toBe(true);
  await act(request, helper.id, 'started');
  const denied = await act(request, helper.id, 'ask', {
    toolName: 'Bash',
    summary: 'curl example.test',
    input: { command: 'curl https://example.test' },
  });
  expect(denied.pending).toBeUndefined();
  expect(denied.decision).toMatchObject({ allow: false });
  // The agent tree's card; the live graph has a button with the same name on the block.
  await page
    .getByRole('button', { name: 'Show the Cart builder in the side panel' })
    .and(page.locator(':not([data-testid="live-agent"])'))
    .click();
  const side = page.getByTestId('side-panel');
  await side.getByRole('tab', { name: /Approvals/ }).click();
  await expect(side.getByTestId('full-auto-approvals-note')).toContainText(
    'Claude Code’s auto mode decides each helper action',
  );
  await act(request, helper.id, 'write', {
    path: 'cart-total.ts',
    content: 'export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n',
  });
  await act(request, helper.id, 'finish');

  // ---- Review agent, the lead's merge, hand over.
  const reviewed = await waitRun(
    (r) =>
      r.changes?.some((c) => typeof agentRound(c.reviews, 0)?.reviewerAgentRunId === 'string') ===
      true,
  );
  const reviewerId = agentRound(reviewed.changes?.[0]?.reviews, 0)?.reviewerAgentRunId ?? '';
  const reviewer = await agentOf(request, (a) => a.id === reviewerId);
  await act(request, reviewer.id, 'started');
  await lead(request, reviewer.id, 'submit_review', {
    verdict: 'approve',
    findings: 'Small and right. Synthetic finding.',
  });
  await act(request, reviewer.id, 'finish');
  await expect
    .poll(
      async () => {
        const out = await act(request, leadAgent.id, 'call-lead', {
          name: 'merge_change',
          input: { agentId: helper.id },
        });
        return out.text ?? out.error ?? '';
      },
      { timeout: 45_000, intervals: [500] },
    )
    .toContain('Merged Cart builder into acp/CART-1');
  await lead(request, leadAgent.id, 'request_review', {});
  await waitRun((r) => r.status === 'REVIEW');

  // ---- No approval ever waited for the owner; the only click is Merge into main.
  expect((await run()).approvals.filter((a) => a.decidedBy === 'owner')).toEqual([]);
  await expect(page.getByTestId('approvals')).toHaveCount(0);
  const branchCard = page.getByTestId('ticket-branch');
  // The checks on the tip run first (RL-B); Merge waits for them.
  await expect(branchCard.getByTestId('branch-checks')).toContainText('Passed', {
    timeout: 45_000,
  });
  await expect(branchCard).toContainText('cart-total.ts');
  await branchCard.getByRole('button', { name: 'Merge into main' }).click();
  await expect(branchCard.getByTestId('confirm')).toContainText('Merge acp/CART-1 into main?');
  await branchCard.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(branchCard.getByTestId('branch-state')).toHaveText('Merged into main');
  await expect(page.getByTestId('ticket-stage')).toContainText('Done');
  expect((await run()).status).toBe('COMPLETED');
});

/*
 * RL-H: ticket-level run options in the browser against the real server routes. In a Full auto
 * project the owner creates a ticket set to Manual in the New ticket dialog; the board card says
 * so; its run starts in Manual (the lead is not told the plan is approved automatically). On the
 * ticket page the owner puts it back to "Project default"; after Stop all, the re-run follows the
 * project again (Full auto). The fake adapter plays the lead; nothing else runs.
 */
test('ticket run options: a Manual ticket in a Full auto project, then back to the project default', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { parentDir } = (await (await request.get(`${DRIVER}/parent`)).json()) as {
    parentDir: string;
  };

  // ---- New project with Full auto.
  await page.goto('/#/projects/new');
  await page.getByText('Create a new repository').click();
  await page.getByLabel('Create it inside').fill(parentDir);
  await page.getByLabel('Repository name').fill('notes');
  await page.getByRole('button', { name: 'Create repository' }).click();
  const wizard = page.getByRole('form', { name: 'New project' });
  await expect(wizard.getByRole('textbox', { name: 'Ticket prefix' })).toHaveValue('NOTES');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 3 of 5');
  await wizard.getByRole('radio', { name: /^Full auto/ }).check({ force: true });
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 4 of 5');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await expect(wizard).toContainText('Step 5 of 5');
  await wizard.getByRole('button', { name: 'Finish and open the board' }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/board$/);

  // ---- New ticket set to Manual; the project default is named in the dialog.
  await page.getByRole('button', { name: 'New ticket' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Title').fill('Rename the notes folder');
  // WG-E (ADR-0023): the mode is a limit; without one, each block keeps its own mode.
  const mode = dialog.getByLabel('Approval mode: at most');
  await expect(mode.locator('option').first()).toHaveText('No limit: each block’s own mode');
  await mode.selectOption('manual');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Created NOTES-1 in Backlog.' }),
  ).toBeVisible();
  const cardOf = page.getByTestId('ticket-card').filter({ hasText: 'NOTES-1' });
  await expect(cardOf.getByTestId('card-run-options')).toHaveAttribute(
    'title',
    'This ticket’s own run options: Manual',
  );

  // ---- Ready, Start: the run snapshots Manual, not the project's Full auto.
  const move = async (item: string) => {
    await page.getByRole('button', { name: 'Move NOTES-1' }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  await move('Move to Ready');
  await expect(
    page.getByRole('status').filter({ hasText: 'Moved NOTES-1 to Ready.' }),
  ).toBeVisible();
  await move('Start (the lead agent plans it)');
  await page.getByRole('link', { name: /Rename the notes folder/ }).click();
  await expect(page).toHaveURL(/#\/p\/[^/]+\/tickets\/[^/]+$/);
  const ticketId = /tickets\/([^/]+)$/.exec(page.url())?.[1] ?? '';
  const ticketOf = async () =>
    (await (await request.get(`/api/tickets/${ticketId}`)).json()) as {
      ticket: { runOptions?: Record<string, unknown> };
      currentRun: { id: string; approvalMode?: string } | null;
    };
  const first = await ticketOf();
  expect(first.ticket.runOptions).toEqual({ approvalMode: 'manual' });
  expect(first.currentRun?.approvalMode).toBe('manual');
  await expect(page.getByTestId('run-approval-mode')).toHaveText('Approvals: Manual');
  const leadAgent = await agentOf(
    request,
    (a) => a.kind === 'lead' && a.prompt.includes('Rename the notes folder'),
  );
  expect(leadAgent.prompt).not.toContain('your plan is approved automatically');

  // ---- The ticket page: back to the project default.
  const options = page.getByTestId('ticket-run-options');
  await expect(options.getByTestId('run-option-mode')).toHaveText('Manual · This ticket');
  await options.getByRole('button', { name: 'Change run options' }).click();
  await options
    .getByLabel('Approval mode: at most')
    .selectOption({ label: 'No limit: each block’s own mode' });
  await options.getByRole('button', { name: 'Save' }).click();
  await expect(options.getByTestId('run-option-mode')).toHaveText(
    'No limit: each block’s own mode',
  );
  expect((await ticketOf()).ticket.runOptions).toBeUndefined();
  // The started run keeps its own snapshot.
  expect((await ticketOf()).currentRun?.approvalMode).toBe('manual');

  // ---- Stop all, then Re-run: the new run follows the project (Full auto).
  const firstRunId = first.currentRun?.id ?? '';
  await page.getByRole('button', { name: 'Stop all' }).click();
  const stopped = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/api/runs/${firstRunId}/stop`),
  );
  await page.getByRole('button', { name: 'Stop everything' }).click();
  expect((await stopped).status()).toBe(200);
  await page.getByRole('button', { name: 'Re-run', exact: true }).click();
  await expect
    .poll(async () => {
      const t = await ticketOf();
      return t.currentRun !== null && t.currentRun.id !== firstRunId
        ? (t.currentRun.approvalMode ?? null)
        : null;
    })
    .toBe('full-auto');
  await expect(page.getByTestId('run-approval-mode')).toHaveText('Approvals: Full auto');
  await page.goto(`/#/p/${/#\/p\/([^/]+)\//.exec(page.url())?.[1] ?? ''}/board`);
  await expect(
    page.getByTestId('ticket-card').filter({ hasText: 'NOTES-1' }).getByTestId('card-run-options'),
  ).toHaveCount(0);
});
