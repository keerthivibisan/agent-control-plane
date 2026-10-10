/**
 * Synthetic, test-only API responses. Every builder parses its output with the @acp/core/api
 * schema, so a fixture that drifts from the contract fails loudly instead of testing a fiction.
 * Never import this from src/.
 */
import {
  CandidateRootDtoSchema,
  CapabilitiesDtoSchema,
  EventDtoSchema,
  HealthDtoSchema,
  OverviewDtoSchema,
  ProjectDtoSchema,
  SessionDetailDtoSchema,
  SessionSummaryDtoSchema,
  SessionTreeDtoSchema,
  UsageSummaryDtoSchema,
  UsageTotalsDtoSchema,
  type CandidateRootDto,
  type CapabilitiesDto,
  type EventDto,
  type HealthDto,
  type OverviewDto,
  type ProjectDto,
  type SessionDetailDto,
  type SessionEdgeDto,
  type SessionSummaryDto,
  type SessionTreeDto,
  type UsageSummaryDto,
  type UsageTotalsDto,
} from '@acp/core/api';

export const T0 = '2026-10-10T08:00:00.000Z';
export const T1 = '2026-10-10T08:05:00.000Z';
export const T2 = '2026-10-10T08:30:00.000Z';

export function usage(over: Partial<UsageTotalsDto> = {}): UsageTotalsDto {
  return UsageTotalsDtoSchema.parse({
    tokens: { input: 1200, output: 3400, cacheCreation: 500, cacheRead: 98000 },
    recordCount: 4,
    recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    provenance: 'derived',
    ...over,
  });
}

/** Usage where no record reported cache creation, and one record lacked cache read. */
export const partialUsage = usage({
  tokens: { input: 10, output: 200, cacheCreation: null, cacheRead: 5000 },
  recordCount: 3,
  recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 3, cacheRead: 1 },
});

export function session(over: Partial<SessionSummaryDto> & { id: string }): SessionSummaryDto {
  return SessionSummaryDtoSchema.parse({
    provider: 'claude-code',
    providerSessionId: `prov-${over.id}`,
    providerAgentId: null,
    origin: 'external',
    projectId: 'p-1',
    title: null,
    agentType: null,
    description: null,
    launchCwd: '/work/repo',
    gitBranch: 'main',
    entrypoint: 'sdk-cli',
    providerVersion: '2.1.0',
    models: ['model-a'],
    status: {
      value: 'active',
      provenance: 'derived',
      basis: { lastEventAt: T1, endedAt: null, evaluatedAt: T1 },
    },
    firstSeenAt: T0,
    lastEventAt: T1,
    endedAt: null,
    endReason: null,
    lastAttentionAt: null,
    directUsage: usage(),
    childCount: 0,
    ...over,
  });
}

export function detail(over: Partial<SessionDetailDto> & { id: string }): SessionDetailDto {
  const { parent, aggregateUsage, latestSnapshot, continuationIds, ...summary } = over;
  return SessionDetailDtoSchema.parse({
    ...session(summary),
    parent: parent ?? { state: 'unknown' },
    aggregateUsage: aggregateUsage ?? usage({ recordCount: 9 }),
    latestSnapshot: latestSnapshot ?? null,
    continuationIds: continuationIds ?? [],
  });
}

export function project(over: Partial<ProjectDto> & { id: string }): ProjectDto {
  return ProjectDtoSchema.parse({
    name: `project-${over.id}`,
    rootPath: `/work/${over.id}`,
    createdAt: T0,
    updatedAt: T0,
    sessionCount: 2,
    lastEventAt: T1,
    ...over,
  });
}

export function event(over: Partial<EventDto> & { id: number }): EventDto {
  return EventDtoSchema.parse({
    eventType: 'session.observed',
    provider: 'claude-code',
    sessionId: 's-1',
    projectId: 'p-1',
    occurredAt: T0,
    observedAt: T0,
    provenance: 'observed',
    channel: 'transcript',
    providerVersion: '2.1.0',
    payload: { cwd: '/work/repo', gitBranch: 'main', entrypoint: 'sdk-cli' },
    ...over,
  });
}

export function overview(over: Partial<OverviewDto> = {}): OverviewDto {
  return OverviewDtoSchema.parse({
    projectCount: 1,
    sessionsByStatus: { active: 1, idle: 2, stale: 3, ended: 4, unknown: 0 },
    totals: usage(),
    needsAttention: [],
    activeSessions: [],
    recentEvents: [],
    candidateRootCount: 0,
    ...over,
  });
}

export function capabilities(over: Partial<CapabilitiesDto> = {}): CapabilitiesDto {
  return CapabilitiesDtoSchema.parse({
    mode: 'live',
    providers: [
      {
        provider: 'claude-code',
        observation: {
          transcripts: true,
          lifecycleHooks: true,
          subagentRelationships: true,
          perTurnUsage: true,
          cumulativeSnapshots: true,
        },
        managedExecution: false,
        providerVersionsSeen: ['2.1.0'],
        limitations: ['cumulative snapshot scope unknown'],
      },
    ],
    hooks: { receiverUrl: 'http://127.0.0.1:7420/api/hooks/claude-code', receivedAny: false },
    ...over,
  });
}

export function health(over: Partial<HealthDto> = {}): HealthDto {
  return HealthDtoSchema.parse({ status: 'ok', mode: 'live', version: '0.0.0-test', ...over });
}

export function candidate(over: Partial<CandidateRootDto> & { cwd: string }): CandidateRootDto {
  return CandidateRootDtoSchema.parse({
    provider: 'claude-code',
    sessionCount: 3,
    lastSeenAt: T1,
    ...over,
  });
}

export function edge(
  parentId: string,
  childId: string,
  kind: SessionEdgeDto['kind'] = 'subagent',
): SessionEdgeDto {
  return {
    parentId,
    childId,
    kind,
    provenance: 'observed',
    evidence: kind === 'subagent' ? ['subagent-metadata'] : ['shared-message-history'],
  };
}

export function tree(
  rootId: string,
  sessions: SessionSummaryDto[],
  edges: SessionEdgeDto[],
): SessionTreeDto {
  return SessionTreeDtoSchema.parse({
    rootId,
    nodes: sessions.map((s) => ({ session: s, aggregateUsage: usage({ recordCount: 9 }) })),
    edges,
  });
}

export function usageSummary(over: Partial<UsageSummaryDto> = {}): UsageSummaryDto {
  return UsageSummaryDtoSchema.parse({
    groupBy: 'project',
    groups: [{ key: 'p-1', label: 'project-p-1', usage: usage() }],
    totals: usage(),
    range: { from: null, to: null },
    ...over,
  });
}

export function page<T>(items: T[], nextCursor: string | null = null) {
  return { items, page: { nextCursor } };
}
