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
  createTicketBranchPrefsRepository,
  type TicketBranchPrefsRepository,
} from './ticket-branch-prefs.js';
import {
  createTicketBranchesRepository,
  type TicketBranchesRepository,
} from './ticket-branches.js';

/**
 * Review loop and ticket branch persistence (migration 0006, ADR-0021), a ticket's own run
 * options (migration 0007, RL-H), and its own branch settings and the ticket branch's pull request
 * (migration 0008, ADR-0025).
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
  /** `tickets.branch_prefs` (migration 0008, ADR-0025). */
  ticketBranchPrefs: TicketBranchPrefsRepository;
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
    ticketBranchPrefs: createTicketBranchPrefsRepository(ctx),
  };
}

export type {
  TicketBranchInsertInput,
  TicketBranchPullRequest,
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
export type { TicketBranchPrefsRepository } from './ticket-branch-prefs.js';
