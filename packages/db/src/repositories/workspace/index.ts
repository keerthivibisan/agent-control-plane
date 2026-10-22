import type { AcpDatabase } from '../../database.js';
import { createContext, type RepositoryOptions } from '../../internal/context.js';
import { createAttachmentsRepository, type AttachmentsRepository } from './attachments.js';
import { createCheckRunsRepository, type CheckRunsRepository } from './check-runs.js';
import { createTicketCommentsRepository, type TicketCommentsRepository } from './comments.js';
import { createTicketPlansRepository, type TicketPlansRepository } from './plans.js';
import { createProjectSetupRepository, type ProjectSetupRepository } from './project-setup.js';
import { createTicketsRepository, type TicketsRepository } from './tickets.js';

/** Phase 4 Agent Workspace persistence (migration 0003). */
export interface WorkspaceRepositories {
  projectSetup: ProjectSetupRepository;
  tickets: TicketsRepository;
  plans: TicketPlansRepository;
  comments: TicketCommentsRepository;
  checkRuns: CheckRunsRepository;
  /** ADR-0026 (migration 0009): the owner's attachments. */
  attachments: AttachmentsRepository;
}

/**
 * Builds the workspace repositories over one connection. Calls that must be atomic (the ticket
 * number, a new plan version superseding the proposed one) open their own transaction; wrap
 * multi-step writes (for example a ticket status change plus its new run) in `withTransaction`.
 */
export function createWorkspaceRepositories(
  db: AcpDatabase,
  options: RepositoryOptions = {},
): WorkspaceRepositories {
  const ctx = createContext(db, options);
  return {
    projectSetup: createProjectSetupRepository(ctx),
    tickets: createTicketsRepository(ctx),
    plans: createTicketPlansRepository(ctx),
    comments: createTicketCommentsRepository(ctx),
    checkRuns: createCheckRunsRepository(ctx),
    attachments: createAttachmentsRepository(ctx),
  };
}

export type { ProjectSetupInput, ProjectSetupRepository } from './project-setup.js';
export type {
  TicketInsertInput,
  TicketListOptions,
  TicketStatusUpdate,
  TicketsRepository,
  TicketUpdate,
} from './tickets.js';
export type { TicketPlanDecision, TicketPlanInsertInput, TicketPlansRepository } from './plans.js';
export type {
  AgentNoteInput,
  StoredTicketComment,
  TicketCommentAuthor,
  TicketCommentInsertInput,
  TicketCommentsRepository,
} from './comments.js';
export type { AttachmentInsertInput, AttachmentsRepository } from './attachments.js';
export type {
  CheckRunInsertInput,
  CheckRunListOptions,
  CheckRunsRepository,
} from './check-runs.js';
