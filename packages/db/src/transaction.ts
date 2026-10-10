import type { AcpDatabase } from './database.js';
import { DbError } from './errors.js';

/** Transactions are synchronous (better-sqlite3); an async body would commit before it finished. */
export type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;

/**
 * Runs `fn` in one write transaction (`BEGIN IMMEDIATE`) and returns its result. If `fn` throws,
 * everything it wrote is rolled back and the error is rethrown. Nested calls become savepoints,
 * so an inner failure caught by the outer body rolls back only the inner work.
 *
 * The pipeline uses this to commit a batch's events, projections, and checkpoint atomically
 * (usage-accounting §7 scenario 8).
 */
export function withTransaction<T>(db: AcpDatabase, fn: () => NotPromise<T>): T {
  const run = db.connection.transaction(() => {
    const result = fn();
    if (isPromiseLike(result)) {
      throw new DbError('invalid_input', 'withTransaction body must be synchronous');
    }
    return result;
  });
  return run.immediate();
}

function isPromiseLike(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
