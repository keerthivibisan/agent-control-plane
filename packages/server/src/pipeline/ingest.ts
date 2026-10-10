import {
  NormalizedEventSchema,
  SUBAGENT_SPAWN_TOOL_NAMES,
  buildUsageRecord,
  deriveContinuationEdges,
  deriveSubagentEdge,
  findOwningRoot,
  groupObservationsByMessage,
  type IngestionBatch,
  type IsoTimestamp,
  type NormalizedEvent,
  type SessionKey,
  type ToolCallSighting,
} from '@acp/core';
import type { StreamNoticeDto } from '@acp/core/api';
import {
  withTransaction,
  type AcpDatabase,
  type Repositories,
  type SessionRow,
  type SessionUpsertInput,
} from '@acp/db';
import { z } from 'zod';
import type { Logger } from '../logger.js';

/**
 * The ingestion pipeline (docs/architecture.md): validate → dedupe → persist → project → checkpoint,
 * all in one transaction, then publish. Projections run only for newly inserted events, so
 * re-ingesting a file (restart, rewrite) changes nothing (usage-accounting §4).
 */

export interface IngestResult {
  inserted: number;
  duplicates: number;
  /** Events that failed `NormalizedEventSchema`; counted and skipped, never stored. */
  invalid: number;
  /** Highest event id inserted by this call, or null when nothing was inserted. */
  lastEventId: number | null;
  sessionIds: string[];
  projectIds: string[];
}

export interface PipelineCounters {
  eventsInserted: number;
  eventsDuplicate: number;
  eventsInvalid: number;
  batchesFailed: number;
}

export interface Pipeline {
  /** Ingests one adapter batch together with its checkpoint, atomically. */
  ingestBatch(batch: IngestionBatch): IngestResult;
  /** Ingests events that have no checkpoint (hook deliveries). */
  ingestEvents(events: readonly NormalizedEvent[]): IngestResult;
  counters(): PipelineCounters;
}

export interface PipelineDeps {
  db: AcpDatabase;
  repos: Repositories;
  logger: Logger;
  now: () => Date;
  /** Called after the transaction commits, never before (SSE must not announce rolled-back data). */
  publish: (notice: StreamNoticeDto) => void;
}

/** Spawn evidence kept on a subagent session so its edge can be (re)derived in any event order. */
const SpawnEvidenceSchema = z.object({
  parentProviderSessionId: z.string().min(1),
  spawnToolUseId: z.string().min(1).optional(),
  spawnDepth: z.number().int().positive().optional(),
});

function keyOf(row: SessionRow): SessionKey {
  return {
    provider: row.provider,
    providerSessionId: row.providerSessionId,
    providerAgentId: row.providerAgentId,
  };
}

function originOf(event: NormalizedEvent): 'demo' | 'external' {
  return event.provider === 'demo' ? 'demo' : 'external';
}

/** Hook deliveries carry no provider timestamp; the delivery time is the best live evidence. */
function activityTime(event: NormalizedEvent): IsoTimestamp | null {
  return event.occurredAt ?? (event.source.channel === 'hook' ? event.observedAt : null);
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const { db, repos, logger } = deps;
  const counters: PipelineCounters = {
    eventsInserted: 0,
    eventsDuplicate: 0,
    eventsInvalid: 0,
    batchesFailed: 0,
  };

  function run(
    candidates: readonly unknown[],
    checkpoint: IngestionBatch['nextCheckpoint'] | null,
  ): IngestResult {
    const result: IngestResult = {
      inserted: 0,
      duplicates: 0,
      invalid: 0,
      lastEventId: null,
      sessionIds: [],
      projectIds: [],
    };
    try {
      withTransaction(db, () => {
        project(candidates, checkpoint, result);
      });
    } catch (error) {
      counters.batchesFailed++;
      logger.log('error', 'ingest batch rolled back', {
        errorName: error instanceof Error ? error.name : 'unknown',
        events: candidates.length,
      });
      throw error;
    }
    counters.eventsInserted += result.inserted;
    counters.eventsDuplicate += result.duplicates;
    counters.eventsInvalid += result.invalid;
    if (result.invalid > 0) {
      logger.log('warn', 'events failed validation and were skipped', { count: result.invalid });
    }
    if (result.lastEventId !== null) {
      deps.publish({
        kind: 'events-ingested',
        lastEventId: result.lastEventId,
        sessionIds: result.sessionIds,
        projectIds: result.projectIds,
      });
    }
    return result;
  }

  function project(
    candidates: readonly unknown[],
    checkpoint: IngestionBatch['nextCheckpoint'] | null,
    result: IngestResult,
  ): void {
    const roots = repos.projects.list();
    const touchedSessions = new Set<string>();
    const touchedProjects = new Set<string>();
    const observedSessions = new Set<string>();
    const messages = new Map<
      string,
      { provider: NormalizedEvent['provider']; messageId: string }
    >();
    const edgeScopes = new Map<string, { provider: NormalizedEvent['provider']; id: string }>();
    const scopeOf = (e: NormalizedEvent) => `${e.provider}\u0000${e.providerSessionId ?? ''}`;

    for (const candidate of candidates) {
      const parsed = NormalizedEventSchema.safeParse(candidate);
      if (!parsed.success) {
        result.invalid++;
        continue;
      }
      const event = parsed.data;
      // Checked before touching the session row: a duplicate must not bump lastObservedAt.
      if (repos.events.getByDedupKey(event.dedupKey) !== undefined) {
        result.duplicates++;
        continue;
      }

      let sessionId: string | null = null;
      let projectId: string | null = null;
      if (event.providerSessionId !== null) {
        const key: SessionKey = {
          provider: event.provider,
          providerSessionId: event.providerSessionId,
          providerAgentId: event.providerAgentId,
        };
        const existing = repos.sessions.getByKey(key);
        const input = sessionInput(event, key, existing, roots);
        const upserted = repos.sessions.upsert(input);
        sessionId = upserted.id;
        projectId = input.projectId ?? existing?.projectId ?? null;
        if (projectId === null && key.providerAgentId !== null) {
          projectId = inheritFromParent(sessionId, key);
        } else if (
          projectId !== null &&
          key.providerAgentId === null &&
          (input.projectId ?? null) !== null
        ) {
          for (const id of assignOrphanSubagents(key, projectId)) touchedSessions.add(id);
        }
        if (upserted.created) {
          edgeScopes.set(scopeOf(event), { provider: event.provider, id: event.providerSessionId });
        }
      }

      const stored = repos.events.insertIfNew({ event, sessionId, projectId });
      if (!stored.inserted) {
        result.duplicates++;
        continue;
      }
      result.inserted++;
      result.lastEventId = Math.max(result.lastEventId ?? 0, stored.id);
      if (sessionId !== null) touchedSessions.add(sessionId);
      if (projectId !== null) touchedProjects.add(projectId);

      switch (event.eventType) {
        case 'usage.reported': {
          if (sessionId === null) break;
          repos.usage.insertObservation({
            eventId: stored.id,
            provider: event.provider,
            messageId: event.payload.messageId,
            sessionId,
            occurredAt: event.occurredAt,
            requestId: event.payload.requestId,
            model: event.payload.model,
            tokens: event.payload.tokens,
          });
          messages.set(`${event.provider}\u0000${event.payload.messageId}`, {
            provider: event.provider,
            messageId: event.payload.messageId,
          });
          observedSessions.add(sessionId);
          break;
        }
        case 'usage.snapshot': {
          if (sessionId === null) break;
          repos.snapshots.insert({
            eventId: stored.id,
            provider: event.provider,
            sessionId,
            occurredAt: event.occurredAt,
            observedAt: event.observedAt,
            snapshot: event.payload,
          });
          break;
        }
        case 'subagent.spawned':
          if (event.providerSessionId !== null) {
            edgeScopes.set(scopeOf(event), {
              provider: event.provider,
              id: event.providerSessionId,
            });
          }
          break;
        case 'tool.called':
          if (
            event.providerSessionId !== null &&
            SUBAGENT_SPAWN_TOOL_NAMES.includes(event.payload.toolName)
          ) {
            edgeScopes.set(scopeOf(event), {
              provider: event.provider,
              id: event.providerSessionId,
            });
          }
          break;
        default:
          break;
      }
    }

    for (const m of messages.values()) rebuildUsageRecord(m.provider, m.messageId);
    for (const scope of edgeScopes.values()) deriveSubagentEdges(scope.provider, scope.id);
    if (observedSessions.size > 0) deriveContinuation([...observedSessions]);
    if (checkpoint !== null) repos.checkpoints.set(checkpoint);

    result.sessionIds = [...touchedSessions].sort();
    result.projectIds = [...touchedProjects].sort();
  }

  function sessionInput(
    event: NormalizedEvent,
    key: SessionKey,
    existing: SessionRow | undefined,
    roots: readonly { id: string; rootPath: string }[],
  ): SessionUpsertInput {
    const activity = activityTime(event);
    const input: SessionUpsertInput = {
      key,
      origin: originOf(event),
      firstSeenAt: event.occurredAt ?? event.observedAt,
      lastObservedAt: event.observedAt,
      lastEventAt: activity,
      providerVersion: event.source.providerVersion,
    };
    let cwd = existing?.launchCwd ?? null;
    switch (event.eventType) {
      case 'session.observed':
        input.launchCwd = event.payload.cwd;
        input.gitBranch = event.payload.gitBranch;
        input.entrypoint = event.payload.entrypoint;
        cwd = cwd ?? event.payload.cwd;
        break;
      case 'session.ended':
        input.endedAt = activity ?? event.observedAt;
        input.endReason = event.payload.reason;
        break;
      case 'session.titled':
        input.title = event.payload.title;
        break;
      case 'session.attention':
        input.lastAttentionAt = activity ?? event.observedAt;
        break;
      case 'subagent.spawned':
        input.agentType = event.payload.agentType;
        input.description = event.payload.description;
        input.metadata = {
          spawn: {
            parentProviderSessionId: event.payload.parentProviderSessionId,
            // merge-patch treats null as "remove", so absent evidence is left out.
            ...(event.payload.spawnToolUseId !== null && {
              spawnToolUseId: event.payload.spawnToolUseId,
            }),
            ...(event.payload.spawnDepth !== null && { spawnDepth: event.payload.spawnDepth }),
          },
        };
        break;
      default:
        break;
    }
    if ((existing?.projectId ?? null) === null && cwd !== null) {
      const owner = findOwningRoot(roots, cwd);
      if (owner !== null) input.projectId = owner.id;
    }
    return input;
  }

  /**
   * A subagent transcript lives in its parent's session directory, which is also why the adapter
   * read it. When the subagent's own cwd is outside every root (e.g. it ran in a worktree), it
   * belongs to the parent's project rather than to none (P1-F F2 finding).
   */
  function inheritFromParent(sessionId: string, key: SessionKey): string | null {
    const parent = repos.sessions.getByKey({ ...key, providerAgentId: null });
    if (parent === undefined || parent.projectId === null) return null;
    repos.sessions.setProject(sessionId, parent.projectId);
    return parent.projectId;
  }

  /** The parent just got its project: subagents that arrived first without one follow it. */
  function assignOrphanSubagents(key: SessionKey, projectId: string): string[] {
    const moved: string[] = [];
    for (const row of repos.sessions.listByProviderSession(key.provider, key.providerSessionId)) {
      if (row.providerAgentId !== null && row.projectId === null) {
        repos.sessions.setProject(row.id, projectId);
        moved.push(row.id);
      }
    }
    return moved;
  }

  function rebuildUsageRecord(provider: NormalizedEvent['provider'], messageId: string): void {
    const observations = repos.usage.listObservationsByMessage(provider, messageId);
    const group = [...groupObservationsByMessage(observations).values()][0] ?? [];
    const draft = buildUsageRecord(group);
    if (draft === null) {
      repos.usage.deleteRecord(provider, messageId);
      return;
    }
    // The record belongs to the attributed session; its time is that session's earliest sighting.
    const own = observations.filter(
      (o) =>
        o.session.providerSessionId === draft.session.providerSessionId &&
        o.session.providerAgentId === draft.session.providerAgentId,
    );
    const first = own.find((o) => o.occurredAt !== null) ?? own[0];
    if (first === undefined) return;
    repos.usage.upsertRecord({
      provider,
      messageId,
      sessionId: first.sessionId,
      selectedEventId: draft.selectedEventId,
      occurredAt: first.occurredAt,
      requestId: draft.requestId,
      model: draft.model,
      tokens: draft.tokens,
      observationCount: draft.observationCount,
      conflict: draft.conflict,
      attributionAmbiguous: draft.attributionAmbiguous,
      source: provider === 'demo' ? 'demo' : 'transcript',
    });
  }

  function deriveSubagentEdges(provider: NormalizedEvent['provider'], providerSessionId: string) {
    const rows = repos.sessions.listByProviderSession(provider, providerSessionId);
    const byKey = new Map(rows.map((r) => [r.providerAgentId ?? '', r]));
    for (const child of rows) {
      if (child.providerAgentId === null) continue;
      const spawn = SpawnEvidenceSchema.safeParse(child.metadata['spawn']);
      if (!spawn.success) continue;
      const toolUseId = spawn.data.spawnToolUseId ?? null;
      const calls =
        toolUseId === null
          ? []
          : repos.events.listToolCalls(
              rows.map((r) => r.id),
              [toolUseId],
            );
      const sightings: ToolCallSighting[] = [];
      for (const call of calls) {
        const caller = rows.find((r) => r.id === call.sessionId);
        if (caller !== undefined) {
          sightings.push({
            session: keyOf(caller),
            toolUseId: call.toolUseId,
            toolName: call.toolName,
          });
        }
      }
      const edge = deriveSubagentEdge(
        {
          provider,
          providerSessionId,
          agentId: child.providerAgentId,
          spawnToolUseId: toolUseId,
          spawnDepth: spawn.data.spawnDepth ?? null,
        },
        sightings,
      );
      if (edge === null) continue;
      const parent = byKey.get(edge.parent.providerAgentId ?? '');
      if (parent === undefined) continue; // parent not observed yet; recomputed when it appears
      repos.edges.upsert({
        kind: 'subagent',
        parentSessionId: parent.id,
        childSessionId: child.id,
        provenance: edge.provenance,
        evidence: edge.evidence,
        observedAt: deps.now().toISOString(),
      });
    }
  }

  function deriveContinuation(sessionIds: readonly string[]): void {
    // Expand to every session reachable through shared messages: a child's parent is decided by
    // comparing it with all candidates, so the evidence set must be closed.
    const ids = new Set(sessionIds);
    let sightings = repos.usage.listSharedSightings([...ids]);
    for (let round = 0; round < 8; round++) {
      const before = ids.size;
      for (const s of sightings) ids.add(s.sessionId);
      if (ids.size === before) break;
      sightings = repos.usage.listSharedSightings([...ids]);
    }
    if (sightings.length === 0) return;
    const edges = deriveContinuationEdges(
      sightings.map((s) => ({
        messageId: s.messageId,
        session: s.session,
        occurredAt: s.occurredAt,
      })),
    );
    for (const edge of edges) {
      const parent = repos.sessions.getByKey(edge.parent);
      const child = repos.sessions.getByKey(edge.child);
      if (parent === undefined || child === undefined) continue;
      repos.edges.upsert({
        kind: 'continuation',
        parentSessionId: parent.id,
        childSessionId: child.id,
        provenance: edge.provenance,
        evidence: edge.evidence,
        observedAt: deps.now().toISOString(),
      });
    }
  }

  return {
    ingestBatch: (batch) => run(batch.events, batch.nextCheckpoint),
    ingestEvents: (events) => run(events, null),
    counters: () => ({ ...counters }),
  };
}
