import { IsoTimestampSchema, type IsoTimestamp } from '@acp/core';
import { DbError, StoredValueError } from '../errors.js';

/**
 * The structural part of a Zod schema this package relies on. @acp/db does not depend on zod
 * directly; it validates with the schemas exported by @acp/core.
 */
export interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/** Validates caller input; throws `DbError('invalid_input')` naming the field. */
export function parseInput<T>(schema: Parser<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DbError('invalid_input', `invalid ${what}`, { cause: result.error });
  }
  return result.data;
}

/** Validates a value read from the database; throws `StoredValueError` naming the column. */
export function parseStored<T>(
  schema: Parser<T>,
  value: unknown,
  table: string,
  column: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new StoredValueError(table, column, { cause: result.error });
  return result.data;
}

/** Parses a JSON column, then validates it. */
export function parseStoredJson<T>(
  schema: Parser<T>,
  text: string,
  table: string,
  column: string,
): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new StoredValueError(table, column, { cause });
  }
  return parseStored(schema, value, table, column);
}

/**
 * Normalizes an ISO-8601 timestamp (any offset) to UTC `...Z` with millisecond precision, so SQL
 * text comparison (MIN/MAX/ORDER BY) orders timestamps correctly.
 */
export function toStoredTimestamp(value: string, what: string): IsoTimestamp {
  parseInput(IsoTimestampSchema, value, what);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new DbError('invalid_input', `invalid ${what}`);
  return new Date(ms).toISOString();
}

export function toStoredTimestampOrNull(
  value: string | null | undefined,
  what: string,
): IsoTimestamp | null {
  return value === null || value === undefined ? null : toStoredTimestamp(value, what);
}

/** Reads a stored timestamp column back (validated, already normalized on write). */
export function storedTimestamp(value: unknown, table: string, column: string): IsoTimestamp {
  return parseStored(IsoTimestampSchema, value, table, column);
}

export function storedTimestampOrNull(
  value: unknown,
  table: string,
  column: string,
): IsoTimestamp | null {
  return value === null ? null : storedTimestamp(value, table, column);
}

export function nonEmptyOrNull(value: string | null | undefined, what: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new DbError('invalid_input', `${what} must be a non-empty string or null`);
  }
  return value;
}

export function requireNonEmpty(value: string, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DbError('invalid_input', `${what} must be a non-empty string`);
  }
  return value;
}

/** Page sizes are bounded so a single request cannot pin the event loop (ADR-0003). */
export const MAX_PAGE_SIZE = 500;

export function pageLimit(limit: number | undefined, fallback = 50): number {
  const value = limit ?? fallback;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new DbError('invalid_input', `limit must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  return value;
}

/** Placeholders for an `IN (...)` list. Callers chunk large lists; SQLite allows 32766 params. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
