import express, { Router } from 'express';
import { z } from 'zod';
import {
  BoardDtoSchema,
  CheckRunDtoSchema,
  CodeHostStatusDtoSchema,
  ContextCandidateDtoSchema,
  HarnessStatusDtoSchema,
  ProjectAgentSetupDtoSchema,
  ProjectDtoSchema,
  TicketCardDtoSchema,
  TicketCommentDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  TicketBranchDtoSchema,
} from '@acp/core/api';
import type { BoardService } from '../board/service.js';
import { requireCsrf } from '../control/csrf.js';
import { badRequest } from '../errors.js';
import { out, param } from './respond.js';

/**
 * Agent Workspace routes (docs/phase-4/README.md §6.3). Thin: parse, call the board service, send
 * the response parsed by its `@acp/core/api` DTO. Every mutation needs the `X-ACP-CSRF` token
 * (ADR-0013 §6), the same per-start token as the control panel. Reads work with managed agents
 * off; starting a ticket or deciding a plan then answers `managed_disabled`.
 */

const CheckRunListSchema = z.array(CheckRunDtoSchema);
const CardListSchema = z.array(TicketCardDtoSchema);
const CandidateListSchema = z.array(ContextCandidateDtoSchema);
const BoardQuerySchema = z.object({ projectId: z.string().min(1) });

export function createBoardRouter(board: BoardService, csrfToken: string): Router {
  const router = Router();
  const csrf = requireCsrf(csrfToken);
  const json = express.json({ limit: '64kb' });

  // Projects: create a repository, remove from the app, setup, harness, context files.
  router.post('/projects/new', csrf, json, async (req, res) => {
    res.status(201).json(out(ProjectDtoSchema, await board.createRepoProject(req.body)));
  });
  router.delete('/projects/:id', csrf, (req, res) => {
    board.removeProject(param(req.params['id']));
    res.status(204).end();
  });
  router.get('/projects/:id/setup', async (req, res) => {
    res.json(out(ProjectAgentSetupDtoSchema, await board.getSetup(param(req.params['id']))));
  });
  router.put('/projects/:id/setup', csrf, json, (req, res) => {
    const dto = board.putSetup(param(req.params['id']), req.body);
    res.json(out(ProjectAgentSetupDtoSchema, dto));
  });
  router.get('/projects/:id/harness', async (req, res) => {
    res.json(out(HarnessStatusDtoSchema, await board.harnessStatus(param(req.params['id']))));
  });
  router.get('/projects/:id/harness/checks', (req, res) => {
    res.json(out(CheckRunListSchema, board.mainCheckHistory(param(req.params['id']))));
  });
  router.post('/projects/:id/harness/checks', csrf, json, async (req, res) => {
    res.json(out(CheckRunListSchema, await board.runMainChecks(param(req.params['id']))));
  });
  router.post('/projects/:id/harness/ticket', csrf, json, async (req, res) => {
    const dto = await board.createHarnessTicket(param(req.params['id']));
    res.status(201).json(out(TicketDtoSchema, dto));
  });
  // ADR-0025: GitHub through the owner's own `gh` login. A GET runs `gh` (exit codes, and the
  // default branch); nothing is pushed or opened except by the POSTs below, on the owner's click.
  router.get('/projects/:id/code-host', async (req, res) => {
    res.json(out(CodeHostStatusDtoSchema, await board.codeHostStatus(param(req.params['id']))));
  });
  router.get('/projects/:id/context-candidates', async (req, res) => {
    const list = await board.contextCandidates(param(req.params['id']));
    res.json(out(CandidateListSchema, list));
  });

  // The board and its tickets.
  router.get('/board', async (req, res) => {
    const query = BoardQuerySchema.safeParse(req.query);
    if (!query.success) throw badRequest('projectId is required', 'invalid_request');
    res.json(out(BoardDtoSchema, await board.board(query.data.projectId)));
  });
  router.get('/projects/:id/tickets', (req, res) => {
    res.json(out(CardListSchema, board.listTickets(param(req.params['id']))));
  });
  router.post('/projects/:id/tickets', csrf, json, async (req, res) => {
    const dto = await board.createTicket(param(req.params['id']), req.body);
    res.status(201).json(out(TicketDtoSchema, dto));
  });
  router.get('/tickets/:id', (req, res) => {
    res.json(out(TicketDetailDtoSchema, board.ticket(param(req.params['id']))));
  });
  router.patch('/tickets/:id', csrf, json, (req, res) => {
    const dto = board.updateTicket(param(req.params['id']), req.body);
    res.json(out(TicketDetailDtoSchema, dto));
  });
  router.post('/tickets/:id/move', csrf, json, (req, res) => {
    res.json(out(TicketDtoSchema, board.moveTicket(param(req.params['id']), req.body)));
  });
  router.post('/tickets/:id/start', csrf, json, async (req, res) => {
    const dto = await board.startTicket(param(req.params['id']), req.body);
    res.json(out(TicketDetailDtoSchema, dto));
  });
  router.post('/tickets/:id/comments', csrf, json, (req, res) => {
    const dto = board.addComment(param(req.params['id']), req.body);
    res.status(201).json(out(TicketCommentDtoSchema, dto));
  });
  router.post('/tickets/:id/branch/pull-request', csrf, json, async (req, res) => {
    const dto = await board.openPullRequest(param(req.params['id']), req.body);
    res.json(out(TicketBranchDtoSchema, dto));
  });
  router.post('/tickets/:id/branch/pull-request/refresh', csrf, json, async (req, res) => {
    const dto = await board.refreshPullRequest(param(req.params['id']));
    res.json(out(TicketBranchDtoSchema, dto));
  });
  router.post('/tickets/:id/plans/:planId/decision', csrf, json, (req, res) => {
    const dto = board.decidePlan(param(req.params['id']), param(req.params['planId']), req.body);
    res.json(out(TicketDetailDtoSchema, dto));
  });

  // Checks on a run's helpers (the control router has already required managed agents on /runs).
  router.get('/runs/:id/checks', (req, res) => {
    res.json(out(CheckRunListSchema, board.runChecks(param(req.params['id']))));
  });
  router.post('/runs/:id/agents/:agentId/checks', csrf, json, async (req, res) => {
    const list = await board.runAgentChecks(param(req.params['id']), param(req.params['agentId']));
    res.json(out(CheckRunListSchema, list));
  });

  return router;
}
