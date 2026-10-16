import {
  BoardDtoSchema,
  CreateTicketRequestSchema,
  MoveTicketRequestSchema,
  TicketCardDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  AgentRunDtoSchema,
  ApprovalDecisionRequestSchema,
  ApprovalDtoSchema,
  CSRF_HEADER,
  CandidateRootDtoSchema,
  ChatMessageDtoSchema,
  ChatRequestSchema,
  CsrfTokenDtoSchema,
  ReviewActionRequestSchema,
  ReviewDtoSchema,
  RunDetailDtoSchema,
  RunSummaryDtoSchema,
  StartRunRequestSchema,
  CapabilitiesDtoSchema,
  DiagnosticsDtoSchema,
  ErrorDtoSchema,
  EventDtoSchema,
  HealthDtoSchema,
  OverviewDtoSchema,
  ProjectDtoSchema,
  SessionDetailDtoSchema,
  SessionSummaryDtoSchema,
  SessionTreeDtoSchema,
  UsageSummaryDtoSchema,
  pageSchema,
} from '@acp/core/api';
import type { RegisterProjectInput } from '@acp/core';
import { API_BASE, PROXY_ERROR_HEADER } from './constants';
// Project setup (Phase 4, P4-F).
import {
  CheckRunDtoSchema,
  ContextCandidateDtoSchema,
  CreateRepoProjectRequestSchema,
  HarnessStatusDtoSchema,
  ProjectAgentSetupDtoSchema,
  UpdateProjectSetupRequestSchema,
} from '@acp/core/api';
// Ticket page (Phase 4, P4-G). `CheckRunDtoSchema` and `TicketDetailDtoSchema` are imported above.
import {
  PlanDecisionRequestSchema,
  TicketCommentDtoSchema,
  TicketCommentRequestSchema,
  UpdateTicketRequestSchema,
} from '@acp/core/api';
// Project Tokens page (redesign R-F).
import { ProjectTokensDtoSchema } from '@acp/core/api';

/**
 * The structural part of a Zod schema the client needs. Kept minimal so the web package depends
 * only on `@acp/core` (which owns zod), not on zod directly.
 */
export interface Schema<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
      };
}

export type ApiErrorKind = 'unreachable' | 'http' | 'parse';

export interface ApiIssue {
  path: string;
  message: string;
}

/** Every API failure, typed so the UI can explain it. Parse failures are never swallowed. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly path: string;
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly issues: readonly ApiIssue[];

  constructor(init: {
    kind: ApiErrorKind;
    path: string;
    message: string;
    status?: number | null;
    code?: string | null;
    requestId?: string | null;
    issues?: readonly ApiIssue[];
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.path = init.path;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.requestId = init.requestId ?? null;
    this.issues = init.issues ?? [];
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '(root)' : path.map((p) => String(p)).join('.');
}

async function readJson(res: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await res.text();
  if (text.length === 0) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export interface ApiClient {
  get<T>(path: string, schema: Schema<T>, signal?: AbortSignal): Promise<T>;
  /** `headers` adds request headers, e.g. the control panel's CSRF token (ADR-0013). */
  post<T>(
    path: string,
    body: unknown,
    schema: Schema<T>,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<T>;
  /** Like `post`, with PUT (Phase 4: `PUT /api/projects/:id/setup`). */
  put<T>(
    path: string,
    body: unknown,
    schema: Schema<T>,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<T>;
  /** Like `post`, with PATCH (Phase 4: `PATCH /api/tickets/:id`). */
  patch<T>(
    path: string,
    body: unknown,
    schema: Schema<T>,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<T>;
}

/** Typed fetch client: every response body is parsed with its DTO schema before the UI sees it. */
export function createApiClient(fetchImpl: FetchLike = (i, init) => fetch(i, init)): ApiClient {
  async function request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    schema: Schema<T>,
    body: unknown,
    signal: AbortSignal | undefined,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    let res: Response;
    try {
      const init: RequestInit = {
        method,
        headers:
          body === undefined
            ? { accept: 'application/json', ...extraHeaders }
            : { accept: 'application/json', 'content-type': 'application/json', ...extraHeaders },
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      if (signal) init.signal = signal;
      res = await fetchImpl(path, init);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ApiError({
        kind: 'unreachable',
        path,
        message: `server not reachable at ${API_BASE}`,
      });
    }

    const json = await readJson(res);

    if (!res.ok) {
      const parsedError = json.ok ? ErrorDtoSchema.safeParse(json.value) : null;
      if (parsedError?.success) {
        const { code, message, requestId } = parsedError.data.error;
        throw new ApiError({ kind: 'http', path, status: res.status, code, message, requestId });
      }
      // The dev proxy marks a refused connection; a bare 502/503/504 also means nothing answered.
      if (res.headers.get(PROXY_ERROR_HEADER) !== null || [502, 503, 504].includes(res.status)) {
        throw new ApiError({
          kind: 'unreachable',
          path,
          status: res.status,
          message: `server not reachable at ${API_BASE}`,
        });
      }
      throw new ApiError({
        kind: 'http',
        path,
        status: res.status,
        message: `HTTP ${res.status} without an ErrorDto body`,
      });
    }

    if (!json.ok) {
      throw new ApiError({
        kind: 'parse',
        path,
        status: res.status,
        message: 'response body is not JSON',
      });
    }
    const parsed = schema.safeParse(json.value);
    if (!parsed.success) {
      throw new ApiError({
        kind: 'parse',
        path,
        status: res.status,
        message: 'response did not match the API contract',
        issues: parsed.error.issues.map((i) => ({
          path: formatIssuePath(i.path),
          message: i.message,
        })),
      });
    }
    return parsed.data;
  }

  return {
    get: (path, schema, signal) => request('GET', path, schema, undefined, signal),
    post: (path, body, schema, signal, headers) =>
      request('POST', path, schema, body, signal, headers),
    put: (path, body, schema, signal, headers) =>
      request('PUT', path, schema, body, signal, headers),
    patch: (path, body, schema, signal, headers) =>
      request('PATCH', path, schema, body, signal, headers),
  };
}

// --- Endpoint paths and their response schemas --------------------------------------------------

export const ProjectListSchema = ProjectDtoSchema.array();
export const CandidateListSchema = CandidateRootDtoSchema.array();
export const SessionPageSchema = pageSchema(SessionSummaryDtoSchema);
export const EventPageSchema = pageSchema(EventDtoSchema);

export type QueryParams = Record<string, string | number | null | undefined>;

/** Builds a path with params in a stable order, so equal queries share one cache key. */
export function withQuery(path: string, params: QueryParams = {}): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const v = params[key];
    if (v === undefined || v === null || v === '') continue;
    search.set(key, String(v));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

const enc = encodeURIComponent;

export interface SessionFilters {
  projectId?: string | undefined;
  provider?: string | undefined;
  status?: string | undefined;
  model?: string | undefined;
  q?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface UsageQuery {
  groupBy: 'project' | 'session' | 'model' | 'day';
  from?: string | undefined;
  to?: string | undefined;
  projectId?: string | undefined;
}

export const paths = {
  health: () => `${API_BASE}/health`,
  overview: () => `${API_BASE}/overview`,
  capabilities: () => `${API_BASE}/capabilities`,
  projects: () => `${API_BASE}/projects`,
  project: (id: string) => `${API_BASE}/projects/${enc(id)}`,
  projectSessions: (id: string, cursor?: string) =>
    withQuery(`${API_BASE}/projects/${enc(id)}/sessions`, { cursor }),
  candidates: () => `${API_BASE}/discovery/candidates`,
  sessions: (f: SessionFilters = {}) => withQuery(`${API_BASE}/sessions`, { ...f }),
  session: (id: string) => `${API_BASE}/sessions/${enc(id)}`,
  sessionTree: (id: string) => `${API_BASE}/sessions/${enc(id)}/tree`,
  sessionEvents: (id: string, cursor?: string) =>
    withQuery(`${API_BASE}/sessions/${enc(id)}/events`, { cursor }),
  usageSummary: (q: UsageQuery) => withQuery(`${API_BASE}/usage/summary`, { ...q }),
  events: (cursor?: string) => withQuery(`${API_BASE}/events`, { cursor }),
  diagnostics: () => `${API_BASE}/diagnostics/ingestion`,
  stream: () => `${API_BASE}/events/stream`,
} as const;

export const schemas = {
  health: HealthDtoSchema,
  overview: OverviewDtoSchema,
  capabilities: CapabilitiesDtoSchema,
  projects: ProjectListSchema,
  project: ProjectDtoSchema,
  sessionPage: SessionPageSchema,
  candidates: CandidateListSchema,
  session: SessionDetailDtoSchema,
  sessionTree: SessionTreeDtoSchema,
  eventPage: EventPageSchema,
  usageSummary: UsageSummaryDtoSchema,
  diagnostics: DiagnosticsDtoSchema,
} as const;

/**
 * Registers an existing folder. When the server runs the control panel it requires the CSRF token
 * like every other mutation (P4-H finding); a server without it (no token route) takes the plain
 * request.
 */
export async function registerProject(client: ApiClient, input: RegisterProjectInput) {
  try {
    await csrfToken(client, false);
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'http' && e.status === 404) {
      return client.post(paths.projects(), input, ProjectDtoSchema);
    }
    throw e;
  }
  return controlPost(client, paths.projects(), input, ProjectDtoSchema);
}

// --- Control panel (Phase 3 M1, P3-E) ------------------------------------------------------------
//
// The routes are served by P3-D. Assumed response bodies (proposed to P3-D): GET /runs →
// RunSummaryDto[]; POST /runs → RunDetailDto; POST /runs/:id/chat → ChatMessageDto;
// POST /approvals/:id → ApprovalDto; POST /runs/:id/agents/:agentId/stop → AgentRunDto;
// POST /runs/:id/stop → RunSummaryDto (a RunDetailDto also parses); GET and POST
// /runs/:id/review → ReviewDto.

export type StartRunRequest = ReturnType<typeof StartRunRequestSchema.parse>;
export type ChatRequest = ReturnType<typeof ChatRequestSchema.parse>;
export type ApprovalDecisionRequest = ReturnType<typeof ApprovalDecisionRequestSchema.parse>;
export type ReviewActionRequest = ReturnType<typeof ReviewActionRequestSchema.parse>;

export const controlPaths = {
  token: () => `${API_BASE}/control/token`,
  runs: () => `${API_BASE}/runs`,
  run: (id: string) => `${API_BASE}/runs/${enc(id)}`,
  chat: (runId: string) => `${API_BASE}/runs/${enc(runId)}/chat`,
  approval: (id: string) => `${API_BASE}/approvals/${enc(id)}`,
  stopAgent: (runId: string, agentId: string) =>
    `${API_BASE}/runs/${enc(runId)}/agents/${enc(agentId)}/stop`,
  stopRun: (runId: string) => `${API_BASE}/runs/${enc(runId)}/stop`,
  review: (runId: string) => `${API_BASE}/runs/${enc(runId)}/review`,
} as const;

export const controlSchemas = {
  token: CsrfTokenDtoSchema,
  runs: RunSummaryDtoSchema.array(),
  run: RunDetailDtoSchema,
  review: ReviewDtoSchema,
} as const;

/** True for every cached control-panel path, so a mutation refetches just those. */
export function isControlPath(key: string): boolean {
  return key.startsWith(`${API_BASE}/runs`) || key.startsWith(`${API_BASE}/approvals`);
}

// The CSRF token (ADR-0013), fetched on first use and kept per client.
const csrfTokens = new WeakMap<ApiClient, Promise<string>>();

function csrfToken(client: ApiClient, fresh: boolean): Promise<string> {
  const cached = fresh ? undefined : csrfTokens.get(client);
  if (cached) return cached;
  const token = client.get(controlPaths.token(), CsrfTokenDtoSchema).then((t) => t.token);
  // A failed fetch is not kept: the next mutation asks again.
  token.catch(() => csrfTokens.delete(client));
  csrfTokens.set(client, token);
  return token;
}

/**
 * A control-panel mutation with the `X-ACP-CSRF` header. A 403 fetches a fresh token and retries
 * once, because the server may have restarted and issued a new one.
 */
async function controlPost<T>(
  client: ApiClient,
  path: string,
  body: unknown,
  schema: Schema<T>,
): Promise<T> {
  const send = async (fresh: boolean) =>
    client.post(path, body, schema, undefined, {
      [CSRF_HEADER]: await csrfToken(client, fresh),
    });
  try {
    return await send(false);
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'http' && e.status === 403) return send(true);
    throw e;
  }
}

/** Validates a request body with its core schema before it leaves the browser. */
function checked<T>(schema: Schema<T>, input: unknown, path: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError({
      kind: 'parse',
      path,
      message: 'request did not match the API contract',
      issues: parsed.error.issues.map((i) => ({
        path: formatIssuePath(i.path),
        message: i.message,
      })),
    });
  }
  return parsed.data;
}

export async function startRun(client: ApiClient, input: StartRunRequest) {
  const path = controlPaths.runs();
  return controlPost(client, path, checked(StartRunRequestSchema, input, path), RunDetailDtoSchema);
}

export async function sendChat(client: ApiClient, runId: string, input: ChatRequest) {
  const path = controlPaths.chat(runId);
  return controlPost(client, path, checked(ChatRequestSchema, input, path), ChatMessageDtoSchema);
}

export async function decideApproval(
  client: ApiClient,
  approvalId: string,
  input: ApprovalDecisionRequest,
) {
  const path = controlPaths.approval(approvalId);
  return controlPost(
    client,
    path,
    checked(ApprovalDecisionRequestSchema, input, path),
    ApprovalDtoSchema,
  );
}

export function stopAgent(client: ApiClient, runId: string, agentId: string) {
  return controlPost(client, controlPaths.stopAgent(runId, agentId), {}, AgentRunDtoSchema);
}

export function stopRun(client: ApiClient, runId: string) {
  return controlPost(client, controlPaths.stopRun(runId), {}, RunSummaryDtoSchema);
}

export async function reviewAction(client: ApiClient, runId: string, input: ReviewActionRequest) {
  const path = controlPaths.review(runId);
  return controlPost(
    client,
    path,
    checked(ReviewActionRequestSchema, input, path),
    ReviewDtoSchema,
  );
}

// --- Board (Phase 4, wp/p4-e-board) -------------------------------------------------------------
//
// Routes from docs/phase-4/README.md §6.3, served by P4-D. Every response is parsed with its
// @acp/core/api DTO; every mutation sends the CSRF header (ADR-0013) through `controlPost`.

export type CreateTicketRequest = ReturnType<typeof CreateTicketRequestSchema.parse>;
export type MoveTicketRequest = ReturnType<typeof MoveTicketRequestSchema.parse>;

export const boardPaths = {
  board: (projectId: string) => withQuery(`${API_BASE}/board`, { projectId }),
  tickets: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/tickets`,
  move: (ticketId: string) => `${API_BASE}/tickets/${enc(ticketId)}/move`,
  start: (ticketId: string) => `${API_BASE}/tickets/${enc(ticketId)}/start`,
} as const;

export const boardSchemas = {
  board: BoardDtoSchema,
  tickets: TicketCardDtoSchema.array(),
} as const;

const projectTicketsPattern = new RegExp(`^${API_BASE}/projects/[^/?]+/tickets(\\?|$)`);

/** True for every cached board or ticket path, so a board mutation refetches just those. */
export function isBoardPath(key: string): boolean {
  return (
    key.startsWith(`${API_BASE}/board`) ||
    key.startsWith(`${API_BASE}/tickets`) ||
    projectTicketsPattern.test(key)
  );
}

/** POST /api/projects/:id/tickets: the new ticket lands in Backlog. */
export async function createTicket(
  client: ApiClient,
  projectId: string,
  input: CreateTicketRequest,
) {
  const path = boardPaths.tickets(projectId);
  return controlPost(
    client,
    path,
    checked(CreateTicketRequestSchema, input, path),
    TicketDtoSchema,
  );
}

/** POST /api/tickets/:id/move: the owner-set statuses only (Backlog, Ready, Cancelled). */
export async function moveTicket(client: ApiClient, ticketId: string, input: MoveTicketRequest) {
  const path = boardPaths.move(ticketId);
  return controlPost(client, path, checked(MoveTicketRequestSchema, input, path), TicketDtoSchema);
}

/** POST /api/tickets/:id/start: creates a run for the ticket, which starts in Planning. */
export function startTicket(client: ApiClient, ticketId: string) {
  return controlPost(client, boardPaths.start(ticketId), {}, TicketDetailDtoSchema);
}

// --- Project setup: wizard and settings (Phase 4, wp/p4-f-project-setup) ------------------------
//
// Served by P4-D (docs/phase-4/README.md §6.3). Every mutation sends the CSRF header like the
// control panel; the harness POSTs send an empty JSON body.

export type CreateRepoProjectRequest = ReturnType<typeof CreateRepoProjectRequestSchema.parse>;
export type UpdateProjectSetupRequest = ReturnType<typeof UpdateProjectSetupRequestSchema.parse>;

export const projectSetupPaths = {
  createRepo: () => `${API_BASE}/projects/new`,
  setup: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/setup`,
  harness: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/harness`,
  harnessChecks: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/harness/checks`,
  harnessTicket: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/harness/ticket`,
  contextCandidates: (projectId: string) =>
    `${API_BASE}/projects/${enc(projectId)}/context-candidates`,
} as const;

export const projectSetupSchemas = {
  setup: ProjectAgentSetupDtoSchema,
  harness: HarnessStatusDtoSchema,
  checkRuns: CheckRunDtoSchema.array(),
  contextCandidates: ContextCandidateDtoSchema.array(),
  ticket: TicketDtoSchema,
} as const;

/** True for the cached setup, harness and context-file paths of one project. */
export function isProjectSetupPath(projectId: string): (key: string) => boolean {
  const base = `${API_BASE}/projects/${enc(projectId)}`;
  return (key) =>
    key === base ||
    key.startsWith(`${base}/setup`) ||
    key.startsWith(`${base}/harness`) ||
    key.startsWith(`${base}/context-candidates`);
}

/** A PUT with the `X-ACP-CSRF` header; a 403 fetches a fresh token and retries once. */
async function controlPut<T>(
  client: ApiClient,
  path: string,
  body: unknown,
  schema: Schema<T>,
): Promise<T> {
  const send = async (fresh: boolean) =>
    client.put(path, body, schema, undefined, { [CSRF_HEADER]: await csrfToken(client, fresh) });
  try {
    return await send(false);
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'http' && e.status === 403) return send(true);
    throw e;
  }
}

/** POST /api/projects/new: the server runs `git init -b main` in a new folder (ADR-0017). */
export async function createRepoProject(client: ApiClient, input: CreateRepoProjectRequest) {
  const path = projectSetupPaths.createRepo();
  return controlPost(
    client,
    path,
    checked(CreateRepoProjectRequestSchema, input, path),
    ProjectDtoSchema,
  );
}

export function getProjectSetup(client: ApiClient, projectId: string, signal?: AbortSignal) {
  return client.get(projectSetupPaths.setup(projectId), projectSetupSchemas.setup, signal);
}

export async function updateProjectSetup(
  client: ApiClient,
  projectId: string,
  input: UpdateProjectSetupRequest,
) {
  const path = projectSetupPaths.setup(projectId);
  return controlPut(
    client,
    path,
    checked(UpdateProjectSetupRequestSchema, input, path),
    projectSetupSchemas.setup,
  );
}

export function getHarnessStatus(client: ApiClient, projectId: string, signal?: AbortSignal) {
  return client.get(projectSetupPaths.harness(projectId), projectSetupSchemas.harness, signal);
}

/** "Run checks now": every harness check on the project's main branch, read-only. */
export function runHarnessChecks(client: ApiClient, projectId: string) {
  return controlPost(
    client,
    projectSetupPaths.harnessChecks(projectId),
    {},
    projectSetupSchemas.checkRuns,
  );
}

/** Adds the ready-written "Build the harness" ticket (HARNESS_TICKET_TEMPLATE) to the board. */
export function createHarnessTicket(client: ApiClient, projectId: string) {
  return controlPost(
    client,
    projectSetupPaths.harnessTicket(projectId),
    {},
    projectSetupSchemas.ticket,
  );
}

export function getContextCandidates(client: ApiClient, projectId: string, signal?: AbortSignal) {
  return client.get(
    projectSetupPaths.contextCandidates(projectId),
    projectSetupSchemas.contextCandidates,
    signal,
  );
}

// --- Ticket page (Phase 4, wp/p4-g-ticket) ------------------------------------------------------
//
// Routes from docs/phase-4/README.md §6.3, served by P4-D. Assumed response bodies (proposed to
// P4-D): PATCH /tickets/:id, POST /tickets/:id/start and POST /tickets/:id/plans/:planId/decision →
// TicketDetailDto; POST /tickets/:id/comments → TicketCommentDto; GET /runs/:id/checks and
// POST /runs/:id/agents/:agentId/checks → CheckRunDto[]. The Phase 3 route
// POST /runs/:id/agents/:agentId/message → AgentRunDto. Every mutation sends the CSRF header.

export type UpdateTicketRequest = ReturnType<typeof UpdateTicketRequestSchema.parse>;
export type TicketCommentRequest = ReturnType<typeof TicketCommentRequestSchema.parse>;
export type PlanDecisionRequest = ReturnType<typeof PlanDecisionRequestSchema.parse>;

export const ticketPaths = {
  ticket: (id: string) => `${API_BASE}/tickets/${enc(id)}`,
  comments: (id: string) => `${API_BASE}/tickets/${enc(id)}/comments`,
  planDecision: (id: string, planId: string) =>
    `${API_BASE}/tickets/${enc(id)}/plans/${enc(planId)}/decision`,
  start: (id: string) => `${API_BASE}/tickets/${enc(id)}/start`,
  runChecks: (runId: string) => `${API_BASE}/runs/${enc(runId)}/checks`,
  agentChecks: (runId: string, agentId: string) =>
    `${API_BASE}/runs/${enc(runId)}/agents/${enc(agentId)}/checks`,
  agentMessage: (runId: string, agentId: string) =>
    `${API_BASE}/runs/${enc(runId)}/agents/${enc(agentId)}/message`,
} as const;

export const ticketSchemas = {
  detail: TicketDetailDtoSchema,
  checks: CheckRunDtoSchema.array(),
} as const;

/** True for every cached ticket and run path, so a ticket-page mutation refetches just those. */
export function isTicketPagePath(key: string): boolean {
  return key.startsWith(`${API_BASE}/tickets`) || isControlPath(key);
}

/** A PATCH with the `X-ACP-CSRF` header; a 403 fetches a fresh token and retries once. */
async function controlPatch<T>(
  client: ApiClient,
  path: string,
  body: unknown,
  schema: Schema<T>,
): Promise<T> {
  const send = async (fresh: boolean) =>
    client.patch(path, body, schema, undefined, { [CSRF_HEADER]: await csrfToken(client, fresh) });
  try {
    return await send(false);
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'http' && e.status === 403) return send(true);
    throw e;
  }
}

/** PATCH /api/tickets/:id: title, description, type, priority or labels. */
export async function updateTicket(
  client: ApiClient,
  ticketId: string,
  input: UpdateTicketRequest,
) {
  const path = ticketPaths.ticket(ticketId);
  return controlPatch(
    client,
    path,
    checked(UpdateTicketRequestSchema, input, path),
    TicketDetailDtoSchema,
  );
}

/** POST /api/tickets/:id/comments: an owner comment on the ticket. */
export async function addTicketComment(
  client: ApiClient,
  ticketId: string,
  input: TicketCommentRequest,
) {
  const path = ticketPaths.comments(ticketId);
  return controlPost(
    client,
    path,
    checked(TicketCommentRequestSchema, input, path),
    TicketCommentDtoSchema,
  );
}

/** Approve the lead's plan, or send it back with a comment (required) for a new version. */
export async function decidePlan(
  client: ApiClient,
  ticketId: string,
  planId: string,
  input: PlanDecisionRequest,
) {
  const path = ticketPaths.planDecision(ticketId, planId);
  return controlPost(
    client,
    path,
    checked(PlanDecisionRequestSchema, input, path),
    TicketDetailDtoSchema,
  );
}

/** POST /api/tickets/:id/start: a new run for the ticket (first start or re-run), in Planning. */
export function rerunTicket(client: ApiClient, ticketId: string) {
  return controlPost(client, ticketPaths.start(ticketId), {}, TicketDetailDtoSchema);
}

/** Runs the harness checks again in one helper agent's copy of the project. */
export function runAgentChecks(client: ApiClient, runId: string, agentId: string) {
  return controlPost(client, ticketPaths.agentChecks(runId, agentId), {}, ticketSchemas.checks);
}

/** A message to one agent, sent through the engine's `message_agent` (Phase 3 route). */
export async function messageAgent(
  client: ApiClient,
  runId: string,
  agentId: string,
  input: ChatRequest,
) {
  const path = ticketPaths.agentMessage(runId, agentId);
  return controlPost(client, path, checked(ChatRequestSchema, input, path), AgentRunDtoSchema);
}

// --- Project Tokens page (redesign R-F, wp/r-f-tokens) -------------------------------------------
//
// GET /api/projects/:id/tokens?from&to (ProjectTokensDto). `from` is inclusive and `to` exclusive,
// both ISO-8601. Read-only, so no CSRF header.

export interface TokensRangeQuery {
  from?: string | undefined;
  to?: string | undefined;
}

export const tokensPaths = {
  project: (projectId: string, range: TokensRangeQuery = {}) =>
    withQuery(`${API_BASE}/projects/${enc(projectId)}/tokens`, { ...range }),
} as const;

export const tokensSchemas = {
  project: ProjectTokensDtoSchema,
} as const;
