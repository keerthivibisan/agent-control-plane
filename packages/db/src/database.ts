import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { DbError } from './errors.js';
import { runMigrations, type MigrationOptions } from './migrations.js';

/** The raw better-sqlite3 connection. Exposed for repositories, queries, and diagnostics. */
export type SqliteConnection = BetterSqlite3.Database;

export interface AcpDatabase {
  /** File path, or `:memory:`. */
  readonly path: string;
  readonly connection: SqliteConnection;
  close(): void;
}

export interface OpenDatabaseOptions extends MigrationOptions {
  /** Apply pending migrations on open. Default `true`. */
  migrate?: boolean;
  /** SQLite `busy_timeout` in milliseconds. Default 5000 (ADR-0003). */
  busyTimeoutMs?: number;
}

const MEMORY = ':memory:';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Opens (creating if needed) the SQLite database at `path` and applies the connection settings
 * from ADR-0003: WAL journal, `foreign_keys=ON`, `busy_timeout=5000`.
 *
 * A missing parent directory is created with mode 0700. The database file is created with, or
 * tightened to, mode 0600 before SQLite opens it; SQLite gives the `-wal`/`-shm` files the same
 * mode as the main file. An existing parent directory is never chmod-ed, because it may be shared
 * (for example a temp directory).
 */
export function openDatabase(path: string, options: OpenDatabaseOptions = {}): AcpDatabase {
  const isMemory = path === MEMORY;
  if (!isMemory) prepareFile(path);

  let connection: SqliteConnection;
  try {
    connection = new BetterSqlite3(path);
  } catch (cause) {
    throw new DbError('open_failed', 'failed to open database', { cause });
  }

  try {
    applyPragmas(connection, isMemory, options.busyTimeoutMs ?? 5000);
    if (options.migrate ?? true) runMigrations(connection, options);
  } catch (error) {
    connection.close();
    throw error;
  }

  return {
    path,
    connection,
    close: () => connection.close(),
  };
}

function prepareFile(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  // 'a' creates the file without truncating an existing database.
  closeSync(openSync(path, 'a', FILE_MODE));
  // POSIX modes do not apply on Windows; the file inherits the directory ACL there.
  if (process.platform !== 'win32') chmodSync(path, FILE_MODE);
}

function applyPragmas(connection: SqliteConnection, isMemory: boolean, busyTimeoutMs: number) {
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new DbError('invalid_input', 'busyTimeoutMs must be a non-negative integer');
  }
  const journal = connection.pragma('journal_mode = WAL', { simple: true });
  // In-memory databases cannot use WAL; they report `memory`.
  if (!isMemory && journal !== 'wal') {
    throw new DbError('open_failed', `could not enable WAL (journal_mode=${String(journal)})`);
  }
  connection.pragma('foreign_keys = ON');
  connection.pragma(`busy_timeout = ${busyTimeoutMs}`);
  if (connection.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new DbError('open_failed', 'could not enable foreign keys');
  }
}
