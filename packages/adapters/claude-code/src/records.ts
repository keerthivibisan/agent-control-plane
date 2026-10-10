import { IsoTimestampSchema, NORMALIZED_EVENT_SCHEMA_VERSION } from '@acp/core';
import type { IsoTimestamp, NormalizedEvent, TokenCounts } from '@acp/core';
import { z } from 'zod';
import { transcriptRecordKey } from './dedup.js';
import { isAbsolutePathString } from './paths.js';
import type { ParsedLine } from './reader.js';
import { cleanFreeText } from './redact.js';
import {
  COST_STATE_RECORD_TYPE,
  ENVELOPE_RECORD_TYPES,
  TITLE_RECORD_TYPES,
} from './record-types.js';

/** Session titles are redacted and capped at 200 characters (core `SessionTitledEvent`). */
export const TITLE_MAX_LENGTH = 200;

/** Per-file state carried across lines and batches: what `session.observed`/`cwd_changed` need. */
export interface FileState {
  /** The last `cwd` seen in an envelope record; null until the first one. */
  lastCwd: string | null;
  /** Last runtime `version` seen; attributed to records that do not carry one. */
  lastVersion: string | null;
}

export const freshFileState = (): FileState => ({ lastCwd: null, lastVersion: null });

export interface LineContext {
  /** From the allowlisted file path, never from line content (forks copy lines across files). */
  sessionId: string;
  agentId: string | null;
  sourcePath: string;
  observedAt: IsoTimestamp;
}

export type LineResult =
  | {
      ok: true;
      events: NormalizedEvent[];
      /** Runtime version attributed to the record, for diagnostics. */
      version: string | null;
      unrecognized: boolean;
    }
  | { ok: false };

// Tolerant field readers: a wrong or missing value becomes null instead of failing the record.
const optString = z.string().min(1).nullable().catch(null);
const optBoolean = z.boolean().nullable().catch(null);
const tokenCount = z.number().int().nonnegative().nullable().catch(null);

const RecordTypeSchema = z.looseObject({ type: z.string().min(1) });

/** Envelope fields, read only from ENVELOPE_RECORD_TYPES. */
const EnvelopeSchema = z.looseObject({
  uuid: optString,
  parentUuid: optString,
  timestamp: optString,
  cwd: optString,
  gitBranch: optString,
  version: optString,
  entrypoint: optString,
});

const UserSchema = z.looseObject({
  isMeta: optBoolean,
  message: z.looseObject({ content: z.unknown() }).nullable().catch(null),
});

/** Only the id and `is_error` of a tool result are read; its `content` never is. */
const ToolResultBlockSchema = z.looseObject({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1),
  is_error: optBoolean,
});

const AssistantSchema = z.looseObject({
  requestId: optString,
  message: z.looseObject({
    id: z.string().min(1),
    model: optString,
    stop_reason: optString,
    content: z.array(z.unknown()).catch([]),
    usage: z.unknown().optional(),
  }),
});

/** Only the id and name of a tool call are read; its `input` never is. */
const ToolUseBlockSchema = z.looseObject({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
});

const UsageSchema = z.looseObject({
  input_tokens: tokenCount,
  output_tokens: tokenCount,
  cache_creation_input_tokens: tokenCount,
  cache_read_input_tokens: tokenCount,
});

const SystemSchema = z.looseObject({ subtype: optString, error: z.unknown().optional() });

/**
 * The api_error `error` field is assumed to mirror the Anthropic SDK error (unverified):
 * `{ status, error: { type: "error", error: { type: "overloaded_error", message } } }`.
 * Only the status and the type identifiers are read; messages never are.
 */
const ApiErrorSchema = z.looseObject({
  status: z.number().int().min(100).max(599).nullable().catch(null),
  type: optString,
  error: z
    .looseObject({
      type: optString,
      error: z.looseObject({ type: optString }).nullable().catch(null),
    })
    .nullable()
    .catch(null),
});

/** `cost-state` keys per the research note; the per-model keys are assumed (unverified). */
const CostStateSchema = z.looseObject({
  uuid: optString,
  timestamp: optString,
  version: optString,
  modelUsage: z.record(z.string(), z.unknown()).optional().catch(undefined),
  totalCostUSD: z.number().nonnegative().nullable().optional().catch(undefined),
});

const ModelUsageSchema = z.looseObject({
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheCreationInputTokens: tokenCount,
  cacheReadInputTokens: tokenCount,
});

/** Title field names are assumed from the record type (unverified); `title` is a fallback. */
const TitleSchema = z.looseObject({
  uuid: optString,
  timestamp: optString,
  version: optString,
  customTitle: optString,
  aiTitle: optString,
  title: optString,
});

const RECORD_TYPE_NAME_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const ERROR_KIND_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Normalizes one parsed transcript line into events (docs/provider-adapters.md §4.4). Mutates
 * `state` (last cwd and version). Returns `{ ok: false }` when the line fails its per-type schema;
 * the caller counts that as a parse error.
 */
export function normalizeLine(line: ParsedLine, ctx: LineContext, state: FileState): LineResult {
  const typed = RecordTypeSchema.safeParse(line.value);
  if (!typed.success) return { ok: false };
  const type = typed.data.type;

  if (ENVELOPE_RECORD_TYPES.has(type)) return normalizeEnvelopeRecord(type, line, ctx, state);
  if (type === COST_STATE_RECORD_TYPE) return normalizeCostState(line, ctx, state);
  if (TITLE_RECORD_TYPES.has(type)) return normalizeTitle(type, line, ctx, state);
  return unrecognized(type, line, ctx, state.lastVersion);
}

/** Applies a line to the per-file state without emitting events (restart recovery). */
export function replayLine(line: ParsedLine, state: FileState): void {
  const typed = RecordTypeSchema.safeParse(line.value);
  if (!typed.success || !ENVELOPE_RECORD_TYPES.has(typed.data.type)) return;
  const env = EnvelopeSchema.safeParse(line.value);
  if (!env.success) return;
  const cwd = absolute(env.data.cwd);
  if (cwd !== null) state.lastCwd = cwd;
  if (env.data.version !== null) state.lastVersion = env.data.version;
}

function normalizeEnvelopeRecord(
  type: string,
  line: ParsedLine,
  ctx: LineContext,
  state: FileState,
): LineResult {
  const env = EnvelopeSchema.safeParse(line.value);
  if (!env.success) return { ok: false };
  const e = env.data;
  const version = e.version ?? state.lastVersion;
  const key = transcriptRecordKey(ctx.sessionId, ctx.agentId, e.uuid, line.raw);
  const base = eventBase(ctx, e.uuid, timestamp(e.timestamp), version, line.offset);

  // Validate the type-specific part before touching state, so an invalid line changes nothing.
  let body: NormalizedEvent[];
  let unrecognizedRecord = false;
  if (type === 'user') {
    const user = UserSchema.safeParse(line.value);
    if (!user.success) return { ok: false };
    body = userEvents(user.data, e, key, base);
  } else if (type === 'assistant') {
    const assistant = AssistantSchema.safeParse(line.value);
    if (!assistant.success) return { ok: false };
    body = assistantEvents(assistant.data, e, key, base);
  } else {
    const system = SystemSchema.safeParse(line.value);
    if (!system.success) return { ok: false };
    if (system.data.subtype === 'api_error') {
      body = [
        {
          ...base,
          dedupKey: `${key}#error`,
          eventType: 'provider.error',
          payload: apiError(system.data.error),
        },
      ];
    } else {
      const subtype = system.data.subtype;
      const name =
        subtype !== null && RECORD_TYPE_NAME_RE.test(subtype) ? `system:${subtype}` : 'system';
      body = [
        {
          ...base,
          dedupKey: `${key}#unrecognized`,
          eventType: 'record.unrecognized',
          payload: { recordType: name },
        },
      ];
      unrecognizedRecord = true;
    }
  }

  const events: NormalizedEvent[] = [];
  const cwd = absolute(e.cwd);
  if (cwd !== null && state.lastCwd === null) {
    events.push({
      ...base,
      dedupKey: `${key}#session`,
      eventType: 'session.observed',
      payload: { cwd, gitBranch: e.gitBranch, entrypoint: e.entrypoint },
    });
  } else if (cwd !== null && cwd !== state.lastCwd) {
    events.push({
      ...base,
      dedupKey: `${key}#cwd`,
      eventType: 'session.cwd_changed',
      payload: { from: state.lastCwd, to: cwd },
    });
  }
  if (cwd !== null) state.lastCwd = cwd;
  if (e.version !== null) state.lastVersion = e.version;
  events.push(...body);
  return { ok: true, events, version, unrecognized: unrecognizedRecord };
}

type Envelope = z.infer<typeof EnvelopeSchema>;
type EventBase = Pick<
  NormalizedEvent,
  | 'schemaVersion'
  | 'provider'
  | 'sourceEventId'
  | 'providerSessionId'
  | 'providerAgentId'
  | 'occurredAt'
  | 'observedAt'
  | 'provenance'
  | 'source'
>;

function userEvents(
  user: z.infer<typeof UserSchema>,
  e: Envelope,
  key: string,
  base: EventBase,
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [
    {
      ...base,
      dedupKey: `${key}#user`,
      eventType: 'message.user',
      payload: { uuid: e.uuid, parentUuid: e.parentUuid, isMeta: user.isMeta === true },
    },
  ];
  const content = user.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const result = ToolResultBlockSchema.safeParse(block);
      if (!result.success) continue;
      const toolUseId = result.data.tool_use_id;
      events.push({
        ...base,
        dedupKey: `${key}#result:${toolUseId}`,
        eventType: 'tool.result',
        payload: { toolUseId, isError: result.data.is_error },
      });
    }
  }
  return events;
}

function assistantEvents(
  assistant: z.infer<typeof AssistantSchema>,
  e: Envelope,
  key: string,
  base: EventBase,
): NormalizedEvent[] {
  const m = assistant.message;
  const events: NormalizedEvent[] = [
    {
      ...base,
      dedupKey: `${key}#assistant`,
      eventType: 'message.assistant',
      payload: {
        uuid: e.uuid,
        parentUuid: e.parentUuid,
        messageId: m.id,
        requestId: assistant.requestId,
        model: m.model,
        stopReason: m.stop_reason,
      },
    },
  ];
  for (const block of m.content) {
    const tool = ToolUseBlockSchema.safeParse(block);
    if (!tool.success) continue;
    events.push({
      ...base,
      dedupKey: `${key}#tool:${tool.data.id}`,
      eventType: 'tool.called',
      payload: { toolUseId: tool.data.id, toolName: tool.data.name, messageId: m.id },
    });
  }
  const usage = UsageSchema.safeParse(m.usage);
  if (usage.success) {
    events.push({
      ...base,
      dedupKey: `${key}#usage`,
      eventType: 'usage.reported',
      payload: {
        kind: 'per-turn',
        messageId: m.id,
        requestId: assistant.requestId,
        model: m.model,
        tokens: {
          input: usage.data.input_tokens,
          output: usage.data.output_tokens,
          cacheCreation: usage.data.cache_creation_input_tokens,
          cacheRead: usage.data.cache_read_input_tokens,
        },
      },
    });
  }
  return events;
}

function apiError(raw: unknown): { kind: string; httpStatus: number | null } {
  const parsed = ApiErrorSchema.safeParse(raw);
  if (!parsed.success) return { kind: 'api_error', httpStatus: null };
  const err = parsed.data;
  const candidates = [err.error?.error?.type, err.error?.type, err.type];
  const kind = candidates.find(
    (k): k is string => typeof k === 'string' && k !== 'error' && ERROR_KIND_RE.test(k),
  );
  return { kind: kind ?? 'api_error', httpStatus: err.status };
}

function normalizeCostState(line: ParsedLine, ctx: LineContext, state: FileState): LineResult {
  const parsed = CostStateSchema.safeParse(line.value);
  if (!parsed.success) return { ok: false };
  const c = parsed.data;
  if (c.modelUsage === undefined && c.totalCostUSD === undefined) return { ok: false };
  const byModel: Record<string, TokenCounts> = {};
  for (const [model, usage] of Object.entries(c.modelUsage ?? {})) {
    if (model.length === 0) continue;
    const u = ModelUsageSchema.safeParse(usage);
    byModel[model] = u.success
      ? {
          input: u.data.inputTokens,
          output: u.data.outputTokens,
          cacheCreation: u.data.cacheCreationInputTokens,
          cacheRead: u.data.cacheReadInputTokens,
        }
      : { input: null, output: null, cacheCreation: null, cacheRead: null };
  }
  const version = c.version ?? state.lastVersion;
  const key = transcriptRecordKey(ctx.sessionId, ctx.agentId, c.uuid, line.raw);
  const base = eventBase(ctx, c.uuid, timestamp(c.timestamp), version, line.offset);
  return {
    ok: true,
    version,
    unrecognized: false,
    events: [
      {
        ...base,
        dedupKey: `${key}#snapshot`,
        eventType: 'usage.snapshot',
        // Whether cost-state includes subagent or auxiliary usage is unverified (research Q3).
        payload: {
          kind: 'cumulative-snapshot',
          scope: 'unknown',
          byModel,
          reportedCostUsd: c.totalCostUSD ?? null,
        },
      },
    ],
  };
}

function normalizeTitle(
  type: string,
  line: ParsedLine,
  ctx: LineContext,
  state: FileState,
): LineResult {
  const parsed = TitleSchema.safeParse(line.value);
  if (!parsed.success) return { ok: false };
  const t = parsed.data;
  const raw = (type === 'custom-title' ? t.customTitle : t.aiTitle) ?? t.title;
  if (raw === null) return { ok: false };
  const version = t.version ?? state.lastVersion;
  const title = cleanFreeText(raw, TITLE_MAX_LENGTH);
  // A title that is empty after redaction and whitespace cleanup carries nothing to show.
  if (title === null) return { ok: true, events: [], version, unrecognized: false };
  const key = transcriptRecordKey(ctx.sessionId, ctx.agentId, t.uuid, line.raw);
  const base = eventBase(ctx, t.uuid, timestamp(t.timestamp), version, line.offset);
  return {
    ok: true,
    version,
    unrecognized: false,
    events: [
      {
        ...base,
        dedupKey: `${key}#title`,
        eventType: 'session.titled',
        payload: { title, titleSource: type === 'custom-title' ? 'user' : 'ai' },
      },
    ],
  };
}

/**
 * `record.unrecognized` for any other type. Only `type` was read: the key is the line hash (not a
 * uuid field) and the version is the last one seen in this file, so no other field is touched.
 */
function unrecognized(
  type: string,
  line: ParsedLine,
  ctx: LineContext,
  version: string | null,
): LineResult {
  const key = transcriptRecordKey(ctx.sessionId, ctx.agentId, null, line.raw);
  const base = eventBase(ctx, null, null, version, line.offset);
  return {
    ok: true,
    version,
    unrecognized: true,
    events: [
      {
        ...base,
        dedupKey: `${key}#unrecognized`,
        eventType: 'record.unrecognized',
        payload: { recordType: RECORD_TYPE_NAME_RE.test(type) ? type : null },
      },
    ],
  };
}

function eventBase(
  ctx: LineContext,
  sourceEventId: string | null,
  occurredAt: IsoTimestamp | null,
  providerVersion: string | null,
  byteOffset: number,
): EventBase {
  return {
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    provider: 'claude-code',
    sourceEventId,
    providerSessionId: ctx.sessionId,
    providerAgentId: ctx.agentId,
    occurredAt,
    observedAt: ctx.observedAt,
    provenance: 'observed',
    source: {
      channel: 'transcript',
      providerVersion,
      path: ctx.sourcePath,
      byteOffset,
      hookEvent: null,
    },
  };
}

/** A valid ISO-8601 timestamp normalized to UTC `Z`, else null. */
export function timestamp(value: string | null): IsoTimestamp | null {
  if (value === null || !IsoTimestampSchema.safeParse(value).success) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function absolute(cwd: string | null): string | null {
  return cwd !== null && isAbsolutePathString(cwd) ? cwd : null;
}
