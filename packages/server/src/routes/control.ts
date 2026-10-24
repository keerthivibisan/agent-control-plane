import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  AgentRunDtoSchema,
  ApprovalDtoSchema,
  ChatMessageDtoSchema,
  CsrfTokenDtoSchema,
  ReviewDtoSchema,
  RunDetailDtoSchema,
  RunSummaryDtoSchema,
  RunWorkflowDtoSchema,
  RunWorkflowGraphDtoSchema,
  TicketBranchReviewDtoSchema,
} from '@acp/core/api';
import { requireCsrf } from '../control/csrf.js';
import { managedDisabled } from '../control/errors.js';
import type { ControlService } from '../control/service.js';
import { out, param } from './respond.js';

/**
 * Control-panel routes (Phase 3 M1, ADR-0013). Thin: parse, call the run service, and send the
 * response parsed by its core DTO schema. Every mutation needs the per-start CSRF token; with
 * managed execution off every route answers `managed_disabled` (404).
 */

const RunSummaryListSchema = z.array(RunSummaryDtoSchema);

export function createControlRouter(control: ControlService): Router {
  const router = Router();
  const enabled: RequestHandler = (_req, _res, next) => {
    if (!control.enabled) throw managedDisabled();
    next();
  };
  const csrf = requireCsrf(control.csrfToken);
  const json = express.json({ limit: '64kb' });
  router.use(['/control', '/runs', '/approvals'], enabled);

  router.get('/control/token', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(out(CsrfTokenDtoSchema, { token: control.csrfToken }));
  });

  router.get('/runs', (_req, res) => {
    res.json(out(RunSummaryListSchema, control.listRuns()));
  });
  router.post('/runs', csrf, json, (req, res) => {
    res.status(201).json(out(RunDetailDtoSchema, control.createRun(req.body)));
  });
  router.get('/runs/:id', (req, res) => {
    res.json(out(RunDetailDtoSchema, control.getRun(param(req.params['id']))));
  });
  router.post('/runs/:id/chat', csrf, json, (req, res) => {
    res.json(out(ChatMessageDtoSchema, control.chat(param(req.params['id']), req.body)));
  });
  // Redesign (ADR-0019): each workflow stage's live state, and the owner's Continue after a
  // restart held the next post-merge stage. Continue answers the run, like the other run actions.
  router.get('/runs/:id/workflow', (req, res) => {
    res.json(out(RunWorkflowDtoSchema, control.runWorkflow(param(req.params['id']))));
  });
  // ADR-0023: the graph the run snapshotted and each node's live state (read-only).
  router.get('/runs/:id/workflow-graph', (req, res) => {
    res.json(out(RunWorkflowGraphDtoSchema, control.runWorkflowGraph(param(req.params['id']))));
  });
  router.post('/runs/:id/continue', csrf, (req, res) => {
    res.json(out(RunDetailDtoSchema, control.continueRun(param(req.params['id']))));
  });
  router.post('/runs/:id/stop', csrf, (req, res) => {
    res.json(out(RunSummaryDtoSchema, control.stopRun(param(req.params['id']))));
  });
  router.post('/runs/:id/agents/:agentId/stop', csrf, (req, res) => {
    const dto = control.stopAgent(param(req.params['id']), param(req.params['agentId']));
    res.json(out(AgentRunDtoSchema, dto));
  });
  router.post('/runs/:id/agents/:agentId/message', csrf, json, (req, res) => {
    const dto = control.messageAgent(
      param(req.params['id']),
      param(req.params['agentId']),
      req.body,
    );
    res.json(out(AgentRunDtoSchema, dto));
  });
  router.get('/runs/:id/review', async (req, res) => {
    res.json(out(ReviewDtoSchema, await control.review(param(req.params['id']))));
  });
  router.post('/runs/:id/review', csrf, json, async (req, res) => {
    const dto = await control.reviewAction(param(req.params['id']), req.body);
    res.json(out(ReviewDtoSchema, dto));
  });

  // ADR-0021 §4: the run's ticket branch and the owner's single merge into the base branch.
  router.get('/runs/:id/ticket-branch', async (req, res) => {
    const dto = await control.ticketBranch(param(req.params['id']));
    res.json(out(TicketBranchReviewDtoSchema, dto));
  });
  router.post('/runs/:id/ticket-branch', csrf, json, async (req, res) => {
    const dto = await control.ticketBranchAction(param(req.params['id']), req.body);
    res.json(out(TicketBranchReviewDtoSchema, dto));
  });
  // F-1: the owner resets a ticket branch changed outside the app to the last reviewed commit.
  router.post('/runs/:id/ticket-branch/reset', csrf, json, async (req, res) => {
    const dto = await control.resetTicketBranch(param(req.params['id']), req.body);
    res.json(out(TicketBranchReviewDtoSchema, dto));
  });

  router.post('/approvals/:id', csrf, json, (req, res) => {
    const dto = control.decideApproval(param(req.params['id']), req.body);
    res.json(out(ApprovalDtoSchema, dto));
  });

  return router;
}
