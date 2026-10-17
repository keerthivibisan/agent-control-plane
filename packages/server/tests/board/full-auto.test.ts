import { existsSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL_AUTO_PLAN_LINE } from '@acp/orchestrator';
import { FULL_AUTO_DENIED_MESSAGE } from '../../src/control/full-auto.js';
import { setupBoard } from './helpers.js';
import { FILES, run, type Board } from './loop-helpers.js';

/*
 * Full auto through the routes (ADR-0022, RL-G): the plan is approved automatically; helpers get
 * the sandbox paths; whatever still reaches the gate runs only by the Auto edits rules and is otherwise
 * denied without asking the owner; the run's temp folder goes when the run ends. The fake managed
 * adapter plays every agent; git runs in a throwaway repository; the home folder is a temp one.
 */

const FULL_AUTO = { approvalMode: 'full-auto', reviewer: 'lead' } as const;

/** A Full auto ticket started; the lead has submitted its plan. */
async function planned(s: Board) {
  const ticket = await s.createTicket('Add dark mode');
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  expect((await s.post(`/api/tickets/${ticket.id}/start`, FULL_AUTO)).status).toBe(200);
  await s.settle();
  const lead = s.fake.lead();
  lead.started();
  await s.settle();
  const reply = await lead.callLead('submit_plan', {
    summary: 'Add a theme toggle',
    steps: [{ title: 'Build the toggle', role: 'Builder', detail: 'In settings' }],
  });
  await s.settle();
  const runId = (await s.detail(ticket.id)).currentRun?.id ?? '';
  return { ticket, lead, reply, runId };
}

async function workerOf(s: Board, lead: ReturnType<Board['fake']['lead']>) {
  expect(await lead.callLead('start_agent', { role: 'Builder', task: 'Build it' })).toContain(
    'Started agent',
  );
  await s.settle();
  const worker = s.fake.workers().at(-1);
  if (worker === undefined) throw new Error('no worker');
  worker.started();
  await s.settle();
  return worker;
}

describe('Full auto (ADR-0022)', () => {
  it('approves the plan automatically and records it on the ticket; the owner is not asked', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, lead, reply, runId } = await planned(s);
    expect(lead.spec.prompt).toContain(FULL_AUTO_PLAN_LINE);
    expect(reply).toContain('approved automatically (Full auto)');
    const detail = await s.detail(ticket.id);
    expect(detail.plans).toHaveLength(1);
    expect(detail.plans[0]).toMatchObject({ status: 'approved', decidedBy: 'auto', version: 1 });
    const runDetail = await run(s, runId);
    expect(runDetail.status).toBe('RUNNING');
    expect(runDetail.approvalMode).toBe('full-auto');
    expect(runDetail.pendingApprovals).toBe(0);
    expect(runDetail.ticketBranch?.branch).toBe('acp/WEBAPP-1');
    // Told only after the ticket branch exists (RL-B), and told to decide itself.
    expect(lead.sent.some((t) => t.startsWith('Plan v1 was approved automatically'))).toBe(true);
    expect(lead.sent.join('\n')).toContain('use ask_owner only when you truly cannot decide');
    // The lead itself keeps the default mode: no Full auto spec.
    expect(lead.spec.fullAuto).toBeUndefined();
  });

  it('keeps the marker across a restart (stored with the run snapshot)', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket } = await planned(s);
    await s.control.close();
    const again = await setupBoard({
      reopen: { dbPath: s.dbPath, repo: s.repo, dataDir: s.dataDir },
    });
    const detail = await again.detail(ticket.id);
    expect(detail.plans[0]).toMatchObject({ status: 'approved', decidedBy: 'auto' });
  });

  it('gives a helper its sandbox paths: the run temp folder and the deny-read list', async () => {
    const s = await setupBoard({ files: FILES });
    const { lead, runId } = await planned(s);
    const worker = await workerOf(s, lead);
    const tempDir = realpathSync(join(s.dataDir, 'sandbox-tmp', runId));
    expect(worker.spec.fullAuto?.tempDir).toBe(tempDir);
    expect(statSync(tempDir).mode & 0o777).toBe(0o700);
    const deny = worker.spec.fullAuto?.denyRead ?? [];
    for (const dir of ['.ssh', '.aws', '.gnupg', '.config/gh', '.netrc', '.docker', '.kube']) {
      expect(deny).toContain(join(s.homeDir, dir));
    }
    expect(deny).toContain(join(s.homeDir, '.claude'));
    expect(deny).toContain(s.dataDir);
    expect(deny).toContain(realpathSync(s.dataDir));
    expect(worker.spec.cwd.startsWith(realpathSync(s.dataDir))).toBe(true);
  });

  it('denies what reaches the gate without asking; the Auto edits rules still allow theirs', async () => {
    const s = await setupBoard({ files: FILES });
    const { lead, runId } = await planned(s);
    const worker = await workerOf(s, lead);
    const before = s.control.counters().diagnostics['full-auto-denied'] ?? 0;
    expect(await worker.ask('Bash', 'Bash curl', { command: 'curl https://example.test' })).toEqual(
      { allow: false, message: FULL_AUTO_DENIED_MESSAGE },
    );
    expect(await worker.ask('WebFetch', 'WebFetch example.test')).toEqual({
      allow: false,
      message: FULL_AUTO_DENIED_MESSAGE,
    });
    expect(s.control.counters().diagnostics['full-auto-denied']).toBe(before + 2);
    const wt = s.worktree(runId, worker.id);
    expect(await worker.ask('Edit', 'Edit a.ts', { file_path: join(wt, 'a.ts') })).toEqual({
      allow: true,
    });
    const detail = await run(s, runId);
    // Nothing waits for the owner; the allowed edit is recorded with its rule.
    expect(detail.approvals.map((a) => [a.status, a.decidedBy, a.allowRule ?? null])).toEqual([
      ['approved', 'allowlist', 'edit-in-own-worktree'],
    ]);
    expect(detail.agents.find((a) => a.id === worker.id)?.status).toBe('RUNNING');
  });

  it('a project command allowlist never overrides an escalation in Full auto', async () => {
    const s = await setupBoard({ files: FILES });
    const setup = {
      projectKey: 'WEBAPP',
      maxConcurrentHelpers: 3,
      maxDepth: 1,
      defaultBudgetTokensPerAgent: 100_000,
      model: null,
      approvals: { mode: 'full-auto', commands: [{ argv: ['npm'], match: 'prefix' }] },
      contextFiles: [],
    };
    expect((await s.send('put', `/api/projects/${s.project.id}/setup`, setup)).status).toBe(200);
    const { lead, runId } = await planned(s);
    const worker = await workerOf(s, lead);
    expect(await worker.ask('Bash', 'Bash npm test', { command: 'npm test' })).toEqual({
      allow: false,
      message: FULL_AUTO_DENIED_MESSAGE,
    });
    // An exact harness check is still allowed (the Auto edits rule).
    expect(await worker.ask('Bash', 'Bash node', { command: 'node check.mjs' })).toEqual({
      allow: true,
    });
    expect((await run(s, runId)).approvals.map((a) => a.allowRule ?? null)).toEqual([
      'run-harness-check',
    ]);
  });

  it('a helper whose protections were unavailable fails with a readable reason', async () => {
    const s = await setupBoard({ files: FILES });
    const { lead, runId } = await planned(s);
    const worker = await workerOf(s, lead);
    worker.emit({
      type: 'finished',
      outcome: 'error',
      reportedCostUsd: null,
      failure: 'sandbox-unavailable',
    });
    await s.settle();
    const detail = await run(s, runId);
    const agent = detail.agents.find((a) => a.id === worker.id);
    expect(agent?.status).toBe('FAILED');
    expect(agent?.latestActivity).toContain('operating-system sandbox is not available');
    expect(s.control.counters().diagnostics['full-auto-unavailable']).toBe(1);
    expect(lead.sent.some((t) => t.includes('could not start in Full auto'))).toBe(true);
  });

  it('removes the run’s temp folder when the run ends', async () => {
    const s = await setupBoard({ files: FILES });
    const { lead, runId } = await planned(s);
    await workerOf(s, lead);
    const tempDir = join(s.dataDir, 'sandbox-tmp', runId);
    expect(existsSync(tempDir)).toBe(true);
    expect((await s.post(`/api/runs/${runId}/stop`)).status).toBe(200);
    await s.settle();
    expect(['CANCELLED', 'CANCELLING']).toContain((await run(s, runId)).status);
    for (let i = 0; i < 50 && existsSync(tempDir); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await s.settle();
    }
    expect(existsSync(tempDir)).toBe(false);
  });

  it('other modes give helpers no Full auto spec and still ask the owner', async () => {
    const s = await setupBoard({ files: FILES });
    const ticket = await s.createTicket('Add dark mode');
    await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
    await s.post(`/api/tickets/${ticket.id}/start`, { approvalMode: 'auto', reviewer: 'lead' });
    await s.settle();
    const lead = s.fake.lead();
    lead.started();
    await s.settle();
    expect(lead.spec.prompt).not.toContain(FULL_AUTO_PLAN_LINE);
    await lead.callLead('submit_plan', {
      summary: 'Add a theme toggle',
      steps: [{ title: 'Build the toggle', role: 'Builder', detail: 'In settings' }],
    });
    const detail = await s.detail(ticket.id);
    expect(detail.currentRun?.status).toBe('PLAN_REVIEW');
    expect(detail.plans[0]?.decidedBy).toBeUndefined();
  });
});
