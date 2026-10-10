import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ErrorDto } from '@acp/core/api';
import { HttpError } from '../errors.js';
import { errorFields, type Logger } from '../logger.js';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Assigns every request an id, echoed in the response header and in any error body. */
export const requestId: RequestHandler = (req, res, next) => {
  const id = randomUUID();
  res.locals['requestId'] = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};

export function requestIdOf(res: { locals: Record<string, unknown> }): string {
  const id = res.locals['requestId'];
  return typeof id === 'string' ? id : 'unknown';
}

function errorBody(
  res: { locals: Record<string, unknown> },
  code: string,
  message: string,
): ErrorDto {
  return { error: { code, message, requestId: requestIdOf(res) } };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(errorBody(res, 'not_found', `No route for ${req.method} ${req.path}`));
};

interface BodyParserError {
  type?: string;
  status?: number;
}

/** The single place where errors become `ErrorDto` responses. 500s never leak internal messages. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json(errorBody(res, err.code, err.message));
      return;
    }
    if (err instanceof ZodError) {
      const message = err.issues
        .map((i) => `${i.path.join('.') || 'request'}: ${i.message}`)
        .join('; ');
      res.status(400).json(errorBody(res, 'invalid_request', message));
      return;
    }
    const bp = err as BodyParserError;
    if (bp.type === 'entity.too.large') {
      res.status(413).json(errorBody(res, 'payload_too_large', 'Request body is too large'));
      return;
    }
    if (bp.type === 'entity.parse.failed') {
      res.status(400).json(errorBody(res, 'invalid_json', 'Request body is not valid JSON'));
      return;
    }
    logger.log('error', 'unhandled request error', {
      requestId: requestIdOf(res),
      method: req.method,
      ...errorFields(err),
    });
    res.status(500).json(errorBody(res, 'internal_error', 'Internal server error'));
  };
}
