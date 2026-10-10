import type { IsoTimestamp } from '@acp/core';
import type { SqliteConnection } from '../database.js';
import { placeholders, storedTimestampOrNull } from '../internal/validate.js';

export interface ProjectStats {
  sessionCount: number;
  /** Latest `lastEventAt` over the project's sessions. */
  lastEventAt: IsoTimestamp | null;
}

export interface UnrecognizedRecordCount {
  providerVersion: string | null;
  recordType: string | null;
  count: number;
}

/** Counts for the diagnostics view. Counted, never silently dropped (AGENTS.md §6). */
export interface DiagnosticsCounts {
  /** Distinct (kind, child, conflicting parent) diagnostics in `edge_conflicts`. */
  edgeConflictCount: number;
  /** Usage records whose non-output categories disagreed across observations. */
  usageConflictCount: number;
  /** Usage records attributed by the fork tie-break (origin unknown). */
  ambiguousAttributionCount: number;
  /** `record.unrecognized` events per provider version and record type. */
  unrecognized: UnrecognizedRecordCount[];
}

export interface StatsQueries {
  /** Session count and latest activity for every registered project (zero sessions included). */
  projectStats(): Map<string, ProjectStats>;
  /** Number of direct `subagent` children per session. Every requested id gets an entry. */
  childCountBySession(sessionIds: readonly string[]): Map<string, number>;
  diagnosticsCounts(): DiagnosticsCounts;
}

export function createStatsQueries(c: SqliteConnection): StatsQueries {
  const projects = c.prepare(`
    SELECT p.id AS project_id, COUNT(s.id) AS session_count, MAX(s.last_event_at) AS last_event_at
    FROM projects p LEFT JOIN sessions s ON s.project_id = p.id
    GROUP BY p.id`);
  const edgeConflicts = c.prepare('SELECT COUNT(*) FROM edge_conflicts').pluck();
  const usageCounts = c.prepare(`
    SELECT COALESCE(SUM(conflict), 0) AS conflicts,
      COALESCE(SUM(attribution_ambiguous), 0) AS ambiguous
    FROM usage_records`);
  const unrecognized = c.prepare(`
    SELECT provider_version, json_extract(payload, '$.recordType') AS record_type,
      COUNT(*) AS count
    FROM events WHERE event_type = 'record.unrecognized'
    GROUP BY provider_version, record_type
    ORDER BY count DESC, provider_version, record_type`);

  return {
    projectStats() {
      const rows = projects.all() as {
        project_id: string;
        session_count: number;
        last_event_at: string | null;
      }[];
      return new Map(
        rows.map((r) => [
          r.project_id,
          {
            sessionCount: r.session_count,
            lastEventAt: storedTimestampOrNull(r.last_event_at, 'sessions', 'last_event_at'),
          },
        ]),
      );
    },
    childCountBySession(sessionIds) {
      const out = new Map<string, number>();
      for (const id of sessionIds) out.set(id, 0);
      for (let i = 0; i < sessionIds.length; i += 500) {
        const chunk = sessionIds.slice(i, i + 500);
        const rows = c
          .prepare(
            `SELECT parent_session_id, COUNT(*) AS n FROM session_edges
             WHERE kind = 'subagent' AND parent_session_id IN (${placeholders(chunk.length)})
             GROUP BY parent_session_id`,
          )
          .all(...chunk) as { parent_session_id: string; n: number }[];
        for (const row of rows) out.set(row.parent_session_id, row.n);
      }
      return out;
    },
    diagnosticsCounts() {
      const usage = usageCounts.get() as { conflicts: number; ambiguous: number };
      const rows = unrecognized.all() as {
        provider_version: string | null;
        record_type: unknown;
        count: number;
      }[];
      return {
        edgeConflictCount: edgeConflicts.get() as number,
        usageConflictCount: usage.conflicts,
        ambiguousAttributionCount: usage.ambiguous,
        unrecognized: rows.map((r) => ({
          providerVersion: r.provider_version,
          recordType: typeof r.record_type === 'string' ? r.record_type : null,
          count: r.count,
        })),
      };
    },
  };
}
