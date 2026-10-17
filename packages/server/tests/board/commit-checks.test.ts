import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkspaceManager } from '../../src/workspace/index.js';
import type { CommitChecksResult } from '../../src/board/checks.js';
import { PASSING_WHEN_FIXED, setupBoard } from './helpers.js';

/*
 * Checks per commit (ADR-0021, RL-B): results are stored with the commit they ran on, and the
 * merge gate counts only results on the commit being merged. Synthetic repository and checks.
 */

async function helperRun(s: Awaited<ReturnType<typeof setupBoard>>) {
  const { ticket } = await s.startTicket();
  await s.submitPlan();
  const plan = (await s.detail(ticket.id)).plans[0];
  await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
    decision: 'approve',
  });
  await s.fake.lead().callLead('start_agent', { role: 'Builder', task: 'Build the toggle' });
  await s.settle();
  const worker = s.fake.workers()[0];
  if (worker === undefined) throw new Error('no worker');
  worker.started();
  await s.settle();
  const runId = (await s.detail(ticket.id)).currentRun?.id ?? '';
  const ws = await s.control.agentWorkspace(runId, worker.id);
  if (ws === undefined) throw new Error('no workspace');
  const manager = createWorkspaceManager({ dataDir: s.dataDir, git: s.git });
  return { runId, worker, ws, manager };
}

describe('checks per commit (ADR-0021)', () => {
  it('stores results with their commit and gates on that commit only', async () => {
    const s = await setupBoard({ files: { 'README.md': 'x\n', ...PASSING_WHEN_FIXED } });
    const { runId, worker, ws, manager } = await helperRun(s);

    writeFileSync(join(ws.path, 'feature.txt'), 'on\n');
    const first = await manager.seal(ws);
    const failed = await s.checks.runOnCommit(runId, worker.id, first.headCommit);
    expect(failed).toMatchObject([{ status: 'failed', commit: first.headCommit }]);
    expect(await s.checks.gateForCommit(runId, worker.id, first.headCommit)).toEqual({
      passed: false,
      failedRequired: ['Unit tests'],
      missing: [],
      running: false,
    });

    // Unsealed edits: the checks would not run on the commit they are stored for.
    writeFileSync(join(ws.path, 'fixed.txt'), 'ok\n');
    await expect(s.checks.runOnCommit(runId, worker.id, first.headCommit)).rejects.toMatchObject({
      code: 'commit_changed',
    });

    const second = await manager.seal(ws);
    // No result on the new commit yet: missing, not passed, whatever ran before.
    expect(await s.checks.gateForCommit(runId, worker.id, second.headCommit)).toMatchObject({
      passed: false,
      missing: ['Unit tests'],
    });
    const done = new Promise<CommitChecksResult>((resolve) =>
      s.checks.startOnCommit(runId, worker.id, second.headCommit, resolve),
    );
    expect(await done).toEqual({ commit: second.headCommit, requiredPassed: true, failed: [] });
    expect((await s.checks.gateForCommit(runId, worker.id, second.headCommit)).passed).toBe(true);
    // The earlier commit's failure still stands for that commit.
    expect((await s.checks.gateForCommit(runId, worker.id, first.headCommit)).passed).toBe(false);

    // The ticket branch tip (agentRunId null) runs in a temporary checkout, then removes it.
    const tip = await s.checks.runOnCommit(runId, null, second.headCommit);
    expect(tip).toMatchObject([
      { agentRunId: null, runId, status: 'passed', commit: second.headCommit },
    ]);
    expect((await s.checks.gateForCommit(runId, null, second.headCommit)).passed).toBe(true);
    expect(readdirSync(join(s.dataDir, 'ticket-checkouts'))).toEqual([]);
    // The run's check list carries each result's commit.
    const listed = (await s.get(`/api/runs/${runId}/checks`)).body as { commit?: string }[];
    expect(listed.map((c) => c.commit)).toEqual([
      first.headCommit,
      second.headCommit,
      second.headCommit,
    ]);
  }, 60_000);

  it('a commit the checks cannot run on reports a closed gate, never a pass', async () => {
    const s = await setupBoard({ files: { 'README.md': 'x\n', ...PASSING_WHEN_FIXED } });
    const { runId, worker } = await helperRun(s);
    const result = await new Promise<CommitChecksResult>((resolve) =>
      s.checks.startOnCommit(runId, worker.id, 'f'.repeat(40), resolve),
    );
    expect(result).toEqual({
      commit: 'f'.repeat(40),
      requiredPassed: false,
      failed: ['The checks could not run'],
    });
    await expect(s.checks.runOnCommit(runId, worker.id, 'main')).rejects.toMatchObject({
      code: 'invalid_request',
    });
  }, 60_000);

  it('a project without required checks passes the gate', async () => {
    const s = await setupBoard();
    const { runId, worker, ws, manager } = await helperRun(s);
    writeFileSync(join(ws.path, 'a.txt'), 'a\n');
    const sealed = await manager.seal(ws);
    expect(await s.checks.gateForCommit(runId, worker.id, sealed.headCommit)).toEqual({
      passed: true,
      failedRequired: [],
      missing: [],
      running: false,
    });
  }, 60_000);
});
