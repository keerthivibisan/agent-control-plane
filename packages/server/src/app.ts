import express, { type Express } from 'express';
import type { ServerConfig } from './config.js';
import { localOnlyGuard } from './http/guard.js';
import { errorHandler, notFoundHandler, requestId } from './http/middleware.js';
import type { Logger } from './logger.js';
import { createApiRouter } from './routes/api.js';
import type { Services } from './services/index.js';

/** The Vite dev server proxies to this server, so its origin is also a legitimate caller. */
export const WEB_DEV_PORT = 5173;

export interface AppDeps {
  config: ServerConfig;
  logger: Logger;
  services: Services;
}

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use('/api', localOnlyGuard([deps.config.port, WEB_DEV_PORT]));
  app.use('/api', createApiRouter(deps.services));
  app.use('/api', notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
