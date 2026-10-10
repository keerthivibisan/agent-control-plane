import {
  CandidateRootDtoSchema,
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
  post<T>(path: string, body: unknown, schema: Schema<T>, signal?: AbortSignal): Promise<T>;
}

/** Typed fetch client: every response body is parsed with its DTO schema before the UI sees it. */
export function createApiClient(fetchImpl: FetchLike = (i, init) => fetch(i, init)): ApiClient {
  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: Schema<T>,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    let res: Response;
    try {
      const init: RequestInit = {
        method,
        headers:
          body === undefined
            ? { accept: 'application/json' }
            : { accept: 'application/json', 'content-type': 'application/json' },
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
    post: (path, body, schema, signal) => request('POST', path, schema, body, signal),
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

export function registerProject(client: ApiClient, input: RegisterProjectInput) {
  return client.post(paths.projects(), input, ProjectDtoSchema);
}
