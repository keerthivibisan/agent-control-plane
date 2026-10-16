import { DbError } from '@acp/db';
import { HttpError } from '../errors.js';
import type { HarnessError, HarnessErrorCode } from '../harness/index.js';

/**
 * Harness refusals (P4-C) become `ErrorDto`s with the code in snake_case. They describe the
 * project folder (missing, not a repository, no commits), never file contents.
 */
const HARNESS_STATUS: Readonly<Record<HarnessErrorCode, number>> = {
  'invalid-root': 409,
  'not-a-git-repo': 409,
  'no-commits': 409,
  'git-failed': 500,
};

export function harnessError(error: HarnessError): HttpError {
  return new HttpError(HARNESS_STATUS[error.code], error.code.replaceAll('-', '_'), error.message);
}

/** A repository refusal the owner can act on (a key in use, a ticket that changed meanwhile). */
export function dbConflict(error: unknown, message: string): HttpError | null {
  if (error instanceof DbError && error.code === 'conflict') {
    return new HttpError(409, 'conflict', message);
  }
  return null;
}
