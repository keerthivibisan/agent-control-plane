import express, { Router, type ErrorRequestHandler } from 'express';
import type { ObservationAdapter } from '@acp/core';
import { HttpError } from '../errors.js';
import { requestIdOf } from '../http/middleware.js';
import { errorFields, type Logger } from '../logger.js';
import type { Pipeline } from '../pipeline/ingest.js';
import type { HookState } from '../services/system.js';
import { tokenMatches } from './token.js';

export const HOOK_TOKEN_HEADER = 'x-acp-hook-token';
export const HOOK_BODY_LIMIT = '256kb';

export interface HookDeps {
  token: string;
  /** The provider's adapter; absent when the mode has no live hooks (demo). */
  adapter: ObservationAdapter | undefined;
  pipeline: Pipeline;
  hookState: HookState;
  requestPoll: () => void;
  logger: Logger;
  now: () => Date;
}

/**
 * `POST /api/hooks/claude-code`. Authenticated by a shared token (checked before the body is read),
 * size-limited, answered with 204 and no body. A hook never carries usage; it only adds lifecycle
 * facts and triggers an immediate transcript poll (usage-accounting scenario 9).
 */
export function createHookRouter(deps: HookDeps): Router {
  const router = Router();
  router.post(
    '/hooks/claude-code',
    (req, _res, next) => {
      if (!tokenMatches(deps.token, req.header(HOOK_TOKEN_HEADER))) {
        next(new HttpError(401, 'unauthorized', 'Missing or invalid hook token'));
        return;
      }
      next();
    },
    express.json({ limit: HOOK_BODY_LIMIT }),
    (req, res) => {
      if (deps.adapter === undefined) {
        throw new HttpError(404, 'hooks_unavailable', 'This mode does not accept provider hooks');
      }
      let events;
      try {
        events = deps.adapter.normalizeHook(req.body, deps.now().toISOString());
      } catch {
        // The adapter's message may quote the payload, so it is not echoed or logged.
        throw new HttpError(400, 'invalid_hook', 'Hook payload was not recognised');
      }
      if (events.length > 0) deps.pipeline.ingestEvents(events);
      deps.hookState.receivedAny = true;
      deps.requestPoll();
      deps.logger.log('info', 'hook accepted', {
        requestId: requestIdOf(res),
        events: events.length,
      });
      res.status(204).end();
    },
  );
  // Every rejection is logged with the request id and a fixed reason code, never the body, headers
  // or token; the shared error handler then sends the ErrorDto.
  const logRejection: ErrorRequestHandler = (err: unknown, _req, res, next) => {
    deps.logger.log('warn', 'hook rejected', {
      requestId: requestIdOf(res),
      reason: rejectionReason(err),
    });
    next(err);
  };
  router.use('/hooks/claude-code', logRejection);
  return router;
}

function rejectionReason(err: unknown): string {
  if (err instanceof HttpError) return err.code;
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.too.large') return 'payload_too_large';
  if (type === 'entity.parse.failed') return 'invalid_json';
  return errorFields(err).errorName;
}
