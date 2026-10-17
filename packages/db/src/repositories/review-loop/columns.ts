import {
  AllowRuleSchema,
  ChangeStateSchema,
  CheckRunSchema,
  GitCommitSchema,
  type AllowRule,
  type ChangeState,
  type CheckRun,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStored, requireNonEmpty } from '../../internal/validate.js';
import { guardWrite, nonNegativeInt, nullable } from '../orchestration/shared.js';
import { createCheckRunsRepository } from '../workspace/check-runs.js';

/**
 * The 0006 columns on earlier tables (README §4): a helper's change state, rework rounds and head
 * commit (`managed_workspaces`), the commit a check ran on (`check_runs.commit_sha`), and the rule
 * that let an action run without asking (`approvals.allow_rule`). As with the 0004 columns
 * (`RunAuditRepository`), they live here so the Phase 3 and Phase 4 repositories stay as they
 * shipped and keep working on older schemas; the server writes them in the same transaction as
 * the rows they belong to.
 */

/** A helper's change in the review loop (`managed_workspaces`, migration 0006). */
export interface WorkspaceChange {
  workspaceId: string;
  agentRunId: string;
  /** Null for runs without the review loop (the legacy flow). */
  changeState: ChangeState | null;
  reworkRounds: number;
  /** The sealed (or integrated) commit; null until sealed. */
  headCommit: string | null;
}

/** An absent field is left unchanged. */
export interface WorkspaceChangeUpdate {
  changeState?: ChangeState | null;
  reworkRounds?: number;
  headCommit?: string | null;
}

export interface WorkspaceChangesRepository {
  getByAgentRun(agentRunId: string): WorkspaceChange | undefined;
  /** Every workspace of the run, oldest first. */
  listForRun(runId: string): WorkspaceChange[];
  /** Undefined when the agent has no workspace. */
  set(agentRunId: string, update: WorkspaceChangeUpdate): WorkspaceChange | undefined;
}

interface ChangeDbRow {
  id: string;
  agent_run_id: string;
  change_state: string | null;
  rework_rounds: number;
  head_commit: string | null;
}

const W = 'managed_workspaces';
const CHANGE_COLUMNS = 'id, agent_run_id, change_state, rework_rounds, head_commit';

function toChange(row: ChangeDbRow): WorkspaceChange {
  return {
    workspaceId: row.id,
    agentRunId: row.agent_run_id,
    changeState: parseStored(nullable(ChangeStateSchema), row.change_state, W, 'change_state'),
    reworkRounds: parseStored(nonNegativeInt, row.rework_rounds, W, 'rework_rounds'),
    headCommit: parseStored(nullable(GitCommitSchema), row.head_commit, W, 'head_commit'),
  };
}

export function createWorkspaceChangesRepository(
  ctx: RepositoryContext,
): WorkspaceChangesRepository {
  const c = ctx.connection;
  const byAgent = c.prepare(`SELECT ${CHANGE_COLUMNS} FROM ${W} WHERE agent_run_id = ?`);
  const forRun = c.prepare(
    `SELECT ${CHANGE_COLUMNS} FROM ${W} WHERE run_id = ? ORDER BY created_at, rowid`,
  );
  const set = c.prepare(
    `UPDATE ${W} SET
       change_state = CASE WHEN @setState THEN @changeState ELSE change_state END,
       rework_rounds = CASE WHEN @setRounds THEN @reworkRounds ELSE rework_rounds END,
       head_commit = CASE WHEN @setHead THEN @headCommit ELSE head_commit END,
       updated_at = @at
     WHERE agent_run_id = @agentRunId RETURNING ${CHANGE_COLUMNS}`,
  );

  return {
    getByAgentRun(agentRunId) {
      const row = byAgent.get(agentRunId) as ChangeDbRow | undefined;
      return row && toChange(row);
    },
    listForRun(runId) {
      return (forRun.all(runId) as ChangeDbRow[]).map(toChange);
    },
    set(agentRunId, update) {
      const row = guardWrite(
        'workspace change',
        () =>
          set.get({
            agentRunId: requireNonEmpty(agentRunId, 'agentRunId'),
            at: ctx.now().toISOString(),
            setState: update.changeState === undefined ? 0 : 1,
            changeState:
              update.changeState === undefined
                ? null
                : parseInput(nullable(ChangeStateSchema), update.changeState, 'changeState'),
            setRounds: update.reworkRounds === undefined ? 0 : 1,
            reworkRounds:
              update.reworkRounds === undefined
                ? 0
                : parseInput(nonNegativeInt, update.reworkRounds, 'reworkRounds'),
            setHead: update.headCommit === undefined ? 0 : 1,
            headCommit:
              update.headCommit === undefined
                ? null
                : parseInput(nullable(GitCommitSchema), update.headCommit, 'headCommit'),
          }) as ChangeDbRow | undefined,
      );
      return row && toChange(row);
    },
  };
}

/** The commit each check ran on (`check_runs.commit_sha`, core's `CheckRun.commit`). */
export interface CheckCommitsRepository {
  /**
   * Stores a check result together with its commit (core's `CheckRunInsertInput` with `commit`),
   * in one transaction. `commit` null or absent stores none, like the Phase 4 repository.
   */
  insert(input: Omit<CheckRun, 'id'>): CheckRun;
  /** `not_found` for an unknown check run. */
  set(checkRunId: string, commit: string | null): void;
  /** Every check of the run with its commit, oldest first (`commit` absent when none). */
  listForRun(runId: string): CheckRun[];
  /**
   * The latest result per check id that ran on `commit`, ordered by check id: for one agent's
   * change (`agentRunId`), or for the run's ticket branch tip (`agentRunId` null). Results on any
   * other commit never count: the merge gate looks only at the commit being merged.
   */
  latestForCommit(runId: string, agentRunId: string | null, commit: string): CheckRun[];
}

export function createCheckCommitsRepository(ctx: RepositoryContext): CheckCommitsRepository {
  const c = ctx.connection;
  const checkRuns = createCheckRunsRepository(ctx);
  const set = c.prepare('UPDATE check_runs SET commit_sha = ? WHERE id = ?');
  const commitsForRun = c.prepare('SELECT id, commit_sha FROM check_runs WHERE run_id = ?');
  const latestIds = c
    .prepare(
      `SELECT id FROM (
         SELECT id, check_id, ROW_NUMBER() OVER (
           PARTITION BY check_id ORDER BY started_at DESC, rowid DESC
         ) AS rn
         FROM check_runs WHERE run_id = ? AND agent_run_id IS ? AND commit_sha = ?
       ) WHERE rn = 1 ORDER BY check_id`,
    )
    .pluck();

  function withCommit(run: CheckRun, commit: string | null): CheckRun {
    if (commit === null) return run;
    return parseStored(CheckRunSchema, { ...run, commit }, 'check_runs', 'commit_sha');
  }

  function setCommit(checkRunId: string, commit: string | null): void {
    const value = commit === null ? null : parseInput(GitCommitSchema, commit, 'check commit');
    if (set.run(value, checkRunId).changes === 0) {
      throw new DbError('not_found', 'check run not found');
    }
  }

  return {
    insert(input) {
      const commit = input.commit ?? null;
      if (commit !== null) parseInput(GitCommitSchema, commit, 'check commit');
      return c.transaction((): CheckRun => {
        const { commit: _commit, ...rest } = input;
        const stored = checkRuns.insert(rest);
        if (commit === null) return stored;
        setCommit(stored.id, commit);
        return withCommit(stored, commit);
      })();
    },
    set: setCommit,
    listForRun(runId) {
      const commits = new Map(
        (commitsForRun.all(runId) as { id: string; commit_sha: string | null }[]).map((r) => [
          r.id,
          r.commit_sha,
        ]),
      );
      return checkRuns.listForRun(runId).map((r) => withCommit(r, commits.get(r.id) ?? null));
    },
    latestForCommit(runId, agentRunId, commit) {
      const sha = parseInput(GitCommitSchema, commit, 'commit');
      const ids = latestIds.all(
        requireNonEmpty(runId, 'runId'),
        agentRunId === null ? null : requireNonEmpty(agentRunId, 'agentRunId'),
        sha,
      ) as string[];
      return ids.flatMap((id) => {
        const run = checkRuns.getById(id);
        return run === undefined ? [] : [withCommit(run, sha)];
      });
    },
  };
}

/** Which rule let an action run without asking (`approvals.allow_rule`, ADR-0021 §1). */
export interface ApprovalRulesRepository {
  /** `not_found` for an unknown approval; null clears it. */
  set(approvalId: string, rule: AllowRule | null): void;
  /** Approval id → rule, for every approval of the run (null when none was recorded). */
  forRun(runId: string): Map<string, AllowRule | null>;
}

export function createApprovalRulesRepository(ctx: RepositoryContext): ApprovalRulesRepository {
  const c = ctx.connection;
  const set = c.prepare('UPDATE approvals SET allow_rule = ? WHERE id = ?');
  const forRun = c.prepare('SELECT id, allow_rule FROM approvals WHERE run_id = ?');
  const RuleParser = nullable(AllowRuleSchema);
  return {
    set(approvalId, rule) {
      const value = parseInput(RuleParser, rule, 'approval allowRule');
      if (set.run(value, approvalId).changes === 0) {
        throw new DbError('not_found', 'approval not found');
      }
    },
    forRun(runId) {
      const rows = forRun.all(runId) as { id: string; allow_rule: string | null }[];
      return new Map(
        rows.map((r) => [r.id, parseStored(RuleParser, r.allow_rule, 'approvals', 'allow_rule')]),
      );
    },
  };
}
