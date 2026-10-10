import {
  SessionEdgeEvidenceSchema,
  SessionEdgeKindSchema,
  SessionEdgeSchema,
  type IsoTimestamp,
  type SessionEdgeEvidence,
  type SessionEdgeKind,
} from '@acp/core';
import { DbError } from '../errors.js';
import type { RepositoryContext } from '../internal/context.js';
import {
  parseInput,
  parseStored,
  parseStoredJson,
  placeholders,
  storedTimestamp,
  toStoredTimestamp,
} from '../internal/validate.js';
import { SESSION_COLUMNS, sessionKeyOf, toSessionRow, type SessionDbRow } from './sessions.js';

export type EdgeProvenance = 'observed' | 'derived';

export interface EdgeUpsertInput {
  kind: SessionEdgeKind;
  /** Internal session ids (both sessions must exist). */
  parentSessionId: string;
  childSessionId: string;
  provenance: EdgeProvenance;
  /** At least one entry; validated against the SessionEdgeSchema rules for `kind`. */
  evidence: readonly SessionEdgeEvidence[];
  observedAt: IsoTimestamp;
}

export interface EdgeRow {
  id: string;
  kind: SessionEdgeKind;
  parentSessionId: string;
  childSessionId: string;
  provenance: EdgeProvenance;
  /** Sorted and de-duplicated. */
  evidence: SessionEdgeEvidence[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface EdgeConflictRow {
  id: string;
  edgeId: string;
  kind: SessionEdgeKind;
  childSessionId: string;
  existingParentSessionId: string;
  conflictingParentSessionId: string;
  provenance: EdgeProvenance;
  evidence: SessionEdgeEvidence[];
  firstSeenAt: IsoTimestamp;
  lastSeenAt: IsoTimestamp;
}

/**
 * - `inserted`: a new edge.
 * - `evidence-added`: same parent; the evidence set grew (or provenance was upgraded to observed).
 * - `unchanged`: same parent and nothing new.
 * - `conflict`: a different parent; recorded in `edge_conflicts`, the edge is left as it was.
 */
export type EdgeUpsertOutcome = 'inserted' | 'evidence-added' | 'unchanged' | 'conflict';

export interface EdgeUpsertResult {
  outcome: EdgeUpsertOutcome;
  /** The stored edge after the call (unchanged on conflict). */
  edge: EdgeRow;
  /** Set when `outcome` is `conflict`. */
  conflictId?: string;
}

export interface EdgesRepository {
  /**
   * Upserts by `(kind, child)`. Re-ingestion only adds evidence; it never re-parents silently
   * (domain-model §3 SessionEdge). Call inside a transaction when combined with other writes.
   */
  upsert(input: EdgeUpsertInput): EdgeUpsertResult;
  getByChild(kind: SessionEdgeKind, childSessionId: string): EdgeRow | undefined;
  listChildren(parentSessionId: string, kind?: SessionEdgeKind): EdgeRow[];
  /** Every edge touching any of the sessions (as parent or child). */
  listForSessions(sessionIds: readonly string[]): EdgeRow[];
  listConflicts(childSessionId?: string): EdgeConflictRow[];
}

interface EdgeDbRow {
  id: string;
  kind: string;
  parent_session_id: string;
  child_session_id: string;
  provenance: string;
  evidence: string;
  created_at: string;
  updated_at: string;
}

interface ConflictDbRow {
  id: string;
  edge_id: string;
  kind: string;
  child_session_id: string;
  existing_parent_session_id: string;
  conflicting_parent_session_id: string;
  provenance: string;
  evidence: string;
  first_seen_at: string;
  last_seen_at: string;
}

const EDGE_COLUMNS =
  'id, kind, parent_session_id, child_session_id, provenance, evidence, created_at, updated_at';
const CONFLICT_COLUMNS = `id, edge_id, kind, child_session_id, existing_parent_session_id,
  conflicting_parent_session_id, provenance, evidence, first_seen_at, last_seen_at`;

const EvidenceListSchema = SessionEdgeEvidenceSchema.array().min(1);
// SessionEdgeSchema is a refined object; Zod 4 keeps `.shape` available on refined objects.
const EdgeProvenanceSchema = SessionEdgeSchema.shape.provenance;

function parseProvenance(value: string, table: string): EdgeProvenance {
  return parseStored(EdgeProvenanceSchema, value, table, 'provenance');
}

function toEdge(row: EdgeDbRow): EdgeRow {
  const t = 'session_edges';
  return {
    id: row.id,
    kind: parseStored(SessionEdgeKindSchema, row.kind, t, 'kind'),
    parentSessionId: row.parent_session_id,
    childSessionId: row.child_session_id,
    provenance: parseProvenance(row.provenance, t),
    evidence: parseStoredJson(EvidenceListSchema, row.evidence, t, 'evidence'),
    createdAt: storedTimestamp(row.created_at, t, 'created_at'),
    updatedAt: storedTimestamp(row.updated_at, t, 'updated_at'),
  };
}

function toConflict(row: ConflictDbRow): EdgeConflictRow {
  const t = 'edge_conflicts';
  return {
    id: row.id,
    edgeId: row.edge_id,
    kind: parseStored(SessionEdgeKindSchema, row.kind, t, 'kind'),
    childSessionId: row.child_session_id,
    existingParentSessionId: row.existing_parent_session_id,
    conflictingParentSessionId: row.conflicting_parent_session_id,
    provenance: parseProvenance(row.provenance, t),
    evidence: parseStoredJson(EvidenceListSchema, row.evidence, t, 'evidence'),
    firstSeenAt: storedTimestamp(row.first_seen_at, t, 'first_seen_at'),
    lastSeenAt: storedTimestamp(row.last_seen_at, t, 'last_seen_at'),
  };
}

function unionEvidence(
  a: readonly SessionEdgeEvidence[],
  b: readonly SessionEdgeEvidence[],
): SessionEdgeEvidence[] {
  return [...new Set([...a, ...b])].sort();
}

/** `observed` is stronger evidence than `derived`; a union keeps the stronger one. */
function unionProvenance(a: EdgeProvenance, b: EdgeProvenance): EdgeProvenance {
  return a === 'observed' || b === 'observed' ? 'observed' : 'derived';
}

export function createEdgesRepository(ctx: RepositoryContext): EdgesRepository {
  const c = ctx.connection;
  const sessionById = c.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`);
  const byChild = c.prepare(
    `SELECT ${EDGE_COLUMNS} FROM session_edges WHERE kind = ? AND child_session_id = ?`,
  );
  const insertEdge = c.prepare(
    `INSERT INTO session_edges (${EDGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING ${EDGE_COLUMNS}`,
  );
  const updateEdge = c.prepare(
    `UPDATE session_edges SET evidence = ?, provenance = ?, updated_at = ? WHERE id = ?
     RETURNING ${EDGE_COLUMNS}`,
  );
  const children = c.prepare(
    `SELECT ${EDGE_COLUMNS} FROM session_edges WHERE parent_session_id = ?
     AND (? IS NULL OR kind = ?) ORDER BY kind, created_at, id`,
  );
  const conflictByKey = c.prepare(
    `SELECT ${CONFLICT_COLUMNS} FROM edge_conflicts
     WHERE kind = ? AND child_session_id = ? AND conflicting_parent_session_id = ?`,
  );
  const insertConflict = c.prepare(
    `INSERT INTO edge_conflicts (${CONFLICT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateConflict = c.prepare(
    `UPDATE edge_conflicts SET evidence = ?, provenance = ?, last_seen_at = MAX(last_seen_at, ?)
     WHERE id = ?`,
  );
  const conflicts = c.prepare(
    `SELECT ${CONFLICT_COLUMNS} FROM edge_conflicts WHERE (? IS NULL OR child_session_id = ?)
     ORDER BY first_seen_at, id`,
  );

  function requireSession(id: string, role: string) {
    const row = sessionById.get(id) as SessionDbRow | undefined;
    if (!row) throw new DbError('not_found', `${role} session not found`);
    return toSessionRow(row);
  }

  const upsert = c.transaction((input: EdgeUpsertInput): EdgeUpsertResult => {
    const parent = requireSession(input.parentSessionId, 'parent');
    const child = requireSession(input.childSessionId, 'child');
    // Re-use core's edge rules (evidence required per kind) instead of duplicating them.
    const edge = parseInput(
      SessionEdgeSchema,
      {
        kind: input.kind,
        parent: sessionKeyOf(parent),
        child: sessionKeyOf(child),
        provenance: input.provenance,
        evidence: [...input.evidence],
      },
      'session edge',
    );
    if (parent.id === child.id) throw new DbError('invalid_input', 'an edge cannot be a self-loop');
    const at = toStoredTimestamp(input.observedAt, 'observedAt');
    const evidence = unionEvidence([], edge.evidence);

    const existingRow = byChild.get(edge.kind, child.id) as EdgeDbRow | undefined;
    if (!existingRow) {
      const row = insertEdge.get(
        ctx.newId(),
        edge.kind,
        parent.id,
        child.id,
        edge.provenance,
        JSON.stringify(evidence),
        at,
        at,
      ) as EdgeDbRow;
      return { outcome: 'inserted', edge: toEdge(row) };
    }

    const existing = toEdge(existingRow);
    if (existing.parentSessionId !== parent.id) {
      const prior = conflictByKey.get(edge.kind, child.id, parent.id) as ConflictDbRow | undefined;
      if (prior) {
        const p = toConflict(prior);
        updateConflict.run(
          JSON.stringify(unionEvidence(p.evidence, evidence)),
          unionProvenance(p.provenance, edge.provenance),
          at,
          p.id,
        );
        return { outcome: 'conflict', edge: existing, conflictId: p.id };
      }
      const conflictId = ctx.newId();
      insertConflict.run(
        conflictId,
        existing.id,
        edge.kind,
        child.id,
        existing.parentSessionId,
        parent.id,
        edge.provenance,
        JSON.stringify(evidence),
        at,
        at,
      );
      return { outcome: 'conflict', edge: existing, conflictId };
    }

    const merged = unionEvidence(existing.evidence, evidence);
    const provenance = unionProvenance(existing.provenance, edge.provenance);
    if (merged.length === existing.evidence.length && provenance === existing.provenance) {
      return { outcome: 'unchanged', edge: existing };
    }
    const updatedAt = at > existing.updatedAt ? at : existing.updatedAt;
    const row = updateEdge.get(
      JSON.stringify(merged),
      provenance,
      updatedAt,
      existing.id,
    ) as EdgeDbRow;
    return { outcome: 'evidence-added', edge: toEdge(row) };
  });

  return {
    upsert: (input) => upsert(input),
    getByChild(kind, childSessionId) {
      const row = byChild.get(kind, childSessionId) as EdgeDbRow | undefined;
      return row && toEdge(row);
    },
    listChildren(parentSessionId, kind) {
      const k = kind ?? null;
      return (children.all(parentSessionId, k, k) as EdgeDbRow[]).map(toEdge);
    },
    listForSessions(sessionIds) {
      const out = new Map<string, EdgeRow>();
      for (let i = 0; i < sessionIds.length; i += 400) {
        const chunk = sessionIds.slice(i, i + 400);
        const ph = placeholders(chunk.length);
        const rows = c
          .prepare(
            `SELECT ${EDGE_COLUMNS} FROM session_edges
             WHERE parent_session_id IN (${ph}) OR child_session_id IN (${ph})`,
          )
          .all(...chunk, ...chunk) as EdgeDbRow[];
        for (const row of rows) out.set(row.id, toEdge(row));
      }
      return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
    },
    listConflicts(childSessionId) {
      const id = childSessionId ?? null;
      return (conflicts.all(id, id) as ConflictDbRow[]).map(toConflict);
    },
  };
}
