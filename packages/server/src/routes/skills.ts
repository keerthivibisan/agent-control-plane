import express, { Router } from 'express';
import { z } from 'zod';
import {
  SkillCommitResultDtoSchema,
  SkillDetailDtoSchema,
  SkillSummaryDtoSchema,
} from '@acp/core/api';
import { requireCsrf } from '../control/csrf.js';
import { notFound } from '../errors.js';
import type { SkillProject, SkillsService } from '../skills/index.js';
import { out, param } from './respond.js';

/**
 * Project skills routes (ADR-0018, docs/history/redesign/README.md §6). Thin: find the project,
 * call the skills service, send the response parsed by its `@acp/core/api` DTO. Every mutation
 * needs the `X-ACP-CSRF` token (ADR-0013 §6), so only an owner action in the Skills page can write
 * a skill.
 */

export interface SkillsRouterDeps {
  skills: SkillsService;
  /** The registered project (its root path is where skills live); undefined when unknown. */
  projectOf: (projectId: string) => SkillProject | undefined;
  /** The per-start CSRF token (the control service's). */
  csrfToken: string;
}

const SummaryListSchema = z.array(SkillSummaryDtoSchema);

export function createSkillsRouter(deps: SkillsRouterDeps): Router {
  const router = Router();
  const csrf = requireCsrf(deps.csrfToken);
  // Room for a 64 KiB SKILL.md after JSON escaping; the service enforces the real cap.
  const json = express.json({ limit: '512kb' });

  function project(id: string | string[] | undefined): SkillProject {
    const projectId = param(id);
    const p = deps.projectOf(projectId);
    if (p === undefined) throw notFound(`Project ${projectId} not found`);
    return p;
  }

  router.get('/projects/:id/skills', async (req, res) => {
    res.json(out(SummaryListSchema, await deps.skills.list(project(req.params['id']))));
  });
  router.get('/projects/:id/skills/:name', async (req, res) => {
    const dto = await deps.skills.get(project(req.params['id']), param(req.params['name']));
    res.json(out(SkillDetailDtoSchema, dto));
  });
  router.post('/projects/:id/skills', csrf, json, async (req, res) => {
    const dto = await deps.skills.create(project(req.params['id']), req.body);
    res.status(201).json(out(SkillDetailDtoSchema, dto));
  });
  router.put('/projects/:id/skills/:name', csrf, json, async (req, res) => {
    const p = project(req.params['id']);
    const dto = await deps.skills.update(p, param(req.params['name']), req.body);
    res.json(out(SkillDetailDtoSchema, dto));
  });
  router.delete('/projects/:id/skills/:name', csrf, async (req, res) => {
    await deps.skills.delete(project(req.params['id']), param(req.params['name']));
    res.status(204).end();
  });
  router.post('/projects/:id/skills/:name/commit', csrf, async (req, res) => {
    const dto = await deps.skills.commit(project(req.params['id']), param(req.params['name']));
    res.json(out(SkillCommitResultDtoSchema, dto));
  });

  return router;
}
