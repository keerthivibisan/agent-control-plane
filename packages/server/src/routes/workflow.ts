import express, { Router } from 'express';
import { ProjectWorkflowDtoSchema } from '@acp/core/api';
import { requireCsrf } from '../control/csrf.js';
import type { WorkflowService } from '../workflow/service.js';
import { out, param } from './respond.js';

/**
 * Workflow routes (docs/redesign/README.md §4.2, §6). Thin: parse, call the workflow service, send
 * the response parsed by its `@acp/core/api` DTO. The PUT needs the `X-ACP-CSRF` token (ADR-0013 §6).
 */
export function createWorkflowRouter(workflow: WorkflowService, csrfToken: string): Router {
  const router = Router();
  const csrf = requireCsrf(csrfToken);
  const json = express.json({ limit: '16kb' });

  router.get('/projects/:id/workflow', async (req, res) => {
    res.json(out(ProjectWorkflowDtoSchema, await workflow.get(param(req.params['id']))));
  });
  router.put('/projects/:id/workflow', csrf, json, async (req, res) => {
    const dto = await workflow.put(param(req.params['id']), req.body);
    res.json(out(ProjectWorkflowDtoSchema, dto));
  });

  return router;
}
