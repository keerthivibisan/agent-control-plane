import {
  GitCommitSchema,
  TicketBranchNameSchema,
  TicketBranchStateSchema,
  type IsoTimestamp,
  type TicketBranchState,
} from '@acp/core';
import {
  CodeHostProviderSchema,
  PullRequestStateSchema,
  type CodeHostProvider,
  type PullRequestState,
} from '@acp/core/api';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import {
  parseInput,
  parseStored,
  requireNonEmpty,
  storedTimestamp,
  toStoredTimestamp,
  type Parser,
} from '../../internal/validate.js';
import { guardWrite, nullable, textParser } from '../orchestration/shared.js';

/**
 * A run's ticket branch (ADR-0021 §4, migration 0006 `ticket_branches`, rebuilt by 0008 for
 * ADR-0025). The row is the server's record of which ticket branches it made: a branch with no row
 * is never moved, merged or deleted. The tip moves only by compare-and-swap (`advance`), the same
 * rule the git ref follows. Before 0.3.0 the name was always `acp/<KEY>`; now the project's
 * branching strategy or the ticket names it. 0008 adds the pull request raised for it, if any.
 */

export interface TicketBranchInsertInput {
  runId: string;
  /** Must be the run's own project (same-project foreign key). */
  projectId: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  /** Usually `baseCommit`: a new ticket branch starts at the base branch tip. */
  headCommit: string;
}

/** The pull request raised for a ticket branch (ADR-0025 §4; migration 0008 `pr_*`). */
export interface TicketBranchPullRequest {
  provider: CodeHostProvider;
  number: number;
  /** The host's web address of the pull request (`https://…`). */
  url: string;
  state: PullRequestState;
  /** When the app last read the state from the host. */
  checkedAt: IsoTimestamp;
}

export interface TicketBranchRow {
  runId: string;
  projectId: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  headCommit: string;
  state: TicketBranchState;
  mergedCommit: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /** Null until the owner pushes the branch and opens (or links) a pull request. */
  pullRequest: TicketBranchPullRequest | null;
}

export interface TicketBranchesRepository {
  /** `conflict` when the run already has one, or an open branch of that name exists. */
  insert(input: TicketBranchInsertInput): TicketBranchRow;
  getByRun(runId: string): TicketBranchRow | undefined;
  /** The open record of `branch`, if any (one at most: unique index). */
  getOpenByBranch(branch: string): TicketBranchRow | undefined;
  /** Every ticket branch of the project, oldest first. */
  listForProject(projectId: string): TicketBranchRow[];
  /**
   * Compare-and-swap of the recorded tip: only an `open` branch whose tip is `from` moves to `to`.
   * Returns the updated row, or undefined when the tip was not `from` (or the branch is not open).
   */
  advance(runId: string, from: string, to: string): TicketBranchRow | undefined;
  /** The owner merged it; `mergedCommit` is the base branch's commit after the fast-forward. */
  markMerged(runId: string, mergedCommit: string): TicketBranchRow | undefined;
  markDiscarded(runId: string): TicketBranchRow | undefined;
  /**
   * Records the pull request raised for the branch, or its state as the host reports it now
   * (ADR-0025 §4), whatever the branch's state. `checkedAt` defaults to now. Undefined for an
   * unknown run.
   */
  setPullRequest(
    runId: string,
    pullRequest: Omit<TicketBranchPullRequest, 'checkedAt'> & { checkedAt?: string },
  ): TicketBranchRow | undefined;
}

interface TicketBranchDbRow {
  run_id: string;
  project_id: string;
  branch: string;
  base_branch: string;
  base_commit: string;
  head_commit: string;
  state: string;
  merged_commit: string | null;
  created_at: string;
  updated_at: string;
  pr_provider: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: string | null;
  pr_checked_at: string | null;
}

const T = 'ticket_branches';
const COLUMNS = `run_id, project_id, branch, base_branch, base_commit, head_commit, state,
  merged_commit, created_at, updated_at, pr_provider, pr_number, pr_url, pr_state, pr_checked_at`;
const INSERT_COLUMNS = `run_id, project_id, branch, base_branch, base_commit, head_commit, state,
  merged_commit, created_at, updated_at`;
const BaseBranchParser = textParser(1, 255);
const PullRequestNumberParser: Parser<number> = {
  safeParse: (value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? { success: true, data: value }
      : { success: false, error: new Error('not a pull request number') },
};
/** An `https://` address without a user part (`user@`), at most 500 characters. */
const PullRequestUrlParser: Parser<string> = {
  safeParse: (value) => {
    if (typeof value !== 'string' || value.length > 500) {
      return { success: false, error: new Error('not a pull request URL') };
    }
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.username === '' && url.password === '') {
        return { success: true, data: value };
      }
    } catch {
      // Not a URL: refused below.
    }
    return { success: false, error: new Error('not a pull request URL') };
  },
};

function toPullRequest(row: TicketBranchDbRow): TicketBranchPullRequest | null {
  if (row.pr_provider === null) return null;
  return {
    provider: parseStored(CodeHostProviderSchema, row.pr_provider, T, 'pr_provider'),
    number: parseStored(PullRequestNumberParser, row.pr_number, T, 'pr_number'),
    url: parseStored(PullRequestUrlParser, row.pr_url, T, 'pr_url'),
    state: parseStored(PullRequestStateSchema, row.pr_state, T, 'pr_state'),
    checkedAt: storedTimestamp(row.pr_checked_at, T, 'pr_checked_at'),
  };
}

function toRow(row: TicketBranchDbRow): TicketBranchRow {
  return {
    runId: row.run_id,
    projectId: row.project_id,
    branch: parseStored(TicketBranchNameSchema, row.branch, T, 'branch'),
    baseBranch: parseStored(BaseBranchParser, row.base_branch, T, 'base_branch'),
    baseCommit: parseStored(GitCommitSchema, row.base_commit, T, 'base_commit'),
    headCommit: parseStored(GitCommitSchema, row.head_commit, T, 'head_commit'),
    state: parseStored(TicketBranchStateSchema, row.state, T, 'state'),
    mergedCommit: parseStored(nullable(GitCommitSchema), row.merged_commit, T, 'merged_commit'),
    createdAt: storedTimestamp(row.created_at, T, 'created_at'),
    updatedAt: storedTimestamp(row.updated_at, T, 'updated_at'),
    pullRequest: toPullRequest(row),
  };
}

export function createTicketBranchesRepository(ctx: RepositoryContext): TicketBranchesRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO ${T} (${INSERT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?)
     RETURNING ${COLUMNS}`,
  );
  const byRun = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE run_id = ?`);
  const openByBranch = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE branch = ? AND state = 'open'`);
  const forProject = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE project_id = ? ORDER BY created_at, rowid`,
  );
  const advance = c.prepare(
    `UPDATE ${T} SET head_commit = ?, updated_at = ?
     WHERE run_id = ? AND head_commit = ? AND state = 'open' RETURNING ${COLUMNS}`,
  );
  const merged = c.prepare(
    `UPDATE ${T} SET state = 'merged', merged_commit = ?, updated_at = ?
     WHERE run_id = ? AND state = 'open' RETURNING ${COLUMNS}`,
  );
  const discarded = c.prepare(
    `UPDATE ${T} SET state = 'discarded', updated_at = ?
     WHERE run_id = ? AND state = 'open' RETURNING ${COLUMNS}`,
  );

  const pullRequest = c.prepare(
    `UPDATE ${T} SET pr_provider = ?, pr_number = ?, pr_url = ?, pr_state = ?, pr_checked_at = ?,
       updated_at = ?
     WHERE run_id = ? RETURNING ${COLUMNS}`,
  );

  const commit = (value: string, what: string) => parseInput(GitCommitSchema, value, what);

  /** A state change on a branch that is not open is a conflict, a missing one undefined. */
  function changed(runId: string, row: TicketBranchDbRow | undefined, what: string) {
    if (row !== undefined) return toRow(row);
    const existing = byRun.get(runId) as TicketBranchDbRow | undefined;
    if (existing === undefined) return undefined;
    throw new DbError('conflict', `ticket branch is already ${existing.state}; cannot ${what}`);
  }

  return {
    insert(input) {
      const at = ctx.now().toISOString();
      return guardWrite('ticket branch', () =>
        toRow(
          insert.get(
            requireNonEmpty(input.runId, 'ticket branch runId'),
            requireNonEmpty(input.projectId, 'ticket branch projectId'),
            parseInput(TicketBranchNameSchema, input.branch, 'ticket branch name'),
            parseInput(BaseBranchParser, input.baseBranch, 'ticket branch baseBranch'),
            commit(input.baseCommit, 'ticket branch baseCommit'),
            commit(input.headCommit, 'ticket branch headCommit'),
            at,
            at,
          ) as TicketBranchDbRow,
        ),
      );
    },
    getByRun(runId) {
      const row = byRun.get(runId) as TicketBranchDbRow | undefined;
      return row && toRow(row);
    },
    getOpenByBranch(branch) {
      const row = openByBranch.get(branch) as TicketBranchDbRow | undefined;
      return row && toRow(row);
    },
    listForProject(projectId) {
      return (forProject.all(projectId) as TicketBranchDbRow[]).map(toRow);
    },
    advance(runId, from, to) {
      const row = advance.get(
        commit(to, 'ticket branch new tip'),
        ctx.now().toISOString(),
        runId,
        commit(from, 'ticket branch expected tip'),
      ) as TicketBranchDbRow | undefined;
      return row && toRow(row);
    },
    markMerged(runId, mergedCommit) {
      const row = merged.get(
        commit(mergedCommit, 'ticket branch mergedCommit'),
        ctx.now().toISOString(),
        runId,
      ) as TicketBranchDbRow | undefined;
      return changed(runId, row, 'merge it');
    },
    markDiscarded(runId) {
      const row = discarded.get(ctx.now().toISOString(), runId) as TicketBranchDbRow | undefined;
      return changed(runId, row, 'discard it');
    },
    setPullRequest(runId, pr) {
      const at = ctx.now().toISOString();
      const checkedAt =
        pr.checkedAt === undefined ? at : toStoredTimestamp(pr.checkedAt, 'pull request checkedAt');
      const row = guardWrite(
        'ticket branch',
        () =>
          pullRequest.get(
            parseInput(CodeHostProviderSchema, pr.provider, 'pull request provider'),
            parseInput(PullRequestNumberParser, pr.number, 'pull request number'),
            parseInput(PullRequestUrlParser, pr.url, 'pull request url'),
            parseInput(PullRequestStateSchema, pr.state, 'pull request state'),
            checkedAt,
            at,
            requireNonEmpty(runId, 'ticket branch runId'),
          ) as TicketBranchDbRow | undefined,
      );
      return row && toRow(row);
    },
  };
}
