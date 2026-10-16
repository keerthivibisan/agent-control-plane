import { describe, expect, it } from 'vitest';
import type { ManagedAgentEvent, ManagedAgentHandle } from '@acp/core';
import { ChatMessageDtoSchema, RunDetailDtoSchema, type RunDetailDto } from '@acp/core/api';
import { FOLLOW_UP_PREFACE } from '@acp/orchestrator';
import { HttpError } from '../../src/errors.js';
import { FOLLOW_UP_READ_ONLY_MESSAGE } from '../../src/control/service.js';
import { CONTROL_NOW, expectError, setupControl } from './helpers.js';
import type { FakeAgent } from './fake-adapter.js';

/*
 * The chat after the lead ended (ADR-0020): the owner's message resumes the lead's saved session
 * for one answers-only turn. Fake adapter only; the Agent SDK never runs.
 */

type Setup = Awaited<ReturnType<typeof setupControl>>;

const later = (s: Setup, ms: number) => {
  s.clock.now = new Date(CONTROL_NOW.getTime() + ms);
};

/** A Phase 3 run whose lead finished: the run is COMPLETED and the lead SUCCEEDED. */
async function completedRun(s: Setup, body: Record<string, unknown> = {}): Promise<string> {
  const created = await s.post('/api/runs', { projectId: s.project.id, ...body });
  const runId = RunDetailDtoSchema.parse(created.body).id;
  expect((await s.post(`/api/runs/${runId}/chat`, { text: 'Look at the app' })).status).toBe(200);
  await s.control.idle();
  const lead = s.fake.lead();
  lead.started();
  lead.emit({ type: 'lead-text', text: 'It is a small app.' });
  lead.finish('success');
  const run = await s.detail(runId);
  expect(run.status).toBe('COMPLETED');
  expect(run.agents.map((a) => [a.kind, a.status])).toEqual([['lead', 'SUCCEEDED']]);
  expect(run.followUp).toEqual({ state: 'available', reason: null });
  return runId;
}

function followUpAgents(s: Setup): FakeAgent[] {
  return s.fake.agents.filter((a) => a.spec.followUp !== undefined);
}

async function ask(s: Setup, runId: string, text: string): Promise<FakeAgent> {
  const before = followUpAgents(s).length;
  const res = await s.post(`/api/runs/${runId}/chat`, { text });
  expect(res.status).toBe(200);
  expect(ChatMessageDtoSchema.parse(res.body)).toMatchObject({
    role: 'owner',
    text,
    followUp: true,
  });
  await s.control.idle();
  const agent = followUpAgents(s)[before];
  if (agent === undefined) throw new Error('no follow-up turn started');
  return agent;
}

const shape = (run: RunDetailDto) => ({
  status: run.status,
  endedAt: run.endedAt,
  agents: run.agents.map((a) => [a.id, a.kind, a.status, a.endedAt, a.budget.used]),
});

describe('follow-up turn through the chat route', () => {
  it('resumes the lead session in the project root, answers-only, and keeps the run COMPLETED', async () => {
    const s = await setupControl();
    const runId = await completedRun(s);
    const before = shape(await s.detail(runId));
    const lead = s.fake.lead();
    later(s, 60_000);

    const turn = await ask(s, runId, 'Why a store?');
    expect(turn.spec).toMatchObject({
      agentRunId: lead.id,
      kind: 'lead',
      cwd: s.repo,
      followUp: { resumeSessionId: `sess-${lead.id}` },
    });
    // No control-plane tools, no skills, and the preface before the owner's words.
    expect(turn.spec.leadTools).toBeUndefined();
    expect(turn.spec.skillPlugin).toBeUndefined();
    expect(turn.spec.prompt.startsWith(FOLLOW_UP_PREFACE)).toBe(true);
    expect(turn.spec.prompt.endsWith('Why a store?')).toBe(true);
    // The turn reuses the lead's id: a lookup by id is the latest start (the e2e drivers use it).
    expect(s.fake.byId(lead.id)).toBe(turn);
    expect(s.fake.lead()).toBe(lead);
    let run = await s.detail(runId);
    expect(run.followUp).toEqual({ state: 'running', reason: null });
    expect(shape(run)).toEqual(before);

    // One turn at a time.
    expectError(
      await s.post(`/api/runs/${runId}/chat`, { text: 'And?' }),
      409,
      'follow_up_running',
    );

    // A tool use the gate did not settle is denied without asking; no approval is made.
    await expect(turn.ask('Edit', 'Edit src/app.ts')).resolves.toEqual({
      allow: false,
      message: FOLLOW_UP_READ_ONLY_MESSAGE,
    });

    turn.started(`sess-${lead.id}`);
    turn.emit({ type: 'activity', summary: 'Read src/app.ts' });
    turn.emit({ type: 'lead-text', text: 'It keeps the theme.' });
    turn.finish('success', 9.5);
    run = await s.detail(runId);
    expect(run.followUp).toEqual({ state: 'available', reason: null });
    expect(shape(run)).toEqual(before);
    expect(run.approvals).toEqual([]);
    expect(run.messages.map((m) => [m.role, m.text, m.followUp ?? false])).toEqual([
      ['owner', 'Look at the app', false],
      ['lead', 'It is a small app.', false],
      ['owner', 'Why a store?', true],
      ['lead', 'It keeps the theme.', true],
    ]);
    // Only the owner's words and the lead's reply are stored: no preface, no tool text.
    const stored = s.db.connection.prepare('SELECT text FROM orchestrator_messages').all() as {
      text: string;
    }[];
    expect(stored.some((m) => m.text.includes(FOLLOW_UP_PREFACE))).toBe(false);
    expect(stored.some((m) => m.text.includes('Read src/app.ts'))).toBe(false);
    // The resumed session keeps its link: no second session link is made.
    expect(
      s.db.connection.prepare('SELECT provider_session_id FROM agent_run_sessions').all(),
    ).toEqual([{ provider_session_id: `sess-${lead.id}` }]);

    // The next message is a new turn.
    later(s, 120_000);
    const next = await ask(s, runId, 'One more?');
    expect(next).not.toBe(turn);
    next.finish('success');
    expect((await s.detail(runId)).status).toBe('COMPLETED');
  });

  it('leaves the chat with a live lead exactly as before', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    const lead = s.fake.lead();
    lead.started();
    const res = await s.post(`/api/runs/${runId}/chat`, { text: 'Status?' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('followUp');
    await s.control.idle();
    expect(lead.sent).toEqual(['Status?']);
    const run = await s.detail(runId);
    expect(run).not.toHaveProperty('followUp');
    expect(run.messages.every((m) => m.followUp === undefined)).toBe(true);
    expect(followUpAgents(s)).toEqual([]);
  });

  it('refuses when the lead never reported a session (no-session)', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    s.fake.lead().finish('error');
    const run = await s.detail(runId);
    expect(run.status).toBe('FAILED');
    expect(run.followUp).toEqual({ state: 'unavailable', reason: 'no-session' });
    expectError(
      await s.post(`/api/runs/${runId}/chat`, { text: 'Hello?' }),
      409,
      'follow_up_unavailable',
    );
    expect(followUpAgents(s)).toEqual([]);
  });

  it('says managed-off when managed agents are off (the service; the routes answer 404)', async () => {
    const first = await setupControl();
    const runId = await completedRun(first);
    const second = await setupControl({
      dbPath: first.dbPath,
      dataDir: first.dataDir,
      repo: first.repo,
      enabled: false,
    });
    expect(second.control.getRun(runId).followUp).toEqual({
      state: 'unavailable',
      reason: 'managed-off',
    });
    let refused: unknown;
    try {
      second.control.chat(runId, { text: 'Hello?' });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).code).toBe('follow_up_unavailable');
    expect(second.fake.agents).toEqual([]);
  });

  it('remembers session-gone after a resume that ends in an error result', async () => {
    const s = await setupControl();
    const runId = await completedRun(s);
    later(s, 60_000);
    const turn = await ask(s, runId, 'Still there?');
    turn.finish('error');
    const run = await s.detail(runId);
    expect(run.followUp).toEqual({ state: 'unavailable', reason: 'session-gone' });
    expect(run.status).toBe('COMPLETED');
    expectError(
      await s.post(`/api/runs/${runId}/chat`, { text: 'Hello?' }),
      409,
      'follow_up_unavailable',
    );
    expect(followUpAgents(s)).toHaveLength(1);
  });

  it('remembers session-gone after a resume whose stream throws', async () => {
    const s = await setupControl();
    const runId = await completedRun(s);
    const start = s.fake.adapter.start.bind(s.fake.adapter);
    let calls = 0;
    s.fake.adapter.start = (spec, callbacks): ManagedAgentHandle => {
      calls++;
      const handle = start(spec, callbacks);
      // eslint-disable-next-line require-yield -- a stream that fails before any event
      async function* failing(): AsyncGenerator<ManagedAgentEvent> {
        await Promise.resolve();
        throw new Error('No conversation found with session ID');
      }
      return { ...handle, events: failing() };
    };
    later(s, 60_000);
    const res = await s.post(`/api/runs/${runId}/chat`, { text: 'Still there?' });
    expect(res.status).toBe(200);
    const run = await s.detail(runId);
    expect(calls).toBe(1);
    expect(run.followUp).toEqual({ state: 'unavailable', reason: 'session-gone' });
    expect(run.status).toBe('COMPLETED');
  });

  it('aborts a turn over its budget (the run budget); the chat stays available', async () => {
    const s = await setupControl();
    const runId = await completedRun(s, {
      budget: { maxTokensPerAgent: 1000, softCostUsdPerRun: null },
    });
    later(s, 60_000);
    const turn = await ask(s, runId, 'Explain everything');
    turn.usage('msg-f1', { input: 10, output: 1200, cacheCreation: 0, cacheRead: 5000 });
    await s.control.idle();
    expect(turn.aborted).toBe(true);
    const run = await s.detail(runId);
    expect(run.followUp).toEqual({ state: 'available', reason: null });
    // The lead's own budget is unchanged by the follow-up turn.
    expect(run.agents[0]?.budget.used).toBe(0);
    expect(s.control.counters().diagnostics['follow-up-over-budget']).toBe(1);
  });

  it("the owner's Stop on the lead ends the turn", async () => {
    const s = await setupControl();
    const runId = await completedRun(s);
    later(s, 60_000);
    const turn = await ask(s, runId, 'Long question');
    const res = await s.post(`/api/runs/${runId}/agents/${s.fake.lead().id}/stop`);
    expect(res.status).toBe(200);
    expect(turn.aborted).toBe(true);
    expect((await s.detail(runId)).followUp).toEqual({ state: 'available', reason: null });
  });

  it('a restart relaunches nothing; the chat can be continued afterwards', async () => {
    const first = await setupControl();
    const runId = await completedRun(first);
    later(first, 60_000);
    await ask(first, runId, 'Question before the restart');
    // "Crash" while the turn runs: a second process opens the same files.
    const second = await setupControl({
      dbPath: first.dbPath,
      dataDir: first.dataDir,
      repo: first.repo,
    });
    const run = await second.detail(runId);
    expect(second.fake.agents).toEqual([]);
    expect(run.status).toBe('COMPLETED');
    expect(run.followUp).toEqual({ state: 'available', reason: null });
    second.clock.now = new Date(CONTROL_NOW.getTime() + 120_000);
    const turn = await ask(second, runId, 'After the restart');
    expect(turn.spec.followUp).toEqual({ resumeSessionId: `sess-${first.fake.lead().id}` });
  });
});
