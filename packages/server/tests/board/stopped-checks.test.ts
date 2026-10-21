import { describe, expect, it } from 'vitest';
import { LEGACY_STOPPED_CHECK_NOTES, type CheckRunStatus } from '@acp/core';
import { TicketBranchReviewDtoSchema } from '@acp/core/api';
import { createReviewLoopRepositories } from '@acp/db';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone, reviewers, run, type Board } from './loop-helpers.js';

/*
 * WG-F3: a check the app's shutdown stopped is not a result. The merge gates (the owner's merge of
 * the ticket branch, ADR-0021 §4, and the lead's merge_change, §3) count it as not run on its
 * commit and start the checks again; a real failure, error, time-out or skip still blocks. Rows
 * v0.1.0 stored for a shutdown (`error` or `skipped` with its note) count as not run too.
 * Synthetic repository, agents and check rows.
 */

/** A stored row standing for what a shutdown left: 0.2.0's own, or v0.1.0's. */
const STOPPED = {
  interrupted: {
    status: 'interrupted',
    outputTail: 'RUN src\n[Stopped when the app stopped, so there is no result. It runs again.]',
  },
  'legacy error': {
    status: 'error',
    outputTail: `RUN src\n[${LEGACY_STOPPED_CHECK_NOTES.error}]`,
  },
  'legacy skipped': {
    status: 'skipped',
    outputTail: `\n[${LEGACY_STOPPED_CHECK_NOTES.skipped}]`,
  },
} as const satisfies Record<string, { status: CheckRunStatus; outputTail: string }>;
type Stopped = keyof typeof STOPPED;

/** Stores one result of the required check on `commit`, newer than any before it. */
function storeCheck(
  s: Board,
  runId: string,
  agentRunId: string | null,
  commit: string,
  row: { status: CheckRunStatus; outputTail: string },
) {
  createReviewLoopRepositories(s.db, { now: () => s.clock.now }).checkCommits.insert({
    runId,
    agentRunId,
    projectId: s.project.id,
    checkId: 'test',
    name: 'Unit tests',
    required: true,
    status: row.status,
    exitCode: null,
    durationMs: 5,
    outputTail: row.outputTail,
    startedAt: s.clock.now.toISOString(),
    commit,
  });
}

/** The helper's change is sealed (its checks passed) and approved by the review agent. */
async function decisionReady(s: Board) {
  const { runId, lead } = await approved(s);
  const worker = await helperDone(s, lead, runId, {
    'src/theme.ts': 'export const dark = true;\n',
    'fixed.txt': 'ok\n',
  });
  const reviewer = reviewers(s)[0];
  if (reviewer === undefined) throw new Error('no change reviewer');
  reviewer.started();
  await s.settle();
  await reviewer.callLead('submit_review', { verdict: 'approve', findings: 'Fine. Synthetic.' });
  reviewer.finish('success');
  await s.settle();
  const sealed = (await run(s, runId)).changes?.find((c) => c.agentRunId === worker.id)?.headCommit;
  if (sealed === undefined || sealed === null) throw new Error('not sealed');
  return { runId, lead, worker, sealed };
}

/** The change is merged into the ticket branch and the run waits for the owner (REVIEW). */
async function atOwnerMerge(s: Board) {
  const ready = await decisionReady(s);
  expect(await ready.lead.callLead('merge_change', { agentId: ready.worker.id })).toContain(
    'Merged Builder into acp/WEBAPP-1',
  );
  await ready.lead.callLead('request_review', {});
  const detail = await run(s, ready.runId);
  expect(detail.status).toBe('REVIEW');
  const tip = detail.ticketBranch?.headCommit ?? '';
  return { ...ready, tip };
}

async function tipChecks(s: Board, runId: string) {
  await s.settle();
  return TicketBranchReviewDtoSchema.parse((await s.get(`/api/runs/${runId}/ticket-branch`)).body)
    .checks;
}

describe('checks the app stopped count as not run (WG-F3)', () => {
  it('the commit gate: stopped is missing; a failure, error, time-out or skip still fails', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, worker, sealed } = await decisionReady(s);
    const gate = () => s.checks.gateForCommit(runId, worker.id, sealed);
    expect((await gate()).passed).toBe(true);

    for (const name of Object.keys(STOPPED) as Stopped[]) {
      storeCheck(s, runId, worker.id, sealed, STOPPED[name]);
      expect(await gate(), name).toEqual({
        passed: false,
        failedRequired: [],
        missing: ['Unit tests'],
        running: false,
      });
    }
    const results: { status: CheckRunStatus; outputTail: string }[] = [
      { status: 'failed', outputTail: '1 test failed' },
      { status: 'error', outputTail: "\n[The command 'pnpm' was not found on PATH.]" },
      { status: 'timed-out', outputTail: '\n[Stopped after 30 s: the time limit was reached.]' },
      // A stopped run's checks (not the app's shutdown) keep blocking, as before.
      { status: 'error', outputTail: '\n[Stopped before it finished: the run was stopped.]' },
      { status: 'skipped', outputTail: '\n[Not run: the run was stopped.]' },
    ];
    for (const row of results) {
      storeCheck(s, runId, worker.id, sealed, row);
      expect(await gate(), row.outputTail).toMatchObject({
        passed: false,
        failedRequired: ['Unit tests'],
        missing: [],
      });
    }
  }, 60_000);

  for (const name of ['interrupted', 'legacy error'] as const) {
    it(`the owner's merge runs a tip check the app stopped (${name}) again, then merges`, async () => {
      const s = await setupBoard({ files: FILES });
      const { runId, tip } = await atOwnerMerge(s);
      expect(await tipChecks(s, runId)).toMatchObject([{ status: 'passed' }]);
      storeCheck(s, runId, null, tip, STOPPED[name]);

      const first = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
      expect(first.status).toBe(409);
      expect(first.body).toMatchObject({ error: { code: 'checks_running' } });
      expect(await tipChecks(s, runId)).toMatchObject([{ status: 'passed', commit: tip }]);
      const done = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
      expect(done.status).toBe(200);
      expect(TicketBranchReviewDtoSchema.parse(done.body).ticketBranch.state).toBe('merged');
    }, 60_000);
  }

  it("a real failure on the tip still refuses the owner's plain merge", async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, tip } = await atOwnerMerge(s);
    storeCheck(s, runId, null, tip, { status: 'failed', outputTail: '1 test failed' });
    const res = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'checks_failed' } });
    // Nothing ran again: the failure is the tip's result.
    expect(await tipChecks(s, runId)).toMatchObject([{ status: 'failed' }]);
  }, 60_000);

  for (const name of ['interrupted', 'legacy error'] as const) {
    it(`the lead's merge_change runs a change check the app stopped (${name}) again`, async () => {
      const s = await setupBoard({ files: FILES });
      const { runId, lead, worker, sealed } = await decisionReady(s);
      storeCheck(s, runId, worker.id, sealed, STOPPED[name]);

      const first = await lead.callLead('merge_change', { agentId: worker.id });
      expect(first).toContain("The required checks are running on Builder's change");
      await s.settle();
      expect(lead.sent.some((t) => t.startsWith("The required checks passed on Builder's"))).toBe(
        true,
      );
      expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain(
        'Merged Builder into acp/WEBAPP-1',
      );
    }, 60_000);
  }

  it("a real failure on the change still refuses the lead's merge_change", async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead, worker, sealed } = await decisionReady(s);
    storeCheck(s, runId, worker.id, sealed, { status: 'timed-out', outputTail: 'slow' });
    expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain(
      "Required checks failed on Builder's change: Unit tests",
    );
  }, 60_000);
});
