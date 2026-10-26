import {
  addUsageTotals,
  AgentRoleKindSchema,
  emptyUsageTotals,
  tokenHeadline,
  type AgentRoleKind,
  type IsoTimestamp,
  type TokenHeadline,
  type UsageTotals,
} from '@acp/core';
import { DbError } from '../errors.js';
import type { AcpDatabase } from '../database.js';
import { parseStored, placeholders, toStoredTimestamp } from '../internal/validate.js';
import { TOTALS_SELECT, toTotals, type TotalsDbRow } from './usage.js';

/*
 * The project Tokens page (docs/history/redesign/README.md §4.5, `ProjectTokensDto`): new work vs
 * cache reuse for one project, from the same deduplicated usage records as every other view.
 *
 * Rules (docs/usage-accounting.md §5–6):
 * - Every group sums DIRECT usage: each usage record belongs to exactly one session (the record is
 *   unique per `(provider, messageId)` and attributed to its earliest occurrence), so a message a
 *   fork copied is counted once, under the session it was attributed to. Aggregates (direct plus
 *   subagent descendants) are never added, and cumulative snapshots are never summed.
 * - SQL groups the records once by (session, UTC day, model); every breakdown is a fold over those
 *   cells, so each record lands in exactly one row of each breakdown.
 * - A category is `null` when no contributing record reported it, never 0;
 *   `recordsWithUnavailable` says "partial".
 *
 * Agent runs: a session belongs to the agent run linked to its provider session
 * (`agent_run_sessions`, the managed adapter's `started` event). The link names a provider session,
 * so it covers the top-level session and Claude Code's own helper sessions inside it (same
 * provider session id). When several agent runs link the same provider session, the earliest link
 * owns it, so a session is never counted under two roles or tickets. A session no agent run links
 * is `external`: the owner started it outside the app. No link is ever guessed from timing or
 * folders (AGENTS.md rule 1).
 */

export interface TokensRange {
  /** Inclusive lower bound on the record's `occurredAt`. Records without a time are excluded. */
  from?: IsoTimestamp | undefined;
  /** Exclusive upper bound on the record's `occurredAt`. Records without a time are excluded. */
  to?: IsoTimestamp | undefined;
}

export type TokenRole = AgentRoleKind | 'external';

/** Workflow order (plan → orchestrate → helpers → review → tests), then sessions outside the app. */
export const TOKEN_ROLE_ORDER: readonly TokenRole[] = [
  'planner',
  'lead',
  'worker',
  'reviewer',
  'tester',
  'external',
];

export interface TokenRow {
  totals: UsageTotals;
  /** From `tokenHeadline()` over `totals.tokens`. */
  headline: TokenHeadline;
}

export interface ProjectTokens extends TokenRow {
  projectId: string;
  range: { from: IsoTimestamp | null; to: IsoTimestamp | null };
  sessions: {
    /** The project's sessions active in the range (all of them without a range). */
    total: number;
    /** Sessions with at least one usage record in the range. */
    withUsage: number;
  };
  /** The project's agent runs (orchestration runs) open at any time in the range. */
  runs: number;
  /** Distinct tickets among those runs. */
  ticketsWithRuns: number;
  /** UTC days, ascending. Records without a time have no day: they are in the totals only. */
  byDay: (TokenRow & { day: string })[];
  /** Sessions with usage in the range, most new work first. */
  bySession: (TokenRow & {
    sessionId: string;
    title: string | null;
    /**
     * The session's latest provider-reported running total before the range end (null: no
     * snapshot; `reportedCostUsd` null: the snapshot carried no cost). Never summed.
     */
    latestSnapshot: { reportedCostUsd: number | null } | null;
  })[];
  /** Tickets with a run in the range or with usage in the range, most new work first. */
  byTicket: (TokenRow & { ticketId: string; key: string; title: string })[];
  /** In `TOKEN_ROLE_ORDER`; only roles with usage in the range. */
  byRole: (TokenRow & { role: TokenRole })[];
  /** Most new work first; `null` groups records with no reported model. */
  byModel: (TokenRow & { model: string | null })[];
}

export interface TokenQueries {
  /** `undefined` for an unknown project. Throws `DbError('invalid_input')` for a bad range. */
  projectTokens(projectId: string, range?: TokensRange): ProjectTokens | undefined;
  /**
   * One ticket's direct usage, all time (v0.3.0 T-A, the ticket badge): the same cells as
   * `projectTokens` without a range, filtered to the ticket, so it equals that ticket's
   * `byTicket` row exactly. `undefined` for an unknown project.
   */
  ticketTokens(projectId: string, ticketId: string): TokenRow | undefined;
}

/**
 * Each provider session's owning agent run (earliest link), and the project's sessions with their
 * owner. A session with no project is the project's when its owning run is (a worktree session
 * ingested before its root was known).
 */
const SCOPED_CTE = `
  link AS (
    SELECT l.agent_run_id, l.provider, l.provider_session_id,
      ROW_NUMBER() OVER (
        PARTITION BY l.provider, l.provider_session_id ORDER BY l.created_at, l.rowid
      ) AS n
    FROM agent_run_sessions l
  ),
  owner AS (
    SELECT l.provider, l.provider_session_id, a.kind, o.project_id AS run_project_id, o.ticket_id
    FROM link l
    JOIN agent_runs a ON a.id = l.agent_run_id
    JOIN orchestration_runs o ON o.id = a.run_id
    WHERE l.n = 1
  ),
  scoped AS (
    SELECT s.id AS session_id, ow.kind, ow.ticket_id
    FROM sessions s
    LEFT JOIN owner ow
      ON ow.provider = s.provider AND ow.provider_session_id = s.provider_session_id
    WHERE s.project_id = @project OR (s.project_id IS NULL AND ow.run_project_id = @project)
  )`;

interface CellDbRow extends TotalsDbRow {
  session_id: string;
  kind: string | null;
  ticket_id: string | null;
  day: string | null;
  model: string | null;
}

interface SessionDbRow {
  id: string;
  title: string | null;
  first_seen_at: string;
  last_at: string;
}

interface SnapshotDbRow {
  session_id: string;
  reported_cost_usd: number | null;
}

interface RunDbRow {
  ticket_id: string | null;
}

interface TicketDbRow {
  id: string;
  key: string;
  title: string;
}

function row(totals: UsageTotals): TokenRow {
  return { totals, headline: tokenHeadline(totals.tokens) };
}

/** Folds cells into groups by key; the key order of the Map is first-seen. */
function fold<K>(cells: readonly CellDbRow[], keyOf: (c: CellDbRow) => K | undefined) {
  const out = new Map<K, UsageTotals>();
  for (const cell of cells) {
    const key = keyOf(cell);
    if (key === undefined) continue;
    out.set(key, addUsageTotals(out.get(key) ?? emptyUsageTotals(), toTotals(cell)));
  }
  return out;
}

/** Most new work first; unavailable (null) last; then by `tie` for a stable order. */
function byNewWork<T extends TokenRow>(tie: (r: T) => string) {
  return (a: T, b: T): number => {
    const x = a.headline.newWork;
    const y = b.headline.newWork;
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    }
    return tie(a).localeCompare(tie(b));
  };
}

export function createTokenQueries(db: AcpDatabase): TokenQueries {
  const c = db.connection;
  const projectExists = c.prepare('SELECT 1 FROM projects WHERE id = ?').pluck();
  const cells = c.prepare(`
    WITH ${SCOPED_CTE}
    SELECT sc.session_id AS session_id, sc.kind AS kind, sc.ticket_id AS ticket_id,
      substr(r.occurred_at, 1, 10) AS day, r.model AS model, ${TOTALS_SELECT}
    FROM usage_records r JOIN scoped sc ON sc.session_id = r.session_id
    WHERE (@from IS NULL OR r.occurred_at >= @from) AND (@to IS NULL OR r.occurred_at < @to)
    GROUP BY r.session_id, day, r.model`);
  const sessions = c.prepare(`
    WITH ${SCOPED_CTE}
    SELECT s.id, s.title, s.first_seen_at, COALESCE(s.last_event_at, s.last_observed_at) AS last_at
    FROM scoped sc JOIN sessions s ON s.id = sc.session_id`);
  const snapshots = c.prepare(`
    WITH ${SCOPED_CTE}
    SELECT session_id, reported_cost_usd FROM (
      SELECT u.session_id, u.reported_cost_usd,
        ROW_NUMBER() OVER (
          PARTITION BY u.session_id
          ORDER BY u.occurred_at IS NULL, u.occurred_at DESC, u.event_id DESC
        ) AS n
      FROM usage_snapshots u JOIN scoped sc ON sc.session_id = u.session_id
      WHERE @to IS NULL OR u.occurred_at < @to
    ) WHERE n = 1`);
  // A run counts when it was open at any time in the range: started before its end, and not
  // ended before its start.
  const runs = c.prepare(`
    SELECT ticket_id FROM orchestration_runs
    WHERE project_id = @project
      AND (@to IS NULL OR created_at < @to)
      AND (@from IS NULL OR ended_at IS NULL OR ended_at >= @from)`);

  // The same cells as `cells` (no range), for one ticket's sessions.
  const ticketCells = c.prepare(`
    WITH ${SCOPED_CTE}
    SELECT sc.session_id AS session_id, sc.kind AS kind, sc.ticket_id AS ticket_id,
      substr(r.occurred_at, 1, 10) AS day, r.model AS model, ${TOTALS_SELECT}
    FROM usage_records r JOIN scoped sc ON sc.session_id = r.session_id
    WHERE sc.ticket_id = @ticket
    GROUP BY r.session_id, day, r.model`);

  return {
    ticketTokens(projectId, ticketId) {
      if (projectExists.get(projectId) === undefined) return undefined;
      const all = ticketCells.all({ project: projectId, ticket: ticketId }) as CellDbRow[];
      return row(fold(all, () => 'all').get('all') ?? emptyUsageTotals());
    },

    projectTokens(projectId, range = {}) {
      if (projectExists.get(projectId) === undefined) return undefined;
      const from = range.from === undefined ? null : toStoredTimestamp(range.from, 'from');
      const to = range.to === undefined ? null : toStoredTimestamp(range.to, 'to');
      if (from !== null && to !== null && from >= to) {
        throw new DbError('invalid_input', 'invalid range: from must be before to');
      }
      const params = { project: projectId, from, to };

      const all = cells.all(params) as CellDbRow[];
      const roleOf = (cell: CellDbRow): TokenRole =>
        cell.kind === null
          ? 'external'
          : parseStored(AgentRoleKindSchema, cell.kind, 'agent_runs', 'kind');

      const totals = fold(all, () => 'all').get('all') ?? emptyUsageTotals();
      const bySessionTotals = fold(all, (cell) => cell.session_id);

      // Sessions active in the range: observed lifetime overlaps it, or usage falls inside it.
      const sessionRows = sessions.all(params) as SessionDbRow[];
      const inRange = (s: SessionDbRow) =>
        (to === null || s.first_seen_at < to) && (from === null || s.last_at >= from);
      const activeSessions = sessionRows.filter(
        (s) => inRange(s) || bySessionTotals.has(s.id),
      ).length;
      const titles = new Map(sessionRows.map((s) => [s.id, s.title]));
      const latest = new Map(
        (snapshots.all(params) as SnapshotDbRow[]).map((s) => [s.session_id, s.reported_cost_usd]),
      );

      const runRows = runs.all(params) as RunDbRow[];
      const runTickets = new Set(
        runRows.map((r) => r.ticket_id).filter((id): id is string => id !== null),
      );

      const bySession = [...bySessionTotals].map(([sessionId, t]) => ({
        sessionId,
        title: titles.get(sessionId) ?? null,
        latestSnapshot: latest.has(sessionId)
          ? { reportedCostUsd: latest.get(sessionId) ?? null }
          : null,
        ...row(t),
      }));
      bySession.sort(byNewWork((r) => r.sessionId));

      const byTicketTotals = fold(all, (cell) => cell.ticket_id ?? undefined);
      const ticketIds = [...new Set([...runTickets, ...byTicketTotals.keys()])];
      const tickets =
        ticketIds.length === 0
          ? []
          : (c
              .prepare(
                `SELECT id, key, title FROM tickets WHERE id IN (${placeholders(ticketIds.length)})`,
              )
              .all(...ticketIds) as TicketDbRow[]);
      const byTicket = tickets.map((t) => ({
        ticketId: t.id,
        key: t.key,
        title: t.title,
        ...row(byTicketTotals.get(t.id) ?? emptyUsageTotals()),
      }));
      byTicket.sort(byNewWork((r) => r.key));

      const byRoleTotals = fold(all, roleOf);
      const byRole = TOKEN_ROLE_ORDER.flatMap((role) => {
        const t = byRoleTotals.get(role);
        return t === undefined ? [] : [{ role, ...row(t) }];
      });

      const byModel = [...fold(all, (cell) => cell.model)].map(([model, t]) => ({
        model,
        ...row(t),
      }));
      byModel.sort(byNewWork((r) => r.model ?? '￿'));

      const byDay = [...fold(all, (cell) => cell.day ?? undefined)]
        .map(([day, t]) => ({ day, ...row(t) }))
        .sort((a, b) => a.day.localeCompare(b.day));

      return {
        projectId,
        range: { from, to },
        sessions: { total: activeSessions, withUsage: bySessionTotals.size },
        runs: runRows.length,
        ticketsWithRuns: runTickets.size,
        ...row(totals),
        byDay,
        bySession,
        byTicket,
        byRole,
        byModel,
      };
    },
  };
}
