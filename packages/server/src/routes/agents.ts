import express, { Router } from 'express';
import { z } from 'zod';
import {
  AgentDefinitionCommitResultDtoSchema,
  AgentDefinitionDetailDtoSchema,
  AgentDefinitionSummaryDtoSchema,
} from '@acp/core/api';
import { requireCsrf } from '../control/csrf.js';
import { notFound } from '../errors.js';
import type { AgentsService, ProjectRef } from '../skills/index.js';
import { out, param } from './respond.js';

/**
 * Project agent definition routes (ADR-0018 amendment), mirroring the skills routes: find the
 * project, call the agents service, send the response parsed by its `@acp/core/api` DTO. Every
 * mutation needs the `X-ACP-CSRF` token (ADR-0013 §6), so only an owner action writes a file.
 */

export interface AgentsRouterDeps {
  agents: AgentsService;
  /** The registered project; undefined when unknown. */
  projectOf: (projectId: string) => ProjectRef | undefined;
  /** The per-start CSRF token (the control service's). */
  csrfToken: string;
}

const SummaryListSchema = z.array(AgentDefinitionSummaryDtoSchema);

export function createAgentsRouter(deps: AgentsRouterDeps): Router {
  const router = Router();
  const csrf = requireCsrf(deps.csrfToken);
  // Room for a 64 KiB agent file after JSON escaping; the service enforces the real cap.
  const json = express.json({ limit: '512kb' });

  function project(id: string | string[] | undefined): ProjectRef {
    const projectId = param(id);
    const p = deps.projectOf(projectId);
    if (p === undefined) throw notFound(`Project ${projectId} not found`);
    return p;
  }

  router.get('/projects/:id/agents', async (req, res) => {
    res.json(out(SummaryListSchema, await deps.agents.list(project(req.params['id']))));
  });
  router.get('/projects/:id/agents/:name', async (req, res) => {
    const dto = await deps.agents.get(project(req.params['id']), param(req.params['name']));
    res.json(out(AgentDefinitionDetailDtoSchema, dto));
  });
  router.post('/projects/:id/agents', csrf, json, async (req, res) => {
    const dto = await deps.agents.create(project(req.params['id']), req.body);
    res.status(201).json(out(AgentDefinitionDetailDtoSchema, dto));
  });
  router.put('/projects/:id/agents/:name', csrf, json, async (req, res) => {
    const p = project(req.params['id']);
    const dto = await deps.agents.update(p, param(req.params['name']), req.body);
    res.json(out(AgentDefinitionDetailDtoSchema, dto));
  });
  router.delete('/projects/:id/agents/:name', csrf, async (req, res) => {
    await deps.agents.delete(project(req.params['id']), param(req.params['name']));
    res.status(204).end();
  });
  router.post('/projects/:id/agents/:name/commit', csrf, async (req, res) => {
    const dto = await deps.agents.commit(project(req.params['id']), param(req.params['name']));
    res.json(out(AgentDefinitionCommitResultDtoSchema, dto));
  });

  return router;
}
