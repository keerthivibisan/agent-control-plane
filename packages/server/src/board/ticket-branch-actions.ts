import type { BranchStrategy } from '@acp/core';
import { MergePullRequestRequestSchema, type TicketBranchDto } from '@acp/core/api';
import type { TicketBranchRow } from '@acp/db';
import { checkTicketBranchAction, type RunState } from '@acp/orchestrator';
import {
  CodeHostError,
  codeHostHttpError,
  type CodeHostService,
  type OriginRead,
  type TicketBranchPresence,
  withPresence,
} from '../code-host/index.js';
import { refusalError } from '../control/errors.js';
import { toTicketBranchDto } from '../control/review-loop-dto.js';
import { HttpError } from '../errors.js';
import type { Logger } from '../logger.js';

/**
 * The owner's last two steps on a ticket branch (ADR-0025 §9, G-G), behind the board's routes:
 *
 * - **Merge pull request** (`POST /api/tickets/:id/branch/pull-request/merge`): `gh pr merge` on
 *   GitHub with the owner's method, then the pull request is read again as Refresh does (the
 *   ticket becomes Done when GitHub reports it merged). With "Delete branch", GitHub deletes the
 *   head branch and the app deletes the local ticket branch, unless the checkout is on it.
 * - **Delete branch** (`POST /api/tickets/:id/branch/delete`): once the branch is merged (here or
 *   on GitHub) or discarded, on origin and in the project.
 *
 * Both answer the ticket branch with `localExists` and the pull request's `headOnOrigin`, which
 * the app does not store: they are read from git when asked.
 */

export type TicketBranchCodeHost = Pick<
  CodeHostService,
  'mergePullRequest' | 'ticketBranchPresence' | 'deleteTicketBranch' | 'deleteLocalBranch'
>;

export interface TicketBranchActionsDeps {
  /** Reads the pull request again (the control service's Refresh). */
  refreshPullRequest: (runId: string) => Promise<TicketBranchDto>;
  /** The run's live state, when it is loaded (to refuse a merge the run is not waiting for). */
  peek: (runId: string) => RunState | undefined;
  branchOf: (runId: string) => TicketBranchRow | undefined;
  logger: Logger;
}

export interface TicketBranchContext {
  runId: string;
  projectRoot: string;
  /** The project's strategy, when it has one: its base and default target are never deleted. */
  strategy: BranchStrategy | undefined;
}

export function createTicketBranchActions(deps: TicketBranchActionsDeps) {
  const { logger } = deps;

  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof CodeHostError) throw codeHostHttpError(error);
      throw error;
    }
  }

  /** Presence is extra information: a failure to read it leaves the DTO as it was. */
  async function presenceOf(
    host: Pick<TicketBranchCodeHost, 'ticketBranchPresence'>,
    projectRoot: string,
    branch: string,
    read: OriginRead,
  ): Promise<TicketBranchPresence | null> {
    try {
      return await host.ticketBranchPresence(projectRoot, branch, read);
    } catch (error) {
      logger.log('info', 'ticket branch presence unread', {
        code: error instanceof CodeHostError ? error.code : 'error',
      });
      return null;
    }
  }

  return {
    /** Adds what git says now (local refs only, no network) to a ticket branch DTO. */
    async present(
      host: Pick<TicketBranchCodeHost, 'ticketBranchPresence'>,
      projectRoot: string,
      dto: TicketBranchDto,
    ): Promise<TicketBranchDto> {
      return withPresence(dto, await presenceOf(host, projectRoot, dto.branch, 'tracking'));
    },

    async merge(
      host: TicketBranchCodeHost,
      ctx: TicketBranchContext,
      body: unknown,
    ): Promise<TicketBranchDto> {
      const input = MergePullRequestRequestSchema.parse(body);
      const row = deps.branchOf(ctx.runId);
      const pr = row?.pullRequest ?? null;
      if (row === undefined || pr === null || pr.state !== 'open') {
        throw new HttpError(
          409,
          'no_open_pull_request',
          'This ticket has no open pull request to merge. Press Refresh to see its state.',
        );
      }
      // As for Push & open PR: only while the run waits for the owner's merge, so the ticket
      // becomes Done once GitHub reports it merged.
      const state = deps.peek(ctx.runId);
      const check = state === undefined ? null : checkTicketBranchAction(state, 'merge');
      if (check !== null) throw refusalError(check);
      // GitHub would merge the tip it has: commits not pushed yet would be left out.
      if (pr.pushedCommit !== null && pr.pushedCommit !== row.headCommit) {
        throw new HttpError(
          409,
          'unpushed_commits',
          `${row.branch} has commits pull request #${pr.number} does not have yet. Push new commits first, then merge.`,
        );
      }
      await call(() =>
        host.mergePullRequest(ctx.projectRoot, {
          number: pr.number,
          method: input.method,
          deleteBranch: input.deleteBranch,
        }),
      );
      let dto: TicketBranchDto;
      try {
        dto = await deps.refreshPullRequest(ctx.runId);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        throw new HttpError(
          error.status,
          error.code,
          `GitHub merged pull request #${pr.number}, but reading it back did not work. Press Refresh. ${error.message}`,
        );
      }
      let local: string | null = null;
      if (input.deleteBranch && dto.pullRequest?.state === 'merged') {
        local = await host.deleteLocalBranch(ctx.projectRoot, row.branch).catch(() => 'failed');
      }
      logger.log('info', 'pull request merged from the app', {
        runId: ctx.runId,
        number: pr.number,
        method: input.method,
        deleteBranch: input.deleteBranch,
        local,
        state: dto.pullRequest?.state ?? null,
      });
      // GitHub deleted the head branch (or not): ask origin, since the tracking ref is stale now.
      const read: OriginRead = input.deleteBranch ? 'remote' : 'tracking';
      return withPresence(dto, await presenceOf(host, ctx.projectRoot, row.branch, read));
    },

    async remove(
      host: TicketBranchCodeHost,
      ctx: TicketBranchContext,
      body: unknown,
    ): Promise<TicketBranchDto> {
      if (
        body !== undefined &&
        body !== null &&
        (typeof body !== 'object' || Array.isArray(body))
      ) {
        throw new HttpError(400, 'invalid_request', 'The body must be an empty object');
      }
      const row = deps.branchOf(ctx.runId);
      if (row === undefined) {
        throw new HttpError(409, 'no_ticket_branch', 'This run has no ticket branch');
      }
      const finished =
        row.state === 'merged' || row.state === 'discarded' || row.pullRequest?.state === 'merged';
      if (!finished) {
        throw new HttpError(
          409,
          'branch_not_finished',
          `${row.branch} is not merged or discarded yet, so the app will not delete it.`,
        );
      }
      const protect = [
        row.baseBranch,
        ...(ctx.strategy === undefined
          ? []
          : [ctx.strategy.baseBranch, ctx.strategy.defaultTargetBranch]),
      ];
      const presence = await call(() =>
        host.deleteTicketBranch(ctx.projectRoot, row.branch, protect),
      );
      logger.log('info', 'ticket branch deleted from the app', { runId: ctx.runId });
      return withPresence(toTicketBranchDto(deps.branchOf(ctx.runId) ?? row), presence);
    },
  };
}

export type TicketBranchActions = ReturnType<typeof createTicketBranchActions>;
