import express, { Router } from 'express';
import {
  AssistantProposalDtoSchema,
  AssistantSessionDtoSchema,
  type AssistantStreamEvent,
} from '@acp/core/api';
import type { AssistantService } from '../assistant/index.js';
import { requireCsrf } from '../control/csrf.js';
import { out, param } from './respond.js';
import { HEARTBEAT_MS } from './stream.js';

/**
 * The project assistant's routes (ADR-0035), under `/api/projects/:projectId/assistant`. Thin:
 * parse, call the service, send the DTO. Every POST needs the `X-ACP-CSRF` token. The stream is
 * server-sent events with unnamed `data:` frames (as `/api/events/stream`: the web client listens
 * on `onmessage`), each with an `id:` so a reconnect sends `Last-Event-ID`.
 */

export interface AssistantRouterDeps {
  assistant: AssistantService;
  csrfToken: string;
  heartbeatMs?: number;
}

function frame(event: AssistantStreamEvent, id: number): string {
  return `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createAssistantRouter(deps: AssistantRouterDeps): Router {
  const router = Router();
  const csrf = requireCsrf(deps.csrfToken);
  // A message is at most 8000 characters; JSON escaping can grow it.
  const json = express.json({ limit: '64kb' });
  const base = '/projects/:projectId/assistant';
  const pid = (req: express.Request) => param(req.params['projectId']);

  router.post(`${base}/session`, csrf, json, async (req, res) => {
    const dto = await deps.assistant.start(pid(req), req.body);
    res.status(201).json(out(AssistantSessionDtoSchema, dto));
  });
  router.get(`${base}/session`, (req, res) => {
    res.json(out(AssistantSessionDtoSchema, deps.assistant.current(pid(req))));
  });
  router.post(`${base}/session/messages`, csrf, json, async (req, res) => {
    res.json(out(AssistantSessionDtoSchema, await deps.assistant.send(pid(req), req.body)));
  });
  router.post(`${base}/session/mode`, csrf, json, (req, res) => {
    res.json(out(AssistantSessionDtoSchema, deps.assistant.setMode(pid(req), req.body)));
  });
  router.post(`${base}/session/end`, csrf, (req, res) => {
    deps.assistant.end(pid(req));
    res.status(204).end();
  });
  router.post(`${base}/proposals/:id/apply`, csrf, async (req, res) => {
    const dto = await deps.assistant.apply(pid(req), param(req.params['id']));
    res.json(out(AssistantProposalDtoSchema, dto));
  });
  router.post(`${base}/proposals/:id/discard`, csrf, (req, res) => {
    const dto = deps.assistant.discard(pid(req), param(req.params['id']));
    res.json(out(AssistantProposalDtoSchema, dto));
  });

  router.get(`${base}/stream`, (req, res) => {
    const projectId = pid(req);
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const header = req.headers['last-event-id'];
    const last = typeof header === 'string' && header !== '' ? Number(header) : NaN;
    const { replay, unsubscribe } = deps.assistant.subscribe(
      projectId,
      (event, id) => res.write(frame(event, id)),
      Number.isInteger(last) && last >= 0 ? last : undefined,
    );
    for (const { event, id } of replay) res.write(frame(event, id));
    const heartbeat = setInterval(
      () => res.write(': heartbeat\n\n'),
      deps.heartbeatMs ?? HEARTBEAT_MS,
    );
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}
