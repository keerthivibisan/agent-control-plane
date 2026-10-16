import type { z } from 'zod';
import { badRequest } from '../errors.js';

/** A response that fails its own DTO is a server bug: a 500, never a 400 blamed on the client. */
export class ResponseContractError extends Error {
  override readonly name = 'ResponseContractError';
}

/** Parses a response with its core DTO schema before it is sent. */
export function out<T extends z.ZodType>(schema: T, value: z.input<T>): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ResponseContractError('response does not match its DTO');
  return parsed.data;
}

export function param(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value === '') throw badRequest('Missing path parameter');
  return value;
}
