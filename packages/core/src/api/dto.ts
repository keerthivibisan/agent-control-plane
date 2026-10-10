import { z } from 'zod';
import { ProjectSchema } from '../domain/project.js';
import { ProviderIdSchema } from '../domain/provider.js';
import { IsoTimestampSchema } from '../domain/time.js';
import { IngestionChannelSchema } from '../events/source.js';
import { EVENT_TYPES, type EventType } from '../events/normalized-event.js';
import {
  SessionEdgeEvidenceSchema,
  SessionEdgeKindSchema,
  SessionStatusSchema,
} from '../sessions/session.js';
import { SnapshotScopeSchema, TokenCountsSchema } from '../usage/usage.js';

/**
 * HTTP response contracts shared by @acp/server and @acp/web (P1-D0).
 * Every response is parsed with these schemas on the client, so the UI can only render what the
 * server actually returned.
 */

const nullableString = z.string().min(1).nullable();
const count = z.number().int().nonnegative();

export const PageInfoSchema = z.object({ nextCursor: z.string().min(1).nullable() });
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), page: PageInfoSchema });
}

/**
 * Summed usage. A category is `null` when every contributing record lacked it (unavailable).
 * `recordsWithUnavailable` lets the UI say "partial" when only some records lacked it.
 */
export const UsageTotalsDtoSchema = z.object({
  tokens: TokenCountsSchema,
  recordCount: count,
  recordsWithUnavailable: z.object({
    input: count,
    output: count,
    cacheCreation: count,
    cacheRead: count,
  }),
  provenance: z.literal('derived'),
});
export type UsageTotalsDto = z.infer<typeof UsageTotalsDtoSchema>;

export const SessionStatusDtoSchema = z.object({
  value: SessionStatusSchema,
  provenance: z.literal('derived'),
  /** The evidence the status was derived from, so the UI can explain it. */
  basis: z.object({
    lastEventAt: IsoTimestampSchema.nullable(),
    endedAt: IsoTimestampSchema.nullable(),
    evaluatedAt: IsoTimestampSchema,
  }),
});
export type SessionStatusDto = z.infer<typeof SessionStatusDtoSchema>;

export const ParentDtoSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('known'),
    sessionId: z.string().min(1),
    kind: SessionEdgeKindSchema,
    provenance: z.enum(['observed', 'derived']),
    evidence: z.array(SessionEdgeEvidenceSchema).min(1),
  }),
  /** No evidence of a parent. Not the same as "independent": an external launcher can't be ruled out. */
  z.object({ state: z.literal('unknown') }),
]);
export type ParentDto = z.infer<typeof ParentDtoSchema>;

export const ProjectDtoSchema = ProjectSchema.extend({
  sessionCount: count,
  lastEventAt: IsoTimestampSchema.nullable(),
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

export const SessionSummaryDtoSchema = z.object({
  id: z.string().min(1),
  provider: ProviderIdSchema,
  providerSessionId: z.string().min(1),
  providerAgentId: nullableString,
  origin: z.enum(['external', 'managed', 'demo']),
  projectId: nullableString,
  title: nullableString,
  agentType: nullableString,
  description: nullableString,
  launchCwd: nullableString,
  gitBranch: nullableString,
  entrypoint: nullableString,
  providerVersion: nullableString,
  /** Models seen in this session's usage records (observed). */
  models: z.array(z.string().min(1)),
  status: SessionStatusDtoSchema,
  firstSeenAt: IsoTimestampSchema,
  lastEventAt: IsoTimestampSchema.nullable(),
  endedAt: IsoTimestampSchema.nullable(),
  endReason: nullableString,
  lastAttentionAt: IsoTimestampSchema.nullable(),
  directUsage: UsageTotalsDtoSchema,
  /** Direct subagent children (verified edges only). */
  childCount: count,
});
export type SessionSummaryDto = z.infer<typeof SessionSummaryDtoSchema>;

export const UsageSnapshotDtoSchema = z.object({
  occurredAt: IsoTimestampSchema.nullable(),
  scope: SnapshotScopeSchema,
  byModel: z.record(z.string().min(1), TokenCountsSchema),
  /** Provider-reported running total: always estimated, never summed. */
  reportedCostUsd: z.discriminatedUnion('provenance', [
    z.object({ provenance: z.literal('estimated'), value: z.number().nonnegative() }),
    z.object({ provenance: z.literal('unavailable'), value: z.null() }),
  ]),
});
export type UsageSnapshotDto = z.infer<typeof UsageSnapshotDtoSchema>;

export const SessionDetailDtoSchema = SessionSummaryDtoSchema.extend({
  parent: ParentDtoSchema,
  /** Direct usage plus subagent descendants. Shown next to direct usage, never added to it. */
  aggregateUsage: UsageTotalsDtoSchema,
  latestSnapshot: UsageSnapshotDtoSchema.nullable(),
  /** Sessions forked from this one (continuation edges). */
  continuationIds: z.array(z.string().min(1)),
  /**
   * Usage records attributed to this session whose origin is ambiguous: fork copies share
   * timestamps, so they are counted once but may belong to a sibling (usage-accounting §5.2).
   */
  ambiguousAttributionCount: z.number().int().nonnegative(),
});
export type SessionDetailDto = z.infer<typeof SessionDetailDtoSchema>;

export const SessionEdgeDtoSchema = z.object({
  parentId: z.string().min(1),
  childId: z.string().min(1),
  kind: SessionEdgeKindSchema,
  provenance: z.enum(['observed', 'derived']),
  evidence: z.array(SessionEdgeEvidenceSchema).min(1),
});
export type SessionEdgeDto = z.infer<typeof SessionEdgeDtoSchema>;

/** Flat tree: nodes + verified edges, rooted at `rootId`. Suits graph rendering directly. */
export const SessionTreeDtoSchema = z.object({
  rootId: z.string().min(1),
  nodes: z.array(
    z.object({ session: SessionSummaryDtoSchema, aggregateUsage: UsageTotalsDtoSchema }),
  ),
  edges: z.array(SessionEdgeDtoSchema),
});
export type SessionTreeDto = z.infer<typeof SessionTreeDtoSchema>;

export const EventDtoSchema = z.object({
  id: z.number().int().positive(),
  eventType: z.enum(EVENT_TYPES as unknown as [EventType, ...EventType[]]),
  provider: ProviderIdSchema,
  sessionId: nullableString,
  projectId: nullableString,
  occurredAt: IsoTimestampSchema.nullable(),
  observedAt: IsoTimestampSchema,
  provenance: z.enum(['observed', 'derived']),
  channel: IngestionChannelSchema,
  providerVersion: nullableString,
  /** The event's typed payload (never conversation content, ADR-0009). */
  payload: z.record(z.string(), z.unknown()),
});
export type EventDto = z.infer<typeof EventDtoSchema>;

export const UsageGroupBySchema = z.enum(['project', 'session', 'model', 'day']);
export type UsageGroupBy = z.infer<typeof UsageGroupBySchema>;

export const UsageSummaryDtoSchema = z.object({
  groupBy: UsageGroupBySchema,
  /** Groups sum DIRECT usage of sessions, so subagent usage is never counted twice. */
  groups: z.array(
    z.object({ key: z.string().min(1), label: z.string().min(1), usage: UsageTotalsDtoSchema }),
  ),
  totals: UsageTotalsDtoSchema,
  range: z.object({ from: IsoTimestampSchema.nullable(), to: IsoTimestampSchema.nullable() }),
});
export type UsageSummaryDto = z.infer<typeof UsageSummaryDtoSchema>;

export const OverviewDtoSchema = z.object({
  projectCount: count,
  sessionsByStatus: z.record(SessionStatusSchema, count),
  totals: UsageTotalsDtoSchema,
  needsAttention: z.array(SessionSummaryDtoSchema),
  activeSessions: z.array(SessionSummaryDtoSchema),
  recentEvents: z.array(EventDtoSchema),
  /** Unassigned sessions are not ingested; this is how many candidate roots were discovered. */
  candidateRootCount: count,
});
export type OverviewDto = z.infer<typeof OverviewDtoSchema>;

export const ProviderCapabilitiesDtoSchema = z.object({
  provider: ProviderIdSchema,
  observation: z.object({
    transcripts: z.boolean(),
    lifecycleHooks: z.boolean(),
    subagentRelationships: z.boolean(),
    perTurnUsage: z.boolean(),
    cumulativeSnapshots: z.boolean(),
  }),
  managedExecution: z.literal(false),
  providerVersionsSeen: z.array(z.string()),
  limitations: z.array(z.string()),
});

export const CapabilitiesDtoSchema = z.object({
  mode: z.enum(['live', 'demo']),
  providers: z.array(ProviderCapabilitiesDtoSchema),
  hooks: z.object({
    receiverUrl: z.string().min(1),
    /** True once at least one authenticated hook delivery has been received. */
    receivedAny: z.boolean(),
  }),
});
export type CapabilitiesDto = z.infer<typeof CapabilitiesDtoSchema>;

export const CandidateRootDtoSchema = z.object({
  provider: ProviderIdSchema,
  cwd: z.string().min(1),
  sessionCount: count,
  lastSeenAt: IsoTimestampSchema.nullable(),
});
export type CandidateRootDto = z.infer<typeof CandidateRootDtoSchema>;

export const DiagnosticsDtoSchema = z.object({
  sources: z.array(
    z.object({
      /** Relative to the provider data root; never an absolute home path. */
      sourcePath: z.string().min(1),
      byteOffset: count,
      sizeBytes: count,
      parseErrors: count,
      updatedAt: IsoTimestampSchema,
    }),
  ),
  unrecognized: z.array(
    z.object({ providerVersion: nullableString, recordType: nullableString, count }),
  ),
  edgeConflictCount: count,
  usageConflictCount: count,
});
export type DiagnosticsDto = z.infer<typeof DiagnosticsDtoSchema>;

export const HealthDtoSchema = z.object({
  status: z.literal('ok'),
  mode: z.enum(['live', 'demo']),
  version: z.string().min(1),
});
export type HealthDto = z.infer<typeof HealthDtoSchema>;

export const ErrorDtoSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
});
export type ErrorDto = z.infer<typeof ErrorDtoSchema>;

/** SSE `data:` payload. An invalidation notice only: clients refetch over REST. */
export const StreamNoticeDtoSchema = z.object({
  kind: z.enum(['events-ingested', 'projects-changed']),
  /** Highest event row id included; also sent as the SSE `id:` field. */
  lastEventId: z.number().int().nonnegative(),
  sessionIds: z.array(z.string().min(1)),
  projectIds: z.array(z.string().min(1)),
});
export type StreamNoticeDto = z.infer<typeof StreamNoticeDtoSchema>;
