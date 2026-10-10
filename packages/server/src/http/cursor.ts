import type { z } from 'zod';
import { badRequest } from '../errors.js';

/** Opaque cursors: base64url JSON, validated on the way back in. Clients must not parse them. */

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T extends z.ZodType>(
  raw: string | undefined,
  schema: T,
): z.infer<T> | null {
  if (raw === undefined || raw === '') return null;
  try {
    const json: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return schema.parse(json);
  } catch {
    throw badRequest('Invalid cursor', 'invalid_cursor');
  }
}
