import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type BetterSqlite3 from 'better-sqlite3';
import { MigrationError } from './errors.js';

export interface MigrationOptions {
  /**
   * Directory holding `NNNN_name.sql` files. Defaults to the `migrations/` directory next to this
   * module, which exists in `src/` and is copied into `dist/` by the build script.
   */
  migrationsDir?: string;
  /** Clock for `applied_at`. */
  now?: () => Date;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
  /** sha256 hex of the file content with line endings normalized to `\n`. */
  checksum: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  appliedAt: string;
  checksum: string;
}

export interface MigrationResult {
  applied: AppliedMigration[];
  /** Versions that were already applied and verified unchanged. */
  skipped: number[];
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Reads and orders the migration files. Non-matching files are ignored; duplicates throw. */
export function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Migration[] {
  if (!existsSync(dir)) {
    throw new MigrationError('migration_failed', `migrations directory not found: ${dir}`, null);
  }
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir).sort()) {
    const match = FILE_PATTERN.exec(file);
    if (!match) continue;
    // Both groups are mandatory in FILE_PATTERN, so they are present when it matches.
    const version = Number(match[1]);
    const name = match[2] as string;
    if (version === 0) {
      throw new MigrationError('migration_failed', 'migration versions start at 0001', version);
    }
    if (migrations.some((m) => m.version === version)) {
      throw new MigrationError(
        'migration_failed',
        `duplicate migration version ${version}`,
        version,
      );
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    migrations.push({ version, name, sql, checksum: checksumOf(sql) });
  }
  return migrations.sort((a, b) => a.version - b.version);
}

export function checksumOf(sql: string): string {
  // Normalizing line endings keeps checksums stable across git autocrlf checkouts.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Applies pending migrations in version order, each in its own transaction, and records them in
 * `schema_migrations`. Verifies every already-applied migration first: an edited applied migration
 * (checksum mismatch) or an applied version this build does not know (a newer database) throws
 * before anything is applied. Applied migrations are never edited; add a new one instead.
 */
export function runMigrations(
  connection: BetterSqlite3.Database,
  options: MigrationOptions = {},
): MigrationResult {
  const now = options.now ?? (() => new Date());
  const migrations = loadMigrations(options.migrationsDir);

  connection.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    checksum TEXT NOT NULL
  ) STRICT`);

  const appliedRows = connection
    .prepare('SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version')
    .all() as { version: number; name: string; applied_at: string; checksum: string }[];

  const known = new Map(migrations.map((m) => [m.version, m]));
  for (const row of appliedRows) {
    const migration = known.get(row.version);
    if (!migration) {
      throw new MigrationError(
        'migration_unknown_applied',
        `database has migration ${row.version} (${row.name}) that this build does not know`,
        row.version,
      );
    }
    if (migration.checksum !== row.checksum) {
      throw new MigrationError(
        'migration_checksum_mismatch',
        `migration ${row.version} (${row.name}) was edited after it was applied`,
        row.version,
      );
    }
  }

  const appliedVersions = new Set(appliedRows.map((r) => r.version));
  const insert = connection.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
  );
  const alreadyApplied = connection.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const result: MigrationResult = { applied: [], skipped: [...appliedVersions] };

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    const appliedAt = now().toISOString();
    const apply = connection.transaction((): boolean => {
      // Another process may have applied it between the check above and taking the lock.
      if (alreadyApplied.get(migration.version) !== undefined) return false;
      connection.exec(migration.sql);
      insert.run(migration.version, migration.name, appliedAt, migration.checksum);
      return true;
    });
    let didApply: boolean;
    try {
      // IMMEDIATE takes the write lock up front, so two processes cannot race on one version.
      didApply = apply.immediate();
    } catch (cause) {
      throw new MigrationError(
        'migration_failed',
        `migration ${migration.version} (${migration.name}) failed`,
        migration.version,
        { cause },
      );
    }
    if (!didApply) {
      result.skipped.push(migration.version);
      continue;
    }
    result.applied.push({
      version: migration.version,
      name: migration.name,
      appliedAt,
      checksum: migration.checksum,
    });
  }
  return result;
}
