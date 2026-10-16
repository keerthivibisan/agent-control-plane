// Synthetic events through the real pipeline (R-J). Never the Agent SDK, never ~/.claude.
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
 * A follow-up turn resumes the lead's session (ADR-0020): Claude Code appends to the same
 * transcript under the same session id, so the transcript tailer attributes the new messages to
 * the lead through its existing session link. Dedup by (provider, messageId) means a message the
 * resumed stream repeats is counted once, at its earliest occurrence; nothing is summed twice.
 */

const BEFORE = '2026-10-12T10:00:00.000Z';
const AFTER = '2026-10-13T10:00:00.000Z';

describe('usage of a follow-up turn (ADR-0020)', () => {
  it('goes to the lead through the same session, with a repeated message counted once', async () => {
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
    const e = (dedupKey: string, occurredAt: string) => ({
      dedupKey,
      sessionId: 'sess-lead',
      occurredAt,
    });
    // The lead's own run.
    base.pipeline.ingestEvents([
      observed(e('o-lead', BEFORE), '/home/user/web'),
      usage(e('u-1', BEFORE), 'm1', tokens(10, 100, 5, 1000)),
    ]);
    // The follow-up turn, appended to the same session later: one new message, and a repeat of
    // m1 (a replayed line), which must not be counted again.
    base.pipeline.ingestEvents([
      usage(e('u-1-replayed', AFTER), 'm1', tokens(10, 100, 5, 1000)),
      usage(e('u-2', AFTER), 'm2', tokens(3, 30, 0, 2000)),
    ]);

    const app = express();
    app.use(requestId);
    app.use('/api', createTokensRouter(createTokensService({ db: base.db })));
    app.use('/api', notFoundHandler);
    app.use(errorHandler(silentLogger));
    const res = await request(app).get(`/api/projects/${web.id}/tokens`);
    expect(res.status).toBe(200);
    const dto = ProjectTokensDtoSchema.parse(res.body);
    expect(dto.sessions).toEqual({ total: 1, withUsage: 1 });
    expect(dto.totals.tokens).toEqual({
      input: 13,
      output: 130,
      cacheCreation: 5,
      cacheRead: 3000,
    });
    expect(dto.totals.recordCount).toBe(2);
    expect(dto.byRole.map((r) => [r.role, r.usage.recordCount])).toEqual([['lead', 2]]);
    // m1 stays on its first day; the follow-up's own message is on the later one.
    expect(dto.byDay.map((d) => [d.day, d.usage.tokens.output])).toEqual([
      ['2026-10-12', 100],
      ['2026-10-13', 30],
    ]);
  });
});
