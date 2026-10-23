import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import express, { Router } from 'express';
import { z } from 'zod';
import {
  BoardDtoSchema,
  CheckRunDtoSchema,
  SetupRunDtoSchema,
  CodeHostStatusDtoSchema,
  ContextCandidateDtoSchema,
  HarnessStatusDtoSchema,
  ProjectAgentSetupDtoSchema,
  ProjectBranchesDtoSchema,
  ProjectDtoSchema,
  TicketCardDtoSchema,
  TicketCommentDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  TicketBranchDtoSchema,
  TicketActivityDtoSchema,
  AttachmentDtoSchema,
} from '@acp/core/api';
import { MAX_ATTACHMENT_BYTES } from '@acp/core';
import type { BoardService } from '../board/service.js';
import { requireCsrf } from '../control/csrf.js';
import { HttpError, badRequest } from '../errors.js';
import { out, param } from './respond.js';
import { contentDisposition, isInlineType, isTextType } from '../attachments/content.js';

/**
 * Agent Workspace routes (docs/phase-4/README.md §6.3). Thin: parse, call the board service, send
 * the response parsed by its `@acp/core/api` DTO. Every mutation needs the `X-ACP-CSRF` token
 * (ADR-0013 §6), the same per-start token as the control panel. Reads work with managed agents
 * off; starting a ticket or deciding a plan then answers `managed_disabled`.
 */

const CheckRunListSchema = z.array(CheckRunDtoSchema);
const SetupRunListSchema = z.array(SetupRunDtoSchema);
const CardListSchema = z.array(TicketCardDtoSchema);
const CandidateListSchema = z.array(ContextCandidateDtoSchema);
const AttachmentListSchema = z.array(AttachmentDtoSchema);
const AttachmentQuerySchema = z.object({ commentId: z.string().min(1).max(100).optional() });
const BoardQuerySchema = z.object({ projectId: z.string().min(1) });

export function createBoardRouter(board: BoardService, csrfToken: string): Router {
  const router = Router();
  const csrf = requireCsrf(csrfToken);
  const json = express.json({ limit: '64kb' });
  // ADR-0026 §4: an attachment is the raw body, at most MAX_ATTACHMENT_BYTES (else 413 while it
  // streams); compressed request bodies are refused rather than inflated.
  const raw = express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES, inflate: false });

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
  // ADR-0027: the setup steps run before "Run checks now" on main, newest first.
  router.get('/projects/:id/harness/setup-runs', (req, res) => {
    res.json(out(SetupRunListSchema, board.mainSetupHistory(param(req.params['id']))));
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
  // ADR-0025 §7: connecting the project from Settings, only when it has no `origin` yet. Create
  // runs `gh repo create` and `git remote add origin` (and the push, if asked); connect runs only
  // `git remote add origin`. Both answer the fresh status.
  router.post('/projects/:id/code-host/repository', csrf, json, async (req, res) => {
    const dto = await board.createCodeHostRepository(param(req.params['id']), req.body);
    res.json(out(CodeHostStatusDtoSchema, dto));
  });
  router.post('/projects/:id/code-host/remote', csrf, json, async (req, res) => {
    const dto = await board.connectCodeHostRepository(param(req.params['id']), req.body);
    res.json(out(CodeHostStatusDtoSchema, dto));
  });
  // ADR-0025 §8: the project's local branches (read from git when asked, no fetch), and a new
  // one on the owner's click: `git branch --no-track`, never a checkout; pushed only if asked.
  router.get('/projects/:id/branches', async (req, res) => {
    res.json(out(ProjectBranchesDtoSchema, await board.projectBranches(param(req.params['id']))));
  });
  router.post('/projects/:id/branches', csrf, json, async (req, res) => {
    const dto = await board.createProjectBranch(param(req.params['id']), req.body);
    res.status(201).json(out(ProjectBranchesDtoSchema, dto));
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
  // ADR-0026 §4: the owner's attachments, stored in the app's data folder.
  router.post('/tickets/:id/attachments', csrf, raw, async (req, res) => {
    const query = AttachmentQuerySchema.safeParse(req.query);
    if (!query.success) throw badRequest('commentId must be one id', 'invalid_request');
    const body: unknown = req.body;
    const dto = await board.uploadAttachment(param(req.params['id']), {
      contentType: req.get('content-type'),
      name: req.get('x-attachment-name'),
      commentId: query.data.commentId,
      bytes: Buffer.isBuffer(body) ? body : Buffer.alloc(0),
    });
    res.status(201).json(out(AttachmentDtoSchema, dto));
  });
  router.get('/tickets/:id/attachments', (req, res) => {
    res.json(out(AttachmentListSchema, board.listAttachments(param(req.params['id']))));
  });
  router.get('/attachments/:id/content', async (req, res) => {
    const { attachment, path } = board.attachmentContent(param(req.params['id']));
    const size = await stat(path).then(
      (s) => (s.isFile() ? s.size : null),
      () => null,
    );
    if (size === null) {
      throw new HttpError(404, 'attachment_missing', "The attachment's file is missing");
    }
    // Served only as what it was checked to be: never sniffed, never a page that can run.
    const type = isTextType(attachment.mimeType)
      ? `${attachment.mimeType}; charset=utf-8`
      : attachment.mimeType;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      contentDisposition(attachment.name, isInlineType(attachment.mimeType)),
    );
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-cache');
    await pipeline(createReadStream(path), res);
  });
  router.delete('/attachments/:id', csrf, async (req, res) => {
    await board.deleteAttachment(param(req.params['id']));
    res.status(204).end();
  });

  // ADR-0026 §1: the Conversation tab's timeline, built from records.
  router.get('/tickets/:id/activity', (req, res) => {
    res.json(out(TicketActivityDtoSchema, board.activity(param(req.params['id']))));
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
