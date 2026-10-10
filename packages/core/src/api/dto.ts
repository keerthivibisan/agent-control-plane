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

/**
 * Provider-reported cost: always `estimated` (never authoritative), or `unavailable` with a null
 * value when the provider did not report one (never a false zero).
 */
export const ReportedCostUsdDtoSchema = z.discriminatedUnion('provenance', [
  z.object({ provenance: z.literal('estimated'), value: z.number().nonnegative() }),
  z.object({ provenance: z.literal('unavailable'), value: z.null() }),
]);
export type ReportedCostUsdDto = z.infer<typeof ReportedCostUsdDtoSchema>;

export const UsageSnapshotDtoSchema = z.object({
  occurredAt: IsoTimestampSchema.nullable(),
  scope: SnapshotScopeSchema,
  byModel: z.record(z.string().min(1), TokenCountsSchema),
  /** Provider-reported running total: always estimated, never summed. */
  reportedCostUsd: ReportedCostUsdDtoSchema,
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

/** Upper bound on `OverviewDto.latestSnapshots`. */
export const OVERVIEW_LATEST_SNAPSHOTS_LIMIT = 10;

/**
 * One top-level session's latest provider snapshot, for the Command Center. Each entry stands
 * alone: snapshots are running totals of unverified scope, so they are never added together and
 * there is no total cost anywhere in the API (usage-accounting §9).
 */
export const SessionSnapshotSummaryDtoSchema = z.object({
  sessionId: z.string().min(1),
  title: nullableString,
  occurredAt: IsoTimestampSchema.nullable(),
  scope: SnapshotScopeSchema,
  reportedCostUsd: ReportedCostUsdDtoSchema,
});
export type SessionSnapshotSummaryDto = z.infer<typeof SessionSnapshotSummaryDtoSchema>;

export const OverviewDtoSchema = z.object({
  projectCount: count,
  sessionsByStatus: z.record(SessionStatusSchema, count),
  totals: UsageTotalsDtoSchema,
  needsAttention: z.array(SessionSummaryDtoSchema),
  activeSessions: z.array(SessionSummaryDtoSchema),
  recentEvents: z.array(EventDtoSchema),
  /** Unassigned sessions are not ingested; this is how many candidate roots were discovered. */
  candidateRootCount: count,
  /**
   * The latest snapshot of each of the most recently active top-level sessions that have one,
   * newest first. Never summed.
   */
  latestSnapshots: z.array(SessionSnapshotSummaryDtoSchema).max(OVERVIEW_LATEST_SNAPSHOTS_LIMIT),
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

/** `/x`, `~/x`, `C:\x`, `\\host\x`: a path that could reveal the user's home directory. */
function isAbsoluteLike(path: string): boolean {
  return /^(?:[/\\~]|[A-Za-z]:[/\\])/.test(path);
}

export const AdapterFileIssueDtoSchema = z.object({
  /** Relative to the provider data root; never an absolute or home-relative path. */
  path: z
    .string()
    .min(1)
    .refine((p) => !isAbsoluteLike(p), 'path must be relative to the provider data root'),
  /** Short machine reason, e.g. `size-cap`, `invalid-meta`, `outside-projects`. */
  reason: z.string().min(1),
  /** Error code or a short fixed explanation. Never file content. */
  detail: nullableString,
});
export type AdapterFileIssueDto = z.infer<typeof AdapterFileIssueDtoSchema>;

export const AdapterDiagnosticsDtoSchema = z.object({
  provider: ProviderIdSchema,
  /** Problems from the adapter's most recent scan. */
  fileIssues: z.array(AdapterFileIssueDtoSchema),
  /**
   * Known record types the adapter skips on purpose because they carry nothing the control plane
   * uses, largest count first. Not the same as `unrecognized`, which are types nobody knows.
   */
  ignoredRecords: z.array(z.object({ recordType: z.string().min(1), count })),
  /** Unparseable or schema-invalid complete lines skipped since the adapter was created. */
  parseErrors: count,
});
export type AdapterDiagnosticsDto = z.infer<typeof AdapterDiagnosticsDtoSchema>;

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
  /** What each adapter reports about its own reading (ADR-0011). In memory; resets on restart. */
  adapters: z.array(AdapterDiagnosticsDtoSchema),
  /** The server's own ingestion counters since it started. */
  ingestion: z.object({
    pipeline: z.object({
      /** Events that failed `NormalizedEventSchema`; skipped, never stored. */
      eventsInvalid: count,
      /** Batches whose transaction rolled back; their checkpoint did not move. */
      batchesFailed: count,
    }),
    scheduler: z.object({
      polls: count,
      /** Adapter polls that threw; the other adapters still ran. */
      pollErrors: count,
      lastPollAt: IsoTimestampSchema.nullable(),
    }),
  }),
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
