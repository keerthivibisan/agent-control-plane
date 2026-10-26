import { ProviderIdSchema, type IsoTimestamp, type ProviderId } from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStored, storedTimestamp } from '../../internal/validate.js';
import { guardWrite, literalParser, textParser } from './shared.js';

/** domain-model §3 AgentRunSession. Not in core yet (proposed). */
export const AGENT_RUN_SESSION_RELATIONS = ['primary', 'retry', 'provider-subagent'] as const;
export type AgentRunSessionRelation = (typeof AGENT_RUN_SESSION_RELATIONS)[number];
const RelationParser = literalParser(AGENT_RUN_SESSION_RELATIONS);
const ProviderSessionIdParser = textParser(1, 512);

export interface AgentRunSessionInput {
  agentRunId: string;
  provider: ProviderId;
  /** The id from the managed adapter's `started` event. */
  providerSessionId: string;
  relation: AgentRunSessionRelation;
}

export interface AgentRunSessionRow extends AgentRunSessionInput {
  /** The observed top-level session (sessions.id), or null until it has been ingested. */
  sessionId: string | null;
  createdAt: IsoTimestamp;
}

export interface AgentRunSessionsRepository {
  /**
   * Links an agent run to a provider session. Idempotent for the same link; a second `primary`
   * session, or the same session with another relation, throws `DbError('conflict')`.
   */
  link(input: AgentRunSessionInput): AgentRunSessionRow;
  listForAgentRun(agentRunId: string): AgentRunSessionRow[];
  /** Which agent runs a provider session belongs to (managed-session linking, ADR-0008). */
  findByProviderSession(provider: ProviderId, providerSessionId: string): AgentRunSessionRow[];
  /**
   * The links of many provider sessions at once (ADR-0024 §2: naming the sessions the app started
   * in session lists), oldest first. Unknown ids are left out.
   */
  listForProviderSessions(
    provider: ProviderId,
    providerSessionIds: readonly string[],
  ): AgentRunSessionRow[];
}

/** Ids per `IN (…)` query, well under SQLite's bound-parameter limit. */
const IN_CHUNK = 400;

interface LinkDbRow {
  agent_run_id: string;
  provider: string;
  provider_session_id: string;
  relation: string;
  session_id: string | null;
  created_at: string;
}

const T = 'agent_run_sessions';
const SELECT = `SELECT l.agent_run_id, l.provider, l.provider_session_id, l.relation,
    s.id AS session_id, l.created_at
  FROM agent_run_sessions l
  LEFT JOIN sessions s ON s.provider = l.provider AND s.provider_session_id = l.provider_session_id
    AND s.provider_agent_id = ''`;

function toLink(row: LinkDbRow): AgentRunSessionRow {
  return {
    agentRunId: row.agent_run_id,
    provider: parseStored(ProviderIdSchema, row.provider, T, 'provider'),
    providerSessionId: row.provider_session_id,
    relation: parseStored(RelationParser, row.relation, T, 'relation'),
    sessionId: row.session_id,
    createdAt: storedTimestamp(row.created_at, T, 'created_at'),
  };
}

export function createAgentRunSessionsRepository(
  ctx: RepositoryContext,
): AgentRunSessionsRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO ${T} (agent_run_id, provider, provider_session_id, relation, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (agent_run_id, provider, provider_session_id) DO NOTHING`,
  );
  const one = c.prepare(
    `${SELECT} WHERE l.agent_run_id = ? AND l.provider = ? AND l.provider_session_id = ?`,
  );
  const forAgent = c.prepare(`${SELECT} WHERE l.agent_run_id = ? ORDER BY l.created_at, l.rowid`);
  const forSession = c.prepare(
    `${SELECT} WHERE l.provider = ? AND l.provider_session_id = ? ORDER BY l.created_at, l.rowid`,
  );

  return {
    link(input) {
      const agentRunId = parseInput(textParser(1, 512), input.agentRunId, 'agentRunId');
      const provider = parseInput(ProviderIdSchema, input.provider, 'provider');
      const providerSessionId = parseInput(
        ProviderSessionIdParser,
        input.providerSessionId,
        'providerSessionId',
      );
      const relation = parseInput(RelationParser, input.relation, 'relation');
      return c.transaction((): AgentRunSessionRow => {
        guardWrite('agent run session', () =>
          insert.run(agentRunId, provider, providerSessionId, relation, ctx.now().toISOString()),
        );
        // Either inserted just now or already present.
        const row = toLink(one.get(agentRunId, provider, providerSessionId) as LinkDbRow);
        if (row.relation !== relation) {
          throw new DbError('conflict', `session is already linked as ${row.relation}`);
        }
        return row;
      })();
    },
    listForAgentRun(agentRunId) {
      return (forAgent.all(agentRunId) as LinkDbRow[]).map(toLink);
    },
    findByProviderSession(provider, providerSessionId) {
      return (forSession.all(provider, providerSessionId) as LinkDbRow[]).map(toLink);
    },
    listForProviderSessions(provider, providerSessionIds) {
      const valid = parseInput(ProviderIdSchema, provider, 'provider');
      const ids = [...new Set(providerSessionIds)].filter((id) => id.length > 0);
      const out: AgentRunSessionRow[] = [];
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const chunk = ids.slice(i, i + IN_CHUNK);
        const marks = chunk.map(() => '?').join(', ');
        const rows = c
          .prepare(
            `${SELECT} WHERE l.provider = ? AND l.provider_session_id IN (${marks})
             ORDER BY l.created_at, l.rowid`,
          )
          .all(valid, ...chunk) as LinkDbRow[];
        out.push(...rows.map(toLink));
      }
      return out;
    },
  };
}
