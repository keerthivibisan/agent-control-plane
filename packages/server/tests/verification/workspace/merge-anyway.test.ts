import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectDtoSchema, ReviewDtoSchema } from '@acp/core/api';
import { makeRepo } from '../../workspace/helpers.js';
import { showFile } from '../control/harness.js';
import {
  HARNESS_FILES,
  approveLatestPlan,
  bootWorkspace,
  createTicket,
  expectError,
  expectStatus,
  logLines,
  setupBody,
  startHelper,
  startTicket,
  submitPlan,
  waitForRun,
  waitForTicket,
  worktreeOf,
  type WorkspaceServer,
} from './harness.js';

/*
 * P4-H: "Merge anyway" (README §4.2 step 6, §6.3): only when a required check failed, only with a
 * reason, and the reason is kept as an owner comment on the ticket (ADR-0016: the owner's own
 * text). The project here is an existing folder added through `POST /api/projects` (the other
 * creation path of D1), with its harness already on main.
 */

const REASON = 'P4H-REASON the check is flaky on this machine; tracked in API-9.';

const open: WorkspaceServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

describe('P4-H merge anyway', () => {
  it('needs a failed required check and a reason; merges and stores the reason as a ticket comment', async () => {
    const b = await bootWorkspace();
    open.push(b);
    const repo = makeRepo({ 'README.md': 'api\n', ...HARNESS_FILES });
    const project = ProjectDtoSchema.parse(
      expectStatus(await b.post('/api/projects', { name: 'api', rootPath: repo }), 201),
    );
    expectStatus(await b.put(`/api/projects/${project.id}/setup`, setupBody('API')), 200);
    const ticket = await createTicket(b, project.id, { title: 'Add a health route' });
    const { runId, lead } = await startTicket(b, ticket.id);
    await submitPlan(b, ticket.id, lead, 'One route');
    await approveLatestPlan(b, ticket.id);
    const helper = await startHelper(b, runId, lead, 'Builder', 'Add the route');
    writeFileSync(join(worktreeOf(helper), 'health.txt'), 'ok\n');
    helper.finish('success');
    await waitForRun(
      b,
      runId,
      (r) => r.agents.some((a) => a.id === helper.id && a.status === 'SUCCEEDED'),
      'the helper to finish',
    );
    await lead.callLead('request_review', {});
    let d = await waitForTicket(
      b,
      ticket.id,
      (x) => x.ticket.stage === 'IN_REVIEW' && x.checks.length === 1,
      'the review checks',
    );
    expect(d.checks.map((c) => [c.name, c.required, c.status])).toEqual([
      ['Unit tests', true, 'failed'],
    ]);

    const review = (body: Record<string, unknown>) =>
      b.post(`/api/runs/${runId}/review`, { agentRunId: helper.id, ...body });
    expectError(await review({ action: 'merge' }), 409, 'checks_failed');
    expectError(await review({ action: 'merge-anyway' }), 400, 'invalid_request');
    expectError(await review({ action: 'merge-anyway', reason: '' }), 400, 'invalid_request');
    expectError(await review({ action: 'merge-anyway', reason: '   ' }), 400, 'invalid_request');
    expect(showFile(repo, 'main', 'health.txt')).toBeNull();
    expect(d.comments).toEqual([]);

    const merged = ReviewDtoSchema.parse(
      expectStatus(await review({ action: 'merge-anyway', reason: REASON }), 200),
    );
    expect(merged.agents.find((a) => a.agentRunId === helper.id)?.state).toBe('merged');
    expect(showFile(repo, 'main', 'health.txt')).toBe('ok\n');
    d = await waitForTicket(b, ticket.id, (x) => x.ticket.stage === 'DONE', 'the ticket done');
    expect(d.ticket.status).toBe('DONE');
    expect(d.comments).toHaveLength(1);
    expect(d.comments[0]).toMatchObject({ author: 'owner', runId, planId: null });
    expect(d.comments[0]?.body).toContain('Unit tests');
    expect(d.comments[0]?.body).toContain(`Reason: ${REASON}`);
    // The event is logged without the owner's text.
    expect(logLines(b.logs, 'merged anyway')).toHaveLength(1);
    expect(b.logs.filter((l) => l.includes('P4H-REASON'))).toEqual([]);
  }, 60_000);

  it('is unavailable when no required check failed', async () => {
    const b = await bootWorkspace();
    open.push(b);
    const repo = makeRepo({ 'README.md': 'api\n', ...HARNESS_FILES, 'fixed.txt': 'ok\n' });
    const project = ProjectDtoSchema.parse(
      expectStatus(await b.post('/api/projects', { name: 'api', rootPath: repo }), 201),
    );
    const ticket = await createTicket(b, project.id, { title: 'Passing change' });
    const { runId, lead } = await startTicket(b, ticket.id);
    await submitPlan(b, ticket.id, lead, 'One change');
    await approveLatestPlan(b, ticket.id);
    const helper = await startHelper(b, runId, lead, 'Builder', 'Change it');
    writeFileSync(join(worktreeOf(helper), 'change.txt'), 'x\n');
    helper.finish('success');
    await waitForRun(
      b,
      runId,
      (r) => r.agents.some((a) => a.id === helper.id && a.status === 'SUCCEEDED'),
      'the helper to finish',
    );
    await lead.callLead('request_review', {});
    await waitForTicket(
      b,
      ticket.id,
      (x) => x.checks.length === 1 && x.checks[0]?.status === 'passed',
      'a passing check',
    );
    expectError(
      await b.post(`/api/runs/${runId}/review`, {
        agentRunId: helper.id,
        action: 'merge-anyway',
        reason: 'not needed',
      }),
      409,
      'merge_anyway_unavailable',
    );
    expectStatus(
      await b.post(`/api/runs/${runId}/review`, { agentRunId: helper.id, action: 'merge' }),
      200,
    );
    await waitForTicket(b, ticket.id, (x) => x.ticket.stage === 'DONE', 'the ticket done');
  }, 60_000);
});
