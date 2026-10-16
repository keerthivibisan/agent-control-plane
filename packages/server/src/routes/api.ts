import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { badRequest } from '../errors.js';
import type { Services } from '../services/index.js';
import { SessionListQuerySchema } from '../services/sessions.js';
import { UsageSummaryQuerySchema } from '../services/usage.js';

/** Thin HTTP layer: parse input, call a service, send the DTO. No business logic lives here. */

const CursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function param(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value === '') throw badRequest('Missing path parameter');
  return value;
}

export interface ApiRouterOptions {
  /**
   * CSRF check for mutations (ADR-0013). Present whenever the control service is mounted, so
   * registering a project needs the token like every other mutation (P4-H finding, 2026-10-16).
   */
  csrf?: RequestHandler;
}

export function createApiRouter(services: Services, options: ApiRouterOptions = {}): Router {
  const router = Router();
  const csrf: RequestHandler = options.csrf ?? ((_req, _res, next) => next());

  router.get('/health', (_req, res) => {
    res.json(services.system.health());
  });
  router.get('/overview', async (_req, res) => {
    res.json(await services.system.overview());
  });
  router.get('/capabilities', async (_req, res) => {
    res.json(await services.system.capabilities());
  });
  router.get('/discovery/candidates', async (_req, res) => {
    res.json(await services.system.candidates());
  });
  router.get('/diagnostics/ingestion', (_req, res) => {
    res.json(services.system.diagnostics());
  });

  router.get('/events', (req, res) => {
    const q = CursorQuerySchema.parse(req.query);
    res.json(services.system.events(q.cursor, q.limit));
  });

  router.get('/projects', (_req, res) => {
    res.json(services.projects.list());
  });
  router.post('/projects', csrf, express.json({ limit: '16kb' }), async (req, res) => {
    res.status(201).json(await services.projects.register(req.body));
  });
  router.get('/projects/:id', (req, res) => {
    res.json(services.projects.get(param(req.params['id'])));
  });
  router.get('/projects/:id/sessions', (req, res) => {
    const q = CursorQuerySchema.parse(req.query);
    res.json(services.projects.sessions(param(req.params['id']), q.cursor, q.limit));
  });

  router.get('/sessions', (req, res) => {
    res.json(services.sessions.list(SessionListQuerySchema.parse(req.query)));
  });
  router.get('/sessions/:id', (req, res) => {
    res.json(services.sessions.detail(param(req.params['id'])));
  });
  router.get('/sessions/:id/tree', (req, res) => {
    res.json(services.sessions.tree(param(req.params['id'])));
  });
  router.get('/sessions/:id/events', (req, res) => {
    const q = CursorQuerySchema.parse(req.query);
    res.json(services.sessions.events(param(req.params['id']), q.cursor, q.limit));
  });

  router.get('/usage/summary', (req, res) => {
    res.json(services.usage.summary(UsageSummaryQuerySchema.parse(req.query)));
  });

  return router;
}
