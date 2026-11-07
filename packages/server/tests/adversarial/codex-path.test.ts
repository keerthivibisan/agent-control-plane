// Synthetic temp git repo and scripted fake adapters only (CX-7). Never the Agent SDK or Codex.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workflowTemplate, type WorkflowGraph, type WorkflowNode } from '@acp/core';
import { TicketDetailDtoSchema, type ProjectAgentSetupDto } from '@acp/core/api';
import { createRepositories } from '@acp/db';
import { setupBoard } from '../board/helpers.js';
import { FILES, run, type Board } from '../board/loop-helpers.js';
import { mapNodes, poolMode, putGraph, withHelper } from '../board/graph-helpers.js';

/*
 * CX-7: the adversarial suite on the Codex path, at the server (docs/testing/adversarial.md,
 * "Codex"). A Codex helper, played by the scripted fake Codex adapter next to the fake Claude one,
 * misuses ADR-0033 messaging and the control-plane tools, and the server must refuse; a follow-up
 * or rework never resumes a session on another provider than the one that made it (ADR-0031 §7);
 * the usage a resumed Codex thread replays is recorded once (ADR-0032). The adapter's own layers
 * (git guard, profile, git location) are covered in packages/adapters/codex/tests/adversarial.test.ts.
 */

const onCodex = (n: WorkflowNode): WorkflowNode => ({ ...n, provider: 'codex' }) as WorkflowNode;

/** The lead-only template with a named `frontend` helper on Codex (the lead reviews it). */
function codexHelperGraph(): WorkflowGraph {
  const graph = withHelper(poolMode(workflowTemplate('lead-only'), null), {
    id: 'frontend',
    label: 'Frontend helper',
    mode: 'auto',
    rounds: 1,
  });
  return mapNodes(graph, (n) => (n.id === 'frontend' ? onCodex(n) : n));
}

function codexOf(s: Board) {
  if (s.codex === undefined) throw new Error('no codex fake');
  return s.codex;
}

async function setProvider(s: Board, provider: 'codex' | null) {
  const current = (await s.get(`/api/projects/${s.project.id}/setup`)).body as ProjectAgentSetupDto;
  const res = await s.send('put', `/api/projects/${s.project.id}/setup`, {
    projectKey: current.projectKey,
    maxConcurrentHelpers: current.maxConcurrentHelpers,
    maxDepth: current.maxDepth,
    defaultBudgetTokensPerAgent: current.defaultBudgetTokensPerAgent,
    model: null,
    contextFiles: [],
    provider,
  });
  expect(res.status).toBe(200);
}

async function start(s: Board, body: object = {}) {
  const ticket = await s.createTicket('Add dark mode');
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  const res = await s.post(`/api/tickets/${ticket.id}/start`, body);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  await s.settle();
  return { ticket, runId: TicketDetailDtoSchema.parse(res.body).currentRun?.id ?? '' };
}

/** A Claude lead with an approved plan, then a started Codex helper on `thread`. */
async function withCodexHelper(s: Board, thread = 'thr-codex-1') {
  await putGraph(s, codexHelperGraph());
  const x = await start(s);
  const lead = s.fake.agents.filter((a) => a.spec.kind === 'lead').at(-1);
  if (lead === undefined) throw new Error('no lead');
  lead.started();
  await s.settle();
  await lead.callLead('submit_plan', {
    summary: 'Add a theme toggle',
    steps: [{ title: 'Build the page', role: 'Page', detail: 'In settings' }],
  });
  await s.settle();
  const plan = (await s.detail(x.ticket.id)).plans.at(-1);
  if (plan?.status === 'proposed') {
    await s.post(`/api/tickets/${x.ticket.id}/plans/${plan.id}/decision`, { decision: 'approve' });
    await s.settle();
  }
  const reply = await lead.callLead('start_agent', {
    role: 'Page',
    task: 'Build it',
    helper: 'frontend',
  });
  expect(reply).toContain('Started agent');
  await s.settle();
  const worker = codexOf(s).agents.at(-1);
  if (worker === undefined) throw new Error('no codex worker');
  worker.started(thread, 'gpt-test');
  await s.settle();
  return { ...x, lead, worker };
}

describe('CX-7 C7: ADR-0033 messaging limits hold for a Codex helper', () => {
  it('ask_lead flood: the 6th open question is refused and never reaches the lead', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    const { lead, worker } = await withCodexHelper(s);
    for (let i = 1; i <= 5; i++) {
      await expect(worker.callLead('ask_lead', { question: `Q${i}` })).resolves.toContain(
        'delivered',
      );
    }
    const sent = lead.sent.length;
    await expect(worker.callLead('ask_lead', { question: 'Q6' })).rejects.toThrow(
      /5 open questions/,
    );
    expect(lead.sent.length).toBe(sent);
  });

  it('a message to an ended Codex helper comes back as dropped', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    const { runId, lead, worker } = await withCodexHelper(s);
    worker.finish('success');
    await s.settle();
    const reply = await lead.callLead('message_agent', { agentId: worker.id, text: 'Too late' });
    expect(reply).toBe('Message for Page: dropped: it has ended. It will never arrive.');
    expect(worker.sent).toEqual([]);
    const entry = (await run(s, runId)).outbox?.find((e) => e.kind === 'message');
    expect(entry).toMatchObject({ state: 'dropped', deliveredAt: null });
  });
});

describe('CX-7 C8: a Codex helper cannot use lead-only tools', () => {
  it('the engine refuses start_agent, merge_change, message_agent and request_review from it', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    const { runId, worker } = await withCodexHelper(s);
    const agentsBefore = (await run(s, runId)).agents.length;
    for (const [name, input] of [
      ['start_agent', { role: 'Evil', task: 'More helpers' }],
      ['merge_change', { agentId: worker.id }],
      ['message_agent', { agentId: worker.id, text: 'hi' }],
      ['request_review', {}],
    ] as const) {
      await expect(worker.callLead(name, input), name).rejects.toThrow();
    }
    await s.settle();
    expect((await run(s, runId)).agents.length).toBe(agentsBefore);
    expect(codexOf(s).agents).toHaveLength(1);
  });
});

describe('CX-7 C9: no cross-provider resume (ADR-0031 §7)', () => {
  it('a Codex helper rework resumes its Codex thread on Codex; its replayed usage counts once', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    const { runId, lead, worker } = await withCodexHelper(s, 'thr-codex-1');
    const last = { input: 40, output: 8, cacheCreation: null, cacheRead: 0 };
    worker.usage('thr-codex-1:turn-1:300', last);
    writeFileSync(join(s.worktree(runId, worker.id), 'fixed.txt'), 'ok\n');
    worker.finish('success');
    await s.settle();
    const reply = await lead.callLead('request_rework', { agentId: worker.id, comments: 'Again.' });
    expect(reply).toContain('round 1');
    await s.settle();

    const again = codexOf(s).byId(worker.id);
    expect(again).not.toBe(worker);
    expect(again.spec.rework).toEqual({ resumeSessionId: 'thr-codex-1' });
    // Nothing of this helper ever started on Claude, and no Claude session reached Codex.
    expect(s.fake.agents.filter((a) => a.id === worker.id)).toEqual([]);
    const claudeSessions = new Set(s.fake.agents.map((a) => `sess-${a.id}`));
    for (const a of codexOf(s).agents) {
      const resumed = a.spec.rework?.resumeSessionId ?? a.spec.followUp?.resumeSessionId ?? null;
      if (resumed !== null) expect(claudeSessions.has(resumed)).toBe(false);
    }

    // CX-1 result 2: the resumed thread replays its last usage notification first.
    again.started('thr-codex-1', 'gpt-test');
    again.usage('thr-codex-1:turn-1:300', last);
    again.usage('thr-codex-1:turn-2:320', {
      input: 20,
      output: 0,
      cacheCreation: null,
      cacheRead: 0,
    });
    await s.settle();
    const db = createRepositories(s.db);
    const session = db.sessions.getByKey({
      provider: 'codex',
      providerSessionId: 'thr-codex-1',
      providerAgentId: null,
    });
    expect(db.usage.getRecord('codex', 'thr-codex-1:turn-1:300')).toMatchObject({
      tokens: last,
      observationCount: 1,
    });
    expect(db.usage.listRecordsForSession(session?.id ?? '')).toHaveLength(2);
    const helper = (await run(s, runId)).agents.find((a) => a.id === worker.id);
    expect(helper?.provider).toBe('codex');
  });

  it('a Claude lead stays on Claude for a follow-up after the project default became Codex', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    const x = await start(s);
    const lead = s.fake.agents.find((a) => a.spec.kind === 'lead');
    if (lead === undefined) throw new Error('no claude lead');
    lead.started();
    await s.settle();
    lead.finish('success');
    await s.settle();
    await setProvider(s, 'codex');
    const chat = await s.post(`/api/runs/${x.runId}/chat`, { text: 'Why?' });
    expect(chat.status, JSON.stringify(chat.body)).toBe(200);
    await s.settle();
    expect(s.fake.agents.at(-1)?.spec.followUp).toEqual({ resumeSessionId: `sess-${lead.id}` });
    expect(codexOf(s).agents).toEqual([]);
  });

  it('a Codex lead stays on Codex for a follow-up after the project default went back to Claude', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    await setProvider(s, 'codex');
    const x = await start(s);
    const lead = codexOf(s).agents.find((a) => a.spec.kind === 'lead');
    if (lead === undefined) throw new Error('no codex lead');
    lead.started('thr-lead', 'gpt-test');
    await s.settle();
    lead.finish('success');
    await s.settle();
    await setProvider(s, null);
    const chat = await s.post(`/api/runs/${x.runId}/chat`, { text: 'Why?' });
    expect(chat.status, JSON.stringify(chat.body)).toBe(200);
    await s.settle();
    expect(codexOf(s).agents.at(-1)?.spec.followUp).toEqual({ resumeSessionId: 'thr-lead' });
    expect(s.fake.agents).toEqual([]);
  });
});
