import {
  buildCodeMapGraph,
  codeMapFileDetail,
  CodeMapCommitSchema,
  CODE_MAP_INDEXER_VERSION,
  searchCodeMap,
  summarizeCodeMap,
  type CodeMapErrorCode,
  type CodeMapFile,
  type CodeMapManifest,
  type Project,
} from '@acp/core';
import {
  CodeMapFileQuerySchema,
  CodeMapGraphQuerySchema,
  CodeMapSearchQuerySchema,
  type CodeMapFileDto,
  type CodeMapGraphDto,
  type CodeMapSearchDto,
  type CodeMapSummaryDto,
} from '@acp/core/api';
import { toCodeMapManifest, type CodeMapManifestRecord, type CodeMapRepository } from '@acp/db';
import type { z } from 'zod';
import { badRequest, HttpError, notFound } from '../errors.js';
import { errorFields, type Logger } from '../logger.js';
import type { GitRunner } from '../workspace/git.js';
import { GitCommandError } from '../workspace/errors.js';
import { CodeMapBuildError } from './errors.js';
import { createCodeMapIndexer, type CodeMapIndexOutcome } from './indexer.js';
import type { SourceParser } from './ts-parser.js';

/**
 * The project code map service (ADR-0034, CM-1): builds maps in the background on the owner's
 * refresh, on demand for a ticket run's base commit (`ensureForCommit`, wired by CM-2), and answers
 * the summary, graph, file and search queries from the stored map. One build per project at a
 * time; a request for a commit already being built waits for that build.
 */

export interface CodeMapServiceDeps {
  repo: CodeMapRepository;
  projectOf: (projectId: string) => Project | undefined;
  git: GitRunner;
  logger: Logger;
  now: () => Date;
  parse?: SourceParser;
  /** Test hook for the file cap. */
  maxFiles?: number;
}

export interface CodeMapService {
  /** 404 for an unknown project; status `none` when never built. */
  summary(projectId: string): CodeMapSummaryDto;
  /**
   * Starts a build of the project checkout's HEAD in the background and returns the summary
   * (`building`). 404 unknown project; 409 when the folder has no git commit to map.
   */
  refresh(projectId: string): Promise<CodeMapSummaryDto>;
  /**
   * The map of `commit` (a full commit id), building it first when needed; resolves once it is
   * stored. Throws `CodeMapBuildError` when the build fails (the failure is recorded).
   */
  ensureForCommit(projectId: string, commit: string): Promise<CodeMapManifest>;
  /**
   * CM-2: the ready map of exactly `commit` with its files, for agents (the repository map and the
   * `code_map` tool); undefined while it is not built, failed or unknown. Never builds.
   */
  mapAt(
    projectId: string,
    commit: string,
  ): { manifest: CodeMapManifest; files: readonly CodeMapFile[] } | undefined;
  graph(projectId: string, query: unknown): CodeMapGraphDto;
  file(projectId: string, query: unknown): CodeMapFileDto;
  search(projectId: string, query: unknown): CodeMapSearchDto;
  /** Resolves when no build is running or queued (tests, shutdown). */
  idle(): Promise<void>;
}

/** Files of the most recently read manifests, so queries do not re-read 20 000 rows each time. */
const FILE_CACHE_SIZE = 3;

function parseQuery<S extends z.ZodType>(schema: S, query: unknown): z.infer<S> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(
      `${issue?.path.join('.') || 'query'}: ${issue?.message ?? 'invalid query'}`,
      'invalid_query',
    );
  }
  return parsed.data;
}

function errorCodeOf(error: unknown): CodeMapErrorCode {
  if (error instanceof CodeMapBuildError) return error.code;
  if (error instanceof GitCommandError) return 'git_failed';
  return 'index_failed';
}

export function createCodeMapService(deps: CodeMapServiceDeps): CodeMapService {
  const indexer = createCodeMapIndexer({
    git: deps.git,
    repo: deps.repo,
    logger: deps.logger,
    now: deps.now,
    ...(deps.parse !== undefined && { parse: deps.parse }),
    ...(deps.maxFiles !== undefined && { maxFiles: deps.maxFiles }),
  });
  /** The tail of each project's build queue. */
  const queues = new Map<string, Promise<unknown>>();
  /** Builds queued or running, by `projectId\0commit`, so the same commit is built once. */
  const pending = new Map<string, Promise<CodeMapIndexOutcome>>();
  const active = new Map<string, number>();
  const background = new Set<Promise<unknown>>();
  const fileCache = new Map<string, CodeMapFile[]>();

  function projectOrThrow(projectId: string): Project {
    const project = deps.projectOf(projectId);
    if (project === undefined) throw notFound(`Project ${projectId} not found`);
    return project;
  }

  async function runBuild(project: Project, commit: string): Promise<CodeMapIndexOutcome> {
    try {
      return await indexer.indexCommit({ id: project.id, rootPath: project.rootPath }, commit);
    } catch (error) {
      const code = errorCodeOf(error);
      deps.logger.log('warn', 'code map build failed', { code, ...errorFields(error) });
      if (CodeMapCommitSchema.safeParse(commit).success) {
        try {
          deps.repo.recordFailure({
            projectId: project.id,
            commit,
            builtAt: deps.now().toISOString(),
            indexerVersion: CODE_MAP_INDEXER_VERSION,
            error: code,
          });
        } catch (recordError) {
          deps.logger.log('warn', 'code map failure not recorded', errorFields(recordError));
        }
      }
      throw new CodeMapBuildError(code);
    }
  }

  function build(project: Project, commit: string): Promise<CodeMapIndexOutcome> {
    const key = `${project.id}\0${commit}`;
    const existing = pending.get(key);
    if (existing !== undefined) return existing;
    active.set(project.id, (active.get(project.id) ?? 0) + 1);
    const previous = queues.get(project.id) ?? Promise.resolve();
    const promise = previous.then(() => runBuild(project, commit));
    const settled = promise.then(
      () => undefined,
      () => undefined,
    );
    queues.set(project.id, settled);
    pending.set(key, promise);
    void settled.then(() => {
      pending.delete(key);
      const left = (active.get(project.id) ?? 1) - 1;
      if (left <= 0) active.delete(project.id);
      else active.set(project.id, left);
      if (queues.get(project.id) === settled) queues.delete(project.id);
    });
    return promise;
  }

  async function headOf(project: Project): Promise<string> {
    let head: string;
    try {
      head = (
        await deps.git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
          cwd: project.rootPath,
        })
      ).stdout.trim();
    } catch {
      throw new HttpError(409, 'no_commits', 'The project folder has no git commit to map');
    }
    if (!CodeMapCommitSchema.safeParse(head).success) {
      throw new HttpError(409, 'no_commits', 'The project folder has no git commit to map');
    }
    return head;
  }

  function summaryOf(projectId: string): CodeMapSummaryDto {
    const ready = deps.repo.latestReady(projectId);
    const newest = deps.repo.latest(projectId);
    const building = (active.get(projectId) ?? 0) > 0;
    const failed = newest?.status === 'failed' ? newest : undefined;
    const files = ready === undefined ? [] : filesOf(ready);
    return {
      status: building
        ? 'building'
        : failed !== undefined
          ? 'failed'
          : ready !== undefined
            ? 'ready'
            : 'none',
      errorCode: !building && failed !== undefined ? failed.error : null,
      failedCommit: !building && failed !== undefined ? failed.commit : null,
      manifest: ready === undefined ? null : toCodeMapManifest(ready),
      ...summarizeCodeMap(files),
    };
  }

  function filesOf(record: CodeMapManifestRecord): CodeMapFile[] {
    const hit = fileCache.get(record.id);
    if (hit !== undefined) {
      // Refresh its place as the most recently used.
      fileCache.delete(record.id);
      fileCache.set(record.id, hit);
      return hit;
    }
    const files = deps.repo.listFiles(record.id);
    fileCache.set(record.id, files);
    while (fileCache.size > FILE_CACHE_SIZE) {
      const oldest = fileCache.keys().next().value;
      if (oldest === undefined) break;
      fileCache.delete(oldest);
    }
    return files;
  }

  /** The ready map of `commit`, or the newest ready map; 404 when there is none. */
  function mapOf(projectId: string, commit: string | undefined): CodeMapManifestRecord {
    projectOrThrow(projectId);
    const record =
      commit === undefined
        ? deps.repo.latestReady(projectId)
        : deps.repo.getManifest(projectId, commit);
    if (record === undefined || record.status !== 'ready') {
      throw new HttpError(
        404,
        'code_map_not_built',
        commit === undefined
          ? 'The project has no code map yet; refresh it first'
          : 'There is no code map for that commit',
      );
    }
    return record;
  }

  return {
    summary(projectId) {
      projectOrThrow(projectId);
      return summaryOf(projectId);
    },
    async refresh(projectId) {
      const project = projectOrThrow(projectId);
      const commit = await headOf(project);
      const job = build(project, commit).catch(() => undefined);
      background.add(job);
      void job.then(() => background.delete(job));
      return summaryOf(projectId);
    },
    async ensureForCommit(projectId, commit) {
      const project = projectOrThrow(projectId);
      if (!CodeMapCommitSchema.safeParse(commit).success) {
        throw badRequest('commit must be a full commit id', 'invalid_commit');
      }
      const outcome = await build(project, commit);
      return toCodeMapManifest(outcome.record);
    },
    mapAt(projectId, commit) {
      if (!CodeMapCommitSchema.safeParse(commit).success) return undefined;
      const record = deps.repo.getManifest(projectId, commit);
      if (record === undefined || record.status !== 'ready') return undefined;
      return { manifest: toCodeMapManifest(record), files: filesOf(record) };
    },
    graph(projectId, query) {
      const q = parseQuery(CodeMapGraphQuerySchema, query);
      const record = mapOf(projectId, q.commit);
      const view = buildCodeMapGraph(filesOf(record), { folder: q.folder, depth: q.depth });
      return { ...view, commit: record.commit, builtAt: record.builtAt };
    },
    file(projectId, query) {
      const q = parseQuery(CodeMapFileQuerySchema, query);
      const record = mapOf(projectId, q.commit);
      const detail = codeMapFileDetail(filesOf(record), q.path);
      if (detail === undefined) {
        throw new HttpError(404, 'code_map_file_not_found', 'No such file in the code map');
      }
      return { ...detail, commit: record.commit };
    },
    search(projectId, query) {
      const q = parseQuery(CodeMapSearchQuerySchema, query);
      const record = mapOf(projectId, q.commit);
      return { ...searchCodeMap(filesOf(record), q.q), commit: record.commit, query: q.q };
    },
    async idle() {
      while (background.size > 0 || pending.size > 0) {
        await Promise.allSettled([...background, ...pending.values()]);
      }
    },
  };
}
