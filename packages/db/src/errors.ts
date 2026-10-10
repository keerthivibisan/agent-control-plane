/**
 * Typed errors thrown by @acp/db. The server maps them to HTTP error bodies in its middleware;
 * this package never formats responses itself (AGENTS.md §6).
 */
export type DbErrorCode =
  | 'migration_failed'
  | 'migration_checksum_mismatch'
  | 'migration_unknown_applied'
  | 'invalid_input'
  | 'invalid_stored_value'
  | 'not_found'
  | 'conflict'
  | 'open_failed';

export class DbError extends Error {
  readonly code: DbErrorCode;

  constructor(code: DbErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DbError';
    this.code = code;
  }
}

export class MigrationError extends DbError {
  readonly version: number | null;

  constructor(
    code: Extract<
      DbErrorCode,
      'migration_failed' | 'migration_checksum_mismatch' | 'migration_unknown_applied'
    >,
    message: string,
    version: number | null,
    options?: { cause?: unknown },
  ) {
    super(code, message, options);
    this.name = 'MigrationError';
    this.version = version;
  }
}

/** A value read from a JSON or enum column failed validation: the database holds data we did not write. */
export class StoredValueError extends DbError {
  readonly table: string;
  readonly column: string;

  constructor(table: string, column: string, options?: { cause?: unknown }) {
    super('invalid_stored_value', `invalid stored value in ${table}.${column}`, options);
    this.name = 'StoredValueError';
    this.table = table;
    this.column = column;
  }
}
