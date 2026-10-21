// Synthetic events through the real pipeline (v0.3.0 S-A, ADR-0024 §2). Never the Agent SDK,
// never ~/.claude.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ProjectTokensDtoSchema } from '@acp/core/api';
import { createOrchestrationRepositories } from '@acp/db';
import { errorHandler, notFoundHandler, requestId } from '../../src/http/middleware.js';
import { silentLogger } from '../../src/logger.js';
import { createTokensRouter } from '../../src/routes/tokens.js';
import { createTokensService } from '../../src/tokens/service.js';
import { observed, setupPipeline, tokens, usage } from '../helpers.js';

/*
 * The Tokens page's per-session rows carry what the session list names a session from
 * (`managed`, `firstSeenAt`, `gitBranch`, `agentType`), so both lists use the same names.
 */

const AT = '2026-10-12T10:00:00.000Z';

describe('session names on the Tokens page (ADR-0024 §2)', () => {
  it('names the app’s sessions and gives every row its naming fields', async () => {
    const base = setupPipeline();
    const web = base.repos.projects.insert({ name: 'web', rootPath: '/home/user/web' });
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
    const e = (sessionId: string, dedupKey: string) => ({ dedupKey, sessionId, occurredAt: AT });
    base.pipeline.ingestEvents([
      observed(e('sess-lead', 'o-lead'), '/home/user/web'),
      usage(e('sess-lead', 'u-lead'), 'm1', tokens(10, 100, 5, 1000)),
      observed(e('sess-own', 'o-own'), '/home/user/web'),
      usage(e('sess-own', 'u-own'), 'm2', tokens(1, 10, 0, 0)),
    ]);

    const app = express();
    app.use(requestId);
    app.use('/api', createTokensRouter(createTokensService({ db: base.db })));
    app.use('/api', notFoundHandler);
    app.use(errorHandler(silentLogger));
    const res = await request(app).get(`/api/projects/${web.id}/tokens`);
    expect(res.status).toBe(200);
    const dto = ProjectTokensDtoSchema.parse(res.body);
    const rows = base.repos.sessions.getByIds(dto.bySession.map((s) => s.sessionId));
    const rowOf = (providerSessionId: string) => {
      const row = rows.find((r) => r.providerSessionId === providerSessionId);
      if (row === undefined) throw new Error(`no session ${providerSessionId}`);
      return row;
    };
    const leadRow = rowOf('sess-lead');
    const ownRow = rowOf('sess-own');
    const byId = new Map(dto.bySession.map((s) => [s.sessionId, s]));

    // A run without a ticket: the label alone (its session title is `Run · Lead`).
    expect(byId.get(leadRow.id)?.managed).toEqual({
      runId: run.id,
      agentRunId: lead.id,
      ticketKey: null,
      kind: 'lead',
      label: 'Lead',
    });
    expect(byId.get(ownRow.id)).not.toHaveProperty('managed');
    for (const row of [leadRow, ownRow]) {
      expect(byId.get(row.id)).toMatchObject({
        firstSeenAt: row.firstSeenAt,
        gitBranch: row.gitBranch,
        agentType: row.agentType,
      });
    }
  });
});
