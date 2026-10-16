import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReviewDtoSchema } from '@acp/core/api';
import { setupControl } from './helpers.js';

/*
 * Restart (ADR-0013 §7): a server that stops while agents work never relaunches them. The new
 * process marks live work NEEDS_REVIEW, expires open approvals, keeps the worktrees the database
 * references and removes orphans; the owner then reviews what is left.
 */

describe('restart', () => {
  it('live run → NEEDS_REVIEW, nothing relaunched, orphans cleaned, work still reviewable', async () => {
    const first = await setupControl();
    const runId = (await first.startRun()).id;
    first.fake.lead().started();
    const worker = await first.startWorker('Builder', 'Write a file');
    worker.started();
    writeFileSync(join(first.worktree(runId, worker.id), 'made.txt'), 'by the agent\n');
    void worker.ask('Edit', 'Edit made.txt');
    await first.control.idle();
    const orphan = join(first.dataDir, 'worktrees', 'old-run', 'old-agent');
    mkdirSync(orphan, { recursive: true });

    // "Crash": the first process is never closed cleanly; a second one opens the same files.
    const second = await setupControl({
      dbPath: first.dbPath,
      dataDir: first.dataDir,
      repo: first.repo,
    });
    const run = await second.detail(runId);
    expect(run.status).toBe('NEEDS_REVIEW');
    expect(run.agents.map((a) => [a.kind, a.status])).toEqual([
      ['lead', 'NEEDS_REVIEW'],
      ['worker', 'NEEDS_REVIEW'],
    ]);
    expect(run.approvals.map((a) => a.status)).toEqual(['expired']);
    expect(second.fake.agents).toEqual([]);
    expect(existsSync(second.worktree(runId, worker.id))).toBe(true);
    expect(existsSync(orphan)).toBe(false);

    // ADR-0020: the owner's message brings the ended lead back for one answers-only turn. It is an
    // owner action, not a relaunch, and the run stays NEEDS_REVIEW.
    const chat = await second.post(`/api/runs/${runId}/chat`, { text: 'hi' });
    expect(chat.status).toBe(200);
    expect(chat.body).toMatchObject({ role: 'owner', text: 'hi', followUp: true });
    await second.control.idle();
    const followUp = second.fake.agents[0];
    expect(followUp?.spec.followUp).toEqual({ resumeSessionId: `sess-${first.fake.lead().id}` });
    followUp?.finish();
    expect((await second.detail(runId)).status).toBe('NEEDS_REVIEW');

    const review = ReviewDtoSchema.parse((await second.get(`/api/runs/${runId}/review`)).body);
    expect(review.agents[0]?.files.map((f) => f.path)).toEqual(['made.txt']);
    const res = await second.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'merge',
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(second.repo, 'made.txt'))).toBe(true);
    expect((await second.detail(runId)).status).toBe('COMPLETED');
  });

  it('a run that was being stopped finishes as CANCELLED', async () => {
    const first = await setupControl({ overrides: { cancelGraceMs: 50 } });
    const runId = (await first.startRun()).id;
    first.fake.lead().started();
    await first.control.idle();
    // Make the lead ignore abort, so the run stays CANCELLING when the process "dies".
    first.fake.lead().handle.abort = () => {};
    await first.post(`/api/runs/${runId}/stop`);
    expect((await first.detail(runId)).status).toBe('CANCELLING');
    const second = await setupControl({
      dbPath: first.dbPath,
      dataDir: first.dataDir,
      repo: first.repo,
    });
    expect((await second.detail(runId)).status).toBe('CANCELLED');
  });
});

describe('content minimization (ADR-0009, ADR-0015)', () => {
  it('stores no worker conversation content: only owner chat, lead replies, tasks and summaries', async () => {
    const s = await setupControl();
    const runId = (await s.startRun('OWNER-CHAT')).id;
    const lead = s.fake.lead();
    lead.started();
    lead.emit({ type: 'lead-text', text: 'LEAD-REPLY' });
    const worker = await s.startWorker('Builder', 'WORKER-TASK');
    worker.started();
    worker.emit({ type: 'activity', summary: 'WORKER-SECRET activity' });
    // A worker's text is never chat (the adapter never emits it; the engine drops it anyway).
    worker.emit({ type: 'lead-text', text: 'WORKER-SECRET text' });
    await lead.callLead('message_agent', { agentId: worker.id, text: 'WORKER-SECRET from lead' });
    await s.post(`/api/runs/${runId}/agents/${worker.id}/message`, {
      text: 'WORKER-SECRET from owner',
    });
    const pending = worker.ask('Edit', 'Edit src/app.ts');
    const approval = (await s.detail(runId)).approvals[0];
    await s.post(`/api/approvals/${approval?.id ?? ''}`, {
      decision: 'deny',
      message: 'WORKER-SECRET deny note',
    });
    await pending;
    worker.finish('success');
    await s.control.idle();
    expect(s.control.counters().diagnostics['worker-text-dropped']).toBe(1);

    const tables = s.db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .pluck()
      .all() as string[];
    const dump = tables
      .map((t) => JSON.stringify(s.db.connection.prepare(`SELECT * FROM "${t}"`).all()))
      .join('\n');
    expect(dump).not.toContain('WORKER-SECRET');
    // What ADR-0015 does allow is there.
    for (const kept of ['OWNER-CHAT', 'LEAD-REPLY', 'WORKER-TASK', 'Edit src/app.ts']) {
      expect(dump).toContain(kept);
    }
    // The activity line lives in memory only, for the panel.
    expect((await s.detail(runId)).agents[1]?.latestActivity).toBe('WORKER-SECRET activity');
  });
});
