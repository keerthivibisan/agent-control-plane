import type { AcpDatabase } from '../../database.js';
import { createContext, type RepositoryOptions } from '../../internal/context.js';
import { createRunAuditRepository, type RunAuditRepository } from './run-audit.js';
import { createProjectWorkflowRepository, type ProjectWorkflowRepository } from './workflow.js';

/** Project workspace redesign persistence (migration 0004). */
export interface RedesignRepositories {
  workflow: ProjectWorkflowRepository;
  runAudit: RunAuditRepository;
}

export function createRedesignRepositories(
  db: AcpDatabase,
  options: RepositoryOptions = {},
): RedesignRepositories {
  const ctx = createContext(db, options);
  return {
    workflow: createProjectWorkflowRepository(ctx),
    runAudit: createRunAuditRepository(ctx),
  };
}

export type { ProjectWorkflowInput, ProjectWorkflowRepository } from './workflow.js';
export { APPROVAL_DECIDERS, StoredRunLimitsSchema } from './run-audit.js';
export type { ApprovalDecider, RunAuditRepository, StoredRunLimits } from './run-audit.js';
