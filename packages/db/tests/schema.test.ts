import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
  type AcpDatabase,
} from '../src/index.js';
import { tempDir } from './helpers.js';

let db: AcpDatabase;

beforeEach(() => {
  db = openDatabase(join(tempDir(), 'schema.sqlite'));
});
afterEach(() => db.close());

const PHASE1_TABLES = [
  'edge_conflicts',
  'events',
  'ingestion_checkpoints',
  'projects',
  'schema_migrations',
  'session_edges',
  'sessions',
  'usage_observations',
  'usage_records',
  'usage_snapshots',
];

const PHASE3_TABLES = [
  'agent_run_sessions',
  'agent_runs',
  'approvals',
  'artifacts',
  'managed_workspaces',
  'orchestration_runs',
  'orchestrator_messages',
];

const PHASE4_TABLES = ['check_runs', 'project_setup', 'ticket_comments', 'ticket_plans', 'tickets'];

/** Added by 0004 (R-G, project workspace redesign). */
const REDESIGN_TABLES = ['project_workflow'];

/** Added by 0006 (RL-0, ADR-0021: the review loop and the ticket branch). */
const REVIEW_LOOP_TABLES = ['change_reviews', 'ticket_branches'];

/** Added by 0009 (C-A, ADR-0026: attachments). */
const ACTIVITY_TABLES = ['ticket_attachments'];

/** Added by 0010 (H-B, ADR-0027: setup runs). */
const HARNESS_TABLES = ['setup_runs'];

/** Added by 0012 (CR-B, ADR-0030: conflict resolution). */
const RESOLUTION_TABLES = ['conflict_resolutions'];

function describeSchema(database: AcpDatabase) {
  const c = database.connection;
  const tables = c
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .pluck()
    .all() as string[];
  return tables.map((table) => ({
    table,
    columns: (
      c.pragma(`table_info(${table})`) as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[]
    ).map((col) =>
      [
        col.name,
        col.type,
        col.notnull ? 'NOT NULL' : 'NULL',
        col.pk ? `PK${col.pk}` : '',
        col.dflt_value === null ? '' : `DEFAULT ${col.dflt_value}`,
      ]
        .filter(Boolean)
        .join(' '),
    ),
    foreignKeys: (
      c.pragma(`foreign_key_list(${table})`) as {
        table: string;
        from: string;
        to: string;
        on_delete: string;
      }[]
    )
      .map((fk) => `${fk.from} -> ${fk.table}(${fk.to}) ON DELETE ${fk.on_delete}`)
      .sort(),
    indexes: (
      c.pragma(`index_list(${table})`) as { name: string; unique: number; origin: string }[]
    )
      .map((ix) => {
        const cols = (c.pragma(`index_xinfo(${ix.name})`) as { name: string | null; key: number }[])
          .filter((x) => x.key === 1)
          .map((x) => x.name ?? '<expr>');
        return `${ix.unique ? 'UNIQUE ' : ''}${ix.origin === 'c' ? ix.name : `(${ix.origin})`} (${cols.join(', ')})`;
      })
      .sort(),
  }));
}

describe('0001_observability schema (B3)', () => {
  it('ships as the first migration and is found from the default directory', () => {
    const migrations = loadMigrations(DEFAULT_MIGRATIONS_DIR);
    expect(migrations[0]).toMatchObject({ version: 1, name: 'observability' });
  });

  it('creates exactly the Phase 1 tables (no Phase 3 tables) when applied alone', () => {
    // Migration 0002 adds the Phase 3 tables; 0001 on its own must still create only Phase 1.
    const dir = join(tempDir(), 'only-0001');
    mkdirSync(dir);
    copyFileSync(
      join(DEFAULT_MIGRATIONS_DIR, '0001_observability.sql'),
      join(dir, '0001_observability.sql'),
    );
    const phase1 = openDatabase(join(tempDir(), 'phase1.sqlite'), { migrationsDir: dir });
    try {
      const tables = describeSchema(phase1).map((t) => t.table);
      expect(tables).toEqual(PHASE1_TABLES);
      for (const forbidden of PHASE3_TABLES) expect(tables).not.toContain(forbidden);
    } finally {
      phase1.close();
    }
  });

  it('with 0002-0006 applied, adds exactly the Phase 3, Phase 4, redesign and review-loop tables', () => {
    const tables = describeSchema(db).map((t) => t.table);
    expect(tables).toEqual(
      [
        ...PHASE1_TABLES,
        ...PHASE3_TABLES,
        ...PHASE4_TABLES,
        ...REDESIGN_TABLES,
        ...REVIEW_LOOP_TABLES,
        ...ACTIVITY_TABLES,
        ...HARNESS_TABLES,
        ...RESOLUTION_TABLES,
      ].sort(),
    );
  });

  it('matches the schema snapshot (columns, foreign keys, indexes)', () => {
    expect(describeSchema(db)).toMatchSnapshot();
  });

  it('uses STRICT tables', () => {
    const sql = db.connection
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence'",
      )
      .all() as { name: string; sql: string }[];
    for (const row of sql) expect(row.sql, row.name).toMatch(/\)\s*STRICT$/);
  });
});

describe('uniqueness and integrity constraints (B3)', () => {
  const now = '2026-10-10T08:00:00.000Z';

  function project(id: string, rootPath: string) {
    db.connection
      .prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)')
      .run(id, id, rootPath, now, now);
  }
  function session(id: string, providerSessionId: string, agentId = '') {
    db.connection
      .prepare(
        `INSERT INTO sessions (id, provider, provider_session_id, provider_agent_id, origin,
           first_seen_at, last_observed_at) VALUES (?, 'claude-code', ?, ?, 'external', ?, ?)`,
      )
      .run(id, providerSessionId, agentId, now, now);
  }
  function event(dedupKey: string): number {
    return Number(
      db.connection
        .prepare(
          `INSERT INTO events (schema_version, provider, event_type, dedup_key, observed_at,
             provenance, channel, payload) VALUES (1, 'claude-code', 'session.ended', ?, ?,
             'observed', 'transcript', '{"reason":null}')`,
        )
        .run(dedupKey, now).lastInsertRowid,
    );
  }
  function edge(id: string, kind: string, parent: string, child: string) {
    db.connection
      .prepare('INSERT INTO session_edges VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, kind, parent, child, 'observed', '["subagent-metadata"]', now, now);
  }
  function record(id: string, messageId: string, sessionId: string) {
    db.connection
      .prepare(
        `INSERT INTO usage_records (id, provider, message_id, session_id, observation_count,
           conflict, source, provenance, updated_at)
         VALUES (?, 'claude-code', ?, ?, 1, 0, 'transcript', 'observed', ?)`,
      )
      .run(id, messageId, sessionId, now);
  }

  it('projects.root_path is unique', () => {
    project('p1', '/repo');
    expect(() => project('p2', '/repo')).toThrow(/UNIQUE constraint failed: projects.root_path/);
  });

  it('sessions are unique by (provider, provider_session_id, provider_agent_id)', () => {
    session('s1', 'sess-1');
    session('s2', 'sess-1', 'agent-a'); // a subagent of the same provider session is distinct
    expect(() => session('s3', 'sess-1')).toThrow(/UNIQUE constraint failed: sessions.provider/);
    expect(() => session('s4', 'sess-1', 'agent-a')).toThrow(/UNIQUE constraint failed/);
  });

  it("top-level sessions default provider_agent_id to ''", () => {
    db.connection
      .prepare(
        `INSERT INTO sessions (id, provider, provider_session_id, origin, first_seen_at,
           last_observed_at) VALUES ('s1', 'claude-code', 'x', 'external', ?, ?)`,
      )
      .run(now, now);
    expect(
      db.connection.prepare("SELECT provider_agent_id FROM sessions WHERE id = 's1'").pluck().get(),
    ).toBe('');
  });

  it('events.dedup_key is unique and ids are monotonic', () => {
    const a = event('k1');
    const b = event('k2');
    expect(b).toBeGreaterThan(a);
    expect(() => event('k1')).toThrow(/UNIQUE constraint failed: events.dedup_key/);
    // AUTOINCREMENT never reuses an id, even after the newest row is purged.
    db.connection.prepare('DELETE FROM events WHERE id = ?').run(b);
    expect(event('k3')).toBeGreaterThan(b);
  });

  it('usage_records are unique by (provider, message_id)', () => {
    session('s1', 'sess-1');
    session('s2', 'sess-2');
    record('r1', 'msg-1', 's1');
    expect(() => record('r2', 'msg-1', 's2')).toThrow(/UNIQUE constraint failed: usage_records/);
  });

  it('session_edges are unique by (kind, child_session_id) and reject self-loops', () => {
    session('p', 'sess-1');
    session('q', 'sess-2');
    session('c', 'sess-1', 'agent-a');
    edge('e1', 'subagent', 'p', 'c');
    expect(() => edge('e2', 'subagent', 'q', 'c')).toThrow(
      /UNIQUE constraint failed: session_edges/,
    );
    edge('e3', 'continuation', 'q', 'c'); // a different kind is a different edge
    expect(() => edge('e4', 'subagent', 'p', 'p')).toThrow(/CHECK constraint failed/);
  });

  it('enforces foreign keys and keeps history when a project is unregistered', () => {
    expect(() => edge('e1', 'subagent', 'missing', 'also-missing')).toThrow(/FOREIGN KEY/);
    project('p1', '/repo');
    session('s1', 'sess-1');
    db.connection.prepare("UPDATE sessions SET project_id = 'p1' WHERE id = 's1'").run();
    db.connection.prepare("DELETE FROM projects WHERE id = 'p1'").run();
    expect(
      db.connection.prepare("SELECT project_id FROM sessions WHERE id = 's1'").pluck().get(),
    ).toBeNull();
  });

  it('rejects negative token counts and invalid JSON', () => {
    session('s1', 'sess-1');
    const id = event('k1');
    expect(() =>
      db.connection
        .prepare(
          `INSERT INTO usage_observations (event_id, provider, message_id, session_id, output_tokens)
           VALUES (?, 'claude-code', 'm', 's1', -1)`,
        )
        .run(id),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.connection.prepare("UPDATE sessions SET metadata = '[1]' WHERE id = 's1'").run(),
    ).toThrow(/CHECK constraint failed/);
  });
});
