import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checksumOf,
  loadMigrations,
  MigrationError,
  openDatabase,
  runMigrations,
  type AcpDatabase,
} from '../src/index.js';
import { fixedClock, tempDir } from './helpers.js';

function migrationsDir(files: Record<string, string>): string {
  const dir = join(tempDir(), 'migrations');
  mkdirSync(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

function freshDb(): AcpDatabase {
  return openDatabase(join(tempDir(), 'm.sqlite'), { migrate: false });
}

function tables(db: AcpDatabase): string[] {
  return (
    db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

const ONE = 'CREATE TABLE one (x INTEGER);\n';
const TWO = 'CREATE TABLE two (y INTEGER);\n';

describe('migration runner (B2)', () => {
  it('applies migrations in version order and records them in schema_migrations', () => {
    // Written out of order on purpose; the runner sorts by version.
    const dir = migrationsDir({ '0002_two.sql': TWO, '0001_one.sql': ONE, 'notes.txt': 'x' });
    const db = freshDb();
    try {
      const result = runMigrations(db.connection, { migrationsDir: dir, now: fixedClock() });
      expect(result.applied.map((m) => [m.version, m.name])).toEqual([
        [1, 'one'],
        [2, 'two'],
      ]);
      expect(result.skipped).toEqual([]);
      expect(tables(db)).toEqual(['one', 'schema_migrations', 'two']);
      expect(
        db.connection.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),
      ).toEqual([
        {
          version: 1,
          name: 'one',
          applied_at: '2026-10-10T08:00:00.000Z',
          checksum: checksumOf(ONE),
        },
        {
          version: 2,
          name: 'two',
          applied_at: '2026-10-10T08:00:01.000Z',
          checksum: checksumOf(TWO),
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('is a no-op when re-run, and applies only new migrations later', () => {
    const dir = migrationsDir({ '0001_one.sql': ONE });
    const db = freshDb();
    try {
      runMigrations(db.connection, { migrationsDir: dir });
      const again = runMigrations(db.connection, { migrationsDir: dir });
      expect(again).toEqual({ applied: [], skipped: [1] });

      writeFileSync(join(dir, '0002_two.sql'), TWO);
      const later = runMigrations(db.connection, { migrationsDir: dir });
      expect(later.applied.map((m) => m.version)).toEqual([2]);
      expect(later.skipped).toEqual([1]);
    } finally {
      db.close();
    }
  });

  it('throws on a checksum mismatch for an applied migration and applies nothing', () => {
    const dir = migrationsDir({ '0001_one.sql': ONE });
    const db = freshDb();
    try {
      runMigrations(db.connection, { migrationsDir: dir });
      writeFileSync(join(dir, '0001_one.sql'), 'CREATE TABLE one (x INTEGER, z TEXT);\n');
      writeFileSync(join(dir, '0002_two.sql'), TWO);

      const error = catchError(() => runMigrations(db.connection, { migrationsDir: dir }));
      expect(error).toBeInstanceOf(MigrationError);
      expect(error).toMatchObject({ code: 'migration_checksum_mismatch', version: 1 });
      expect(tables(db)).not.toContain('two');
    } finally {
      db.close();
    }
  });

  it('treats CRLF and LF checkouts of the same file as unchanged', () => {
    expect(checksumOf('a;\r\nb;\r\n')).toBe(checksumOf('a;\nb;\n'));
  });

  it('refuses a database with an applied migration this build does not know', () => {
    const newer = migrationsDir({ '0001_one.sql': ONE, '0002_two.sql': TWO });
    const db = freshDb();
    try {
      runMigrations(db.connection, { migrationsDir: newer });
      const older = migrationsDir({ '0001_one.sql': ONE });
      const error = catchError(() => runMigrations(db.connection, { migrationsDir: older }));
      expect(error).toMatchObject({ code: 'migration_unknown_applied', version: 2 });
    } finally {
      db.close();
    }
  });

  it('rolls back a failing migration in its own transaction and keeps earlier ones', () => {
    const dir = migrationsDir({
      '0001_one.sql': ONE,
      '0002_bad.sql': 'CREATE TABLE half (x INTEGER);\nINSERT INTO missing_table VALUES (1);\n',
    });
    const db = freshDb();
    try {
      const error = catchError(() => runMigrations(db.connection, { migrationsDir: dir }));
      expect(error).toMatchObject({ code: 'migration_failed', version: 2 });
      expect(tables(db)).toEqual(['one', 'schema_migrations']);
      expect(db.connection.prepare('SELECT version FROM schema_migrations').pluck().all()).toEqual([
        1,
      ]);
    } finally {
      db.close();
    }
  });

  it('rejects duplicate versions and a missing directory', () => {
    const dir = migrationsDir({ '0001_one.sql': ONE, '0001_other.sql': TWO });
    expect(() => loadMigrations(dir)).toThrow(/duplicate migration version 1/);
    expect(() => loadMigrations(join(tempDir(), 'nope'))).toThrow(MigrationError);
  });

  it('runs migrations from openDatabase by default', () => {
    const dir = migrationsDir({ '0001_one.sql': ONE });
    const db = openDatabase(join(tempDir(), 'o.sqlite'), { migrationsDir: dir });
    try {
      expect(tables(db)).toContain('one');
    } finally {
      db.close();
    }
  });
});
