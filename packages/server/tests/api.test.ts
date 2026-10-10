import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  CandidateRootDtoSchema,
  CapabilitiesDtoSchema,
  DiagnosticsDtoSchema,
  ErrorDtoSchema,
  HealthDtoSchema,
  OverviewDtoSchema,
  ProjectDtoSchema,
  SessionDetailDtoSchema,
  SessionSummaryDtoSchema,
  SessionTreeDtoSchema,
  UsageSummaryDtoSchema,
  EventDtoSchema,
  pageSchema,
} from '@acp/core/api';
import { setupApp } from './helpers.js';

const SessionPage = pageSchema(SessionSummaryDtoSchema);
const EventPage = pageSchema(EventDtoSchema);

describe('API: contracts (every response is parsed by its DTO schema)', () => {
  it('health, capabilities, candidates, diagnostics', async () => {
    const { app } = await setupApp();
    expect(HealthDtoSchema.parse((await request(app).get('/api/health')).body).mode).toBe('demo');

    const caps = CapabilitiesDtoSchema.parse((await request(app).get('/api/capabilities')).body);
    expect(caps.providers[0]?.provider).toBe('demo');
    expect(caps.hooks.receivedAny).toBe(false);

    const diag = DiagnosticsDtoSchema.parse(
      (await request(app).get('/api/diagnostics/ingestion')).body,
    );
    expect(diag.sources.length).toBe(6);
    expect(diag.sources.every((s) => s.sourcePath.startsWith('demo://'))).toBe(true);
    expect(diag.unrecognized.length).toBe(1); // the demo's unrecognized record

    const res = await request(app).get('/api/discovery/candidates');
    expect(CandidateRootDtoSchema.array().parse(res.body)).toEqual([]);
  });

  it('lists candidates outside registered roots', async () => {
    const { app, repos } = await setupApp();
    const web = repos.projects.list().find((p) => p.name === 'demo-web');
    repos.projects.remove(web!.id);
    const res = await request(app).get('/api/discovery/candidates');
    expect(
      CandidateRootDtoSchema.array()
        .parse(res.body)
        .map((c) => c.cwd),
    ).toEqual(['/home/user/demo-web']);
  });

  it('overview counts statuses from the data and never invents totals', async () => {
    const { app, queries } = await setupApp();
    const o = OverviewDtoSchema.parse((await request(app).get('/api/overview')).body);
    expect(o.projectCount).toBe(2);
    expect(Object.values(o.sessionsByStatus).reduce((a, b) => a + b, 0)).toBe(6);
    expect(
      o.sessionsByStatus.stale +
        o.sessionsByStatus.active +
        o.sessionsByStatus.idle +
        o.sessionsByStatus.ended +
        o.sessionsByStatus.unknown,
    ).toBe(6);
    expect(o.totals.recordCount).toBe(
      queries.usageSummary('model').reduce((n, g) => n + g.totals.recordCount, 0),
    );
    expect(o.recentEvents.length).toBe(20);
    expect(o.needsAttention.every((s) => s.lastAttentionAt !== null)).toBe(true);
  });

  it('sessions list, detail and events', async () => {
    const { app } = await setupApp();
    const list = SessionPage.parse((await request(app).get('/api/sessions?limit=200')).body);
    expect(list.items.length).toBe(6);
    expect(list.page.nextCursor).toBeNull();

    const main = list.items.find((s) => s.title !== null && s.childCount === 2);
    expect(main).toBeDefined();
    const detail = SessionDetailDtoSchema.parse(
      (await request(app).get(`/api/sessions/${main!.id}`)).body,
    );
    expect(detail.parent).toEqual({ state: 'unknown' });
    // Aggregate includes the two subagents; direct usage does not.
    expect(detail.aggregateUsage.recordCount).toBeGreaterThan(detail.directUsage.recordCount);
    expect(detail.latestSnapshot?.reportedCostUsd.provenance).toBe('estimated');

    const events = EventPage.parse(
      (await request(app).get(`/api/sessions/${main!.id}/events?limit=5`)).body,
    );
    expect(events.items.length).toBe(5);
    expect(events.page.nextCursor).not.toBeNull();
    const next = EventPage.parse(
      (
        await request(app).get(
          `/api/sessions/${main!.id}/events?limit=5&cursor=${events.page.nextCursor}`,
        )
      ).body,
    );
    expect(next.items[0]!.id).toBeLessThan(events.items.at(-1)!.id);

    const all = EventPage.parse((await request(app).get('/api/events?limit=3')).body);
    expect(all.items.length).toBe(3);
  });

  it('subagent detail names its parent with evidence; tree is rooted at the topmost ancestor', async () => {
    const { app } = await setupApp();
    const list = SessionPage.parse((await request(app).get('/api/sessions?limit=200')).body);
    const child = list.items.find((s) => s.providerAgentId !== null)!;
    const detail = SessionDetailDtoSchema.parse(
      (await request(app).get(`/api/sessions/${child.id}`)).body,
    );
    expect(detail.parent).toMatchObject({
      state: 'known',
      kind: 'subagent',
      provenance: 'observed',
    });

    const tree = SessionTreeDtoSchema.parse(
      (await request(app).get(`/api/sessions/${child.id}/tree`)).body,
    );
    const root = tree.nodes.find((n) => n.session.id === tree.rootId)!;
    expect(root.session.providerAgentId).toBeNull();
    // main + two subagents + the fork (a continuation edge, derived from shared message ids)
    expect(tree.nodes.length).toBe(4);
    expect(tree.edges.filter((e) => e.kind === 'subagent').length).toBe(2);
    const continuation = tree.edges.filter((e) => e.kind === 'continuation');
    expect(continuation).toHaveLength(1);
    expect(continuation[0]).toMatchObject({ provenance: 'derived', parentId: tree.rootId });
    expect(continuation[0]?.evidence).toEqual(['shared-message-history']);
    expect(tree.edges.every((e) => e.evidence.length > 0)).toBe(true);
    expect(root.aggregateUsage.recordCount).toBeGreaterThan(root.session.directUsage.recordCount);
  });

  it('usage summary for every grouping: groups sum direct usage and match totals', async () => {
    const { app } = await setupApp();
    for (const groupBy of ['project', 'session', 'model', 'day']) {
      const res = await request(app).get(`/api/usage/summary?groupBy=${groupBy}`);
      const s = UsageSummaryDtoSchema.parse(res.body);
      expect(s.groupBy).toBe(groupBy);
      expect(s.groups.length).toBeGreaterThan(0);
      expect(s.groups.reduce((n, g) => n + g.usage.recordCount, 0)).toBe(s.totals.recordCount);
    }
    const byProject = UsageSummaryDtoSchema.parse(
      (await request(app).get('/api/usage/summary?groupBy=project')).body,
    );
    expect(byProject.groups.map((g) => g.label).sort()).toEqual(['demo-api', 'demo-web']);
  });

  it('keeps unavailable usage as null in responses', async () => {
    const { app } = await setupApp();
    const s = UsageSummaryDtoSchema.parse(
      (await request(app).get('/api/usage/summary?groupBy=session')).body,
    );
    const anyNull = s.groups.some((g) => Object.values(g.usage.tokens).some((v) => v === null));
    const anyPartial = s.groups.some((g) =>
      Object.values(g.usage.recordsWithUnavailable).some((n) => n > 0),
    );
    expect(anyNull || anyPartial).toBe(true);
  });
});

describe('API: filters and pagination', () => {
  it('paginates with an opaque keyset cursor without gaps or repeats', async () => {
    const { app } = await setupApp();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get(
        `/api/sessions?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      const page = SessionPage.parse(res.body);
      seen.push(...page.items.map((s) => s.id));
      cursor = page.page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen.length).toBe(6);
    expect(new Set(seen).size).toBe(6);
  });

  it('filters by status, project, provider, model and search', async () => {
    const { app, repos } = await setupApp();
    const all = SessionPage.parse((await request(app).get('/api/sessions?limit=200')).body).items;
    const statuses = new Set(all.map((s) => s.status.value));
    for (const status of statuses) {
      const page = SessionPage.parse(
        (await request(app).get(`/api/sessions?status=${status}&limit=200`)).body,
      );
      expect(page.items.length).toBe(all.filter((s) => s.status.value === status).length);
      expect(page.items.every((s) => s.status.value === status)).toBe(true);
    }
    const api = repos.projects.list().find((p) => p.name === 'demo-api')!;
    const byProject = SessionPage.parse(
      (await request(app).get(`/api/sessions?projectId=${api.id}`)).body,
    );
    expect(byProject.items.length).toBe(4);
    const paged = SessionPage.parse(
      (await request(app).get(`/api/projects/${api.id}/sessions`)).body,
    );
    expect(paged.items.length).toBe(4);
    expect(
      SessionPage.parse((await request(app).get('/api/sessions?provider=claude-code')).body).items,
    ).toEqual([]);
    const firstModel = all.flatMap((s) => s.models)[0]!;
    const byModel = SessionPage.parse(
      (await request(app).get(`/api/sessions?model=${firstModel}&limit=200`)).body,
    );
    expect(byModel.items.length).toBeGreaterThan(0);
    const search = SessionPage.parse(
      (await request(app).get(`/api/sessions?q=${all[0]!.providerSessionId.slice(0, 12)}`)).body,
    );
    expect(search.items.length).toBeGreaterThan(0);
  });
});

describe('API: errors', () => {
  it('returns ErrorDto with a matching request id for 400 and 404', async () => {
    const { app } = await setupApp();
    const cases: [string, number, string][] = [
      ['/api/sessions?status=completed', 400, 'invalid_request'],
      ['/api/sessions?limit=0', 400, 'invalid_request'],
      ['/api/sessions?cursor=%25%25', 400, 'invalid_cursor'],
      ['/api/usage/summary', 400, 'invalid_request'],
      ['/api/usage/summary?groupBy=weekday', 400, 'invalid_request'],
      ['/api/usage/summary?groupBy=day&from=yesterday', 400, 'invalid_request'],
      ['/api/sessions/does-not-exist', 404, 'not_found'],
      ['/api/sessions/does-not-exist/tree', 404, 'not_found'],
      ['/api/sessions/does-not-exist/events', 404, 'not_found'],
      ['/api/projects/nope', 404, 'not_found'],
      ['/api/projects/nope/sessions', 404, 'not_found'],
      ['/api/unknown', 404, 'not_found'],
    ];
    for (const [url, status, code] of cases) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(status);
      const body = ErrorDtoSchema.parse(res.body);
      expect(body.error.code, url).toBe(code);
      expect(body.error.requestId).toBe(res.headers['x-request-id']);
    }
  });
});

describe('API: project registration', () => {
  it('registers a project, re-associates unassigned sessions, notifies and requests a poll', async () => {
    const s = await setupApp({ ingestDemo: false });
    // A session observed before any project exists stays unassigned.
    s.pipeline.ingestEvents([
      {
        schemaVersion: 1,
        provider: 'claude-code',
        dedupKey: 'o',
        sourceEventId: null,
        providerSessionId: 'early',
        providerAgentId: null,
        occurredAt: '2026-10-10T08:00:00.000Z',
        observedAt: '2026-10-10T08:00:01.000Z',
        provenance: 'observed',
        source: {
          channel: 'transcript',
          providerVersion: null,
          path: null,
          byteOffset: null,
          hookEvent: null,
        },
        eventType: 'session.observed',
        payload: { cwd: '/work/app/sub', gitBranch: null, entrypoint: null },
      },
    ]);
    s.notices.length = 0;

    const res = await request(s.app)
      .post('/api/projects')
      .send({ name: 'app', rootPath: '/work/app' });
    expect(res.status).toBe(201);
    const project = ProjectDtoSchema.parse(res.body);
    expect(project.sessionCount).toBe(1);
    expect(s.notices).toMatchObject([{ kind: 'projects-changed', projectIds: [project.id] }]);
    expect(s.polls.length).toBe(1);

    const list = ProjectDtoSchema.array().parse((await request(s.app).get('/api/projects')).body);
    expect(list.map((p) => p.name)).toEqual(['app']);
    expect(
      ProjectDtoSchema.parse((await request(s.app).get(`/api/projects/${project.id}`)).body).id,
    ).toBe(project.id);
  });

  it('rejects bad input (400), duplicate roots (409) and unusable paths with ErrorDto', async () => {
    const s = await setupApp({
      ingestDemo: false,
      normalizeRoot: async (p) => {
        if (p.includes('missing')) {
          const { HttpError } = await import('../src/errors.js');
          throw new HttpError(400, 'invalid_root', 'Root path does not exist');
        }
        return p;
      },
    });
    const post = (body: unknown) =>
      request(s.app)
        .post('/api/projects')
        .send(body as object);
    expect((await post({ name: '', rootPath: '/x' })).status).toBe(400);
    expect((await post({ name: 'n', rootPath: 'relative/path' })).status).toBe(400);
    expect((await post({ name: 'n' })).status).toBe(400);
    const missing = await post({ name: 'n', rootPath: '/missing/dir' });
    expect(missing.status).toBe(400);
    expect(ErrorDtoSchema.parse(missing.body).error.code).toBe('invalid_root');
    expect(
      (
        await request(s.app)
          .post('/api/projects')
          .set('Content-Type', 'application/json')
          .send('{bad')
      ).status,
    ).toBe(400);

    expect((await post({ name: 'n', rootPath: '/ok' })).status).toBe(201);
    const dup = await post({ name: 'other', rootPath: '/ok' });
    expect(dup.status).toBe(409);
    expect(ErrorDtoSchema.parse(dup.body).error.code).toBe('conflict');
  });
});

describe('API: local-only guard', () => {
  it('rejects foreign hosts, foreign origins and CORS preflights; allows the dev UI origin', async () => {
    const { app } = await setupApp({ ingestDemo: false });
    const foreignHost = await request(app).get('/api/health').set('Host', 'evil.example');
    expect(foreignHost.status).toBe(403);
    const foreignOrigin = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example');
    expect(foreignOrigin.status).toBe(403);
    expect(foreignOrigin.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(app)
      .options('/api/projects')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.status).toBe(403);
    const dev = await request(app).get('/api/health').set('Origin', 'http://127.0.0.1:5173');
    expect(dev.status).toBe(200);
    expect(ErrorDtoSchema.safeParse(foreignOrigin.body).success).toBe(true);
  });
});
