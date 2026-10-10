import express, { type Express } from 'express';
import type { HealthDto } from '@acp/core/api';
import type { ServerConfig } from './config.js';
import { errorHandler, notFoundHandler, requestId } from './http/middleware.js';
import type { Logger } from './logger.js';

export interface AppDeps {
  config: ServerConfig;
  logger: Logger;
  version: string;
}

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);

  app.get('/api/health', (_req, res) => {
    const body: HealthDto = { status: 'ok', mode: deps.config.mode, version: deps.version };
    res.json(body);
  });

  app.use('/api', notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
