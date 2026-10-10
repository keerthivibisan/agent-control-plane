import type { SqliteConnection } from '../database.js';
import {
  SESSION_COLUMNS,
  toSessionRow,
  type SessionDbRow,
  type SessionRow,
} from '../repositories/sessions.js';

/**
 * Recursive CTE `subtree(session_id, parent_session_id, depth, path)` over `subagent` edges from
 * `rootParam`. `path` holds the visited ids so a (corrupt) cycle cannot recurse forever; internal
 * ids are UUIDs and never contain '/'. Continuation edges are deliberately not followed.
 */
export function subagentSubtreeCte(rootParam: string): string {
  return `subtree(session_id, parent_session_id, depth, path) AS (
    SELECT id, NULL, 0, '/' || id || '/' FROM sessions WHERE id = ${rootParam}
    UNION ALL
    SELECT e.child_session_id, e.parent_session_id, t.depth + 1,
      t.path || e.child_session_id || '/'
    FROM session_edges e JOIN subtree t ON e.parent_session_id = t.session_id
    WHERE e.kind = 'subagent' AND instr(t.path, '/' || e.child_session_id || '/') = 0
  )`;
}

export interface SessionTreeNode {
  session: SessionRow;
  /** Parent within the tree (`null` for the root). */
  parentSessionId: string | null;
  /** 0 for the root. */
  depth: number;
}

/** Root first, then by depth, first-seen time, and id. Empty when the root does not exist. */
export function createSessionTreeQuery(c: SqliteConnection) {
  const stmt = c.prepare(`
    WITH RECURSIVE ${subagentSubtreeCte('@root')}
    SELECT ${SESSION_COLUMNS.split(',')
      .map((col) => `s.${col.trim()}`)
      .join(', ')}, t.parent_session_id AS tree_parent_session_id, t.depth AS tree_depth
    FROM subtree t JOIN sessions s ON s.id = t.session_id
    ORDER BY t.depth, s.first_seen_at, s.id`);

  return (rootSessionId: string): SessionTreeNode[] =>
    (
      stmt.all({ root: rootSessionId }) as (SessionDbRow & {
        tree_parent_session_id: string | null;
        tree_depth: number;
      })[]
    ).map((row) => ({
      session: toSessionRow(row),
      parentSessionId: row.tree_parent_session_id,
      depth: row.tree_depth,
    }));
}
