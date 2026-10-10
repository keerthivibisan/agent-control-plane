import type { AcpDatabase } from '../database.js';
import { createContext, type RepositoryOptions } from '../internal/context.js';
import { createCheckpointsRepository, type CheckpointsRepository } from './checkpoints.js';
import { createEdgesRepository, type EdgesRepository } from './edges.js';
import { createEventsRepository, type EventsRepository } from './events.js';
import { createProjectsRepository, type ProjectsRepository } from './projects.js';
import { createSessionsRepository, type SessionsRepository } from './sessions.js';
import { createSnapshotsRepository, type SnapshotsRepository } from './snapshots.js';
import { createUsageRepository, type UsageRepository } from './usage.js';

export interface Repositories {
  projects: ProjectsRepository;
  sessions: SessionsRepository;
  edges: EdgesRepository;
  events: EventsRepository;
  usage: UsageRepository;
  snapshots: SnapshotsRepository;
  checkpoints: CheckpointsRepository;
}

/**
 * Builds every repository over one connection, with statements prepared once. Repositories do not
 * open transactions of their own (except where a single call must be atomic); wrap multi-step
 * writes in `withTransaction`.
 */
export function createRepositories(db: AcpDatabase, options: RepositoryOptions = {}): Repositories {
  const ctx = createContext(db, options);
  return {
    projects: createProjectsRepository(ctx),
    sessions: createSessionsRepository(ctx),
    edges: createEdgesRepository(ctx),
    events: createEventsRepository(ctx),
    usage: createUsageRepository(ctx),
    snapshots: createSnapshotsRepository(ctx),
    checkpoints: createCheckpointsRepository(ctx),
  };
}

export type { RepositoryOptions } from '../internal/context.js';
export type { CheckpointsRepository, StoredCheckpoint } from './checkpoints.js';
export type {
  EdgeConflictRow,
  EdgeProvenance,
  EdgeRow,
  EdgesRepository,
  EdgeUpsertInput,
  EdgeUpsertOutcome,
  EdgeUpsertResult,
} from './edges.js';
export type {
  EventInsertInput,
  EventInsertResult,
  EventPage,
  EventsRepository,
  ToolCallRow,
  RecentEventsQuery,
  StoredEvent,
} from './events.js';
export type { ProjectsRepository } from './projects.js';
export {
  SESSION_ORIGINS,
  sessionKeyOf,
  type JsonValue,
  type SessionMetadata,
  type SessionOrigin,
  type SessionRow,
  type SessionsRepository,
  type SessionUpsertInput,
  type SessionUpsertResult,
} from './sessions.js';
export type { SnapshotsRepository, UsageSnapshotInput, UsageSnapshotRow } from './snapshots.js';
export type {
  UsageObservationInput,
  UsageObservationRow,
  UsageRecordInput,
  UsageRecordRow,
  UsageRepository,
} from './usage.js';
