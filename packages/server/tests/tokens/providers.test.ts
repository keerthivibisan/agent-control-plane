// Synthetic events through the real pipeline (CX-6b). Ids, models and numbers are fake.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, ProviderId } from '@acp/core';
import { ProjectTokensDtoSchema } from '@acp/core/api';
import { errorHandler, notFoundHandler, requestId } from '../../src/http/middleware.js';
import { silentLogger } from '../../src/logger.js';
import { createTokensRouter } from '../../src/routes/tokens.js';
import { createTokensService } from '../../src/tokens/service.js';
import { envelope, observed, setupPipeline, tokens, usage } from '../helpers.js';

const DAY1 = '2026-11-05T10:00:00.000Z';

const as = (provider: ProviderId, event: NormalizedEvent) =>
  ({ ...event, provider }) as NormalizedEvent;

function snapshot(dedupKey: string, sessionId: string, cost: number | null) {
  return {
    ...envelope({ dedupKey, sessionId, occurredAt: DAY1 }),
    eventType: 'usage.snapshot',
    payload: { kind: 'cumulative-snapshot', scope: 'unknown', byModel: {}, reportedCostUsd: cost },
  } as NormalizedEvent;
}

/**
 * Project "web": a Claude Code session and a Codex session that both report the model name
 * "shared-model", plus a Codex record with no model. Claude reports a cost; Codex reports none.
 */
function setup() {
  const base = setupPipeline();
  const web = base.repos.projects.insert({ name: 'web', rootPath: '/home/user/web' });
  const e = (dedupKey: string, sessionId: string) => ({ dedupKey, sessionId, occurredAt: DAY1 });
  base.pipeline.ingestEvents([
    observed(e('o-c', 'sess-claude'), '/home/user/web'),
    as('codex', observed(e('o-x', 'thread-codex'), '/home/user/web')),
    usage(e('u-c-1', 'sess-claude'), 'm1', tokens(10, 100, 5, 1000), 'shared-model'),
    as(
      'codex',
      usage(e('u-x-1', 'thread-codex'), 'turn:t1', tokens(3, 30, 0, 300), 'shared-model'),
    ),
    as('codex', usage(e('u-x-2', 'thread-codex'), 'turn:t2', tokens(1, 10, null, null), null)),
    snapshot('s-c', 'sess-claude', 0.75),
    as('codex', snapshot('s-x', 'thread-codex', null)),
  ]);
  const app = express();
  app.use(requestId);
  app.use('/api', createTokensRouter(createTokensService({ db: base.db })));
  app.use('/api', notFoundHandler);
  app.use(errorHandler(silentLogger));
  const sessionId = (provider: ProviderId, providerSessionId: string) => {
    const s = base.repos.sessions.getByKey({ provider, providerSessionId, providerAgentId: null });
    if (s === undefined) throw new Error(`session ${providerSessionId} missing`);
    return s.id;
  };
  return { app, web, sessionId };
}

describe('GET /api/projects/:id/tokens by provider (CX-6b)', () => {
  it('keeps the same model name from two providers in two rows, each with its provider', async () => {
    const s = setup();
    const res = await request(s.app).get(`/api/projects/${s.web.id}/tokens`);
    expect(res.status).toBe(200);
    const dto = ProjectTokensDtoSchema.parse(res.body);
    expect(dto.byModel.map((m) => [m.provider, m.model, m.usage.recordCount])).toEqual([
      ['claude-code', 'shared-model', 1],
      ['codex', 'shared-model', 1],
      ['codex', 'unknown', 1],
    ]);
    const codexShared = dto.byModel.find(
      (m) => m.provider === 'codex' && m.model === 'shared-model',
    );
    expect(codexShared?.usage.tokens).toEqual(tokens(3, 30, 0, 300));
  });

  it('carries each session’s provider; the totals per provider add up; null cost stays null', async () => {
    const s = setup();
    const dto = ProjectTokensDtoSchema.parse(
      (await request(s.app).get(`/api/projects/${s.web.id}/tokens`)).body,
    );
    const claude = dto.bySession.find(
      (r) => r.sessionId === s.sessionId('claude-code', 'sess-claude'),
    );
    const codex = dto.bySession.find((r) => r.sessionId === s.sessionId('codex', 'thread-codex'));
    expect(claude?.provider).toBe('claude-code');
    expect(codex?.provider).toBe('codex');
    expect(claude?.usage.tokens).toEqual(tokens(10, 100, 5, 1000));
    // Codex: 3+1 input, 30+10 output; the second record's cache types are unavailable, not 0.
    expect(codex?.usage.tokens).toEqual(tokens(4, 40, 0, 300));
    expect(codex?.usage.recordsWithUnavailable).toMatchObject({ cacheCreation: 1, cacheRead: 1 });
    expect(claude?.latestEstimatedCost).toEqual({ provenance: 'estimated', value: 0.75 });
    // ADR-0032 §6: Codex reports no cost, so it is unavailable, never $0.
    expect(codex?.latestEstimatedCost).toEqual({ provenance: 'unavailable', value: null });
    expect(dto.totals.tokens).toEqual(tokens(14, 140, 5, 1300));
  });
});
