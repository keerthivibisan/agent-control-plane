import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TicketActivityDtoSchema, type TicketActivityDto } from '@acp/core/api';
import { AGENT_NOTE_LINE } from '@acp/orchestrator';
import { TICKET_SUMMARY_SO_FAR } from '../../src/control/run-summary.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, reviewers, run, type Board } from './loop-helpers.js';

/*
 * ADR-0026 (C-A) through the server: a helper's report_work note (one per agent run), the lead's
 * whole-ticket summary carried into a later run's brief, and the Conversation timeline
 * (`GET /api/tickets/:id/activity`) built from records with no conversation content. The fake
 * managed adapter plays every agent; git runs in a throwaway repository. Synthetic data only.
 */

const CANARY = 'CANARY-C-A-9Q';
const SUMMARY = 'Added a dark mode switch to Settings. Tested it with the project check.';

async function activity(s: Board, ticketId: string): Promise<TicketActivityDto> {
  const res = await s.get(`/api/tickets/${ticketId}/activity`);
  expect(res.status).toBe(200);
  return TicketActivityDtoSchema.parse(res.body);
}

describe('agent notes, the ticket summary and the activity timeline (ADR-0026)', () => {
  it('records one note per helper, the summary, and a timeline without conversation', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    lead.emit({ type: 'lead-text', text: `${CANARY} lead reply` });

    expect(
      await lead.callLead('start_agent', { role: 'Builder', task: `Build ${CANARY}` }),
    ).toContain('Started agent');
    await s.settle();
    const worker = s.fake.workers().at(-1);
    if (worker === undefined) throw new Error('no worker');
    // The brief asks for the note, and the helper has the tool.
    expect(worker.spec.prompt.endsWith(AGENT_NOTE_LINE)).toBe(true);
    worker.started();
    await s.settle();
    writeFileSync(join(s.worktree(runId, worker.id), 'fixed.txt'), 'ok\n');
    expect(await worker.callLead('report_work', { note: 'First try.' })).toContain('Noted');
    expect(
      await worker.callLead('report_work', { note: 'Added fixed.txt. The check passes.' }),
    ).toContain('Noted');
    worker.emit({ type: 'activity', summary: `${CANARY} tool output` });
    worker.finish('success');
    await s.settle();
    await expect(worker.callLead('report_work', { note: 'Too late.' })).rejects.toThrow(
      'Your turn is over.',
    );

    const reviewer = reviewers(s).at(-1);
    if (reviewer === undefined) throw new Error('no change reviewer');
    reviewer.started();
    await s.settle();
    // The reviewer has no note tool.
    await expect(reviewer.callLead('report_work', { note: 'x' })).rejects.toThrow();
    await reviewer.callLead('submit_review', { verdict: 'approve', findings: 'Looks right.' });
    reviewer.finish('success');
    await s.settle();
    expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged');
    await s.settle();
    expect(await lead.callLead('request_review', { summary: SUMMARY })).toContain('Handed over');
    expect((await run(s, runId)).status).toBe('REVIEW');

    const comments = (await s.detail(ticket.id)).comments;
    const notes = comments.filter((c) => c.kind === 'agent-note');
    expect(notes).toEqual([
      expect.objectContaining({
        author: 'app',
        runId,
        agentRunId: worker.id,
        body: 'Added fixed.txt. The check passes.',
        attachments: [],
      }),
    ]);
    expect(comments.filter((c) => c.kind === 'ticket-summary').map((c) => c.body)).toEqual([
      SUMMARY,
    ]);
    expect(comments.find((c) => c.author === 'reviewer')?.kind).toBe('review');

    const timeline = await activity(s, ticket.id);
    const items = timeline.items;
    expect(timeline.ticketId).toBe(ticket.id);
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort());
    const types = new Set(items.map((i) => i.type));
    for (const t of [
      'run-started',
      'plan',
      'decision',
      'agent-started',
      'agent-ended',
      'agent-note',
      'review',
      'run-facts',
    ] as const) {
      expect(types.has(t), t).toBe(true);
    }
    expect(items[0]).toMatchObject({ type: 'run-started', title: 'Run 1 started', runId });
    const note = items.find((i) => i.type === 'agent-note');
    expect(note).toMatchObject({
      actor: { kind: 'worker', label: 'Helpers', agentRunId: worker.id },
      title: 'Helpers reported its work',
      body: 'Added fixed.txt. The check passes.',
      link: { kind: 'change', agentRunId: worker.id },
    });
    expect(items.find((i) => i.type === 'review')).toMatchObject({
      actor: { kind: 'reviewer', agentRunId: reviewer.id },
      title: "Reviewed Helpers's change: approve",
      body: 'Looks right.',
    });
    expect(items.find((i) => i.type === 'decision' && i.link?.kind === 'change')).toMatchObject({
      actor: { kind: 'lead' },
      title: "Lead merged Helpers's change into the ticket branch",
    });
    expect(items.find((i) => i.type === 'plan')).toMatchObject({
      title: 'Proposed plan v1 (1 step)',
      body: 'Add a theme toggle',
    });
    expect(items.find((i) => i.type === 'run-facts')?.body).toContain('Details:');
    // The Comments tab's texts (the ticket summary) and no conversation content.
    const json = JSON.stringify(timeline);
    expect(json).not.toContain(SUMMARY);
    expect(json).not.toContain(CANARY);

    // The owner merges: a merge line, then a second run's lead starts with the summary so far.
    expect((await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' })).status).toBe(
      200,
    );
    await s.settle();
    const merged = await activity(s, ticket.id);
    expect(merged.items.find((i) => i.type === 'merge')).toMatchObject({
      actor: { kind: 'app', label: 'Agent Control Plane' },
      link: { kind: 'files' },
    });
    expect(merged.items.some((i) => i.type === 'run-ended' && i.title === 'Run 1 finished')).toBe(
      true,
    );

    const rerun = await s.post(`/api/tickets/${ticket.id}/start`, {});
    expect(rerun.status).toBe(200);
    await s.settle();
    const lead2 = s.fake.agents.filter((a) => a.spec.kind === 'lead').at(-1);
    expect(lead2?.spec.agentRunId).not.toBe(lead.spec.agentRunId);
    expect(lead2?.spec.prompt.endsWith(`${TICKET_SUMMARY_SO_FAR}\n${SUMMARY}`)).toBe(true);
    expect(
      (await activity(s, ticket.id)).items.filter((i) => i.type === 'run-started'),
    ).toHaveLength(2);
  }, 90_000);

  it("shows the owner's review from Files changed on Conversation, not on Comments", async () => {
    const s = await setupBoard();
    const ticket = await s.createTicket('Add dark mode');
    const review = await s.post(`/api/tickets/${ticket.id}/comments`, {
      body: 'Review comments:\n- src/app.ts:4 Keep the old name.',
      kind: 'review',
    });
    expect(review.status).toBe(201);
    expect(review.body).toMatchObject({ author: 'owner', kind: 'review' });
    const plain = await s.post(`/api/tickets/${ticket.id}/comments`, { body: 'Looks close.' });
    expect(plain.body).toMatchObject({ author: 'owner', kind: 'comment' });

    const items = (await activity(s, ticket.id)).items;
    expect(items.filter((i) => i.type === 'review')).toEqual([
      expect.objectContaining({
        actor: { kind: 'owner', label: 'You', agentRunId: null },
        title: 'You reviewed',
        link: { kind: 'files' },
      }),
    ]);
    // A plain comment belongs to the Comments tab only.
    expect(JSON.stringify(items)).not.toContain('Looks close.');
    // The owner cannot claim other kinds.
    const forged = await s.post(`/api/tickets/${ticket.id}/comments`, {
      body: 'x',
      kind: 'ticket-summary',
    });
    expect(forged.status).toBe(400);
  });

  it('answers 404 for an unknown ticket', async () => {
    const s = await setupBoard();
    expect((await s.get('/api/tickets/nope/activity')).status).toBe(404);
  });
});
