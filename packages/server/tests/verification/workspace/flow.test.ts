import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CheckRunDtoSchema,
  ErrorDtoSchema,
  HarnessStatusDtoSchema,
  ProjectAgentSetupDtoSchema,
  ReviewDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  type ProjectDto,
} from '@acp/core/api';
import { dumpDatabase, showFile } from '../control/harness.js';
import { git } from '../../workspace/helpers.js';
import {
  HARNESS_FILES,
  approveLatestPlan,
  boardOf,
  bootWorkspace,
  columnOf,
  createProject,
  createTicket,
  expectError,
  expectStatus,
  listenToStream,
  logLines,
  runDetail,
  setupBody,
  startHelper,
  startTicket,
  submitPlan,
  ticketDetail,
  waitFor,
  waitForRun,
  waitForTicket,
  worktreeOf,
  type WorkspaceServer,
} from './harness.js';

/*
 * P4-H: the Phase 4 owner flow end to end through the HTTP routes of the real server composition
 * (README §4.1, §4.2, §8 P4-H row): create a repository → set up the AI work environment → the
 * "Build the harness" ticket → plan → request changes (the comment reaches the lead) → plan v2 →
 * approve → helper → an allowlisted edit (inside its worktree: no question; outside: the owner is
 * asked) → review → merge → Done. The harness is now on main, so a second ticket's helper has its
 * check command pre-approved, the checks run on review, a failing required check blocks the merge
 * (`checks_failed`), a fix turns it green and the merge makes the ticket Done.
 *
 * Why two tickets: the checks always come from the project's checkout, never from a helper's
 * worktree (ADR-0017; an edited manifest is code under review and must not choose what runs). So
 * the harness ticket's own review has no checks; the next ticket is the first one checked.
 *
 * The raw tool input (`file_path`, `old_string`, `command`) carries markers; at the end no
 * response, log line or database row may contain them (ADR-0009, ADR-0013 amendment).
 */

const SECRET = {
  edit: 'P4H-SECRET-EDIT-INPUT',
  write: 'P4H-SECRET-WRITE-INPUT',
  outside: 'P4H-SECRET-OUTSIDE-INPUT',
  command: 'P4H-SECRET-COMMAND',
} as const;
const REQUEST_CHANGES = 'Also make the checks fast: under a minute in total.';

const open: WorkspaceServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

function writeIn(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/**
 * "Run checks" on one helper, on demand. While the checks that started on entering review are
 * still in flight the server answers `409 checks_running` (documented); the owner would retry.
 */
async function checkNow(b: WorkspaceServer, runId: string, agentRunId: string) {
  const res = await waitFor(async () => {
    const r = await b.post(`/api/runs/${runId}/agents/${agentRunId}/checks`, {});
    if (r.status === 409 && ErrorDtoSchema.parse(r.body).error.code === 'checks_running') {
      return undefined;
    }
    return r;
  }, 'the review checks to finish');
  return CheckRunDtoSchema.array().parse(expectStatus(res, 200));
}

/** Part 1: create the repository and set it up (README §4.1). */
async function createAndSetUp(b: WorkspaceServer): Promise<ProjectDto> {
  const project = await createProject(b, 'shop');
  expect(git(project.rootPath, 'branch', '--show-current').trim()).toBe('main');
  expect(showFile(project.rootPath, 'main', 'README.md')).toBe('# shop\n');

  const initial = ProjectAgentSetupDtoSchema.parse(
    expectStatus(await b.get(`/api/projects/${project.id}/setup`), 200),
  );
  expect(initial).toMatchObject({
    planFirst: true,
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    allowlist: { editInOwnWorktree: false, runHarnessChecks: false },
  });
  const saved = ProjectAgentSetupDtoSchema.parse(
    expectStatus(
      await b.put(
        `/api/projects/${project.id}/setup`,
        setupBody('SHOP', {
          maxConcurrentHelpers: 2,
          allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
          contextFiles: ['README.md'],
        }),
      ),
      200,
    ),
  );
  expect(saved).toMatchObject({
    projectKey: 'SHOP',
    allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
    contextFiles: ['README.md'],
  });

  const harness = HarnessStatusDtoSchema.parse(
    expectStatus(await b.get(`/api/projects/${project.id}/harness`), 200),
  );
  expect(harness.state).toBe('none');
  return project;
}

describe('P4-H full flow (fake Claude, real server, real check runner)', () => {
  it('create a repo → setup → harness ticket → plan, changes, v2, approve → allowlisted edit → merge; then a checked ticket: failing check blocks merge, a fix passes, merge → Done', async () => {
    const b = await bootWorkspace();
    open.push(b);
    const sse = listenToStream(b);

    const project = await createAndSetUp(b);

    // ---- Ticket 1: "Build the harness" (README §6.4) -------------------------------------------
    const harnessTicket = TicketDtoSchema.parse(
      expectStatus(await b.post(`/api/projects/${project.id}/harness/ticket`, {}), 201),
    );
    expect(harnessTicket).toMatchObject({
      key: 'SHOP-1',
      title: 'Build the harness',
      type: 'harness',
      status: 'BACKLOG',
      stage: 'BACKLOG',
    });
    expect(columnOf(await boardOf(b, project.id), harnessTicket.id)).toBe('BACKLOG');

    const t1 = harnessTicket.id;
    const { runId: run1, lead: lead1 } = await startTicket(b, t1);
    expect((await ticketDetail(b, t1)).ticket.stage).toBe('PLANNING');
    expect(columnOf(await boardOf(b, project.id), t1)).toBe('PLANNING');
    // The lead gets the ticket, the plan-first instruction and the chosen context file.
    expect(lead1.spec.prompt).toContain('SHOP-1');
    expect(lead1.spec.prompt).toContain('Build the harness');
    expect(lead1.spec.prompt).toContain('submit_plan');
    expect(lead1.spec.context).toContain('=== README.md ===');

    // Plan first: no helper before a plan is approved (planning, then plan review).
    await expect(
      lead1.callLead('start_agent', { role: 'Harness builder', task: 'x' }),
    ).rejects.toThrow(/Plan first/);

    let d = await submitPlan(b, t1, lead1, 'Add a unit-test check', [
      { title: 'Write the harness', role: 'Harness builder', detail: 'manifest and check' },
    ]);
    expect(d.plans).toMatchObject([{ version: 1, status: 'proposed' }]);
    const card = (await boardOf(b, project.id)).columns
      .find((c) => c.stage === 'PLAN_REVIEW')
      ?.tickets.find((t) => t.id === t1);
    expect(card).toMatchObject({ key: 'SHOP-1', needsYou: 1 });
    await expect(
      lead1.callLead('start_agent', { role: 'Harness builder', task: 'x' }),
    ).rejects.toThrow(/waiting for the owner/);
    expect(
      logLines(b.logs, 'lead tool refused').filter((l) => l['code'] === 'plan-not-approved'),
    ).toHaveLength(2);

    // Request changes: the comment is stored on the ticket and reaches the lead.
    const planV1 = d.plans[0]?.id ?? '';
    d = TicketDetailDtoSchema.parse(
      expectStatus(
        await b.post(`/api/tickets/${t1}/plans/${planV1}/decision`, {
          decision: 'request-changes',
          comment: REQUEST_CHANGES,
        }),
        200,
      ),
    );
    expect(d.ticket.stage).toBe('PLANNING');
    expect(d.plans[0]?.status).toBe('changes-requested');
    expect(d.comments).toMatchObject([{ author: 'owner', planId: planV1, body: REQUEST_CHANGES }]);
    await waitFor(
      () => (lead1.sent.some((m) => m.includes(REQUEST_CHANGES)) ? true : undefined),
      'the comment to reach the lead',
    );

    d = await submitPlan(b, t1, lead1, 'Add a fast unit-test check', [
      { title: 'Write the harness', role: 'Harness builder', detail: 'manifest and check' },
    ]);
    expect(d.plans.map((p) => [p.version, p.status])).toEqual([
      [1, 'changes-requested'],
      [2, 'proposed'],
    ]);
    d = await approveLatestPlan(b, t1);
    expect(d.ticket.stage).toBe('WORKING');
    expect(d.currentRun?.status).toBe('RUNNING');
    expect(d.plans.map((p) => p.status)).toEqual(['changes-requested', 'approved']);

    // Helpers start, each in its own worktree.
    const builder = await startHelper(b, run1, lead1, 'Harness builder', 'Write the harness');
    const wt1 = worktreeOf(builder);
    expect(wt1.startsWith(project.rootPath)).toBe(false);
    expect(existsSync(join(wt1, 'README.md'))).toBe(true);
    expect(columnOf(await boardOf(b, project.id), t1)).toBe('WORKING');

    // Allowlisted edit: inside its own worktree → approved at once, without asking the owner.
    await expect(
      builder.ask('Edit', 'Edit README.md', {
        file_path: join(wt1, 'README.md'),
        old_string: SECRET.edit,
        new_string: 'x',
      }),
    ).resolves.toEqual({ allow: true });
    writeFileSync(join(wt1, 'README.md'), '# shop\n\nRun `node check.mjs`.\n');
    expect(logLines(b.logs, 'approval allowed by the project allowlist')).toHaveLength(1);

    // A new file in a folder that does not exist yet resolves through its nearest existing
    // folder (RL-F): still inside its own worktree, so allowlisted too.
    await expect(
      builder.ask('Write', 'Write .acp/harness.json', {
        file_path: join(wt1, '.acp', 'harness.json'),
        content: SECRET.write,
      }),
    ).resolves.toEqual({ allow: true });
    expect(logLines(b.logs, 'approval allowed by the project allowlist')).toHaveLength(2);
    writeIn(wt1, HARNESS_FILES);

    // Outside its worktree (the owner's checkout): the owner is asked, and denies.
    const outside = builder.ask('Edit', 'Edit README.md', {
      file_path: join(project.rootPath, 'README.md'),
      old_string: SECRET.outside,
      new_string: 'y',
    });
    let run = await waitForRun(
      b,
      run1,
      (r) => r.approvals.filter((a) => a.status === 'pending').length === 1,
      'the outside edit to wait for the owner',
    );
    expect((await ticketDetail(b, t1)).ticket.stage).toBe('NEEDS_YOU');
    expect(columnOf(await boardOf(b, project.id), t1)).toBe('NEEDS_YOU');
    const outsideApproval = run.approvals.find((a) => a.status === 'pending');
    expectStatus(
      await b.post(`/api/approvals/${outsideApproval?.id ?? ''}`, { decision: 'deny' }),
      200,
    );
    await expect(outside).resolves.toMatchObject({ allow: false });
    run = await runDetail(b, run1);
    expect(run.approvals.map((a) => [a.summary, a.status])).toEqual([
      ['Edit README.md', 'approved'],
      ['Write .acp/harness.json', 'approved'],
      ['Edit README.md', 'denied'],
    ]);
    expect(showFile(project.rootPath, 'main', 'README.md')).toBe('# shop\n');

    // The helper finishes; the lead asks for review. The checks come from the project's checkout,
    // which has no harness yet: nothing runs, even on demand.
    builder.finish('success');
    await waitForRun(
      b,
      run1,
      (r) => r.agents.some((a) => a.id === builder.id && a.status === 'SUCCEEDED'),
      'the helper to finish',
    );
    await lead1.callLead('request_review', {});
    d = await waitForTicket(b, t1, (x) => x.ticket.stage === 'IN_REVIEW', 'ticket 1 in review');
    expect(d.checks).toEqual([]);
    expect(await checkNow(b, run1, builder.id)).toEqual([]);
    const review1 = ReviewDtoSchema.parse(
      expectStatus(await b.get(`/api/runs/${run1}/review`), 200),
    );
    expect(review1.agents[0]?.files.map((f) => f.path).sort()).toEqual([
      '.acp/harness.json',
      'README.md',
      'check.mjs',
    ]);
    expectStatus(
      await b.post(`/api/runs/${run1}/review`, { agentRunId: builder.id, action: 'merge' }),
      200,
    );
    d = await waitForTicket(b, t1, (x) => x.ticket.stage === 'DONE', 'ticket 1 done');
    expect(d.ticket.status).toBe('DONE');
    expect(d.currentRun?.status).toBe('COMPLETED');
    expect(showFile(project.rootPath, 'main', '.acp/harness.json')).toBe(
      HARNESS_FILES['.acp/harness.json'],
    );

    // "Run checks now" on main: the merged harness runs (and fails: nothing is fixed yet).
    const mainChecks = CheckRunDtoSchema.array().parse(
      expectStatus(await b.post(`/api/projects/${project.id}/harness/checks`, {}), 200),
    );
    expect(mainChecks).toMatchObject([
      { runId: null, agentRunId: null, checkId: 'test', status: 'failed', exitCode: 1 },
    ]);

    // ---- Ticket 2: a feature, now checked by the harness --------------------------------------
    const feature = await createTicket(b, project.id, {
      title: 'Add a greeting',
      type: 'feature',
      priority: 'high',
      labels: ['ui'],
      description: 'Show a greeting on the home page.',
    });
    expect(feature.key).toBe('SHOP-2');
    const t2 = feature.id;
    const { runId: run2, lead: lead2 } = await startTicket(b, t2);
    // The harness notes and checks are read again from the project's checkout.
    const harness = HarnessStatusDtoSchema.parse(
      expectStatus(await b.get(`/api/projects/${project.id}/harness`), 200),
    );
    expect(harness).toMatchObject({ state: 'ready', problems: [] });
    expect((await boardOf(b, project.id)).harness.state).toBe('ready');
    await submitPlan(b, t2, lead2, 'Add greeting.txt');
    await approveLatestPlan(b, t2);
    const greeter = await startHelper(b, run2, lead2, 'Builder', 'Add greeting.txt');
    const wt2 = worktreeOf(greeter);

    // A new file in an existing folder of its worktree: allowlisted.
    await expect(
      greeter.ask('Write', 'Write greeting.txt', {
        file_path: join(wt2, 'greeting.txt'),
        content: SECRET.write,
      }),
    ).resolves.toEqual({ allow: true });
    writeFileSync(join(wt2, 'greeting.txt'), 'hello\n');
    // The harness check command, exactly: allowlisted. Anything else: the owner is asked.
    await expect(
      greeter.ask('Bash', 'Run node check.mjs', { command: 'node check.mjs' }),
    ).resolves.toEqual({ allow: true });
    const other = greeter.ask('Bash', 'Run a command', {
      command: `node check.mjs; echo ${SECRET.command}`,
    });
    run = await waitForRun(
      b,
      run2,
      (r) => r.approvals.some((a) => a.status === 'pending'),
      'the other command to wait for the owner',
    );
    expectStatus(
      await b.post(
        `/api/approvals/${run.approvals.find((a) => a.status === 'pending')?.id ?? ''}`,
        { decision: 'deny' },
      ),
      200,
    );
    await expect(other).resolves.toMatchObject({ allow: false });
    expect(logLines(b.logs, 'approval allowed by the project allowlist')).toHaveLength(4);

    greeter.finish('success');
    await waitForRun(
      b,
      run2,
      (r) => r.agents.some((a) => a.id === greeter.id && a.status === 'SUCCEEDED'),
      'the helper to finish',
    );
    await lead2.callLead('request_review', {});

    // Entering review runs the checks in the helper's worktree: the required one fails.
    d = await waitForTicket(
      b,
      t2,
      (x) => x.ticket.stage === 'IN_REVIEW' && x.checks.length === 1,
      'ticket 2 checked',
    );
    expect(d.checks).toMatchObject([
      { runId: run2, agentRunId: greeter.id, checkId: 'test', status: 'failed', exitCode: 1 },
    ]);
    expect(columnOf(await boardOf(b, project.id), t2)).toBe('IN_REVIEW');
    expectError(
      await b.post(`/api/runs/${run2}/review`, { agentRunId: greeter.id, action: 'merge' }),
      409,
      'checks_failed',
    );
    expect(showFile(project.rootPath, 'main', 'greeting.txt')).toBeNull();

    // A fix in the worktree; the checks run again on demand and pass; the merge goes through.
    writeFileSync(join(wt2, 'fixed.txt'), 'ok\n');
    const rerun = await checkNow(b, run2, greeter.id);
    expect(rerun.map((c) => [c.checkId, c.status, c.exitCode])).toEqual([['test', 'passed', 0]]);
    expectStatus(
      await b.post(`/api/runs/${run2}/review`, { agentRunId: greeter.id, action: 'merge' }),
      200,
    );
    d = await waitForTicket(b, t2, (x) => x.ticket.stage === 'DONE', 'ticket 2 done');
    expect(d.ticket.status).toBe('DONE');
    expect(d.currentRun?.status).toBe('COMPLETED');
    expect(d.checks.map((c) => c.status)).toEqual(['failed', 'passed']);
    expect(showFile(project.rootPath, 'main', 'greeting.txt')).toBe('hello\n');
    expect(showFile(project.rootPath, 'main', 'fixed.txt')).toBe('ok\n');

    const board = await boardOf(b, project.id);
    expect(
      board.columns
        .find((c) => c.stage === 'DONE')
        ?.tickets.map((t) => t.key)
        .sort(),
    ).toEqual(['SHOP-1', 'SHOP-2']);
    expect(board.stats.runningRuns).toBe(0);
    expect(board.stats.needsYou).toBe(0);
    // History stays with the ticket.
    const history = await ticketDetail(b, t1);
    expect(history.runs).toHaveLength(1);
    expect(history.plans).toHaveLength(2);

    // The raw tool input was used for matching only: it is in no response, log line, SSE frame
    // or database row.
    const frames = await sse.stop();
    expect(frames).toContain('tickets-changed');
    await b.close();
    const database = dumpDatabase(b.databasePath);
    expect(b.responses.length).toBeGreaterThan(50);
    expect(b.logs.length).toBeGreaterThan(20);
    for (const marker of Object.values(SECRET)) {
      expect(b.responses.filter((r) => r.includes(marker))).toEqual([]);
      expect(b.logs.filter((l) => l.includes(marker))).toEqual([]);
      expect(frames).not.toContain(marker);
      expect(database).not.toContain(marker);
    }
  }, 120_000);
});
