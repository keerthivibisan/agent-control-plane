// Synthetic temp git repo and the scripted fake adapter only (R-G). Never the Agent SDK.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApprovalDtoSchema, type RunDetailDto } from '@acp/core/api';
import { createRedesignRepositories } from '@acp/db';
import { createRunStore } from '../../src/control/store.js';
import { BOARD_NOW, setupBoard } from '../board/helpers.js';

/*
 * Migration 0004 audit fields (README §6 "Persist audit fields"): who decided an approval and the
 * run's limits snapshot are written with the run state and come back when a run is reloaded
 * (restart path). P4-D kept both in memory only.
 */

type Board = Awaited<ReturnType<typeof setupBoard>>;

async function setLimits(s: Board, maxConcurrentHelpers: number, editInOwnWorktree: boolean) {
  const current = (await s.get(`/api/projects/${s.project.id}/setup`)).body as Record<
    string,
    unknown
  >;
  const res = await s.send('put', `/api/projects/${s.project.id}/setup`, {
    projectKey: current['projectKey'],
    maxConcurrentHelpers,
    maxDepth: 2,
    defaultBudgetTokensPerAgent: current['defaultBudgetTokensPerAgent'],
    model: null,
    allowlist: { editInOwnWorktree, runHarnessChecks: false },
    contextFiles: [],
  });
  expect(res.status).toBe(200);
}

/** A started ticket with an approved plan and one running helper. */
async function withHelper(s: Board) {
  const { ticket } = await s.startTicket();
  await s.submitPlan();
  const plan = (await s.detail(ticket.id)).plans[0];
  await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
    decision: 'approve',
  });
  await s.settle();
  await s.fake.lead().callLead('start_agent', { role: 'Builder', task: 'Build the toggle' });
  await s.settle();
  const worker = s.fake.workers()[0];
  if (worker === undefined) throw new Error('no worker');
  worker.started();
  await s.settle();
  const runId = (await s.detail(ticket.id)).currentRun?.id ?? '';
  return { ticket, runId, worker };
}

async function run(s: Board, runId: string): Promise<RunDetailDto> {
  await s.settle();
  const res = await s.get(`/api/runs/${runId}`);
  expect(res.status).toBe(200);
  return res.body as RunDetailDto;
}

describe('approval decidedBy and run limits persistence (R-G)', () => {
  it('restores managed usage observations so replayed messages remain deduplicated', async () => {
    const s = await setupBoard();
    const { runId, worker } = await withHelper(s);
    worker.usage('message-1', { input: 50, output: 10, cacheCreation: 0, cacheRead: 0 });
    worker.usage('__proto__', { input: 2, output: 3, cacheCreation: 0, cacheRead: 0 });
    await s.settle();
    const loaded = createRunStore({ db: s.db, now: () => BOARD_NOW }).load(runId);
    expect(loaded?.durableBudgetLedger).toBe(true);
    expect(loaded?.ledger.entries['message-1']).toMatchObject({
      messageId: 'message-1',
      agentRunIds: [worker.id],
      tokens: { input: 50, output: 10 },
    });
    expect(Object.hasOwn(loaded?.ledger.entries ?? {}, '__proto__')).toBe(true);
    expect(loaded?.ledger.entries['__proto__']?.tokens.output).toBe(3);
  });
  it('stores the owner as decider and the limits snapshot, and reloads both', async () => {
    const s = await setupBoard({ legacyRuns: true });
    await setLimits(s, 2, false);
    const { runId, worker } = await withHelper(s);
    const audit = createRedesignRepositories(s.db).runAudit;
    expect(audit.getRunSnapshot(runId)).toMatchObject({ maxConcurrentHelpers: 2, maxDepth: 2 });

    const pending = worker.ask('Write', 'Write src/theme.ts');
    await s.settle();
    const approval = (await run(s, runId)).approvals[0];
    expect(approval).toMatchObject({ status: 'pending', decidedBy: null });
    expect(audit.approvalDecidersForRun(runId).get(approval?.id ?? '')).toBeNull();

    const res = await s.post(`/api/approvals/${approval?.id ?? ''}`, { decision: 'approve' });
    expect(res.status).toBe(200);
    expect(ApprovalDtoSchema.parse(res.body)).toMatchObject({
      status: 'approved',
      decidedBy: 'owner',
    });
    expect(await pending).toEqual({ allow: true });
    expect(audit.approvalDecidersForRun(runId).get(approval?.id ?? '')).toBe('owner');

    // Restart path: a run rebuilt from the database keeps its decider and limits.
    const loaded = createRunStore({ db: s.db, now: () => BOARD_NOW }).load(runId);
    expect(loaded?.limits).toEqual({ maxConcurrentHelpers: 2, maxDepth: 2 });
    expect(loaded?.approvals.map((a) => a.decidedBy)).toEqual(['owner']);
  });

  it('stores the allowlist as decider for an auto-approved edit in the helper worktree', async () => {
    const s = await setupBoard({ legacyRuns: true });
    await setLimits(s, 3, true);
    const { runId, worker } = await withHelper(s);
    const decision = await worker.ask('Edit', 'Edit src/app.ts', {
      file_path: join(s.worktree(runId, worker.id), 'src', 'app.ts'),
      old_string: 'export {};',
      new_string: 'export const a = 1;',
    });
    expect(decision).toEqual({ allow: true });
    const approvals = (await run(s, runId)).approvals;
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ status: 'approved', decidedBy: 'allowlist' });
    const audit = createRedesignRepositories(s.db).runAudit;
    expect([...audit.approvalDecidersForRun(runId).values()]).toEqual(['allowlist']);
  });
});
