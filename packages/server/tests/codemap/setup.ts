// Synthetic temp repositories only (CM-1): never a real user repository, never ~/.claude.
import { join } from 'node:path';
import express from 'express';
import { afterEach } from 'vitest';
import {
  createCodeMapRepositories,
  createRepositories,
  openDatabase,
  type AcpDatabase,
} from '@acp/db';
import { createCodeMapService, parseScript, type CodeMapService } from '../../src/codemap/index.js';
import { errorHandler, notFoundHandler, requestId } from '../../src/http/middleware.js';
import { silentLogger, type Logger } from '../../src/logger.js';
import { createCodeMapRouter } from '../../src/routes/code-map.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { GIT_TEST_ENV, git, tempDir, write } from '../workspace/helpers.js';

export const CSRF = 'c'.repeat(64);

const dbs: AcpDatabase[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

export interface CodeMapSetup {
  db: AcpDatabase;
  repoDir: string;
  projectId: string;
  service: CodeMapService;
  /** Paths given to the parser, in call order. */
  parsed: string[];
  app: express.Express;
  logs: string[];
  /** Writes (or, with `null`, deletes) files, commits, returns the new HEAD. */
  commit(files: Record<string, string | Buffer | null>, message?: string): string;
}

export function setupCodeMap(
  options: { maxFiles?: number; logger?: Logger; onParse?: (path: string) => void } = {},
): CodeMapSetup {
  const db = openDatabase(join(tempDir('acp-cm-db-'), 'cm.sqlite'));
  dbs.push(db);
  const repos = createRepositories(db);
  const repoDir = tempDir('acp-cm-repo-');
  git(repoDir, 'init', '--quiet', '-b', 'main');
  const project = repos.projects.insert({ name: 'web', rootPath: repoDir });
  const parsed: string[] = [];
  const logs: string[] = [];
  let t = Date.parse('2026-11-08T10:00:00.000Z');
  const service = createCodeMapService({
    repo: createCodeMapRepositories(db).codeMap,
    projectOf: (id) => repos.projects.getById(id),
    git: createGitRunner({ env: GIT_TEST_ENV }),
    logger: options.logger ?? {
      log(level, message, fields) {
        logs.push(JSON.stringify({ level, message, ...fields }));
      },
    },
    now: () => new Date((t += 1000)),
    parse: (path, text) => {
      parsed.push(path);
      options.onParse?.(path);
      return parseScript(path, text);
    },
    ...(options.maxFiles !== undefined && { maxFiles: options.maxFiles }),
  });
  const app = express();
  app.use(requestId);
  app.use('/api', createCodeMapRouter(service, CSRF));
  app.use('/api', notFoundHandler);
  app.use(errorHandler(silentLogger));
  return {
    db,
    repoDir,
    projectId: project.id,
    service,
    parsed,
    app,
    logs,
    commit(files, message = 'change') {
      for (const [path, content] of Object.entries(files)) {
        if (content === null) git(repoDir, 'rm', '--quiet', path);
        else write(repoDir, path, content);
      }
      git(repoDir, 'add', '--all');
      git(repoDir, 'commit', '--quiet', '--allow-empty', '-m', message);
      return git(repoDir, 'rev-parse', 'HEAD').trim();
    },
  };
}
