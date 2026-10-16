import express, { type Express } from 'express';
import type { ServerConfig } from './config.js';
import { requireCsrf } from './control/csrf.js';
import { localOnlyGuard } from './http/guard.js';
import { errorHandler, notFoundHandler, requestId } from './http/middleware.js';
import type { Logger } from './logger.js';
import { createHookRouter, type HookDeps } from './hooks/receiver.js';
import { createApiRouter } from './routes/api.js';
import { createBoardRouter } from './routes/board.js';
import { createControlRouter } from './routes/control.js';
import { createStreamRouter, type StreamDeps } from './routes/stream.js';
import { createTokensRouter } from './routes/tokens.js';
import { createWorkflowRouter } from './routes/workflow.js';
import type { BoardService } from './board/service.js';
import type { ControlService } from './control/service.js';
import type { Services } from './services/index.js';
import type { TokensService } from './tokens/service.js';
import type { WorkflowService } from './workflow/service.js';
import { mountStatic } from './static.js';

/** The Vite dev server proxies to this server, so its origin is also a legitimate caller. */
export const WEB_DEV_PORT = 5173;

export interface AppDeps {
  config: ServerConfig;
  logger: Logger;
  services: Services;
  stream: StreamDeps;
  hooks: HookDeps;
  /** The control panel's run service (Phase 3). Omitted: the control routes are not mounted. */
  control?: ControlService;
  /** The Agent Workspace board (Phase 4); mounted with the control panel, which owns the CSRF token. */
  board?: BoardService;
  /** Project workflows (redesign, R-G); mounted with the board, under the same CSRF token. */
  workflow?: WorkflowService;
  /** The project Tokens page (redesign, R-F). Read-only, so it needs no control panel or CSRF. */
  tokens?: TokensService;
  /** Built web UI directory; omitted in tests and when the web package has not been built. */
  staticDir?: string;
}

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use('/api', localOnlyGuard([deps.config.port, WEB_DEV_PORT]));
  app.use('/api', createStreamRouter(deps.stream));
  app.use('/api', createHookRouter(deps.hooks));
  app.use(
    '/api',
    createApiRouter(
      deps.services,
      deps.control === undefined ? {} : { csrf: requireCsrf(deps.control.csrfToken) },
    ),
  );
  if (deps.tokens !== undefined) app.use('/api', createTokensRouter(deps.tokens));
  if (deps.control !== undefined) app.use('/api', createControlRouter(deps.control));
  if (deps.control !== undefined && deps.board !== undefined) {
    app.use('/api', createBoardRouter(deps.board, deps.control.csrfToken));
    if (deps.workflow !== undefined) {
      app.use('/api', createWorkflowRouter(deps.workflow, deps.control.csrfToken));
    }
  }
  app.use('/api', notFoundHandler);
  if (deps.staticDir !== undefined) mountStatic(app, deps.staticDir);
  app.use(errorHandler(deps.logger));
  return app;
}
