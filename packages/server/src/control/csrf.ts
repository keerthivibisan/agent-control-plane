import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { CSRF_HEADER } from '@acp/core/api';
import { HttpError } from '../errors.js';

/**
 * CSRF protection for the control panel's mutating routes (ADR-0013 §6). A new random token is made
 * on every server start and handed out by `GET /api/control/token`; the local-only guard already
 * keeps other origins from reading it. Every mutation must echo it in `X-ACP-CSRF`.
 */

/** 32 random bytes as 64 hex characters (`CsrfTokenDtoSchema` needs at least 32). */
export function createCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Constant-time comparison. Both sides are hashed first, so the compare never depends on where the
 * strings differ, and inputs of different lengths need no early return.
 */
export function csrfTokenMatches(expected: string, received: string): boolean {
  const a = createHash('sha256').update(expected, 'utf8').digest();
  const b = createHash('sha256').update(received, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function requireCsrf(token: string): RequestHandler {
  return (req, _res, next) => {
    const received = req.get(CSRF_HEADER);
    if (received === undefined || received === '') {
      throw new HttpError(403, 'csrf_missing', `The ${CSRF_HEADER} header is required`);
    }
    if (!csrfTokenMatches(token, received)) {
      throw new HttpError(403, 'csrf_invalid', `The ${CSRF_HEADER} header does not match`);
    }
    next();
  };
}
