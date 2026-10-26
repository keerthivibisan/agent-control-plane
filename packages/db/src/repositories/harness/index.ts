import type { AcpDatabase } from '../../database.js';
import { createContext, type RepositoryOptions } from '../../internal/context.js';
import { createSetupRunsRepository, type SetupRunsRepository } from './setup-runs.js';

/**
 * The harness in the workflow (migration 0010, ADR-0027): setup runs. Where each check ran
 * (`check_runs.place`, `block_node_id`) is read and written by the check runs repository.
 */
export interface HarnessRepositories {
  setupRuns: SetupRunsRepository;
}

export function createHarnessRepositories(
  db: AcpDatabase,
  options: RepositoryOptions = {},
): HarnessRepositories {
  const ctx = createContext(db, options);
  return { setupRuns: createSetupRunsRepository(ctx) };
}

export type {
  SetupRunInsertInput,
  SetupRunListOptions,
  SetupRunsRepository,
} from './setup-runs.js';
