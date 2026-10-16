// Synthetic events through the real pipeline (R-F). Never the Agent SDK, never ~/.claude.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '@acp/core';
import { ProjectTokensDtoSchema } from '@acp/core/api';
import { createOrchestrationRepositories } from '@acp/db';
import { errorHandler, notFoundHandler, requestId } from '../../src/http/middleware.js';
import { silentLogger } from '../../src/logger.js';
import { createTokensRouter } from '../../src/routes/tokens.js';
import { createTokensService } from '../../src/tokens/service.js';
import { envelope, observed, setupPipeline, tokens, usage } from '../helpers.js';

const DAY1 = '2026-10-12T10:00:00.000Z';
const DAY2 = '2026-10-13T10:00:00.000Z';

function snapshot(dedupKey: string, sessionId: string, occurredAt: string, cost: number | null) {
  return {
    ...envelope({ dedupKey, sessionId, occurredAt }),
    eventType: 'usage.snapshot',
    payload: { kind: 'cumulative-snapshot', scope: 'unknown', byModel: {}, reportedCostUsd: cost },
  } as NormalizedEvent;
}

/**
 * Project "web": `sess-a` (external), its fork `sess-fork` (copies m1 with the same time), and
 * `sess-lead`, the lead of a run. `sess-other` belongs to another project.
 */
function setup() {
  const base = setupPipeline();
  const web = base.repos.projects.insert({ name: 'web', rootPath: '/home/user/web' });
  base.repos.projects.insert({ name: 'other', rootPath: '/home/user/other' });

  const orch = createOrchestrationRepositories(base.db);
  const run = orch.runs.insert({
    projectId: web.id,
    title: 'Ad hoc',
    budget: { maxTokensPerAgent: 500_000, softCostUsdPerRun: null },
  });
  const lead = orch.agentRuns.insert({
    runId: run.id,
    kind: 'lead',
    parentAgentRunId: null,
    role: 'Lead',
    task: null,
  });
  orch.agentRunSessions.link({
    agentRunId: lead.id,
    provider: 'claude-code',
    providerSessionId: 'sess-lead',
    relation: 'primary',
  });

  const e = (dedupKey: string, sessionId: string, occurredAt = DAY1) => ({
    dedupKey,
    sessionId,
    occurredAt,
  });
  base.pipeline.ingestEvents([
    observed(e('o-a', 'sess-a'), '/home/user/web'),
    observed(e('o-fork', 'sess-fork'), '/home/user/web'),
    observed(e('o-lead', 'sess-lead'), '/home/user/web/src'),
    observed(e('o-other', 'sess-other'), '/home/user/other'),
    usage(e('u-a-1', 'sess-a'), 'm1', tokens(10, 100, 5, 1000), 'claude-opus-4-1'),
    // The fork's copy of m1 keeps the original time: one message, counted once.
    usage(e('u-fork-1', 'sess-fork'), 'm1', tokens(10, 100, 5, 1000), 'claude-opus-4-1'),
    usage(e('u-a-2', 'sess-a', DAY2), 'm2', tokens(null, 20, null, null), null),
    usage(e('u-lead-1', 'sess-lead', DAY2), 'm3', tokens(4, 40, 4, 400), 'claude-sonnet-4-5'),
    usage(e('u-other', 'sess-other', DAY2), 'm4', tokens(9, 9, 9, 9), 'claude-opus-4-1'),
    snapshot('s-a-1', 'sess-a', DAY1, 0.5),
    snapshot('s-a-2', 'sess-a', DAY2, 1.25),
  ]);

  const app = express();
  app.use(requestId);
  app.use('/api', createTokensRouter(createTokensService({ db: base.db })));
  app.use('/api', notFoundHandler);
  app.use(errorHandler(silentLogger));
  const sessionId = (providerSessionId: string) => {
    const s = base.repos.sessions.getByKey({
      provider: 'claude-code',
      providerSessionId,
      providerAgentId: null,
    });
    if (s === undefined) throw new Error(`session ${providerSessionId} missing`);
    return s.id;
  };
  return { app, web, sessionId };
}

function errorCode(res: { body: unknown }): string {
  return (res.body as { error: { code: string } }).error.code;
}

describe('GET /api/projects/:id/tokens (R-F)', () => {
  it('answers ProjectTokensDto: direct usage, the fork copy counted once, roles', async () => {
    const s = setup();
    const res = await request(s.app).get(`/api/projects/${s.web.id}/tokens`);
    expect(res.status).toBe(200);
    const dto = ProjectTokensDtoSchema.parse(res.body);
    expect(dto.projectId).toBe(s.web.id);
    expect(dto.range).toEqual({ from: null, to: null });
    expect(dto.sessions).toEqual({ total: 3, withUsage: 2 });
    expect(dto.runs).toBe(1);
    expect(dto.ticketsWithRuns).toBe(0);
    expect(dto.totals).toEqual({
      tokens: { input: 14, output: 160, cacheCreation: 9, cacheRead: 1400 },
      recordCount: 3,
      recordsWithUnavailable: { input: 1, output: 0, cacheCreation: 1, cacheRead: 1 },
      provenance: 'derived',
    });
    expect(dto.headline).toEqual({
      newWork: 174,
      totalProcessed: 1583,
      cacheReuseShare: 1400 / 1583,
      provenance: 'derived',
    });
    expect(dto.byRole.map((r) => [r.role, r.usage.recordCount])).toEqual([
      ['lead', 1],
      ['external', 2],
    ]);
    expect(dto.byTicket).toEqual([]);
    expect(dto.byDay.map((d) => d.day)).toEqual(['2026-10-12', '2026-10-13']);
    expect(dto.byModel.map((m) => m.model)).toEqual([
      'claude-opus-4-1',
      'claude-sonnet-4-5',
      'unknown',
    ]);

    const a = dto.bySession.find((r) => r.sessionId === s.sessionId('sess-a'));
    // The latest provider-reported running total, estimated; never added up.
    expect(a?.latestEstimatedCost).toEqual({ provenance: 'estimated', value: 1.25 });
    expect(a?.usage.recordCount).toBe(2);
    const lead = dto.bySession.find((r) => r.sessionId === s.sessionId('sess-lead'));
    expect(lead?.latestEstimatedCost).toBeNull();
    expect(dto.bySession.some((r) => r.sessionId === s.sessionId('sess-fork'))).toBe(false);
  });

  it('filters by range (from inclusive, to exclusive)', async () => {
    const s = setup();
    const res = await request(s.app)
      .get(`/api/projects/${s.web.id}/tokens`)
      .query({ from: '2026-10-13T00:00:00.000Z', to: '2026-10-14T00:00:00+00:00' });
    expect(res.status).toBe(200);
    const dto = ProjectTokensDtoSchema.parse(res.body);
    expect(dto.range).toEqual({ from: '2026-10-13T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' });
    expect(dto.totals.tokens).toEqual({ input: 4, output: 60, cacheCreation: 4, cacheRead: 400 });
    expect(dto.byDay.map((d) => d.day)).toEqual(['2026-10-13']);
  });

  it('is 404 for an unknown project', async () => {
    const s = setup();
    const res = await request(s.app).get('/api/projects/nope/tokens');
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('not_found');
  });

  it('is 400 for a bad range', async () => {
    const s = setup();
    const path = `/api/projects/${s.web.id}/tokens`;
    for (const query of [
      { from: 'yesterday' },
      { to: '2026-13-01T00:00:00Z' },
      { from: '2026-10-14T00:00:00.000Z', to: '2026-10-13T00:00:00.000Z' },
      { from: '2026-10-13T00:00:00.000Z', to: '2026-10-13T00:00:00.000Z' },
      { from: ['2026-10-13T00:00:00.000Z', '2026-10-14T00:00:00.000Z'] },
    ]) {
      const res = await request(s.app).get(path).query(query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(errorCode(res)).toBe('invalid_range');
    }
  });
});
