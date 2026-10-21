import express, { Router } from 'express';
import {
  ProjectWorkflowDtoSchema,
  ValidateWorkflowGraphResultDtoSchema,
  WorkflowGraphDtoSchema,
} from '@acp/core/api';
import { requireCsrf } from '../control/csrf.js';
import type { WorkflowService } from '../workflow/service.js';
import { out, param } from './respond.js';

/**
 * Workflow routes (docs/redesign/README.md §4.2, §6; ADR-0023 graphs). Thin: parse, call the
 * workflow service, send the response parsed by its `@acp/core/api` DTO. Mutations (and the
 * validate POST) need the `X-ACP-CSRF` token (ADR-0013 §6).
 */
export function createWorkflowRouter(workflow: WorkflowService, csrfToken: string): Router {
  const router = Router();
  const csrf = requireCsrf(csrfToken);
  const json = express.json({ limit: '16kb' });
  // A graph holds up to 40 blocks with their descriptions and 120 links.
  const graphJson = express.json({ limit: '256kb' });

  router.get('/projects/:id/workflow', async (req, res) => {
    res.json(out(ProjectWorkflowDtoSchema, await workflow.get(param(req.params['id']))));
  });
  router.put('/projects/:id/workflow', csrf, json, async (req, res) => {
    const dto = await workflow.put(param(req.params['id']), req.body);
    res.json(out(ProjectWorkflowDtoSchema, dto));
  });

  router.get('/projects/:id/workflow-graph', async (req, res) => {
    res.json(out(WorkflowGraphDtoSchema, await workflow.getGraph(param(req.params['id']))));
  });
  router.put('/projects/:id/workflow-graph', csrf, graphJson, async (req, res) => {
    const dto = await workflow.putGraph(param(req.params['id']), req.body);
    res.json(out(WorkflowGraphDtoSchema, dto));
  });
  router.post('/projects/:id/workflow-graph/validate', csrf, graphJson, async (req, res) => {
    const dto = await workflow.validateGraph(param(req.params['id']), req.body);
    res.json(out(ValidateWorkflowGraphResultDtoSchema, dto));
  });

  return router;
}
