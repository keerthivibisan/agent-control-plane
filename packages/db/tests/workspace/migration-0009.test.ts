// Synthetic data only: ids, names, hashes and texts are fake (C-A, migration 0009, ADR-0026:
// comment kinds, agent notes and attachments).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENTS_PER_TICKET } from '@acp/core';
import {
  createWorkspaceRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
  type AcpDatabase,
} from '../../src/index.js';
import { tempDir } from '../helpers.js';
import { count, setupWorkspace, ticketWithRun } from './setup.js';

const SHA = 'c'.repeat(64);
const SHA2 = 'd'.repeat(64);

function columns(db: AcpDatabase, table: string): string[] {
  return (db.connection.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

function file(name = 'notes.txt', sha256 = SHA) {
  return { name, mimeType: 'text/plain' as const, sizeBytes: 12, sha256 };
}

describe('migration 0009 (C-A)', () => {
  it('ships as 0009_ticket_activity', () => {
    const shipped = loadMigrations(DEFAULT_MIGRATIONS_DIR);
    expect(shipped.find((m) => m.version === 9)).toMatchObject({ name: 'ticket_activity' });
  });

  it('keeps comments stored before it, with a null kind and agent run', () => {
    const dir = join(tempDir(), 'upto-0008');
    mkdirSync(dir);
    for (const m of loadMigrations(DEFAULT_MIGRATIONS_DIR).filter((m) => m.version <= 8)) {
      const name = `${String(m.version).padStart(4, '0')}_${m.name}.sql`;
      copyFileSync(join(DEFAULT_MIGRATIONS_DIR, name), join(dir, name));
    }
    const old = openDatabase(join(tempDir(), 'old8.sqlite'), { migrationsDir: dir });
    expect(columns(old, 'ticket_comments')).not.toContain('kind');
    const at = '2026-10-22T09:00:00.000Z';
    old.connection
      .prepare("INSERT INTO projects VALUES ('p1', 'web', '/home/user/web', ?, ?)")
      .run(at, at);
    old.connection
      .prepare(
        `INSERT INTO tickets (id, project_id, seq, key, title, type, priority, status, created_at,
           updated_at) VALUES ('t1', 'p1', 1, 'WEB-1', 'Old', 'feature', 'medium', 'BACKLOG', ?, ?)`,
      )
      .run(at, at);
    const ticket = { id: 't1' };
    old.connection
      .prepare(
        `INSERT INTO ticket_comments (id, ticket_id, run_id, plan_id, author, body, created_at)
         VALUES ('c1', ?, NULL, NULL, 'owner', 'Synthetic comment', '2026-10-22T09:00:00.000Z')`,
      )
      .run(ticket.id);
    const oldPath = old.connection.name;
    old.close();

    const migrated = openDatabase(oldPath);
    try {
      expect(columns(migrated, 'ticket_comments')).toEqual(
        expect.arrayContaining(['kind', 'agent_run_id']),
      );
      expect(columns(migrated, 'ticket_attachments')).toEqual([
        'id',
        'ticket_id',
        'comment_id',
        'name',
        'mime_type',
        'size_bytes',
        'sha256',
        'created_at',
      ]);
      const ws = createWorkspaceRepositories(migrated);
      expect(ws.comments.getById('c1')).toMatchObject({
        author: 'owner',
        body: 'Synthetic comment',
        kind: null,
        agentRunId: null,
      });
    } finally {
      migrated.close();
    }
  });
});

describe('ticket comments with a kind (C-A)', () => {
  it('stores a kind and an agent run of the run', () => {
    const store = setupWorkspace();
    const { ticket, run, helper } = ticketWithRun(store);
    const summary = store.ws.comments.insert({
      ticketId: ticket.id,
      runId: run.id,
      author: 'lead',
      body: 'Added a dark mode switch.',
      kind: 'ticket-summary',
    });
    expect(summary).toMatchObject({ kind: 'ticket-summary', agentRunId: null });
    const tagged = store.ws.comments.insert({
      ticketId: ticket.id,
      runId: run.id,
      author: 'app',
      body: 'Synthetic note',
      kind: 'agent-note',
      agentRunId: helper.id,
    });
    expect(store.ws.comments.getById(tagged.id)).toMatchObject({
      kind: 'agent-note',
      agentRunId: helper.id,
    });
  });

  it('refuses an agent run without its run, or of another run', () => {
    const store = setupWorkspace();
    const { ticket, run, helper } = ticketWithRun(store);
    expect(() =>
      store.ws.comments.insert({
        ticketId: ticket.id,
        author: 'app',
        body: 'x',
        agentRunId: helper.id,
      }),
    ).toThrow(/needs its run/);
    expect(() =>
      store.ws.comments.insert({
        ticketId: ticket.id,
        runId: run.id,
        author: 'app',
        body: 'x',
        agentRunId: 'not-an-agent',
      }),
    ).toThrow(/agent run not found/);
    expect(() =>
      store.ws.comments.insert({
        ticketId: ticket.id,
        author: 'owner',
        body: 'x',
        kind: 'chat' as never,
      }),
    ).toThrow(/comment kind/);
  });

  it('keeps one agent note per agent run: a later note replaces it and moves to now', () => {
    let at = Date.parse('2026-10-22T09:00:00.000Z');
    const store = setupWorkspace();
    const { ticket, run, helper } = ticketWithRun(store);
    const ws = createWorkspaceRepositories(store.db, { now: () => new Date((at += 1000)) });
    const first = ws.comments.upsertAgentNote({
      ticketId: ticket.id,
      runId: run.id,
      agentRunId: helper.id,
      body: 'Added the theme store.',
    });
    expect(first).toMatchObject({ author: 'app', kind: 'agent-note', agentRunId: helper.id });
    const second = ws.comments.upsertAgentNote({
      ticketId: ticket.id,
      runId: run.id,
      agentRunId: helper.id,
      body: 'Fixed the review findings.',
    });
    expect(second.id).toBe(first.id);
    expect(second.body).toBe('Fixed the review findings.');
    expect(second.createdAt > first.createdAt).toBe(true);
    expect(
      ws.comments.listForTicket(ticket.id).filter((c) => c.kind === 'agent-note'),
    ).toHaveLength(1);
    // The partial unique index holds even for a direct insert.
    expect(() =>
      ws.comments.insert({
        ticketId: ticket.id,
        runId: run.id,
        author: 'app',
        body: 'x',
        kind: 'agent-note',
        agentRunId: helper.id,
      }),
    ).toThrow(/already exists/);
  });

  it("deleting the run deletes its agents' notes", () => {
    const store = setupWorkspace();
    const { ticket, run, helper } = ticketWithRun(store);
    store.ws.comments.upsertAgentNote({
      ticketId: ticket.id,
      runId: run.id,
      agentRunId: helper.id,
      body: 'Synthetic note',
    });
    store.ws.tickets.setStatus(ticket.id, 'BACKLOG', { currentRunId: null });
    store.db.connection.prepare('DELETE FROM orchestration_runs WHERE id = ?').run(run.id);
    expect(count(store.db, 'ticket_comments')).toBe(0);
  });
});

describe('attachments (C-A)', () => {
  it('stores attachments on a ticket and on its comments, oldest first', () => {
    const store = setupWorkspace();
    const { ticket } = ticketWithRun(store);
    const a = store.ws.attachments.insert({ ticketId: ticket.id, ...file() });
    expect(a).toMatchObject({ ticketId: ticket.id, commentId: null, name: 'notes.txt' });
    const comment = store.ws.comments.insert({ ticketId: ticket.id, author: 'owner', body: 'See' });
    const b = store.ws.attachments.insert({
      ticketId: ticket.id,
      commentId: comment.id,
      ...file('shot.png', SHA2),
      mimeType: 'image/png',
    });
    expect(b.commentId).toBe(comment.id);
    expect(store.ws.attachments.listForTicket(ticket.id).map((x) => x.id)).toEqual([a.id, b.id]);
    expect(store.ws.attachments.countBySha256(SHA)).toBe(1);
  });

  it('refuses a bad name, type, size or hash, and a comment of another ticket', () => {
    const store = setupWorkspace();
    const { ticket } = ticketWithRun(store);
    const other = store.ws.tickets.insert({ projectId: store.projectId, title: 'Other' });
    const elsewhere = store.ws.comments.insert({ ticketId: other.id, author: 'owner', body: 'x' });
    const bad = [
      { ...file('../etc/passwd') },
      { ...file('.env') },
      { ...file(), mimeType: 'text/html' as never },
      { ...file(), sizeBytes: 0 },
      { ...file(), sizeBytes: 10 * 1024 * 1024 + 1 },
      { ...file(), sha256: 'XYZ' },
    ];
    for (const input of bad) {
      expect(() => store.ws.attachments.insert({ ticketId: ticket.id, ...input })).toThrow(
        /invalid attachment/,
      );
    }
    expect(() =>
      store.ws.attachments.insert({ ticketId: ticket.id, commentId: elsewhere.id, ...file() }),
    ).toThrow(/comment not found/);
    expect(() => store.ws.attachments.insert({ ticketId: 'nope', ...file() })).toThrow(
      /does not exist/,
    );
  });

  it(`allows at most ${MAX_ATTACHMENTS_PER_TICKET} per ticket`, () => {
    const store = setupWorkspace();
    const { ticket } = ticketWithRun(store);
    for (let i = 0; i < MAX_ATTACHMENTS_PER_TICKET; i++) {
      store.ws.attachments.insert({ ticketId: ticket.id, ...file(`f${i}.txt`) });
    }
    expect(store.ws.attachments.countForTicket(ticket.id)).toBe(MAX_ATTACHMENTS_PER_TICKET);
    expect(() => store.ws.attachments.insert({ ticketId: ticket.id, ...file('more.txt') })).toThrow(
      /at most/,
    );
  });

  it('attaches uploads to a comment all or none, and deletes rows', () => {
    const store = setupWorkspace();
    const { ticket } = ticketWithRun(store);
    const a = store.ws.attachments.insert({ ticketId: ticket.id, ...file() });
    const b = store.ws.attachments.insert({ ticketId: ticket.id, ...file('b.txt', SHA2) });
    const comment = store.ws.comments.insert({ ticketId: ticket.id, author: 'owner', body: 'x' });
    expect(() =>
      store.ws.attachments.attachToComment(ticket.id, comment.id, [a.id, 'missing']),
    ).toThrow(/attachment not found/);
    expect(store.ws.attachments.getById(a.id)?.commentId).toBeNull();
    const attached = store.ws.attachments.attachToComment(ticket.id, comment.id, [a.id, b.id]);
    expect(attached.map((x) => x.commentId)).toEqual([comment.id, comment.id]);
    const second = store.ws.comments.insert({ ticketId: ticket.id, author: 'owner', body: 'y' });
    expect(() => store.ws.attachments.attachToComment(ticket.id, second.id, [a.id])).toThrow(
      /already on a comment/,
    );
    expect(store.ws.attachments.delete(a.id)?.id).toBe(a.id);
    expect(store.ws.attachments.delete(a.id)).toBeUndefined();
    expect(store.ws.attachments.countBySha256(SHA)).toBe(0);
  });

  it('deleting the ticket deletes its attachment rows', () => {
    const store = setupWorkspace();
    const ticket = store.ws.tickets.insert({ projectId: store.projectId, title: 'Gone' });
    store.ws.attachments.insert({ ticketId: ticket.id, ...file() });
    store.db.connection.prepare('DELETE FROM tickets WHERE id = ?').run(ticket.id);
    expect(count(store.db, 'ticket_attachments')).toBe(0);
  });
});
