import type { ObservationAdapter, SessionStatusThresholds } from '@acp/core';
import type { StreamNoticeDto } from '@acp/core/api';
import type { AcpDatabase, Queries, Repositories } from '@acp/db';
import { createProjectsService, type ProjectsService } from './projects.js';
import { createSessionsService, type SessionsService } from './sessions.js';
import {
  createSystemService,
  type HookState,
  type IngestionStats,
  type SystemService,
} from './system.js';
import { createUsageService, type UsageService } from './usage.js';

export interface Services {
  sessions: SessionsService;
  projects: ProjectsService;
  usage: UsageService;
  system: SystemService;
}

export interface ServicesDeps {
  db: AcpDatabase;
  repos: Repositories;
  queries: Queries;
  adapters: readonly ObservationAdapter[];
  now: () => Date;
  thresholds: SessionStatusThresholds;
  mode: 'live' | 'demo';
  version: string;
  hookReceiverUrl: string;
  hookState: HookState;
  claudeDir: string;
  ingestionStats: () => IngestionStats;
  normalizeRoot: (rootPath: string) => Promise<string>;
  publish: (notice: StreamNoticeDto) => void;
  requestPoll: () => void;
}

export function createServices(deps: ServicesDeps): Services {
  const { db, repos, queries } = deps;
  const sessions = createSessionsService({
    repos,
    queries,
    now: deps.now,
    thresholds: deps.thresholds,
  });
  return {
    sessions,
    usage: createUsageService({ repos, queries }),
    projects: createProjectsService({
      db,
      repos,
      queries,
      sessions,
      normalizeRoot: deps.normalizeRoot,
      publish: deps.publish,
      requestPoll: deps.requestPoll,
    }),
    system: createSystemService({
      adapters: deps.adapters,
      repos,
      queries,
      sessions,
      mode: deps.mode,
      version: deps.version,
      hookReceiverUrl: deps.hookReceiverUrl,
      hookState: deps.hookState,
      claudeDir: deps.claudeDir,
      ingestionStats: deps.ingestionStats,
    }),
  };
}

export type { HookState, IngestionStats };
