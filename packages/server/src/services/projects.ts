import { RegisterProjectInputSchema, findOwningRoot, type Project } from '@acp/core';
import type { Page } from './mappers.js';
import {
  UpdateProjectInputSchema,
  type ProjectDto,
  type SessionSummaryDto,
  type StreamNoticeDto,
} from '@acp/core/api';
import {
  DbError,
  withTransaction,
  type AcpDatabase,
  type Queries,
  type Repositories,
} from '@acp/db';
import { HttpError, badRequest, notFound } from '../errors.js';
import type { SessionsService } from './sessions.js';

export interface ProjectsService {
  list(): ProjectDto[];
  get(id: string): ProjectDto;
  register(input: unknown): Promise<ProjectDto>;
  update(id: string, input: unknown): Promise<ProjectDto>;
  sessions(id: string, cursor: string | undefined, limit?: number): Page<SessionSummaryDto>;
}

export interface ProjectsServiceDeps {
  db: AcpDatabase;
  repos: Repositories;
  queries: Queries;
  sessions: SessionsService;
  /**
   * Turns a user-supplied root into the canonical path to store (live: realpath of an existing
   * directory). Throws `HttpError` 400 when the path is unusable.
   */
  normalizeRoot: (rootPath: string) => Promise<string>;
  publish: (notice: StreamNoticeDto) => void;
  /** Requests an immediate ingestion poll; failures are the scheduler's to count. */
  requestPoll: () => void;
}

export function createProjectsService(deps: ProjectsServiceDeps): ProjectsService {
  const { repos, queries } = deps;

  function toDto(project: Project, stats: ReturnType<Queries['projectStats']>): ProjectDto {
    const s = stats.get(project.id);
    return { ...project, sessionCount: s?.sessionCount ?? 0, lastEventAt: s?.lastEventAt ?? null };
  }

  function get(id: string): ProjectDto {
    const project = repos.projects.getById(id);
    if (project === undefined) throw notFound(`Project ${id} not found`);
    return toDto(project, queries.projectStats());
  }

  /** Assigns unassigned sessions to the root that owns them; call inside a transaction. */
  function reassignUnassigned(): string[] {
    const roots = repos.projects.list();
    const reassigned: string[] = [];
    for (const session of repos.sessions.listUnassigned()) {
      if (session.launchCwd === null) continue;
      const owner = findOwningRoot(roots, session.launchCwd);
      if (owner !== null && repos.sessions.setProject(session.id, owner.id)) {
        reassigned.push(session.id);
      }
    }
    // Subagents whose own cwd is outside every root follow their parent session's project.
    for (const session of repos.sessions.listUnassigned()) {
      if (session.providerAgentId === null) continue;
      const parent = repos.sessions.getByKey({
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        providerAgentId: null,
      });
      if (
        parent !== undefined &&
        parent.projectId !== null &&
        repos.sessions.setProject(session.id, parent.projectId)
      ) {
        reassigned.push(session.id);
      }
    }
    return reassigned;
  }

  return {
    list() {
      const stats = queries.projectStats();
      return repos.projects.list().map((p) => toDto(p, stats));
    },

    get,

    async register(raw) {
      const parsed = RegisterProjectInputSchema.safeParse(raw);
      if (!parsed.success) {
        throw badRequest(
          parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
          'invalid_request',
        );
      }
      const rootPath = await deps.normalizeRoot(parsed.data.rootPath);
      let result: { id: string; reassigned: string[] };
      try {
        // Registration and re-association are one unit: a half-assigned project would hide sessions.
        result = withTransaction(deps.db, () => {
          const project = repos.projects.insert({ name: parsed.data.name, rootPath });
          const reassigned = reassignUnassigned();
          return { id: project.id, reassigned };
        });
      } catch (error) {
        if (error instanceof DbError && error.code === 'conflict') {
          throw new HttpError(409, 'conflict', 'A project with this root is already registered');
        }
        throw error;
      }
      deps.publish({
        kind: 'projects-changed',
        lastEventId: repos.events.maxId() ?? 0,
        sessionIds: result.reassigned,
        projectIds: [result.id],
      });
      deps.requestPoll();
      return get(result.id);
    },

    async update(id, raw) {
      const parsed = UpdateProjectInputSchema.safeParse(raw);
      if (!parsed.success) {
        throw badRequest(
          parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
          'invalid_request',
        );
      }
      if (repos.projects.getById(id) === undefined) throw notFound(`Project ${id} not found`);
      const { name, rootPath: requestedRoot } = parsed.data;
      const rootPath =
        requestedRoot === undefined ? undefined : await deps.normalizeRoot(requestedRoot);
      const reassigned: string[] = [];
      try {
        withTransaction(deps.db, () => {
          if (name !== undefined) repos.projects.rename(id, name);
          if (rootPath !== undefined) {
            const other = repos.projects.getByRootPath(rootPath);
            if (other !== undefined && other.id !== id) {
              throw new HttpError(
                409,
                'conflict',
                'A project with this root is already registered',
              );
            }
            repos.projects.setRootPath(id, rootPath);
            reassigned.push(...reassignUnassigned());
          }
        });
      } catch (error) {
        if (error instanceof DbError && error.code === 'conflict') {
          throw new HttpError(409, 'conflict', 'A project with this root is already registered');
        }
        throw error;
      }
      deps.publish({
        kind: 'projects-changed',
        lastEventId: repos.events.maxId() ?? 0,
        sessionIds: reassigned,
        projectIds: [id],
      });
      deps.requestPoll();
      return get(id);
    },

    sessions(id, cursor, limit = 50) {
      if (repos.projects.getById(id) === undefined) throw notFound(`Project ${id} not found`);
      return deps.sessions.list({
        projectId: id,
        limit,
        ...(cursor !== undefined && { cursor }),
      });
    },
  };
}
