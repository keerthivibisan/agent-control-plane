import {
  NORMALIZED_EVENT_SCHEMA_VERSION,
  type ManagedProviderId,
  type NormalizedEvent,
  type TokenCounts,
} from '@acp/core';

/**
 * ADR-0032 §5 (CX-4): usage of a managed provider that ACP does not observe from files (Codex,
 * whose session files are not read, ADR-0031 owner decision 1) enters the database as normalized
 * events on the `managed` channel, through the same ingestion pipeline as transcripts. So the
 * session row, the usage observation and the usage record (`buildUsageRecord`, deduped by
 * `(provider, messageId)`) are made exactly as for Claude, and the Tokens page and the budget read
 * one source. Each event's `dedupKey` is built from provider identifiers only, so a replayed
 * notification (CX-1: Codex repeats the last one after `thread/resume`) is a duplicate and changes
 * nothing. No content: a folder, a model id and token counts.
 */

/** Providers whose managed usage the server records itself (no observation adapter reads them). */
export const SELF_RECORDED_USAGE: ReadonlySet<ManagedProviderId> = new Set(['codex']);

/** Shows how the session was launched (`session.observed.entrypoint`). */
export const MANAGED_ENTRYPOINT = 'acp-managed';

interface Base {
  provider: ManagedProviderId;
  /** The provider's session id (Codex: the thread id). */
  providerSessionId: string;
  /** When the server received the event. */
  observedAt: string;
}

function envelope(base: Base, dedupKey: string) {
  return {
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION as typeof NORMALIZED_EVENT_SCHEMA_VERSION,
    provider: base.provider,
    dedupKey,
    sourceEventId: null,
    providerSessionId: base.providerSessionId,
    providerAgentId: null,
    provenance: 'observed' as const,
    source: {
      channel: 'managed' as const,
      providerVersion: null,
      path: null,
      byteOffset: null,
      hookEvent: null,
    },
  };
}

/**
 * The session's start, on the agent's `started`: where it runs (its project follows from the
 * folder, a helper's worktree through its run's root) and the model the provider reported. One per
 * provider session: a follow-up or rework turn on the same thread is a duplicate.
 */
export function managedSessionEvents(
  base: Base & { cwd: string; model: string | null },
): NormalizedEvent[] {
  const key = `managed:${base.provider}:${base.providerSessionId}`;
  return [
    {
      ...envelope(base, `${key}:session.observed`),
      eventType: 'session.observed',
      occurredAt: base.observedAt,
      observedAt: base.observedAt,
      payload: { cwd: base.cwd, gitBranch: null, entrypoint: MANAGED_ENTRYPOINT },
    },
    {
      ...envelope(base, `${key}:session.started`),
      eventType: 'session.started',
      occurredAt: base.observedAt,
      observedAt: base.observedAt,
      payload: { startSource: null, model: base.model },
    },
  ];
}

/**
 * One model request's usage (ADR-0032 amendment: one record per request, provenance `observed`).
 * The adapter's `messageId` is unique per provider (Codex: `<thread>:<turn>:<cumulative total>`).
 * The notification has no timestamp of its own; the server receives it as the request ends, so
 * the receipt time is the record's time (needed for the Tokens page's day and range). Null token
 * fields stay null (unavailable, never 0).
 */
export function managedUsageEvent(
  base: Base & { messageId: string; model: string | null; tokens: TokenCounts },
): NormalizedEvent {
  return {
    ...envelope(base, `managed:${base.provider}:usage:${base.messageId}`),
    eventType: 'usage.reported',
    occurredAt: base.observedAt,
    observedAt: base.observedAt,
    payload: {
      kind: 'per-turn',
      messageId: base.messageId,
      requestId: null,
      model: base.model,
      tokens: { ...base.tokens },
    },
  };
}
