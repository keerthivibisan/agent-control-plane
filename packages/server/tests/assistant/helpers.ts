import express, { type Express } from 'express';
import request from 'supertest';
import { CSRF_HEADER, type AssistantStreamEvent } from '@acp/core/api';
import { createAssistantService, type AssistantServiceDeps } from '../../src/assistant/index.js';
import { errorHandler } from '../../src/http/middleware.js';
import { createAssistantRouter } from '../../src/routes/assistant.js';
import { createAgentsService, createSkillsService } from '../../src/skills/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { setupBoard, type BoardSetupOptions } from '../board/helpers.js';
import { captureLogger } from '../skills/helpers.js';
import { GIT_TEST_ENV } from '../workspace/helpers.js';

/** The fields tests read from a session, a proposal or an error body. */
export interface ReplyBody {
  id?: string;
  status?: string;
  mode?: string;
  state?: string;
  problem?: string | null;
  budget?: { used: number; limit: number };
  error?: { code: string; message: string };
  [key: string]: unknown;
}
export interface Reply {
  status: number;
  body: ReplyBody;
}

/**
 * The project assistant (ADR-0035) over the real board, control service, workflow and Skills &
 * Agents writers of `setupBoard`, with the scripted fake managed adapters (never the real claude
 * or codex). Every log line is captured, so tests can check that no chat text reaches the logs.
 */
export async function setupAssistant(
  options: BoardSetupOptions & { assistant?: Partial<AssistantServiceDeps> } = {},
) {
  const { logger, lines } = captureLogger();
  const s = await setupBoard({ ...options, logger });
  const git = createGitRunner({ env: GIT_TEST_ENV });
  const workflowOf = (projectId: string) => s.workflow.effective(projectId);
  const skills = createSkillsService({
    git,
    now: () => s.clock.now,
    logger,
    workflowOf,
    homeDir: s.homeDir,
  });
  const agents = createAgentsService({ git, logger, workflowOf, homeDir: s.homeDir });
  const adapters = new Map([
    [s.fake.adapter.provider, s.fake.adapter],
    ...(s.codex !== undefined ? ([[s.codex.adapter.provider, s.codex.adapter]] as const) : []),
  ]);
  const assistant = createAssistantService({
    adapters,
    checkProvider: (provider) => s.control.checkProvider(provider),
    projectOf: (projectId) => s.repos.projects.getById(projectId),
    board: s.board,
    workflowOf,
    skills,
    agents,
    denyRead: () => Promise.resolve([`${s.homeDir}/.ssh`, s.dataDir]),
    ingestManaged: (events) => {
      s.pipeline.ingestEvents(events);
    },
    now: () => s.clock.now,
    logger,
    sweepIntervalMs: null,
    ...options.assistant,
  });
  const app: Express = express();
  app.use('/api', createAssistantRouter({ assistant, csrfToken: s.token, heartbeatMs: 20 }));
  app.use(errorHandler(logger));
  const base = `/api/projects/${s.project.id}/assistant`;
  const typed = (r: { status: number; body: unknown }): Reply => ({
    status: r.status,
    body: r.body as ReplyBody,
  });
  const post = async (path: string, body: object = {}) =>
    typed(await request(app).post(`${base}${path}`).set(CSRF_HEADER, s.token).send(body));
  const get = async (path: string) => typed(await request(app).get(`${base}${path}`));

  /** Every stream event from now on, as the SSE route sends them. */
  function record(lastEventId?: number) {
    const events: AssistantStreamEvent[] = [];
    const ids: number[] = [];
    const { replay, unsubscribe } = assistant.subscribe(
      s.project.id,
      (event, id) => {
        events.push(event);
        ids.push(id);
      },
      lastEventId,
    );
    return { replay, events, ids, unsubscribe };
  }

  /** Lets the fake agent's event pump run. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  }

  return {
    ...s,
    assistant,
    skills,
    agents,
    app,
    logs: lines,
    base,
    post,
    get,
    record,
    flush,
    agent: () => s.fake.assistant(),
  };
}
