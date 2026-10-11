import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentRunDtoSchema,
  ApprovalDtoSchema,
  ChatMessageDtoSchema,
  CsrfTokenDtoSchema,
  ReviewDtoSchema,
  RunDetailDtoSchema,
  RunSummaryDtoSchema,
} from '@acp/core/api';
import { z } from 'zod';
import { git } from '../workspace/helpers.js';
import { expectError, setupControl } from './helpers.js';

/*
 * P3-D control-panel routes, each driven through supertest with a scripted fake managed adapter
 * and a temp git repository. Every response is parsed by its core DTO schema.
 */

describe('GET /api/control/token', () => {
  it('returns the per-start CSRF token, never cached', async () => {
    const s = await setupControl();
    const res = await s.get('/api/control/token');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { token } = CsrfTokenDtoSchema.parse(res.body);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toBe(s.token);
    const other = await setupControl();
    expect(other.token).not.toBe(token);
  });
});

describe('runs: create, list, detail', () => {
  it('POST /api/runs creates a QUEUED run with a QUEUED lead; nothing runs before the owner chats', async () => {
    const s = await setupControl();
    const res = await s.post('/api/runs', { projectId: s.project.id, title: 'Add a feature' });
    expect(res.status).toBe(201);
    const run = RunDetailDtoSchema.parse(res.body);
    expect(run).toMatchObject({
      projectId: s.project.id,
      title: 'Add a feature',
      status: 'QUEUED',
      agentCount: 1,
      pendingApprovals: 0,
      budget: { maxTokensPerAgent: 500_000, softCostUsdPerRun: null },
      messages: [],
      approvals: [],
    });
    expect(run.agents).toEqual([
      expect.objectContaining({ kind: 'lead', status: 'QUEUED', task: null, sessionId: null }),
    ]);
    expect(s.fake.agents).toEqual([]);

    const list = z.array(RunSummaryDtoSchema).parse((await s.get('/api/runs')).body);
    expect(list.map((r) => r.id)).toEqual([run.id]);
    expect(RunDetailDtoSchema.parse((await s.get(`/api/runs/${run.id}`)).body).id).toBe(run.id);
    expect(s.notices.some((n) => n.kind === 'runs-changed' && n.runIds?.includes(run.id))).toBe(
      true,
    );
  });

  it('defaults the title and accepts an owner budget', async () => {
    const s = await setupControl();
    const res = await s.post('/api/runs', {
      projectId: s.project.id,
      budget: { maxTokensPerAgent: 1000, softCostUsdPerRun: 2 },
    });
    const run = RunDetailDtoSchema.parse(res.body);
    expect(run.title).toBe('Run in app');
    expect(run.agents[0]?.budget).toEqual({ used: 0, limit: 1000 });
  });

  it('answers unknown runs with a 404 ErrorDto and bad bodies with 400', async () => {
    const s = await setupControl();
    expectError(await s.get('/api/runs/nope'), 404, 'not_found');
    expectError(await s.post('/api/runs/nope/chat', { text: 'hi' }), 404, 'not_found');
    expectError(await s.post('/api/runs', { title: 'no project' }), 400, 'invalid_request');
    const run = RunDetailDtoSchema.parse(
      (await s.post('/api/runs', { projectId: s.project.id })).body,
    );
    expectError(await s.post(`/api/runs/${run.id}/chat`, { text: '   ' }), 400, 'invalid_request');
    expectError(
      await s.post(`/api/runs/${run.id}/review`, { agentRunId: 'x', action: 'squash' }),
      400,
      'invalid_request',
    );
  });
});

describe('chat and the lead agent', () => {
  it('the first message starts the lead read-only in the project root; later ones are sent to it', async () => {
    const s = await setupControl();
    const created = await s.post('/api/runs', { projectId: s.project.id });
    const runId = (created.body as { id: string }).id;
    const res = await s.post(`/api/runs/${runId}/chat`, { text: 'Spin up two agents' });
    expect(res.status).toBe(200);
    const message = ChatMessageDtoSchema.parse(res.body);
    expect(message).toMatchObject({ runId, role: 'owner', text: 'Spin up two agents' });

    const lead = s.fake.lead();
    expect(lead.spec).toMatchObject({ kind: 'lead', cwd: s.repo, prompt: 'Spin up two agents' });
    expect(typeof lead.spec.leadTools).toBe('function');

    lead.started('lead-session-1');
    lead.emit({ type: 'activity', summary: 'Read src/app.ts' });
    lead.emit({ type: 'lead-text', text: 'Starting two agents now.' });
    let run = await s.detail(runId);
    expect(run.status).toBe('RUNNING');
    expect(run.agents[0]).toMatchObject({ status: 'RUNNING', latestActivity: 'Read src/app.ts' });
    expect(run.messages.map((m) => [m.role, m.text])).toEqual([
      ['owner', 'Spin up two agents'],
      ['lead', 'Starting two agents now.'],
    ]);
    expect(s.notices.some((n) => n.kind === 'chat-message' && n.runIds?.includes(runId))).toBe(
      true,
    );
    // Session linking from the `started` event (agent_run_sessions).
    // Not ingested yet, so no observed session is joined; the link itself is stored.
    expect(run.agents[0]?.sessionId).toBeNull();
    const links = s.db.connection
      .prepare('SELECT provider_session_id, relation FROM agent_run_sessions')
      .all();
    expect(links).toEqual([{ provider_session_id: 'lead-session-1', relation: 'primary' }]);

    const second = await s.post(`/api/runs/${runId}/chat`, { text: 'Status?' });
    expect(ChatMessageDtoSchema.parse(second.body).text).toBe('Status?');
    await s.control.idle();
    expect(lead.sent).toEqual(['Status?']);
    run = await s.detail(runId);
    expect(run.messages).toHaveLength(3);
  });

  it('denies every non-read-only tool use of the lead without asking (it works in the owner tree)', async () => {
    const s = await setupControl();
    await s.startRun();
    const lead = s.fake.lead();
    lead.started();
    const decision = await lead.ask('Edit', 'Edit src/app.ts');
    expect(decision.allow).toBe(false);
    expect(s.control.counters().leadToolUsesDenied).toBe(1);
    const run = await s.detail(s.control.listRuns()[0]?.id ?? '');
    expect(run.approvals).toEqual([]);
  });
});

describe('workers, approvals, review (the M1 flow)', () => {
  it('start → approve → finish → review → merge → COMPLETED', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    const lead = s.fake.lead();
    lead.started();

    const worker = await s.startWorker('API builder', 'Add a health endpoint');
    const path = s.worktree(runId, worker.id);
    expect(worker.spec).toMatchObject({
      kind: 'worker',
      cwd: path,
      prompt: 'Add a health endpoint',
    });
    expect(worker.spec.leadTools).toBeUndefined();
    expect(existsSync(path)).toBe(true);
    worker.started('worker-session-1');

    // Approval bridge: the SDK callback parks until the owner decides.
    let decided = false;
    const pending = worker.ask('Write', 'Write src/health.ts').then((d) => {
      decided = true;
      return d;
    });
    let run = await s.detail(runId);
    expect(decided).toBe(false);
    expect(run.status).toBe('RUNNING');
    expect(run.agents[1]).toMatchObject({ status: 'WAITING_APPROVAL', role: 'API builder' });
    const approval = run.approvals[0];
    expect(approval).toMatchObject({ kind: 'tool-use', toolName: 'Write', status: 'pending' });
    expect(run.pendingApprovals).toBe(1);
    expect(
      s.notices.some((n) => n.kind === 'approval-requested' && n.runIds?.includes(runId)),
    ).toBe(true);

    const res = await s.post(`/api/approvals/${approval?.id ?? ''}`, { decision: 'approve' });
    expect(res.status).toBe(200);
    expect(ApprovalDtoSchema.parse(res.body)).toMatchObject({ status: 'approved' });
    expect(await pending).toEqual({ allow: true });
    expectError(
      await s.post(`/api/approvals/${approval?.id ?? ''}`, { decision: 'deny' }),
      409,
      'approval_not_pending',
    );

    writeFileSync(join(path, 'src', 'health.ts'), 'export const ok = true;\n');
    worker.finish('success', 0.12);
    lead.emit({ type: 'lead-text', text: 'Done.' });
    await s.control.idle();
    expect(await lead.callLead('request_review', {})).toMatch(/review/);
    run = await s.detail(runId);
    expect(run.status).toBe('REVIEW');
    expect(run.agents[1]).toMatchObject({
      status: 'SUCCEEDED',
      review: { state: 'pending', changedFiles: null },
    });

    const review = ReviewDtoSchema.parse((await s.get(`/api/runs/${runId}/review`)).body);
    expect(review.agents).toHaveLength(1);
    expect(review.agents[0]).toMatchObject({
      agentRunId: worker.id,
      role: 'API builder',
      branch: `acp/${runId}/${worker.id}`,
      baseBranch: 'main',
      state: 'pending',
      files: [{ path: 'src/health.ts', status: 'added', additions: 1, deletions: 0 }],
      diffTruncated: false,
    });
    expect(review.agents[0]?.diff).toContain('+export const ok = true;');
    expect((await s.detail(runId)).agents[1]?.review).toEqual({
      state: 'pending',
      changedFiles: 1,
    });

    const merged = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'merge',
    });
    expect(merged.status).toBe(200);
    expect(ReviewDtoSchema.parse(merged.body).agents[0]).toMatchObject({
      state: 'merged',
      files: [],
    });
    expect(readFileSync(join(s.repo, 'src', 'health.ts'), 'utf8')).toBe(
      'export const ok = true;\n',
    );
    expect(existsSync(path)).toBe(false);
    expect(git(s.repo, 'branch', '--list', 'acp/*').trim()).toBe('');

    run = await s.detail(runId);
    expect(run.status).toBe('COMPLETED');
    expect(run.endedAt).not.toBeNull();
    // The conversation is over: the lead is stopped.
    expect(lead.aborted).toBe(true);
  });

  it('deny resolves the SDK callback with a deny and the owner message', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    s.fake.lead().started();
    const worker = await s.startWorker();
    worker.started();
    const pending = worker.ask('Bash', 'Run npm');
    const approval = (await s.detail(runId)).approvals[0];
    const res = await s.post(`/api/approvals/${approval?.id ?? ''}`, {
      decision: 'deny',
      message: 'Not now',
    });
    expect(ApprovalDtoSchema.parse(res.body).status).toBe('denied');
    expect(await pending).toEqual({ allow: false, message: 'Not now' });
    expect((await s.detail(runId)).agents[1]?.status).toBe('RUNNING');
    expectError(
      await s.post('/api/approvals/nope', { decision: 'deny' }),
      404,
      'approval_not_found',
    );
  });

  it('an approval nobody answers is denied by the expiry sweep', async () => {
    const s = await setupControl({ overrides: { approvalTimeoutMs: 60_000 } });
    const runId = (await s.startRun()).id;
    s.fake.lead().started();
    const worker = await s.startWorker();
    worker.started();
    const pending = worker.ask('Edit', 'Edit README.md');
    await s.control.idle();
    s.clock.now = new Date(s.clock.now.getTime() + 60_000);
    s.control.sweep();
    expect((await pending).allow).toBe(false);
    const run = await s.detail(runId);
    expect(run.approvals[0]?.status).toBe('expired');
    expect(run.agents[1]?.status).toBe('RUNNING');
  });

  it('POST /api/runs/:id/agents/:agentId/message sends to a worker and stores nothing', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    s.fake.lead().started();
    const worker = await s.startWorker();
    worker.started();
    const res = await s.post(`/api/runs/${runId}/agents/${worker.id}/message`, {
      text: 'Also add tests',
    });
    expect(res.status).toBe(200);
    expect(AgentRunDtoSchema.parse(res.body).id).toBe(worker.id);
    await s.control.idle();
    expect(worker.sent).toEqual(['Also add tests']);
    const stored = JSON.stringify(
      s.db.connection.prepare('SELECT text FROM orchestrator_messages').all(),
    );
    expect(stored).not.toContain('Also add tests');
  });

  it('a message to a worker that is still starting is delivered once it runs', async () => {
    const s = await setupControl();
    await s.startRun();
    const lead = s.fake.lead();
    lead.started();
    await s.control.idle();
    // No idle between: the worktree is still being created when the message arrives.
    const reply = await lead.callLead('start_agent', { role: 'Tester', task: 'Test it' });
    const workerId = /Started agent (\S+) /.exec(reply)?.[1] ?? '';
    await lead.callLead('message_agent', { agentId: workerId, text: 'Use vitest' });
    await s.control.idle();
    expect(s.fake.byId(workerId).sent).toEqual(['Use vitest']);
  });
});

describe('stop', () => {
  it('POST /api/runs/:id/agents/:agentId/stop aborts one worker and returns its AgentRunDto', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    s.fake.lead().started();
    const worker = await s.startWorker();
    worker.started();
    const res = await s.post(`/api/runs/${runId}/agents/${worker.id}/stop`);
    expect(res.status).toBe(200);
    expect(AgentRunDtoSchema.parse(res.body)).toMatchObject({
      status: 'CANCELLED',
      review: { state: 'pending' },
    });
    expect(worker.aborted).toBe(true);
    expectError(await s.post(`/api/runs/${runId}/agents/${worker.id}/stop`), 409, 'agent_not_live');
    expectError(await s.post(`/api/runs/${runId}/agents/nope/stop`), 404, 'unknown_agent');
  });

  it('POST /api/runs/:id/stop (Stop all) aborts workers then the lead and ends CANCELLED', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    const lead = s.fake.lead();
    lead.started();
    const a = await s.startWorker('A', 'Task A');
    const b = await s.startWorker('B', 'Task B');
    a.started();
    b.started();
    const pending = a.ask('Edit', 'Edit README.md');
    const res = await s.post(`/api/runs/${runId}/stop`);
    expect(res.status).toBe(200);
    expect(RunSummaryDtoSchema.parse(res.body).status).toBe('CANCELLING');
    expect((await pending).allow).toBe(false);
    expect([a.aborted, b.aborted, lead.aborted]).toEqual([true, true, true]);
    const run = await s.detail(runId);
    expect(run.status).toBe('CANCELLED');
    expect(run.agents.map((x) => x.status)).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED']);
    expectError(await s.post(`/api/runs/${runId}/stop`), 409, 'run_cancelling');
    expectError(await s.post(`/api/runs/${runId}/chat`, { text: 'hi' }), 409, 'run_cancelling');
  });

  it('a run past its deadline is timed out by the sweep', async () => {
    const s = await setupControl({ overrides: { runTimeoutMs: 1000 } });
    const runId = (await s.startRun()).id;
    const lead = s.fake.lead();
    lead.started();
    s.clock.now = new Date(s.clock.now.getTime() + 1000);
    s.control.sweep();
    const run = await s.detail(runId);
    expect(run.status).toBe('CANCELLED');
    expect(run.agents[0]?.status).toBe('TIMED_OUT');
    expect(lead.aborted).toBe(true);
  });
});

describe('ACP_MANAGED=off', () => {
  it('every control route answers 404 managed_disabled', async () => {
    const s = await setupControl({ enabled: false });
    for (const res of [
      await s.get('/api/control/token'),
      await s.get('/api/runs'),
      await s.get('/api/runs/x'),
      await s.post('/api/runs', { projectId: s.project.id }),
      await s.post('/api/approvals/x', { decision: 'approve' }),
      await s.get('/api/runs/x/review'),
    ]) {
      expectError(res, 404, 'managed_disabled');
    }
    // Phase 1 routes are untouched.
    expect((await s.get('/api/health')).status).toBe(200);
  });

  it('demo mode keeps managed off unless an adapter is injected', async () => {
    const { startServer } = await import('../../src/bootstrap.js');
    const { loadConfig } = await import('../../src/config.js');
    const { tempDir } = await import('../helpers.js');
    const { createFakeManagedAdapter } = await import('./fake-adapter.js');
    const plain = await startServer({
      config: loadConfig({ ACP_MODE: 'demo', ACP_DATA_DIR: tempDir() }),
      logger: { log() {} },
      port: 0,
    });
    try {
      expect(plain.managed).toBe(false);
      const res = await fetch(`http://127.0.0.1:${plain.port}/api/runs`);
      expect(res.status).toBe(404);
    } finally {
      await plain.close();
    }
    const injected = await startServer({
      config: loadConfig({ ACP_MODE: 'demo', ACP_DATA_DIR: tempDir() }),
      logger: { log() {} },
      port: 0,
      managedAdapter: createFakeManagedAdapter().adapter,
    });
    try {
      expect(injected.managed).toBe(true);
      const res = await fetch(`http://127.0.0.1:${injected.port}/api/control/token`);
      expect(CsrfTokenDtoSchema.parse(await res.json()).token).toHaveLength(64);
    } finally {
      await injected.close();
    }
    const off = await startServer({
      config: loadConfig({ ACP_MODE: 'demo', ACP_MANAGED: 'off', ACP_DATA_DIR: tempDir() }),
      logger: { log() {} },
      port: 0,
      managedAdapter: createFakeManagedAdapter().adapter,
    });
    try {
      expect(off.managed).toBe(false);
    } finally {
      await off.close();
    }
  });
});
