import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TicketBranchReviewDtoSchema } from '@acp/core/api';
import { git, tempDir } from '../../workspace/helpers.js';
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

/*
 * WG-F3 through the real server composition (`startServer`, fake managed adapter, real git, real
 * check runner): the app is stopped while the ticket branch tip's checks run (for example to
 * upgrade). The check it stopped is stored as `interrupted`, not as a failure, so after the restart
 * the owner's merge starts the checks again (409 `checks_running`, as for a tip with no checks)
 * and goes through once they pass. Before WG-F3 it was refused with `checks_failed`.
 * Synthetic project and check; the check waits while a hold file exists, so the test decides
 * when the app stops.
 */

const open: WorkspaceServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

/** One required check: hangs while `hold` exists (after writing `started`), else needs fixed.txt. */
function holdingHarness(hold: string, started: string): Record<string, string> {
  return {
    '.acp/harness.json': `${JSON.stringify({
      version: 1,
      description: 'Synthetic WG-F3 harness',
      checks: [
        {
          id: 'test',
          name: 'Unit tests',
          argv: ['node', 'check.mjs'],
          timeoutSec: 60,
          required: true,
        },
      ],
    })}\n`,
    'check.mjs': [
      "import { existsSync, writeFileSync } from 'node:fs';",
      `if (existsSync(${JSON.stringify(hold)})) {`,
      `  writeFileSync(${JSON.stringify(started)}, 'started');`,
      '  setInterval(() => {}, 1000);',
      "} else process.exit(existsSync('fixed.txt') ? 0 : 1);",
      '',
    ].join('\n'),
  };
}

describe('WG-F3: checks stopped by a restart run again (real composition)', () => {
  it('stop the app while the tip checks run → restart → the owner merge reruns them, then merges', async () => {
    const dataDir = tempDir('acp-f3-data-');
    const claudeDir = tempDir('acp-f3-claude-');
    const control = tempDir('acp-f3-hold-');
    const hold = join(control, 'hold');
    const started = join(control, 'started');
    const logs: string[] = [];

    const b1 = await bootWorkspace({ reviewLoop: true, dataDir, claudeDir, logs });
    open.push(b1);
    const project = await createProject(b1, 'shop');
    for (const [path, content] of Object.entries(holdingHarness(hold, started))) {
      mkdirSync(dirname(join(project.rootPath, path)), { recursive: true });
      writeFileSync(join(project.rootPath, path), content);
    }
    git(project.rootPath, 'add', '--all');
    git(project.rootPath, 'commit', '--quiet', '-m', 'Add the synthetic harness');

    const ticket = await createTicket(b1, project.id, { title: 'Add a greeting' });
    const { runId, lead } = await startTicket(b1, ticket.id);
    await submitPlan(b1, ticket.id, lead, 'One helper writes the greeting');
    await approveLatestPlan(b1, ticket.id);
    await waitForRun(b1, runId, (r) => r.ticketBranch?.state === 'open', 'the ticket branch');
    const helper = await startHelper(b1, runId, lead, 'Builder', 'Write hello.txt');
    writeFileSync(join(worktreeOf(helper), 'hello.txt'), 'hello\n');
    writeFileSync(join(worktreeOf(helper), 'fixed.txt'), 'ok\n');
    helper.finish('success');
    const reviewing = await waitForRun(
      b1,
      runId,
      (r) => r.changes?.some((c) => c.state === 'reviewing') === true,
      'the change under review',
    );
    const reviewerId = reviewing.agents.find((a) => a.kind === 'reviewer')?.id ?? '';
    const reviewer = await waitFor(
      () => b1.fake.agents.find((a) => a.id === reviewerId),
      'the review agent',
    );
    reviewer.started();
    await reviewer.callLead('submit_review', { verdict: 'approve', findings: 'Fine.' });
    reviewer.finish('success');
    await waitForRun(
      b1,
      runId,
      (r) => r.changes?.[0]?.reviews[0]?.verdict === 'approve',
      'the verdict',
    );
    // The change's own checks may still run under load: the lead calls again once told.
    await waitFor(async () => {
      const reply = await lead.callLead('merge_change', { agentId: helper.id });
      return reply.includes('Merged Builder into') ? reply : undefined;
    }, 'the lead merge');

    // From now on the check hangs: the tip's checks start at REVIEW and the app stops meanwhile.
    writeFileSync(hold, 'hold');
    await lead.callLead('request_review', {});
    await waitForRun(b1, runId, (r) => r.status === 'REVIEW', 'the owner review');
    await waitFor(() => (existsSync(started) ? true : undefined), 'the tip check running');
    await b1.close();
    rmSync(hold);

    const b2 = await bootWorkspace({ reviewLoop: true, dataDir, claudeDir, logs });
    open.push(b2);
    const stopped = TicketBranchReviewDtoSchema.parse(
      expectStatus(await b2.get(`/api/runs/${runId}/ticket-branch`), 200),
    );
    expect(stopped.checks).toMatchObject([
      { checkId: 'test', status: 'interrupted', agentRunId: null },
    ]);
    expect(stopped.checks[0]?.outputTail).toContain('Stopped when the app stopped');

    // The first merge starts the checks again (not checks_failed); the owner clicks again.
    const first = await b2.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
    expect(first.status).toBe(409);
    expect((first.body as { error?: { code?: string } }).error?.code).toBe('checks_running');
    const merged = await waitFor(async () => {
      const res = await b2.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
      const code = (res.body as { error?: { code?: string } } | null)?.error?.code;
      return res.status === 409 && code === 'checks_running' ? undefined : res;
    }, 'the rerun tip checks');
    expectStatus(merged, 200);
    const after = TicketBranchReviewDtoSchema.parse(
      expectStatus(await b2.get(`/api/runs/${runId}/ticket-branch`), 200),
    );
    expect(after.ticketBranch.state).toBe('merged');
    expect(after.checks).toMatchObject([{ checkId: 'test', status: 'passed' }]);
    await waitForTicket(b2, ticket.id, (d) => d.ticket.status === 'DONE', 'the ticket done');
    expect(readFileSync(join(project.rootPath, 'hello.txt'), 'utf8')).toBe('hello\n');
    expect((await runDetail(b2, runId)).status).toBe('COMPLETED');
  }, 90_000);
});
