import { describe, expect, it } from 'vitest';
import {
  EventDtoSchema,
  OverviewDtoSchema,
  SessionDetailDtoSchema,
  SessionTreeDtoSchema,
  StreamNoticeDtoSchema,
  UsageSnapshotDtoSchema,
  pageSchema,
} from '../src/api/index.js';

const T = '2026-10-10T08:00:00.000Z';
const usage = {
  tokens: { input: 10, output: 200, cacheCreation: null, cacheRead: 5000 },
  recordCount: 3,
  recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 3, cacheRead: 1 },
  provenance: 'derived',
};
const summary = {
  id: 's-1',
  provider: 'claude-code',
  providerSessionId: 'sess-1',
  providerAgentId: null,
  origin: 'external',
  projectId: 'p-1',
  title: null,
  agentType: null,
  description: null,
  launchCwd: '/repo',
  gitBranch: 'main',
  entrypoint: 'claude-desktop',
  providerVersion: '2.1.263',
  models: ['model-a'],
  status: {
    value: 'stale',
    provenance: 'derived',
    basis: { lastEventAt: T, endedAt: null, evaluatedAt: T },
  },
  firstSeenAt: T,
  lastEventAt: T,
  endedAt: null,
  endReason: null,
  lastAttentionAt: null,
  directUsage: usage,
  childCount: 0,
};

describe('API DTO contracts', () => {
  it('accepts a session detail with an unknown parent and no snapshot', () => {
    const parsed = SessionDetailDtoSchema.parse({
      ...summary,
      parent: { state: 'unknown' },
      aggregateUsage: usage,
      latestSnapshot: null,
      continuationIds: [],
      ambiguousAttributionCount: 0,
    });
    expect(parsed.parent.state).toBe('unknown');
    expect(parsed.directUsage.tokens.cacheCreation).toBeNull();
  });

  it('rejects a known parent without evidence', () => {
    const result = SessionDetailDtoSchema.safeParse({
      ...summary,
      parent: {
        state: 'known',
        sessionId: 's-0',
        kind: 'subagent',
        provenance: 'observed',
        evidence: [],
      },
      aggregateUsage: usage,
      latestSnapshot: null,
      continuationIds: [],
      ambiguousAttributionCount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('never lets reported cost be authoritative or a false zero', () => {
    const base = { occurredAt: T, scope: 'unknown', byModel: {} };
    expect(
      UsageSnapshotDtoSchema.safeParse({
        ...base,
        reportedCostUsd: { provenance: 'observed', value: 1 },
      }).success,
    ).toBe(false);
    expect(
      UsageSnapshotDtoSchema.safeParse({
        ...base,
        reportedCostUsd: { provenance: 'unavailable', value: 0 },
      }).success,
    ).toBe(false);
    expect(
      UsageSnapshotDtoSchema.safeParse({
        ...base,
        reportedCostUsd: { provenance: 'estimated', value: 1.5 },
      }).success,
    ).toBe(true);
  });

  it('requires every status bucket in the overview', () => {
    const overview = {
      projectCount: 1,
      sessionsByStatus: { active: 1, idle: 0, stale: 2, ended: 0, unknown: 0 },
      totals: usage,
      needsAttention: [],
      activeSessions: [summary],
      recentEvents: [],
      candidateRootCount: 0,
    };
    expect(OverviewDtoSchema.safeParse(overview).success).toBe(true);
    const { unknown: _dropped, ...partial } = overview.sessionsByStatus;
    expect(OverviewDtoSchema.safeParse({ ...overview, sessionsByStatus: partial }).success).toBe(
      false,
    );
  });

  it('validates tree edges and paginated events', () => {
    expect(
      SessionTreeDtoSchema.safeParse({
        rootId: 's-1',
        nodes: [{ session: summary, aggregateUsage: usage }],
        edges: [
          {
            parentId: 's-1',
            childId: 's-2',
            kind: 'subagent',
            provenance: 'observed',
            evidence: ['subagent-metadata'],
          },
        ],
      }).success,
    ).toBe(true);
    const event = {
      id: 7,
      eventType: 'session.observed',
      provider: 'claude-code',
      sessionId: 's-1',
      projectId: 'p-1',
      occurredAt: T,
      observedAt: T,
      provenance: 'observed',
      channel: 'transcript',
      providerVersion: '2.1.263',
      payload: { cwd: '/repo' },
    };
    const page = pageSchema(EventDtoSchema).parse({ items: [event], page: { nextCursor: null } });
    expect(page.items[0]?.id).toBe(7);
    expect(EventDtoSchema.safeParse({ ...event, eventType: 'session.completed' }).success).toBe(
      false,
    );
  });

  it('keeps SSE notices to invalidation data', () => {
    expect(
      StreamNoticeDtoSchema.parse({
        kind: 'events-ingested',
        lastEventId: 9,
        sessionIds: ['s-1'],
        projectIds: [],
      }).lastEventId,
    ).toBe(9);
  });
});
