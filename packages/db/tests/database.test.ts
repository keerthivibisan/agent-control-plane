import { chmodSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DbError, openDatabase } from '../src/index.js';
import { tempDir } from './helpers.js';

const posix = process.platform !== 'win32';
const mode = (p: string) => statSync(p).mode & 0o777;

describe('openDatabase (B1)', () => {
  it('applies WAL, foreign_keys=ON, and busy_timeout=5000', () => {
    const db = openDatabase(join(tempDir(), 'acp.sqlite'), { migrate: false });
    try {
      const c = db.connection;
      expect(c.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(c.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(c.pragma('busy_timeout', { simple: true })).toBe(5000);
    } finally {
      db.close();
    }
  });

  it('accepts a custom busy timeout and rejects an invalid one', () => {
    const dir = tempDir();
    const db = openDatabase(join(dir, 'a.sqlite'), { migrate: false, busyTimeoutMs: 250 });
    expect(db.connection.pragma('busy_timeout', { simple: true })).toBe(250);
    db.close();
    expect(() =>
      openDatabase(join(dir, 'b.sqlite'), { migrate: false, busyTimeoutMs: -1 }),
    ).toThrow(DbError);
  });

  it.runIf(posix)(
    'creates a missing parent directory with mode 0700 and the file with 0600',
    () => {
      const dataDir = join(tempDir(), 'nested', 'data');
      const file = join(dataDir, 'acp.sqlite');
      const db = openDatabase(file, { migrate: false });
      try {
        db.connection.exec('CREATE TABLE t (x INTEGER)');
        db.connection.prepare('INSERT INTO t VALUES (1)').run();
        expect(mode(dataDir)).toBe(0o700);
        expect(mode(join(dataDir, '..'))).toBe(0o700);
        expect(mode(file)).toBe(0o600);
        // SQLite creates the WAL with the main file's permissions.
        expect(existsSync(`${file}-wal`)).toBe(true);
        expect(mode(`${file}-wal`)).toBe(0o600);
      } finally {
        db.close();
      }
    },
  );

  it.runIf(posix)('tightens an existing database file to 0600 and keeps its contents', () => {
    const dir = tempDir();
    const file = join(dir, 'acp.sqlite');
    const first = openDatabase(file, { migrate: false });
    first.connection.exec('CREATE TABLE kept (x INTEGER)');
    first.close();
    // Simulate a file loosened by something else.
    chmodSync(file, 0o644);
    const dirModeBefore = mode(dir);

    const db = openDatabase(file, { migrate: false });
    try {
      expect(mode(file)).toBe(0o600);
      // An existing directory is never chmod-ed.
      expect(mode(dir)).toBe(dirModeBefore);
      const row = db.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kept'")
        .get();
      expect(row).toEqual({ name: 'kept' });
    } finally {
      db.close();
    }
  });

  it('supports :memory: without touching the filesystem', () => {
    const db = openDatabase(':memory:', { migrate: false });
    try {
      expect(db.path).toBe(':memory:');
      expect(db.connection.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      db.close();
    }
  });

  it('enforces foreign keys on the opened connection', () => {
    const db = openDatabase(join(tempDir(), 'fk.sqlite'), { migrate: false });
    try {
      db.connection.exec(
        'CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (p_id TEXT REFERENCES p(id));',
      );
      expect(() => db.connection.prepare("INSERT INTO c VALUES ('missing')").run()).toThrow(
        /FOREIGN KEY/,
      );
    } finally {
      db.close();
    }
  });
});
