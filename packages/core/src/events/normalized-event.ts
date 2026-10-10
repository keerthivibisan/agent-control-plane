import { z } from 'zod';
import { ProviderIdSchema } from '../domain/provider.js';
import { IsoTimestampSchema } from '../domain/time.js';
import { CumulativeUsageSnapshotSchema, PerTurnUsageSchema } from '../usage/usage.js';
import { SourceRefSchema } from './source.js';

export const NORMALIZED_EVENT_SCHEMA_VERSION = 1;

const nullableString = z.string().min(1).nullable();

/**
 * Fields shared by every normalized event. Adapters emit provider identifiers only;
 * internal ids (project, session row, agent run) are assigned by the event pipeline.
 */
const envelope = z.object({
  schemaVersion: z.literal(NORMALIZED_EVENT_SCHEMA_VERSION),
  provider: ProviderIdSchema,
  /**
   * Stable across re-ingestion, restarts, and ingestion channels for the same fact.
   * Built by the adapter from source identifiers (see docs/usage-accounting.md).
   */
  dedupKey: z.string().min(1),
  /** Provider's own identifier for the record (e.g. transcript `uuid`), when it has one. */
  sourceEventId: nullableString,
  providerSessionId: nullableString,
  /** Subagent id when the event belongs to a subagent, otherwise null. */
  providerAgentId: nullableString,
  /** When the provider says it happened. Null if the record carries no timestamp. */
  occurredAt: IsoTimestampSchema.nullable(),
  /** When the control plane read it. */
  observedAt: IsoTimestampSchema,
  /** Events are facts read from a source (`observed`) or computed from other events (`derived`). */
  provenance: z.enum(['observed', 'derived']),
  source: SourceRefSchema,
});

function event<const T extends string, P extends z.ZodType>(eventType: T, payload: P) {
  return envelope.extend({ eventType: z.literal(eventType), payload });
}

export const SessionObservedEvent = event(
  'session.observed',
  z.object({
    cwd: nullableString,
    gitBranch: nullableString,
    /** How the session was launched, e.g. `claude-desktop`, `sdk-cli`, `claude-vscode`. */
    entrypoint: nullableString,
  }),
);

export const SessionStartedEvent = event(
  'session.started',
  z.object({
    /** Hook `source`: startup | resume | clear | compact | fork (as reported). */
    startSource: nullableString,
    model: nullableString,
  }),
);

export const SessionEndedEvent = event('session.ended', z.object({ reason: nullableString }));

export const SessionCwdChangedEvent = event(
  'session.cwd_changed',
  z.object({ from: nullableString, to: z.string().min(1) }),
);

export const SubagentSpawnedEvent = event(
  'subagent.spawned',
  z.object({
    parentProviderSessionId: z.string().min(1),
    agentId: z.string().min(1),
    agentType: nullableString,
    description: nullableString,
    /** Tool call in the parent that spawned the subagent, when the source reports it. */
    spawnToolUseId: nullableString,
    spawnDepth: z.number().int().positive().nullable(),
    model: nullableString,
  }),
);

export const SubagentStoppedEvent = event(
  'subagent.stopped',
  z.object({ agentId: z.string().min(1), agentType: nullableString }),
);

export const UserMessageEvent = event(
  'message.user',
  z.object({
    uuid: nullableString,
    parentUuid: nullableString,
    /** True for provider-injected (non-human) user records. */
    isMeta: z.boolean(),
  }),
);

export const AssistantMessageEvent = event(
  'message.assistant',
  z.object({
    uuid: nullableString,
    parentUuid: nullableString,
    messageId: z.string().min(1),
    requestId: nullableString,
    model: nullableString,
    stopReason: nullableString,
  }),
);

export const ToolCalledEvent = event(
  'tool.called',
  z.object({
    toolUseId: z.string().min(1),
    toolName: z.string().min(1),
    messageId: nullableString,
  }),
);

export const ToolResultEvent = event(
  'tool.result',
  z.object({ toolUseId: z.string().min(1), isError: z.boolean().nullable() }),
);

export const UsageReportedEvent = event('usage.reported', PerTurnUsageSchema);

export const UsageSnapshotEvent = event('usage.snapshot', CumulativeUsageSnapshotSchema);

export const ProviderErrorEvent = event(
  'provider.error',
  z.object({ kind: nullableString, httpStatus: z.number().int().nullable() }),
);

/** A record the adapter does not understand. Kept for diagnostics; never interpreted. */
export const UnrecognizedRecordEvent = event(
  'record.unrecognized',
  z.object({ recordType: nullableString }),
);

export const NormalizedEventSchema = z.discriminatedUnion('eventType', [
  SessionObservedEvent,
  SessionStartedEvent,
  SessionEndedEvent,
  SessionCwdChangedEvent,
  SubagentSpawnedEvent,
  SubagentStoppedEvent,
  UserMessageEvent,
  AssistantMessageEvent,
  ToolCalledEvent,
  ToolResultEvent,
  UsageReportedEvent,
  UsageSnapshotEvent,
  ProviderErrorEvent,
  UnrecognizedRecordEvent,
]);
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
export type EventType = NormalizedEvent['eventType'];
export type EventOf<T extends EventType> = Extract<NormalizedEvent, { eventType: T }>;

export const EVENT_TYPES = NormalizedEventSchema.options.map(
  (o) => o.shape.eventType.value,
) as readonly EventType[];
