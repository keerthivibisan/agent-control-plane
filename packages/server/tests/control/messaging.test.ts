import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_OUTBOX_ENTRIES, type AgentMessageMetaDto } from '@acp/core/api';
import type { RunState } from '@acp/orchestrator';
import {
  MAX_HELD_MESSAGES,
  createMailbox,
  emptyMail,
  textHash,
  type MailboxLive,
} from '../../src/control/mailbox.js';
import { setupBoard } from '../board/helpers.js';
import { FILES, approved, helperDone, reviewers, run } from '../board/loop-helpers.js';
import { setupControl } from './helpers.js';

/*
 * ADR-0033 through the control service and the fake managed adapter: delivery states for
 * `message_agent` and `ask_lead`, held messages for a lead that cannot take input, finish notices,
 * `get_review_findings`, the bounded merge and the metadata-only outbox. Synthetic agents only.
 */

const OUTBOX_KEYS = [
  'createdAt',
  'deliveredAt',
  'from',
  'id',
  'kind',
  'length',
  'sha256',
  'state',
  'to',
];

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function runWithWorker(budget?: number) {
  const s = await setupControl();
  const created = await s.post('/api/runs', {
    projectId: s.project.id,
    ...(budget !== undefined && { budget: { maxTokensPerAgent: budget, softCostUsdPerRun: null } }),
  });
  const runId = (created.body as { id: string }).id;
  await s.post(`/api/runs/${runId}/chat`, { text: 'go' });
  await s.control.idle();
  const lead = s.fake.lead();
  lead.started();
  const worker = await s.startWorker('Frontend', 'Build the page');
  return { s, runId, lead, worker };
}

describe('message_agent delivery states (ADR-0033 §1)', () => {
  it('delivered: handed to the live process; the outbox keeps metadata, never the text', async () => {
    const { s, runId, lead, worker } = await runWithWorker();
    worker.started();
    await s.control.idle();
    const text = 'Also add a dark theme. SYNTHETIC-SECRET-TEXT';
    const reply = await lead.callLead('message_agent', { agentId: worker.id, text });
    expect(reply).toBe('Message for Frontend: delivered (handed to its process now).');
    expect(worker.sent).toEqual([text]);
    const detail = await s.detail(runId);
    const entry = detail.outbox?.find((e) => e.kind === 'message');
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {}).sort()).toEqual(OUTBOX_KEYS);
    expect(entry).toMatchObject({
      from: lead.id,
      to: worker.id,
      state: 'delivered',
      length: text.length,
      sha256: sha256(text),
    });
    expect(entry?.deliveredAt).not.toBeNull();
    expect(JSON.stringify(detail.outbox)).not.toContain('SYNTHETIC-SECRET-TEXT');
  });

  it('queued: a worker still starting gets it once its process runs', async () => {
    const { s, runId, lead } = await runWithWorker();
    // A second helper: its worktree is made in the background, so it is still starting.
    await lead.callLead('start_agent', { role: 'Backend', task: 'Build the API' });
    const backend = s.control.peek(runId)?.agents.find((a) => a.role === 'Backend');
    if (backend === undefined) throw new Error('no backend helper');
    const reply = await lead.callLead('message_agent', { agentId: backend.id, text: 'Use REST.' });
    expect(reply).toBe(
      'Message for Backend: queued (it is starting and gets it as soon as it runs).',
    );
    await s.control.idle();
    expect(s.fake.byId(backend.id).sent).toEqual(['Use REST.']);
    const entry = (await s.detail(runId)).outbox?.find((e) => e.to === backend.id);
    expect(entry).toMatchObject({ state: 'delivered' });
  });

  it('dropped: a message to an ended helper never arrives; the drop is counted', async () => {
    const { s, runId, lead, worker } = await runWithWorker();
    worker.started();
    worker.finish('success');
    await s.control.idle();
    const before = s.control.counters().diagnostics['message-dropped'] ?? 0;
    const reply = await lead.callLead('message_agent', { agentId: worker.id, text: 'Too late' });
    expect(reply).toBe('Message for Frontend: dropped: it has ended. It will never arrive.');
    expect(s.control.counters().diagnostics['message-dropped']).toBe(before + 1);
    const entry = (await s.detail(runId)).outbox?.find((e) => e.kind === 'message');
    expect(entry).toMatchObject({ state: 'dropped', deliveredAt: null });
  });
});

describe('held messages (ADR-0033 §2)', () => {
  it('notices for a BLOCKED lead are held in order and delivered when the owner raises it', async () => {
    const { s, runId, lead, worker } = await runWithWorker(1000);
    worker.started();
    const second = await s.startWorker('Backend', 'Build the API');
    second.started();
    await s.control.idle();
    // The lead passes its budget: BLOCKED, waiting for the owner.
    lead.usage('l1', { input: 600, output: 500, cacheCreation: 0, cacheRead: 0 });
    let detail = await s.detail(runId);
    expect(detail.agents.find((a) => a.id === lead.id)?.status).toBe('BLOCKED');
    const sentBefore = lead.sent.length;
    worker.finish('success');
    await s.control.idle();
    second.finish('error');
    await s.control.idle();
    // Nothing reached the lead; both notices wait, in order.
    expect(lead.sent.length).toBe(sentBefore);
    detail = await s.detail(runId);
    expect(detail.outbox?.filter((e) => e.kind === 'notice').map((e) => [e.to, e.state])).toEqual([
      [lead.id, 'held'],
      [lead.id, 'held'],
    ]);
    const raise = detail.approvals.find((a) => a.kind === 'budget-raise');
    await s.post(`/api/approvals/${raise?.id ?? ''}`, { decision: 'approve' });
    await s.control.idle();
    expect(lead.sent.slice(sentBefore)).toEqual([
      'The owner raised your budget. Continue your task.',
      `Frontend (agentId ${worker.id}) finished: its change waits for the owner's review.`,
      `Backend (agentId ${second.id}) failed: its change waits for the owner's review.`,
    ]);
    detail = await s.detail(runId);
    expect(detail.outbox?.filter((e) => e.kind === 'notice').map((e) => e.state)).toEqual([
      'delivered',
      'delivered',
    ]);
  });

  it('finish notices: success, error and cancel, one each, to a live lead', async () => {
    const { s, runId, lead, worker } = await runWithWorker();
    worker.started();
    const b = await s.startWorker('Backend', 'b');
    b.started();
    const c = await s.startWorker('Docs', 'c');
    c.started();
    await s.control.idle();
    worker.finish('success');
    b.finish('error');
    await s.control.idle();
    expect((await s.post(`/api/runs/${runId}/agents/${c.id}/stop`)).status).toBe(200);
    await s.control.idle();
    const notices = lead.sent.filter((t) =>
      / \(agentId .+\) (finished|failed|was stopped): /.test(t),
    );
    expect(notices).toEqual([
      `Frontend (agentId ${worker.id}) finished: its change waits for the owner's review.`,
      `Backend (agentId ${b.id}) failed: its change waits for the owner's review.`,
      `Docs (agentId ${c.id}) was stopped: its change waits for the owner's review.`,
    ]);
  });
});

describe('ask_lead (ADR-0033 §3)', () => {
  it('reaches the lead with the role, reports delivery, is rate limited and answered', async () => {
    const { s, runId, lead, worker } = await runWithWorker();
    worker.started();
    await s.control.idle();
    const reply = await worker.callLead('ask_lead', { question: 'Which colour token?' });
    expect(reply).toBe('Question for the lead: delivered (handed to its process now).');
    expect(lead.sent.at(-1)).toContain(`Frontend (agentId ${worker.id}) asks: Which colour token?`);
    for (let i = 2; i <= 5; i++) await worker.callLead('ask_lead', { question: `Q${i}` });
    // A flood is refused, with a clear message; nothing more reaches the lead.
    const sent = lead.sent.length;
    await expect(worker.callLead('ask_lead', { question: 'Q6' })).rejects.toThrow(
      /5 open questions/,
    );
    expect(lead.sent.length).toBe(sent);
    // The lead's message answers them; the helper may ask again.
    await lead.callLead('message_agent', { agentId: worker.id, text: 'Use blue.' });
    await expect(worker.callLead('ask_lead', { question: 'Q7' })).resolves.toContain('delivered');
    const questions = (await s.detail(runId)).outbox?.filter((e) => e.kind === 'question') ?? [];
    expect(questions).toHaveLength(6);
    expect(questions[0]).toMatchObject({ from: worker.id, to: lead.id, state: 'delivered' });
  });
});

describe('get_review_findings and the bounded merge (ADR-0033 §5, §6)', () => {
  it('returns the stored findings, and refuses before any are stored', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead } = await approved(s);
    const worker = await helperDone(s, lead, runId, { 'fixed.txt': 'ok\n' });
    await expect(lead.callLead('get_review_findings', { agentId: worker.id })).rejects.toThrow(
      /No review findings are stored/,
    );
    const reviewer = reviewers(s)[0];
    if (reviewer === undefined) throw new Error('no change reviewer');
    reviewer.started();
    await s.settle();
    await reviewer.callLead('submit_review', {
      verdict: 'rework',
      findings: 'Rename the flag. Synthetic finding.',
    });
    reviewer.finish('success');
    await s.settle();
    const findings = await lead.callLead('get_review_findings', { agentId: worker.id });
    expect(findings).toContain("Builder's change");
    expect(findings).toContain('Verdict: rework');
    expect(findings).toContain(`(agentId ${reviewer.id})`);
    expect(findings).toContain('Rename the flag. Synthetic finding.');
  });

  it('a merge stuck waiting for its checks times out: a failure for the lead, nothing merged', async () => {
    const s = await setupBoard({
      files: FILES,
      mergeTimeoutMs: 50,
      patchHooks: (hooks) => {
        const checks = hooks.commitChecks;
        if (checks === undefined) throw new Error('no commit checks');
        hooks.commitChecks = { ...checks, gate: () => new Promise(() => undefined) };
      },
    });
    const { runId, lead } = await approved(s);
    const worker = await helperDone(s, lead, runId, { 'fixed.txt': 'ok\n' });
    const reviewer = reviewers(s)[0];
    if (reviewer === undefined) throw new Error('no change reviewer');
    reviewer.started();
    await s.settle();
    await reviewer.callLead('submit_review', { verdict: 'approve', findings: 'Fine.' });
    reviewer.finish('success');
    await s.settle();
    const before = (await run(s, runId)).ticketBranch?.headCommit;
    const reply = await lead.callLead('merge_change', { agentId: worker.id });
    expect(reply).toContain('timed out');
    expect(reply).toContain('Nothing was merged');
    const detail = await run(s, runId);
    expect(detail.ticketBranch?.headCommit).toBe(before);
    expect(detail.changes?.find((c) => c.agentRunId === worker.id)).toMatchObject({
      state: 'decision',
    });
    expect(s.control.counters().diagnostics['merge-timeout']).toBe(1);
    // Consistent: the lead may decide again (here: discard it).
    await expect(
      lead.callLead('discard_change', { agentId: worker.id, reason: 'Stuck checks' }),
    ).resolves.toBeTruthy();
  });
});

describe('the mailbox (ADR-0033 §2, §7)', () => {
  function liveWith(leadStatus: string): MailboxLive {
    const state = {
      run: { id: 'run-1', status: 'RUNNING' },
      agents: [{ id: 'lead-1', kind: 'lead', status: leadStatus, role: 'Lead' }],
    } as unknown as RunState;
    return { state, handles: new Map(), starting: new Set(), mail: emptyMail() };
  }

  function mailbox() {
    const counts: Record<string, number> = {};
    let n = 0;
    const box = createMailbox({
      now: () => new Date('2026-11-07T10:00:00.000Z'),
      newId: () => `m-${++n}`,
      logger: { log() {} },
      countDiagnostic: (code) => (counts[code] = (counts[code] ?? 0) + 1),
      track: () => undefined,
      followUpOpen: () => false,
    });
    return { box, counts };
  }

  it(`holds at most ${MAX_HELD_MESSAGES} per agent, dropping the oldest and counting each drop`, () => {
    const { box, counts } = mailbox();
    const live = liveWith('BLOCKED');
    for (let i = 0; i < MAX_HELD_MESSAGES + 2; i++) {
      box.send(live, 'lead-1', `notice ${i}`, { from: 'engine', kind: 'notice' });
    }
    expect(live.mail.held.get('lead-1')?.map((p) => p.text)[0]).toBe('notice 2');
    expect(live.mail.held.get('lead-1')).toHaveLength(MAX_HELD_MESSAGES);
    expect(counts['held-message-dropped']).toBe(2);
    const states = box.outbox(live).map((e) => e.state);
    expect(states.slice(0, 2)).toEqual(['dropped', 'dropped']);
    expect(states.slice(2).every((s) => s === 'held')).toBe(true);
    // The lead can take input again: everything held goes out, in order.
    const sent: string[] = [];
    (live.state.agents[0] as { status: string }).status = 'RUNNING';
    live.handles.set('lead-1', {
      send: (t) => {
        sent.push(t);
        return Promise.resolve();
      },
    });
    box.flush(live);
    expect(sent[0]).toBe('notice 2');
    expect(sent).toHaveLength(MAX_HELD_MESSAGES);
  });

  it(`keeps the latest ${MAX_OUTBOX_ENTRIES} entries, with no text field and a correct hash`, () => {
    const { box } = mailbox();
    const live = liveWith('BLOCKED');
    for (let i = 0; i < MAX_OUTBOX_ENTRIES + 5; i++) {
      box.send(live, 'lead-1', `m${i}`, { from: 'engine', kind: 'notice' });
    }
    const outbox: AgentMessageMetaDto[] = box.outbox(live);
    expect(outbox).toHaveLength(MAX_OUTBOX_ENTRIES);
    expect(outbox[0]?.id).toBe('m-6');
    for (const e of outbox) expect(Object.keys(e).sort()).toEqual(OUTBOX_KEYS);
    expect(outbox.at(-1)).toMatchObject({ length: 4, sha256: sha256('m204') });
    expect(textHash('ä')).toBe(sha256('ä'));
  });

  it('never drops silently: plain input to an agent without a process is counted', () => {
    const { box, counts } = mailbox();
    const live = liveWith('RUNNING');
    const r = box.send(live, 'lead-1', 'hello');
    expect(r).toMatchObject({ state: 'dropped', reason: 'it has no running process', entry: null });
    expect(counts['message-dropped']).toBe(1);
    expect(box.outbox(live)).toEqual([]);
  });
});
