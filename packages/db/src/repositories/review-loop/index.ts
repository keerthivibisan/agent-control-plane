import type { AcpDatabase } from '../../database.js';
import { createContext, type RepositoryOptions } from '../../internal/context.js';
import { createChangeReviewsRepository, type ChangeReviewsRepository } from './change-reviews.js';
import {
  createApprovalRulesRepository,
  createCheckCommitsRepository,
  createWorkspaceChangesRepository,
  type ApprovalRulesRepository,
  type CheckCommitsRepository,
  type WorkspaceChangesRepository,
} from './columns.js';
import {
  createTicketRunOptionsRepository,
  type TicketRunOptionsRepository,
} from './ticket-options.js';
import {
  createTicketBranchesRepository,
  type TicketBranchesRepository,
} from './ticket-branches.js';

/**
 * Review loop and ticket branch persistence (migration 0006, ADR-0021), and a ticket's own run
 * options (migration 0007, RL-H).
 */
export interface ReviewLoopRepositories {
  ticketBranches: TicketBranchesRepository;
  changeReviews: ChangeReviewsRepository;
  /** `managed_workspaces.change_state`, `rework_rounds`, `head_commit`. */
  workspaceChanges: WorkspaceChangesRepository;
  /** `check_runs.commit_sha`. */
  checkCommits: CheckCommitsRepository;
  /** `approvals.allow_rule`. */
  approvalRules: ApprovalRulesRepository;
  /** `tickets.run_options` (migration 0007, RL-H). */
  ticketRunOptions: TicketRunOptionsRepository;
}

export function createReviewLoopRepositories(
  db: AcpDatabase,
  options: RepositoryOptions = {},
): ReviewLoopRepositories {
  const ctx = createContext(db, options);
  return {
    ticketBranches: createTicketBranchesRepository(ctx),
    changeReviews: createChangeReviewsRepository(ctx),
    workspaceChanges: createWorkspaceChangesRepository(ctx),
    checkCommits: createCheckCommitsRepository(ctx),
    approvalRules: createApprovalRulesRepository(ctx),
    ticketRunOptions: createTicketRunOptionsRepository(ctx),
  };
}

export type {
  TicketBranchInsertInput,
  TicketBranchRow,
  TicketBranchesRepository,
} from './ticket-branches.js';
export type {
  ChangeReviewDecisionInput,
  ChangeReviewInsertInput,
  ChangeReviewRow,
  ChangeReviewsRepository,
} from './change-reviews.js';
export type {
  ApprovalRulesRepository,
  CheckCommitsRepository,
  WorkspaceChange,
  WorkspaceChangeUpdate,
  WorkspaceChangesRepository,
} from './columns.js';
export type { TicketRunOptionsRepository } from './ticket-options.js';
