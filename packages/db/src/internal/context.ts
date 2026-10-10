import { randomUUID } from 'node:crypto';
import type { AcpDatabase, SqliteConnection } from '../database.js';

export interface RepositoryOptions {
  /** Clock for `created_at`/`updated_at` columns. Defaults to the system clock. */
  now?: () => Date;
  /** Internal id generator. Defaults to `crypto.randomUUID()`. */
  newId?: () => string;
}

export interface RepositoryContext {
  connection: SqliteConnection;
  now: () => Date;
  newId: () => string;
}

export function createContext(db: AcpDatabase, options: RepositoryOptions = {}): RepositoryContext {
  return {
    connection: db.connection,
    now: options.now ?? (() => new Date()),
    newId: options.newId ?? (() => randomUUID()),
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}
