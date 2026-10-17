import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectAgentSetupDtoSchema, TicketBranchReviewDtoSchema } from '@acp/core/api';
import { dumpDatabase } from '../control/harness.js';
import {
  approveLatestPlan,
  bootWorkspace,
  createProject,
  createTicket,
  expectStatus,
  runDetail,
  startHelper,
  startTicket,
  submitPlan,
  waitFor,
  waitForRun,
  waitForTicket,
  worktreeOf,
  type WorkspaceServer,
} from '../workspace/harness.js';
import { git } from '../../workspace/helpers.js';

/*
 * RL-B: the review loop through the HTTP routes of the real server composition (`startServer`,
 * fake managed adapter, real git, real check runner): a new project starts on Auto edits; plan
 * approval makes the ticket branch; the helper's edit in its own worktree runs unasked; its change
 * is sealed, reviewed by a read-only review agent and merged by the lead into the ticket branch;
 * the owner merges the ticket branch into main once. The diff the agents saw is never stored or
 * logged (ADR-0021 §6).
 */

const DIFF_MARKER = 'RLB-DIFF-MARKER-LINE';

const open: WorkspaceServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

describe('RL-B review loop (real composition)', () => {
  it('new project → auto-edits → ticket branch → seal → review agent → lead merge → owner merge', async () => {
    const b = await bootWorkspace({ reviewLoop: true });
    open.push(b);
    const project = await createProject(b, 'shop');
    const setup = ProjectAgentSetupDtoSchema.parse(
      expectStatus(await b.get(`/api/projects/${project.id}/setup`), 200),
    );
    expect(setup.approvals).toEqual({ mode: 'auto-edits', commands: [] });
    const ticket = await createTicket(b, project.id, { title: 'Add a greeting' });
    const { runId, lead } = await startTicket(b, ticket.id);
    await submitPlan(b, ticket.id, lead, 'One helper writes the greeting');
    await approveLatestPlan(b, ticket.id);
    const withBranch = await waitForRun(
      b,
      runId,
      (r) => r.ticketBranch?.state === 'open',
      'the ticket branch',
    );
    expect(withBranch.approvalMode).toBe('auto-edits');
    const branch = withBranch.ticketBranch?.branch ?? '';
    expect(branch).toMatch(/^acp\/SHOP-1$/);

    const helper = await startHelper(b, runId, lead, 'Builder', 'Write hello.txt');
    const target = join(worktreeOf(helper), 'hello.txt');
    // Auto edits: an edit inside its own worktree runs without asking.
    expect(await helper.ask('Write', 'Write hello.txt', { file_path: target })).toEqual({
      allow: true,
    });
    writeFileSync(target, `hello\n${DIFF_MARKER}\n`);
    helper.finish('success');

    const reviewing = await waitForRun(
      b,
      runId,
      (r) => r.changes?.some((c) => c.state === 'reviewing') === true,
      'the change under review',
    );
    expect(reviewing.approvals[0]).toMatchObject({
      decidedBy: 'allowlist',
      allowRule: 'edit-in-own-worktree',
    });
    const reviewerId = reviewing.agents.find((a) => a.kind === 'reviewer')?.id ?? '';
    const reviewer = await waitFor(
      () => b.fake.agents.find((a) => a.id === reviewerId),
      'the review agent',
    );
    expect(reviewer.spec.reviewScope).toBe('change');
    expect(reviewer.spec.prompt).toContain(DIFF_MARKER);
    reviewer.started();
    await reviewer.callLead('submit_review', { verdict: 'approve', findings: 'Fine.' });
    reviewer.finish('success');
    await waitForRun(
      b,
      runId,
      (r) => r.changes?.[0]?.reviews[0]?.verdict === 'approve',
      'the verdict recorded',
    );
    expect(await lead.callLead('view_change', { agentId: helper.id })).toContain(DIFF_MARKER);
    expect(await lead.callLead('merge_change', { agentId: helper.id })).toContain(
      `Merged Builder into ${branch}`,
    );
    expect(existsSync(worktreeOf(helper))).toBe(false);
    await lead.callLead('request_review', {});
    await waitForRun(b, runId, (r) => r.status === 'REVIEW', 'the owner review');

    const review = TicketBranchReviewDtoSchema.parse(
      expectStatus(await b.get(`/api/runs/${runId}/ticket-branch`), 200),
    );
    expect(review.files.map((f) => f.path)).toEqual(['hello.txt']);
    // The checks on the tip start at REVIEW; under load they may still run (409 checks_running),
    // and the owner then clicks again.
    const merged = await waitFor(async () => {
      const res = await b.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
      const code = (res.body as { error?: { code?: string } } | null)?.error?.code;
      return res.status === 409 && code === 'checks_running' ? undefined : res;
    }, 'the tip checks to finish');
    expectStatus(merged, 200);
    await waitForTicket(b, ticket.id, (d) => d.ticket.status === 'DONE', 'the ticket done');
    expect(readFileSync(join(project.rootPath, 'hello.txt'), 'utf8')).toContain('hello');
    expect(git(project.rootPath, 'branch', '--list', branch).trim()).toBe('');
    expect((await runDetail(b, runId)).status).toBe('COMPLETED');

    // The diff reached the agents only: no response other than the diff routes, no log line and
    // no database row holds it.
    await b.close();
    expect(b.logs.some((l) => l.includes(DIFF_MARKER))).toBe(false);
    expect(dumpDatabase(b.databasePath)).not.toContain(DIFF_MARKER);
  }, 60_000);
});
