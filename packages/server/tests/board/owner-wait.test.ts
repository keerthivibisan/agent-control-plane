import { describe, expect, it } from 'vitest';
import { createOrchestrationRepositories } from '@acp/db';
import { BOARD_NOW, setupBoard } from './helpers.js';
import { FILES, approved, helperDone, run } from './loop-helpers.js';

/*
 * P-D (v0.3.1): a helper's change the lead escalated to the owner (`ask_owner`) must still be
 * decidable, and reworkable in the helper's own session, however late the owner answers. The run
 * timeout (ADR-0013 §3) counts from the run's start, so before the fix a run that was near its
 * deadline when the lead asked was timed out while it only waited for the owner: every agent
 * ended, the helper with it, and the owner had to cancel and redo the ticket.
 * Synthetic repository and agents; the clock is injected and the sweep is called by hand.
 */

const HOUR = 60 * 60 * 1000;
const at = (ms: number) => new Date(BOARD_NOW.getTime() + ms);

describe('a change waiting for the owner (P-D)', () => {
  it('survives the run timeout while only the owner is awaited; the owner reworks it late', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead } = await approved(s, { reviewer: 'lead' });
    // The helpers worked for most of the run's 2 hours before the lead asked the owner.
    s.clock.now = at(1.5 * HOUR);
    const worker = await helperDone(s, lead, runId, { 'a.txt': 'first\n', 'fixed.txt': 'ok\n' });
    await lead.callLead('ask_owner', { agentId: worker.id, question: 'Keep a.txt? Synthetic.' });
    expect((await run(s, runId)).changes?.[0]?.state).toBe('needs-owner');

    // The owner answers 3 hours later: well past the run's 2-hour deadline from its start.
    s.clock.now = at(4.5 * HOUR);
    s.control.sweep();
    let detail = await run(s, runId);
    expect(detail.status).toBe('RUNNING');
    expect(detail.agents.find((a) => a.id === worker.id)?.status).toBe('AWAITING_REVIEW');
    expect(detail.agents.find((a) => a.kind === 'lead')?.status).toBe('RUNNING');

    // The owner sends it back: the same helper resumes its own session in its own worktree.
    const owner = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'rework',
      comment: 'Drop a.txt. Synthetic.',
    });
    expect(owner.status).toBe(200);
    await s.settle();
    const again = s.fake.byId(worker.id);
    expect(again).not.toBe(worker);
    expect(again.spec.rework).toEqual({ resumeSessionId: `sess-${worker.id}` });
    expect(again.spec.cwd).toBe(worker.spec.cwd);
    again.started(`sess-${worker.id}`);
    await s.settle();

    // The wait did not count: 20 minutes into the rework the run is still within its 2 hours.
    s.clock.now = at(4.5 * HOUR + 20 * 60 * 1000);
    s.control.sweep();
    detail = await run(s, runId);
    expect(detail.status).toBe('RUNNING');
    expect(detail.agents.find((a) => a.id === worker.id)?.status).toBe('RUNNING');
    again.finish('success');
    await s.settle();
    expect((await run(s, runId)).changes?.[0]).toMatchObject({ reworkRounds: 1 });
  }, 60_000);

  it('a late merge keeps the run and its lead going; the lead hears of it', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead } = await approved(s, { reviewer: 'lead' });
    s.clock.now = at(1.9 * HOUR);
    const worker = await helperDone(s, lead, runId, { 'a.txt': 'first\n', 'fixed.txt': 'ok\n' });
    await lead.callLead('ask_owner', { agentId: worker.id, question: 'Merge it? Synthetic.' });

    s.clock.now = at(5 * HOUR);
    s.control.sweep();
    const merged = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'merge',
    });
    expect(merged.status).toBe(200);
    await s.settle();
    expect(lead.sent.some((t) => t.startsWith('The owner decided: Merged Builder'))).toBe(true);
    // The next sweeps (every 15 s) leave the run with its lead, which can hand over.
    s.clock.now = at(5 * HOUR + 15_000);
    s.control.sweep();
    const detail = await run(s, runId);
    expect(detail.status).toBe('RUNNING');
    expect(detail.agents.find((a) => a.kind === 'lead')?.status).toBe('RUNNING');
    expect(detail.changes?.[0]?.state).toBe('merged');
    expect(await lead.callLead('request_review', {})).toBeTruthy();
    expect((await run(s, runId)).status).toBe('REVIEW');
  }, 60_000);

  it('adversarial: the owner answers a day later and the helper session is gone', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s, { reviewer: 'lead' });
    const worker = await helperDone(s, lead, runId, { 'a.txt': 'first\n', 'fixed.txt': 'ok\n' });
    await lead.callLead('ask_owner', { agentId: worker.id, question: 'Keep a.txt? Synthetic.' });
    s.clock.now = at(26 * HOUR);
    s.control.sweep();
    expect((await run(s, runId)).status).toBe('RUNNING');
    const owner = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'rework',
      comment: 'Drop a.txt. Synthetic.',
    });
    expect(owner.status).toBe(200);
    await s.settle();
    // The adapter could not resume the saved session and started a new one in the same folder.
    const again = s.fake.byId(worker.id);
    expect(again.spec.rework).toEqual({ resumeSessionId: `sess-${worker.id}` });
    again.started('sess-new-session');
    await s.settle();
    const detail = await run(s, runId);
    expect(detail.status).toBe('RUNNING');
    expect(detail.agents.find((a) => a.id === worker.id)).toMatchObject({
      status: 'RUNNING',
      latestActivity: 'Started a new session: its earlier conversation could not be continued',
    });
    expect(lead.sent.some((t) => t.includes('could not continue its earlier conversation'))).toBe(
      true,
    );
    // The owner reads it on the ticket; the new session is linked to the same agent run.
    const comments = (await s.detail(ticket.id)).comments;
    expect(comments.filter((c) => c.author === 'app').map((c) => c.body)).toContain(
      'Builder could not continue its earlier conversation, so it reworks its change in a new session, in the same folder with its earlier work.',
    );
    const links = createOrchestrationRepositories(s.db).agentRunSessions.listForAgentRun(worker.id);
    expect(links.map((l) => [l.providerSessionId, l.relation])).toEqual([
      [`sess-${worker.id}`, 'primary'],
      ['sess-new-session', 'retry'],
    ]);

    // Its change comes back; the next rework resumes the new session.
    again.finish('success');
    await s.settle();
    await lead.callLead('request_rework', { agentId: worker.id, comments: 'Once more.' });
    await s.settle();
    expect(s.fake.byId(worker.id).spec.rework).toEqual({ resumeSessionId: 'sess-new-session' });
  }, 60_000);

  it('still times out a run whose helpers work past the deadline', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead } = await approved(s, { reviewer: 'lead' });
    const worker = await helperDone(s, lead, runId, { 'a.txt': 'first\n' });
    await lead.callLead('ask_owner', { agentId: worker.id, question: 'Keep it? Synthetic.' });
    // A second helper keeps working while the first change waits: the run's clock runs.
    expect(await lead.callLead('start_agent', { role: 'Tester', task: 'Synthetic.' })).toContain(
      'Started agent',
    );
    await s.settle();
    s.fake.workers().at(-1)?.started();
    await s.settle();
    s.clock.now = at(2 * HOUR + 1000);
    s.control.sweep();
    const detail = await run(s, runId);
    expect(['CANCELLING', 'CANCELLED']).toContain(detail.status);
    expect(detail.agents.find((a) => a.kind === 'lead')?.status).toBe('TIMED_OUT');
    // Before P-D the timeout was refused while a change waited for review (no such transition).
    expect(detail.agents.find((a) => a.id === worker.id)?.status).toBe('CANCELLED');
  }, 60_000);
});
