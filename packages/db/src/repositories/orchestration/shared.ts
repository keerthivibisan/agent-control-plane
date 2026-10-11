import { DbError } from '../../errors.js';
import { parseInput, type Parser } from '../../internal/validate.js';

/**
 * Helpers shared by the orchestration repositories (Phase 3). Enums that `@acp/core` defines are
 * validated with its Zod schemas; the few values core does not define yet (artifact kind, session
 * relation, workspace state, chat role) are closed lists here. See the README for the proposal to
 * move them into core.
 */

export function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error && (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
  );
}

export function isConstraintViolation(error: unknown): boolean {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

/**
 * Runs a write and turns SQLite constraint failures into typed errors: a missing referenced row
 * becomes `not_found`, any other constraint (unique, check) becomes `conflict` or `invalid_input`.
 */
export function guardWrite<T>(what: string, write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new DbError('not_found', `${what}: a referenced row does not exist`, { cause: error });
    }
    if (
      error instanceof Error &&
      ((error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY')
    ) {
      throw new DbError('conflict', `${what}: already exists`, { cause: error });
    }
    if (isConstraintViolation(error)) {
      throw new DbError('invalid_input', `${what}: violates a constraint`, { cause: error });
    }
    throw error;
  }
}

/** A Parser for a closed list of string literals (for enums core does not define). */
export function literalParser<const T extends string>(values: readonly T[]): Parser<T> {
  return {
    safeParse(value: unknown) {
      return typeof value === 'string' && (values as readonly string[]).includes(value)
        ? { success: true, data: value as T }
        : { success: false, error: new Error(`expected one of ${values.join(', ')}`) };
    },
  };
}

/** A Parser for a string of bounded length. */
export function textParser(min: number, max: number): Parser<string> {
  return {
    safeParse(value: unknown) {
      return typeof value === 'string' && value.length >= min && value.length <= max
        ? { success: true, data: value }
        : { success: false, error: new Error(`expected a string of ${min}..${max} characters`) };
    },
  };
}

export function nullable<T>(parser: Parser<T>): Parser<T | null> {
  return {
    safeParse(value: unknown) {
      return value === null ? { success: true, data: null } : parser.safeParse(value);
    },
  };
}

export const nonNegativeInt: Parser<number> = {
  safeParse(value: unknown) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? { success: true, data: value }
      : { success: false, error: new Error('expected a non-negative integer') };
  },
};

export const positiveInt: Parser<number> = {
  safeParse(value: unknown) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? { success: true, data: value }
      : { success: false, error: new Error('expected a positive integer') };
  },
};

/** Validates an optional `from` status guard and returns it as a SQL-ready list (or null). */
export function statusGuard<T extends string>(
  schema: Parser<T>,
  from: readonly T[] | undefined,
  what: string,
): T[] | null {
  if (from === undefined) return null;
  if (from.length === 0) throw new DbError('invalid_input', `${what}: 'from' must not be empty`);
  return from.map((s) => parseInput(schema, s, what));
}
