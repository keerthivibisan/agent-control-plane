import {
  ProviderIdSchema,
  SessionKeySchema,
  type IsoTimestamp,
  type ProviderId,
  type SessionKey,
} from '@acp/core';
import { DbError, StoredValueError } from '../errors.js';
import type { RepositoryContext } from '../internal/context.js';
import {
  nonEmptyOrNull,
  parseInput,
  parseStored,
  placeholders,
  storedTimestamp,
  storedTimestampOrNull,
  toStoredTimestamp,
  toStoredTimestampOrNull,
} from '../internal/validate.js';

/** How the session came to exist (domain-model §3). */
export const SESSION_ORIGINS = ['external', 'managed', 'demo'] as const;
export type SessionOrigin = (typeof SESSION_ORIGINS)[number];

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** Allowlisted, content-free session metadata (ADR-0009). The caller enforces the allowlist. */
export type SessionMetadata = { [key: string]: JsonValue };

/**
 * Evidence about one session. Absent (`undefined`) and `null` both mean "this observation does not
 * say"; neither ever clears a stored value.
 */
export interface SessionUpsertInput {
  key: SessionKey;
  origin: SessionOrigin;
  /** Merged as MIN with the stored value. */
  firstSeenAt: IsoTimestamp;
  /** Merged as MAX with the stored value. */
  lastObservedAt: IsoTimestamp;
  /** Provider time of the latest activity evidence. Merged as MAX, ignoring nulls. */
  lastEventAt?: IsoTimestamp | null;
  /** First non-null value wins (association is decided once from `launchCwd`; see `setProject`). */
  projectId?: string | null;
  /** First observed cwd. First non-null value wins. */
  launchCwd?: string | null;
  /** First non-null value wins. */
  entrypoint?: string | null;
  /** Subagent type. First non-null value wins. */
  agentType?: string | null;
  /** Subagent description. First non-null value wins. */
  description?: string | null;
  /** Latest non-null value wins. */
  gitBranch?: string | null;
  /** Latest non-null value wins. */
  providerVersion?: string | null;
  /** Latest non-null value wins. */
  title?: string | null;
  /** Observed end (e.g. SessionEnd hook). Merged as MAX, ignoring nulls. */
  endedAt?: IsoTimestamp | null;
  /** Kept together with the latest `endedAt`. */
  endReason?: string | null;
  /** Latest "needs attention" evidence (Notification hook). Merged as MAX, ignoring nulls. */
  lastAttentionAt?: IsoTimestamp | null;
  /** Merged into the stored object with JSON merge-patch semantics (RFC 7396): `null` removes a key. */
  metadata?: SessionMetadata;
}

/**
 * A stored session. Status is not stored; derive it from the evidence columns
 * (`lastEventAt`, `endedAt`, `lastAttentionAt`, `lastObservedAt`) with core's status logic.
 */
export interface SessionRow {
  id: string;
  provider: ProviderId;
  providerSessionId: string;
  /** `null` for top-level sessions (stored as `''`). */
  providerAgentId: string | null;
  projectId: string | null;
  origin: SessionOrigin;
  launchCwd: string | null;
  gitBranch: string | null;
  entrypoint: string | null;
  providerVersion: string | null;
  title: string | null;
  agentType: string | null;
  description: string | null;
  firstSeenAt: IsoTimestamp;
  lastObservedAt: IsoTimestamp;
  lastEventAt: IsoTimestamp | null;
  endedAt: IsoTimestamp | null;
  endReason: string | null;
  lastAttentionAt: IsoTimestamp | null;
  metadata: SessionMetadata;
}

export interface SessionUpsertResult {
  id: string;
  created: boolean;
}

export interface SessionsRepository {
  /** Inserts or merges a session by its SessionKey (see field docs for the merge rules). */
  upsert(input: SessionUpsertInput): SessionUpsertResult;
  getById(id: string): SessionRow | undefined;
  getByKey(key: SessionKey): SessionRow | undefined;
  /** Sessions by id, in no particular order; unknown ids are skipped. */
  getByIds(ids: readonly string[]): SessionRow[];
  /** The top-level session and its subagents that share one provider session id. */
  listByProviderSession(provider: ProviderId, providerSessionId: string): SessionRow[];
  /** Sessions with no project, for re-association after a project is registered. */
  listUnassigned(): SessionRow[];
  /** Explicitly (re)associates a session with a project, or detaches it with `null`. */
  setProject(id: string, projectId: string | null): boolean;
}

export const SESSION_COLUMNS = `id, provider, provider_session_id, provider_agent_id, project_id,
  origin, launch_cwd, git_branch, entrypoint, provider_version, title, agent_type, description,
  first_seen_at, last_observed_at, last_event_at, ended_at, end_reason, last_attention_at, metadata`;

export interface SessionDbRow {
  id: string;
  provider: string;
  provider_session_id: string;
  provider_agent_id: string;
  project_id: string | null;
  origin: string;
  launch_cwd: string | null;
  git_branch: string | null;
  entrypoint: string | null;
  provider_version: string | null;
  title: string | null;
  agent_type: string | null;
  description: string | null;
  first_seen_at: string;
  last_observed_at: string;
  last_event_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  last_attention_at: string | null;
  metadata: string;
}

const T = 'sessions';

export function toSessionRow(row: SessionDbRow): SessionRow {
  if (!(SESSION_ORIGINS as readonly string[]).includes(row.origin)) {
    throw new StoredValueError(T, 'origin');
  }
  return {
    id: row.id,
    provider: parseStored(ProviderIdSchema, row.provider, T, 'provider'),
    providerSessionId: row.provider_session_id,
    providerAgentId: row.provider_agent_id === '' ? null : row.provider_agent_id,
    projectId: row.project_id,
    origin: row.origin as SessionOrigin,
    launchCwd: row.launch_cwd,
    gitBranch: row.git_branch,
    entrypoint: row.entrypoint,
    providerVersion: row.provider_version,
    title: row.title,
    agentType: row.agent_type,
    description: row.description,
    firstSeenAt: storedTimestamp(row.first_seen_at, T, 'first_seen_at'),
    lastObservedAt: storedTimestamp(row.last_observed_at, T, 'last_observed_at'),
    lastEventAt: storedTimestampOrNull(row.last_event_at, T, 'last_event_at'),
    endedAt: storedTimestampOrNull(row.ended_at, T, 'ended_at'),
    endReason: row.end_reason,
    lastAttentionAt: storedTimestampOrNull(row.last_attention_at, T, 'last_attention_at'),
    metadata: parseMetadata(row.metadata),
  };
}

/** The SessionKey of a stored session. */
export function sessionKeyOf(
  row: Pick<SessionRow, 'provider' | 'providerSessionId' | 'providerAgentId'>,
): SessionKey {
  return {
    provider: row.provider,
    providerSessionId: row.providerSessionId,
    providerAgentId: row.providerAgentId,
  };
}

function parseMetadata(text: string): SessionMetadata {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new StoredValueError(T, 'metadata', { cause });
  }
  if (!isPlainObject(value)) throw new StoredValueError(T, 'metadata');
  // JSON.parse output is JSON by construction; only the top-level shape needs checking.
  return value as SessionMetadata;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metadataJson(metadata: SessionMetadata | undefined): string {
  if (metadata === undefined) return '{}';
  if (!isPlainObject(metadata)) {
    throw new DbError('invalid_input', 'session metadata must be a JSON object');
  }
  return JSON.stringify(metadata);
}

/** MAX of two nullable timestamps, ignoring NULL (SQLite's MAX() returns NULL if any arg is NULL). */
const maxNonNull = (col: string) =>
  `CASE WHEN excluded.${col} IS NULL THEN sessions.${col}
        WHEN sessions.${col} IS NULL THEN excluded.${col}
        ELSE MAX(sessions.${col}, excluded.${col}) END`;

export function createSessionsRepository(ctx: RepositoryContext): SessionsRepository {
  const c = ctx.connection;
  // In ON CONFLICT DO UPDATE, `sessions.col` is the pre-update value for every assignment.
  const upsert = c.prepare(`
    INSERT INTO sessions (${SESSION_COLUMNS})
    VALUES (@id, @provider, @provider_session_id, @provider_agent_id, @project_id, @origin,
      @launch_cwd, @git_branch, @entrypoint, @provider_version, @title, @agent_type, @description,
      @first_seen_at, @last_observed_at, @last_event_at, @ended_at, @end_reason,
      @last_attention_at, @metadata)
    ON CONFLICT (provider, provider_session_id, provider_agent_id) DO UPDATE SET
      project_id = COALESCE(sessions.project_id, excluded.project_id),
      launch_cwd = COALESCE(sessions.launch_cwd, excluded.launch_cwd),
      entrypoint = COALESCE(sessions.entrypoint, excluded.entrypoint),
      agent_type = COALESCE(sessions.agent_type, excluded.agent_type),
      description = COALESCE(sessions.description, excluded.description),
      git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
      provider_version = COALESCE(excluded.provider_version, sessions.provider_version),
      title = COALESCE(excluded.title, sessions.title),
      first_seen_at = MIN(sessions.first_seen_at, excluded.first_seen_at),
      last_observed_at = MAX(sessions.last_observed_at, excluded.last_observed_at),
      last_event_at = ${maxNonNull('last_event_at')},
      ended_at = ${maxNonNull('ended_at')},
      end_reason = CASE
        WHEN excluded.ended_at IS NOT NULL
          AND (sessions.ended_at IS NULL OR excluded.ended_at >= sessions.ended_at)
        THEN COALESCE(excluded.end_reason, sessions.end_reason)
        ELSE sessions.end_reason END,
      last_attention_at = ${maxNonNull('last_attention_at')},
      metadata = json_patch(sessions.metadata, excluded.metadata)
    RETURNING id`);
  const byId = c.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`);
  const byKey = c.prepare(
    `SELECT ${SESSION_COLUMNS} FROM sessions
     WHERE provider = ? AND provider_session_id = ? AND provider_agent_id = ?`,
  );
  const byProviderSession = c.prepare(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE provider = ? AND provider_session_id = ?
     ORDER BY provider_agent_id`,
  );
  const unassigned = c.prepare(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE project_id IS NULL ORDER BY first_seen_at, id`,
  );
  const setProject = c.prepare('UPDATE sessions SET project_id = ? WHERE id = ?');

  return {
    upsert(input) {
      const key = parseInput(SessionKeySchema, input.key, 'session key');
      if (!(SESSION_ORIGINS as readonly string[]).includes(input.origin)) {
        throw new DbError('invalid_input', 'invalid session origin');
      }
      const id = ctx.newId();
      const params = {
        id,
        provider: key.provider,
        provider_session_id: key.providerSessionId,
        provider_agent_id: key.providerAgentId ?? '',
        project_id: nonEmptyOrNull(input.projectId, 'projectId'),
        origin: input.origin,
        launch_cwd: nonEmptyOrNull(input.launchCwd, 'launchCwd'),
        git_branch: nonEmptyOrNull(input.gitBranch, 'gitBranch'),
        entrypoint: nonEmptyOrNull(input.entrypoint, 'entrypoint'),
        provider_version: nonEmptyOrNull(input.providerVersion, 'providerVersion'),
        title: nonEmptyOrNull(input.title, 'title'),
        agent_type: nonEmptyOrNull(input.agentType, 'agentType'),
        description: nonEmptyOrNull(input.description, 'description'),
        first_seen_at: toStoredTimestamp(input.firstSeenAt, 'firstSeenAt'),
        last_observed_at: toStoredTimestamp(input.lastObservedAt, 'lastObservedAt'),
        last_event_at: toStoredTimestampOrNull(input.lastEventAt, 'lastEventAt'),
        ended_at: toStoredTimestampOrNull(input.endedAt, 'endedAt'),
        end_reason: nonEmptyOrNull(input.endReason, 'endReason'),
        last_attention_at: toStoredTimestampOrNull(input.lastAttentionAt, 'lastAttentionAt'),
        metadata: metadataJson(input.metadata),
      };
      const row = upsert.get(params) as { id: string };
      return { id: row.id, created: row.id === id };
    },
    getById(id) {
      const row = byId.get(id) as SessionDbRow | undefined;
      return row && toSessionRow(row);
    },
    getByKey(key) {
      const valid = parseInput(SessionKeySchema, key, 'session key');
      const row = byKey.get(
        valid.provider,
        valid.providerSessionId,
        valid.providerAgentId ?? '',
      ) as SessionDbRow | undefined;
      return row && toSessionRow(row);
    },
    getByIds(ids) {
      const out: SessionRow[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const rows = c
          .prepare(
            `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id IN (${placeholders(chunk.length)})`,
          )
          .all(...chunk) as SessionDbRow[];
        out.push(...rows.map(toSessionRow));
      }
      return out;
    },
    listByProviderSession(provider, providerSessionId) {
      return (byProviderSession.all(provider, providerSessionId) as SessionDbRow[]).map(
        toSessionRow,
      );
    },
    listUnassigned() {
      return (unassigned.all() as SessionDbRow[]).map(toSessionRow);
    },
    setProject(id, projectId) {
      return setProject.run(nonEmptyOrNull(projectId, 'projectId'), id).changes > 0;
    },
  };
}
