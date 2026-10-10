import { z } from 'zod';

/**
 * How an event reached the control plane.
 * - `transcript`: a line of a provider transcript file (Claude Code JSONL).
 * - `subagent-meta`: a subagent metadata file.
 * - `hook`: a provider lifecycle hook delivered to the local hook receiver.
 * - `otel`: an OpenTelemetry signal (reserved; not ingested in Phase 1).
 * - `managed`: a run launched by the control plane (reserved for Phase 3).
 * - `demo`: the deterministic demo adapter. Never mixed with live data.
 */
export const IngestionChannelSchema = z.enum([
  'transcript',
  'subagent-meta',
  'hook',
  'otel',
  'managed',
  'demo',
]);
export type IngestionChannel = z.infer<typeof IngestionChannelSchema>;

export const SourceRefSchema = z.object({
  channel: IngestionChannelSchema,
  /** Provider runtime version that wrote the record, when the record states it. */
  providerVersion: z.string().min(1).nullable(),
  /** File the record was read from (transcript and subagent-meta channels). */
  path: z.string().min(1).nullable(),
  /** Byte offset of the first byte of the record within `path`. */
  byteOffset: z.number().int().nonnegative().nullable(),
  /** Hook event name for the hook channel, e.g. `SessionStart`. */
  hookEvent: z.string().min(1).nullable(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
