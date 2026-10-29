import {
  ConflictResolutionDtoSchema,
  ConflictResolutionViewDtoSchema,
  PromoteResolutionRequestSchema,
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
import type { UpdateProjectInput } from '@acp/core/api';
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
// Workflow page (redesign R-B).
import { AgentDefinitionSummaryDtoSchema, ProjectWorkflowDtoSchema } from '@acp/core/api';
// Skills page (redesign, R-D).
import {
  SkillCommitResultDtoSchema,
  SkillDetailDtoSchema,
  SkillSummaryDtoSchema,
  SkillWriteRequestSchema,
} from '@acp/core/api';
// Agents tab of the Skills & Agents page (redesign, R-D). `AgentDefinitionSummaryDtoSchema` is
// imported by the Workflow section above.
import {
  AgentDefinitionCommitResultDtoSchema,
  AgentDefinitionDetailDtoSchema,
  AgentDefinitionWriteRequestSchema,
} from '@acp/core/api';
// Ticket page live workflow and the harness history (redesign, R-H).
import { RunWorkflowDtoSchema } from '@acp/core/api';
// Live run graph and the blocks' modes for the run options (WG-E, ADR-0023).
import { RunWorkflowGraphDtoSchema } from '@acp/core/api';
// The harness in the workflow: setup runs on main (H-D, ADR-0027).
import { SetupRunDtoSchema } from '@acp/core/api';
// Review loop: Start overrides and the ticket branch (RL-D, ADR-0021).
import {
  StartTicketRequestSchema,
  TicketBranchActionRequestSchema,
  TicketBranchReviewDtoSchema,
} from '@acp/core/api';
// F-1: reset a ticket branch changed outside the app.
import { ResetTicketBranchRequestSchema } from '@acp/core/api';
// Workflow graph editor (WG-D, ADR-0023).
import {
  UpdateWorkflowGraphRequestSchema,
  ValidateWorkflowGraphResultDtoSchema,
  WorkflowGraphDtoSchema,
} from '@acp/core/api';
// Code hosting and branching (G-B, ADR-0025).
import {
  CodeHostStatusDtoSchema,
  OpenPullRequestRequestSchema,
  TicketBranchDtoSchema,
} from '@acp/core/api';
// Connecting a project to GitHub from Settings (G-E, ADR-0025 §7).
import { ConnectRepositoryRequestSchema, CreateRepositoryRequestSchema } from '@acp/core/api';
// A project's branches: list and create (G-F, ADR-0025 §8).
import { CreateBranchRequestSchema, ProjectBranchesDtoSchema } from '@acp/core/api';
// Comments, Conversation and attachments (v0.3.0 C-B, ADR-0026).
import { AttachmentDtoSchema, TicketActivityDtoSchema } from '@acp/core/api';
// Merge pull request, Delete branch (G-G, ADR-0025 §9) and the ticket badge (T-A).
import { MergePullRequestRequestSchema, TicketTotalsDtoSchema } from '@acp/core/api';

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
  /** DELETE answered by 204 No Content (redesign R-D: `DELETE /api/projects/:id/skills/:name`). */
  delete(path: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<void>;
  /**
   * A POST whose body is the bytes themselves, not JSON (v0.3.0 C-B, ADR-0026: an attachment's
   * upload), sent with `contentType` as its `Content-Type`.
   */
  postRaw<T>(
    path: string,
    data: Blob,
    contentType: string,
    schema: Schema<T>,
    headers?: Record<string, string>,
  ): Promise<T>;
}

/** A request body sent as it is (`postRaw`), apart from the JSON bodies of every other call. */
class RawBody {
  constructor(
    readonly data: Blob,
    readonly contentType: string,
  ) {}
}

/** The "schema" of a 204 response: no body at all. */
const NoContentSchema: Schema<void> = {
  safeParse: (data) =>
    data === undefined
      ? { success: true, data: undefined }
      : { success: false, error: { issues: [{ path: [], message: 'expected no content' }] } },
};

/** Typed fetch client: every response body is parsed with its DTO schema before the UI sees it. */
export function createApiClient(fetchImpl: FetchLike = (i, init) => fetch(i, init)): ApiClient {
  async function request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    schema: Schema<T>,
    body: unknown,
    signal: AbortSignal | undefined,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    let res: Response;
    try {
      const raw = body instanceof RawBody ? body : null;
      const init: RequestInit = {
        method,
        headers:
          body === undefined
            ? { accept: 'application/json', ...extraHeaders }
            : {
                accept: 'application/json',
                'content-type': raw !== null ? raw.contentType : 'application/json',
                ...extraHeaders,
              },
      };
      if (raw !== null) init.body = raw.data;
      else if (body !== undefined) init.body = JSON.stringify(body);
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

    // 204 No Content has no body to read; the schema decides whether that is acceptable.
    const json = res.status === 204 ? { ok: true as const, value: undefined } : await readJson(res);

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
    delete: (path, signal, headers) =>
      request('DELETE', path, NoContentSchema, undefined, signal, headers),
    postRaw: (path, data, contentType, schema, headers) =>
      request('POST', path, schema, new RawBody(data, contentType), undefined, headers),
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
// Routes from docs/history/phase-4/README.md §6.3, served by P4-D. Every response is parsed with
// its @acp/core/api DTO; every mutation sends the CSRF header (ADR-0013) through `controlPost`.

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

/**
 * POST /api/tickets/:id/start: creates a run for the ticket, which starts in Planning. `input`
 * (ADR-0021) overrides the project's approval mode, reviewer or rework rounds for this run only;
 * without it the body is `{}` and the run uses the project's settings, as before.
 */
export function startTicket(client: ApiClient, ticketId: string, input?: StartTicketRequest) {
  const path = boardPaths.start(ticketId);
  const body = input === undefined ? {} : checked(StartTicketRequestSchema, input, path);
  return controlPost(client, path, body, TicketDetailDtoSchema);
}

// --- Project setup: wizard and settings (Phase 4, wp/p4-f-project-setup) ------------------------
//
// Served by P4-D (docs/history/phase-4/README.md §6.3). Every mutation sends the CSRF header like
// the control panel; the harness POSTs send an empty JSON body.

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

/** True for the cached project, list and overview views, which show the folder path. */
export function isProjectQueryPath(key: string): boolean {
  return key.startsWith(`${API_BASE}/projects`) || key.startsWith(`${API_BASE}/overview`);
}

/** PATCH /api/projects/:id: the owner renames the project or points it at a new folder. */
export async function updateProject(
  client: ApiClient,
  projectId: string,
  input: UpdateProjectInput,
) {
  return controlPatch(client, paths.project(projectId), input, ProjectDtoSchema);
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
// Routes from docs/history/phase-4/README.md §6.3, served by P4-D. Assumed response bodies
// (proposed to P4-D): PATCH /tickets/:id, POST /tickets/:id/start and POST
// /tickets/:id/plans/:planId/decision → TicketDetailDto; POST /tickets/:id/comments →
// TicketCommentDto; GET /runs/:id/checks and POST /runs/:id/agents/:agentId/checks → CheckRunDto[].
// The Phase 3 route POST /runs/:id/agents/:agentId/message → AgentRunDto. Every mutation sends the
// CSRF header.

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

/**
 * POST /api/tickets/:id/start: a new run for the ticket (first start or re-run), in Planning.
 * `input` overrides the project's settings for this run (ADR-0021); without it the body is `{}`.
 */
export function rerunTicket(client: ApiClient, ticketId: string, input?: StartTicketRequest) {
  const path = ticketPaths.start(ticketId);
  const body = input === undefined ? {} : checked(StartTicketRequestSchema, input, path);
  return controlPost(client, path, body, TicketDetailDtoSchema);
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

// --- Workflow page (redesign R-B, wp/r-b-workflow) ----------------------------------------------
//
// Served by R-G (docs/redesign/wp/R-G.md at tag v0.3.0): GET /api/projects/:id/workflow →
// ProjectWorkflowDto, read only by the ticket page's version 1 view, for a server from before
// graphs. It answers 409 `workflow_is_graph` once a project stores a graph, so everything else (the
// Workflow page, the run options, Skills & Agents) reads the graph below since WG-D and WG-F. The
// agent files list, GET /api/projects/:id/agents → AgentDefinitionSummaryDto[], is R-D's.

export const workflowPaths = {
  workflow: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/workflow`,
  agents: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/agents`,
} as const;

export const workflowSchemas = {
  workflow: ProjectWorkflowDtoSchema,
  agents: AgentDefinitionSummaryDtoSchema.array(),
} as const;

// --- Workflow graph (WG-D, wp/wg-d-editor; ADR-0023) ---------------------------------------------
//
// Served by WG-C (docs/history/workflow-graph/README.md, WG-0 refinement 9): GET/PUT
// /api/projects/:id/workflow-graph → WorkflowGraphDto, POST …/workflow-graph/validate →
// ValidateWorkflowGraphResultDto. A PUT of a graph with an error answers 422 `workflow_invalid`.
// The project's limits and approvals still save through PUT …/setup.

export type UpdateWorkflowGraphRequest = ReturnType<typeof UpdateWorkflowGraphRequestSchema.parse>;

export const workflowGraphPaths = {
  graph: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/workflow-graph`,
  validate: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/workflow-graph/validate`,
} as const;

export const workflowGraphSchemas = {
  graph: WorkflowGraphDtoSchema,
  validate: ValidateWorkflowGraphResultDtoSchema,
} as const;

/**
 * The cached graph and setup of one project: the graph's DTO carries the setup too, and the run
 * options read the project's defaults from it (WG-F). The version 1 workflow is not among them: only
 * the ticket page's version 1 view, for a server from before graphs, still reads it.
 */
export function isWorkflowGraphPath(projectId: string): (key: string) => boolean {
  const graph = workflowGraphPaths.graph(projectId);
  const setup = projectSetupPaths.setup(projectId);
  return (key) => key.startsWith(graph) || key.startsWith(setup);
}

/** PUT /api/projects/:id/workflow-graph: the whole graph (422 `workflow_invalid` on an error). */
export async function updateWorkflowGraph(
  client: ApiClient,
  projectId: string,
  input: UpdateWorkflowGraphRequest,
) {
  const path = workflowGraphPaths.graph(projectId);
  return controlPut(
    client,
    path,
    checked(UpdateWorkflowGraphRequestSchema, input, path),
    workflowGraphSchemas.graph,
  );
}

/** POST …/workflow-graph/validate: the server's issues for a graph, without saving it. */
export async function validateWorkflowGraphOnServer(
  client: ApiClient,
  projectId: string,
  input: UpdateWorkflowGraphRequest,
) {
  const path = workflowGraphPaths.validate(projectId);
  return controlPost(
    client,
    path,
    checked(UpdateWorkflowGraphRequestSchema, input, path),
    workflowGraphSchemas.validate,
  );
}

// --- Skills (redesign, wp/r-d-skills) -----------------------------------------------------------
//
// Project skills in `<repo>/.claude/skills/<slug>/SKILL.md` (ADR-0018), served by the server's
// `routes/skills.ts`. Every mutation sends the CSRF header; a delete answers 204.

export type SkillWriteRequest = ReturnType<typeof SkillWriteRequestSchema.parse>;

export const skillsPaths = {
  list: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/skills`,
  skill: (projectId: string, name: string) =>
    `${API_BASE}/projects/${enc(projectId)}/skills/${enc(name)}`,
  commit: (projectId: string, name: string) =>
    `${API_BASE}/projects/${enc(projectId)}/skills/${enc(name)}/commit`,
} as const;

export const skillsSchemas = {
  list: SkillSummaryDtoSchema.array(),
  detail: SkillDetailDtoSchema,
  commit: SkillCommitResultDtoSchema,
} as const;

/** True for one project's cached skill list and skill pages. */
export function isSkillsPath(projectId: string): (key: string) => boolean {
  const base = skillsPaths.list(projectId);
  return (key) => key === base || key.startsWith(`${base}/`);
}

/** POST …/skills: writes a new SKILL.md into the project's working tree (uncommitted). */
export function createSkill(client: ApiClient, projectId: string, input: SkillWriteRequest) {
  const path = skillsPaths.list(projectId);
  return controlPost(
    client,
    path,
    checked(SkillWriteRequestSchema, input, path),
    skillsSchemas.detail,
  );
}

/** PUT …/skills/:name: replaces the skill's description and instructions. */
export function updateSkill(
  client: ApiClient,
  projectId: string,
  name: string,
  input: SkillWriteRequest,
) {
  const path = skillsPaths.skill(projectId, name);
  return controlPut(
    client,
    path,
    checked(SkillWriteRequestSchema, input, path),
    skillsSchemas.detail,
  );
}

/** DELETE …/skills/:name (204): refused while a workflow stage uses the skill. */
export function deleteSkill(client: ApiClient, projectId: string, name: string) {
  return controlDelete(client, skillsPaths.skill(projectId, name));
}

/** A DELETE with the `X-ACP-CSRF` header; a 403 fetches a fresh token and retries once. */
async function controlDelete(client: ApiClient, path: string): Promise<void> {
  const send = async (fresh: boolean) =>
    client.delete(path, undefined, { [CSRF_HEADER]: await csrfToken(client, fresh) });
  try {
    await send(false);
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'http' && e.status === 403) return send(true);
    throw e;
  }
}

/** POST …/skills/:name/commit: a git commit of only that skill's folder, never pushed. */
export function commitSkill(client: ApiClient, projectId: string, name: string) {
  return controlPost(client, skillsPaths.commit(projectId, name), {}, skillsSchemas.commit);
}

// --- Agent definitions (redesign, wp/r-d-skills) ------------------------------------------------
//
// Project agent files in `<repo>/.claude/agents/<slug>.md` (ADR-0018 amendment), served by the
// server's `routes/agents.ts`, mirroring the skills routes.

export type AgentDefinitionWriteRequest = ReturnType<
  typeof AgentDefinitionWriteRequestSchema.parse
>;

export const agentsPaths = {
  list: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/agents`,
  agent: (projectId: string, name: string) =>
    `${API_BASE}/projects/${enc(projectId)}/agents/${enc(name)}`,
  commit: (projectId: string, name: string) =>
    `${API_BASE}/projects/${enc(projectId)}/agents/${enc(name)}/commit`,
} as const;

export const agentsSchemas = {
  list: AgentDefinitionSummaryDtoSchema.array(),
  detail: AgentDefinitionDetailDtoSchema,
  commit: AgentDefinitionCommitResultDtoSchema,
} as const;

/** True for one project's cached agent list and agent pages. */
export function isAgentsPath(projectId: string): (key: string) => boolean {
  const base = agentsPaths.list(projectId);
  return (key) => key === base || key.startsWith(`${base}/`);
}

/** POST …/agents: writes a new agent file into the project's working tree (uncommitted). */
export function createAgent(
  client: ApiClient,
  projectId: string,
  input: AgentDefinitionWriteRequest,
) {
  const path = agentsPaths.list(projectId);
  return controlPost(
    client,
    path,
    checked(AgentDefinitionWriteRequestSchema, input, path),
    agentsSchemas.detail,
  );
}

/** PUT …/agents/:name: replaces the agent's name, description, tools, model and instructions. */
export function updateAgent(
  client: ApiClient,
  projectId: string,
  name: string,
  input: AgentDefinitionWriteRequest,
) {
  const path = agentsPaths.agent(projectId, name);
  return controlPut(
    client,
    path,
    checked(AgentDefinitionWriteRequestSchema, input, path),
    agentsSchemas.detail,
  );
}

/** DELETE …/agents/:name (204). */
export function deleteAgent(client: ApiClient, projectId: string, name: string) {
  return controlDelete(client, agentsPaths.agent(projectId, name));
}

/** POST …/agents/:name/commit: a commit of only that agent file, never pushed. */
export function commitAgent(client: ApiClient, projectId: string, name: string) {
  return controlPost(client, agentsPaths.commit(projectId, name), {}, agentsSchemas.commit);
}

// --- Ticket page workflow and harness history (redesign R-H, wp/r-h-polish) ----------------------
//
// Served by R-G (docs/redesign/wp/R-G.md at tag v0.3.0): GET /api/runs/:id/workflow →
// RunWorkflowDto (404 for an unknown run, and while managed agents are off); POST
// /api/runs/:id/continue (CSRF, no body) → RunDetailDto; GET /api/projects/:id/harness/checks →
// CheckRunDto[], the last 50 main-branch results, newest first (the same path as "Run checks now",
// which POSTs).

export const runWorkflowPaths = {
  workflow: (runId: string) => `${API_BASE}/runs/${enc(runId)}/workflow`,
  continue: (runId: string) => `${API_BASE}/runs/${enc(runId)}/continue`,
  /** WG-E: the run's snapshot graph and each block's live state (`RunWorkflowGraphDto`). */
  graph: (runId: string) => `${API_BASE}/runs/${enc(runId)}/workflow-graph`,
} as const;

export const runWorkflowSchemas = {
  workflow: RunWorkflowDtoSchema,
  graph: RunWorkflowGraphDtoSchema,
} as const;

// --- Live run graph and the blocks' modes (WG-E, wp/wg-e-live; ADR-0023) ------------------------
//
// Served by WG-C (docs/history/workflow-graph/README.md, WG-0 refinement 9). GET
// /api/runs/:id/workflow-graph (`runWorkflowPaths.graph` above) answers the run's snapshot graph; a
// server from before it answers 404 (or 409), and the ticket page then keeps the version 1 view.
// The run options, the Start dialog, the board badge and "Used by" read the project's graph with
// the editor's path and schema (`workflowGraphPaths`), so they share one cache entry: the project's
// defaults, the blocks' own approval modes and the blocks that use a file (WG-F).

/** 404 or 409: the server has no graph for this run or project (a server from before ADR-0023). */
export function isGraphUnavailable(error: ApiError | null): boolean {
  return error !== null && error.kind === 'http' && (error.status === 404 || error.status === 409);
}

/** Continue: starts the post-merge stage a restart held (`code-review` or `unit-tests`). */
export function continueRun(client: ApiClient, runId: string) {
  return controlPost(client, runWorkflowPaths.continue(runId), {}, RunDetailDtoSchema);
}

export const harnessHistoryPaths = {
  history: (projectId: string) => projectSetupPaths.harnessChecks(projectId),
} as const;

export const harnessHistorySchemas = {
  history: CheckRunDtoSchema.array(),
} as const;

// --- Review loop: the ticket branch and the Start overrides (RL-D, ADR-0021) ---------------------
//
// GET /api/runs/:id/ticket-branch → TicketBranchReviewDto (the combined change base..tip and the
// checks on the tip); POST the same path (CSRF) with a TicketBranchActionRequest, answered with the
// branch afterwards (the same TicketBranchReviewDto). The page refetches the ticket and the run.

export type StartTicketRequest = ReturnType<typeof StartTicketRequestSchema.parse>;
export type TicketBranchActionRequest = ReturnType<typeof TicketBranchActionRequestSchema.parse>;

export const reviewLoopPaths = {
  ticketBranch: (runId: string) => `${API_BASE}/runs/${enc(runId)}/ticket-branch`,
} as const;

export const reviewLoopSchemas = {
  ticketBranch: TicketBranchReviewDtoSchema,
} as const;

/** Merge, merge anyway, request changes, discard or update the run's ticket branch. */
export async function ticketBranchAction(
  client: ApiClient,
  runId: string,
  input: TicketBranchActionRequest,
) {
  const path = reviewLoopPaths.ticketBranch(runId);
  return controlPost(
    client,
    path,
    checked(TicketBranchActionRequestSchema, input, path),
    TicketBranchReviewDtoSchema,
  );
}

// F-1: POST /api/runs/:id/ticket-branch/reset (CSRF; the owner's click only) with
// `{ from }`, the tip the owner saw (`ticketBranch.movedOutside.tip`): the server moves the branch
// back to the last reviewed commit by compare-and-swap and answers with the TicketBranchReviewDto.
export const ticketBranchResetPath = (runId: string): string =>
  `${API_BASE}/runs/${enc(runId)}/ticket-branch/reset`;

/** "Reset to the last reviewed commit" for a ticket branch changed outside the app. */
export async function resetTicketBranch(client: ApiClient, runId: string, from: string) {
  const path = ticketBranchResetPath(runId);
  return controlPost(
    client,
    path,
    checked(ResetTicketBranchRequestSchema, { from }, path),
    TicketBranchReviewDtoSchema,
  );
}

// --- Conflict resolution (ADR-0030) --------------------------------------------------------------
//
// GET /api/runs/:id/conflict-resolution → ConflictResolutionViewDto (the latest operation, the
// project's policy, whether the target moved). POST the same path (CSRF) starts "Update target /
// Resolve conflicts"; POST …/cancel and …/promote (`{ reason? }`) act on the operation. Each answers
// the operation (ConflictResolutionDto).

export const conflictResolutionPaths = {
  view: (runId: string) => `${API_BASE}/runs/${enc(runId)}/conflict-resolution`,
} as const;

export const conflictResolutionSchemas = { view: ConflictResolutionViewDtoSchema } as const;

/** The owner's "Update target / Resolve conflicts". */
export async function startConflictResolution(client: ApiClient, runId: string) {
  const path = conflictResolutionPaths.view(runId);
  return controlPost(client, path, {}, ConflictResolutionDtoSchema);
}

/** Stops the operation under way (its resolver too); the ticket branch stays as it was. */
export async function cancelConflictResolution(client: ApiClient, runId: string) {
  const path = `${conflictResolutionPaths.view(runId)}/cancel`;
  return controlPost(client, path, {}, ConflictResolutionDtoSchema);
}

/** Applies a candidate the policy gate held; `reason` when it was not verified. */
export async function promoteConflictResolution(client: ApiClient, runId: string, reason?: string) {
  const path = `${conflictResolutionPaths.view(runId)}/promote`;
  const body = checked(
    PromoteResolutionRequestSchema,
    reason === undefined ? {} : { reason },
    path,
  );
  return controlPost(client, path, body, ConflictResolutionDtoSchema);
}

// --- Code hosting: GitHub status, Push & open PR (G-B, ADR-0025) ---------------------------------
//
// GET /api/projects/:id/code-host → CodeHostStatusDto (the server asks `gh` by exit code only).
// POST /api/tickets/:id/branch/pull-request (CSRF; the owner's click only) with an
// OpenPullRequestRequest pushes the ticket branch to origin and opens a pull request against its
// target; POST …/pull-request/refresh reads the pull request's state again. Both answer with the
// ticket branch, `pullRequest` filled in. Nothing here runs on a timer.

export type OpenPullRequestRequest = ReturnType<typeof OpenPullRequestRequestSchema.parse>;

export const codeHostPaths = {
  status: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/code-host`,
  /** G-E: create the repository on GitHub and set it as origin. */
  repository: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/code-host/repository`,
  /** G-E: set an existing GitHub repository as origin. */
  remote: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/code-host/remote`,
  pullRequest: (ticketId: string) => `${API_BASE}/tickets/${enc(ticketId)}/branch/pull-request`,
  refresh: (ticketId: string) => `${API_BASE}/tickets/${enc(ticketId)}/branch/pull-request/refresh`,
} as const;

export const codeHostSchemas = {
  status: CodeHostStatusDtoSchema,
  branch: TicketBranchDtoSchema,
} as const;

/** Push & open PR: only from the owner's confirmed click on the ticket branch card. */
export async function openPullRequest(
  client: ApiClient,
  ticketId: string,
  input: OpenPullRequestRequest,
) {
  const path = codeHostPaths.pullRequest(ticketId);
  return controlPost(
    client,
    path,
    checked(OpenPullRequestRequestSchema, input, path),
    codeHostSchemas.branch,
  );
}

/** Refresh: reads the pull request's state on GitHub again. */
export function refreshPullRequest(client: ApiClient, ticketId: string) {
  return controlPost(client, codeHostPaths.refresh(ticketId), {}, codeHostSchemas.branch);
}

// G-G (ADR-0025 §9), only on the owner's confirmed click: POST …/pull-request/merge with a
// MergePullRequestRequest merges the open pull request on GitHub (and, with deleteBranch, deletes
// the branch there and locally); POST /api/tickets/:id/branch/delete deletes the merged or
// discarded ticket branch on origin and in the project. Both answer the ticket branch with
// `localExists` and `pullRequest.headOnOrigin`.

export type MergePullRequestRequest = ReturnType<typeof MergePullRequestRequestSchema.parse>;

export const branchActionPaths = {
  merge: (ticketId: string) => `${API_BASE}/tickets/${enc(ticketId)}/branch/pull-request/merge`,
  delete: (ticketId: string) => `${API_BASE}/tickets/${enc(ticketId)}/branch/delete`,
} as const;

export function mergePullRequest(
  client: ApiClient,
  ticketId: string,
  input: MergePullRequestRequest,
) {
  const path = branchActionPaths.merge(ticketId);
  return controlPost(
    client,
    path,
    checked(MergePullRequestRequestSchema, input, path),
    codeHostSchemas.branch,
  );
}

export function deleteTicketBranch(client: ApiClient, ticketId: string) {
  return controlPost(client, branchActionPaths.delete(ticketId), {}, codeHostSchemas.branch);
}

// T-A: GET /api/tickets/:id/totals → TicketTotalsDto (time taken and the ticket's tokens, as on
// the Tokens page; no cost). Under /api/tickets, so the ticket page's refetches include it.

export const ticketTotalsPaths = {
  totals: (ticketId: string) => `${API_BASE}/tickets/${enc(ticketId)}/totals`,
} as const;

export const ticketTotalsSchemas = {
  totals: TicketTotalsDtoSchema,
} as const;

// G-E (ADR-0025 §7): connecting a project from Settings, only on the owner's click and only when
// the project has no origin yet (409 `origin_exists` otherwise). POST …/code-host/repository with
// a CreateRepositoryRequest creates the repository with the owner's `gh` login and sets it as
// origin (and pushes the current branch when asked); POST …/code-host/remote with a
// ConnectRepositoryRequest sets an existing one as origin. Both answer the new CodeHostStatusDto.

export type CreateRepositoryRequest = ReturnType<typeof CreateRepositoryRequestSchema.parse>;
export type ConnectRepositoryRequest = ReturnType<typeof ConnectRepositoryRequestSchema.parse>;

export function createCodeHostRepository(
  client: ApiClient,
  projectId: string,
  input: CreateRepositoryRequest,
) {
  const path = codeHostPaths.repository(projectId);
  return controlPost(
    client,
    path,
    checked(CreateRepositoryRequestSchema, input, path),
    codeHostSchemas.status,
  );
}

export function connectCodeHostRepository(
  client: ApiClient,
  projectId: string,
  input: ConnectRepositoryRequest,
) {
  const path = codeHostPaths.remote(projectId);
  return controlPost(
    client,
    path,
    checked(ConnectRepositoryRequestSchema, input, path),
    codeHostSchemas.status,
  );
}

// --- A project's branches (G-F, ADR-0025 §8) ----------------------------------------------------
//
// GET /api/projects/:id/branches → ProjectBranchesDto: the local branches, read from git when
// asked (no fetch), with the current one and which are on origin. POST the same path (CSRF; the
// owner's click only) with a CreateBranchRequest creates `name` at the tip of the local `from`
// without switching the checkout, and pushes it when asked; it answers the new list. Refusals:
// 409 `branch_exists`, 404 `base_branch_missing`, 409 `no_origin`, 422 `invalid_branch_name`.

export type CreateBranchRequest = ReturnType<typeof CreateBranchRequestSchema.parse>;

export const branchPaths = {
  list: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/branches`,
} as const;

export const branchSchemas = {
  list: ProjectBranchesDtoSchema,
} as const;

export function createProjectBranch(
  client: ApiClient,
  projectId: string,
  input: CreateBranchRequest,
) {
  const path = branchPaths.list(projectId);
  return controlPost(
    client,
    path,
    checked(CreateBranchRequestSchema, input, path),
    branchSchemas.list,
  );
}

// --- Comments, Conversation and attachments (v0.3.0 C-B, ADR-0026) -----------------------------
//
// GET /api/tickets/:id/activity → TicketActivityDto (the Conversation tab, oldest first).
// GET /api/tickets/:id/attachments → AttachmentDto[]; POST the same path (CSRF) with the file's
// bytes as the body, its type as `Content-Type` and its name, URI-encoded, in `X-Attachment-Name`
// (optional `?commentId=`) → AttachmentDto. DELETE /api/attachments/:id (CSRF) → 204. Each
// attachment's bytes are at its `contentUrl` (`/api/attachments/:id/content`).

/** The header that carries an uploaded file's name (URI-encoded). */
export const ATTACHMENT_NAME_HEADER = 'X-Attachment-Name';

export const activityPaths = {
  activity: (ticketId: string) => `${API_BASE}/tickets/${enc(ticketId)}/activity`,
  attachments: (ticketId: string) => `${API_BASE}/tickets/${enc(ticketId)}/attachments`,
  attachment: (id: string) => `${API_BASE}/attachments/${enc(id)}`,
} as const;

export const activitySchemas = {
  activity: TicketActivityDtoSchema,
  attachments: AttachmentDtoSchema.array(),
  attachment: AttachmentDtoSchema,
} as const;

/**
 * Uploads one file to the ticket (or to an existing comment with `commentId`). The caller checks
 * the size, type and name first (`features/attachments/limits.ts`); the server checks them again.
 */
export async function uploadAttachment(
  client: ApiClient,
  ticketId: string,
  file: { data: Blob; name: string; mimeType: string },
  commentId?: string,
) {
  const path = withQuery(activityPaths.attachments(ticketId), { commentId });
  const send = async (fresh: boolean) =>
    client.postRaw(path, file.data, file.mimeType, activitySchemas.attachment, {
      [CSRF_HEADER]: await csrfToken(client, fresh),
      [ATTACHMENT_NAME_HEADER]: encodeURIComponent(file.name),
    });
  try {
    return await send(false);
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'http' && e.status === 403) return send(true);
    throw e;
  }
}

/** Removes an attachment the owner added (the file and its row). */
export function deleteAttachment(client: ApiClient, attachmentId: string) {
  return controlDelete(client, activityPaths.attachment(attachmentId));
}

// --- The harness in the workflow (v0.3.0 H-D, ADR-0027) ----------------------------------------
//
// Served by H-B: GET /api/projects/:id/harness/setup-runs → SetupRunDto[], the latest setup runs
// on the main branch ("Run setup and checks now"), oldest first; a server from before it answers
// 404, read as none (`isSetupRunsUnavailable`). "Run setup and checks now" is the same POST
// …/harness/checks as before (`runHarnessChecks`); the switch "Setup may use the network" is the
// setup PUT's `setupNetwork` (`updateProjectSetup`). Both paths are under …/harness and …/setup,
// so `isProjectSetupPath` refetches them.

export const harnessSetupPaths = {
  setupRuns: (projectId: string) => `${API_BASE}/projects/${enc(projectId)}/harness/setup-runs`,
} as const;

export const harnessSetupSchemas = {
  setupRuns: SetupRunDtoSchema.array(),
} as const;

/** A 404: the server has no setup runs route (before ADR-0027), so there are none to show. */
export function isSetupRunsUnavailable(error: ApiError | null): boolean {
  return error !== null && error.kind === 'http' && error.status === 404;
}
