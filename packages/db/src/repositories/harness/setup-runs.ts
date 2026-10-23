import { MAX_CHECK_OUTPUT_BYTES, SetupRunSchema, redact, type SetupRun } from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import {
  pageLimit,
  parseInput,
  parseStored,
  requireNonEmpty,
  toStoredTimestamp,
} from '../../internal/validate.js';
import { guardWrite, textParser } from '../orchestration/shared.js';

/** A setup step's run to store (ADR-0027 §1); the repository assigns the id. */
export type SetupRunInsertInput = Omit<SetupRun, 'id'>;

export interface SetupRunListOptions {
  /** 1..MAX_PAGE_SIZE; default 50. */
  limit?: number;
}

export interface SetupRunsRepository {
  /**
   * Stores one step's run. The output tail is `redact()`ed again and cut to its last
   * MAX_CHECK_OUTPUT_BYTES characters, as for checks. `not_found` for an unknown project, run, or
   * an agent that is not in the run; `invalid_input` when the run belongs to another project.
   */
  insert(input: SetupRunInsertInput): SetupRun;
  getById(id: string): SetupRun | undefined;
  /** Every setup run of the orchestration run (worktrees and check checkouts), oldest first. */
  listForRun(runId: string): SetupRun[];
  /** One editing agent's setup runs, oldest first. */
  listForAgentRun(agentRunId: string): SetupRun[];
  /** Setup runs before "Run checks now" on the main branch (`runId` null), newest first. */
  listForProjectMain(projectId: string, options?: SetupRunListOptions): SetupRun[];
}

interface SetupRunDbRow {
  id: string;
  project_id: string;
  run_id: string | null;
  agent_run_id: string | null;
  step_id: string;
  name: string;
  status: string;
  exit_code: number | null;
  duration_ms: number;
  output_tail: string;
  started_at: string;
  commit_sha: string | null;
}

const T = 'setup_runs';
const COLUMNS = `id, project_id, run_id, agent_run_id, step_id, name, status, exit_code, duration_ms,
  output_tail, started_at, commit_sha`;
/** Any length on the way in: the repository keeps only the tail. */
const AnyText = textParser(0, Number.MAX_SAFE_INTEGER);

function toSetupRun(row: SetupRunDbRow): SetupRun {
  return parseStored(
    SetupRunSchema,
    {
      id: row.id,
      projectId: row.project_id,
      runId: row.run_id,
      agentRunId: row.agent_run_id,
      stepId: row.step_id,
      name: row.name,
      status: row.status,
      exitCode: row.exit_code,
      durationMs: row.duration_ms,
      outputTail: row.output_tail,
      startedAt: row.started_at,
      commit: row.commit_sha,
    },
    T,
    '*',
  );
}

/** The last `MAX_CHECK_OUTPUT_BYTES` characters, without a broken surrogate pair at the start. */
function tailOf(text: string): string {
  if (text.length <= MAX_CHECK_OUTPUT_BYTES) return text;
  const tail = text.slice(-MAX_CHECK_OUTPUT_BYTES);
  const first = tail.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
}

export function createSetupRunsRepository(ctx: RepositoryContext): SetupRunsRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  );
  const runProject = c.prepare('SELECT project_id FROM orchestration_runs WHERE id = ?').pluck();
  const byId = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`);
  const forRun = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE run_id = ? ORDER BY started_at, rowid`,
  );
  const forAgent = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE agent_run_id = ? ORDER BY started_at, rowid`,
  );
  const forMain = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE project_id = ? AND run_id IS NULL
     ORDER BY started_at DESC, rowid DESC LIMIT ?`,
  );

  return {
    insert(input) {
      // Defense in depth: the runner already redacts; a stray secret must not reach the DB.
      const outputTail = tailOf(redact(parseInput(AnyText, input.outputTail, 'setup outputTail')));
      const valid = parseInput(
        SetupRunSchema.omit({ id: true }),
        { ...input, outputTail },
        'setup run',
      );
      if (valid.agentRunId !== null && valid.runId === null) {
        throw new DbError('invalid_input', "an agent's setup run needs its runId");
      }
      if (valid.runId !== null) {
        const project = runProject.get(valid.runId) as string | undefined;
        if (project === undefined) throw new DbError('not_found', 'orchestration run not found');
        if (project !== valid.projectId) {
          throw new DbError('invalid_input', 'setup run project is not the run project');
        }
      }
      return guardWrite('setup run', () =>
        toSetupRun(
          insert.get(
            ctx.newId(),
            valid.projectId,
            valid.runId,
            valid.agentRunId,
            valid.stepId,
            valid.name,
            valid.status,
            valid.exitCode,
            valid.durationMs,
            valid.outputTail,
            toStoredTimestamp(valid.startedAt, 'setup startedAt'),
            valid.commit,
          ) as SetupRunDbRow,
        ),
      );
    },
    getById(id) {
      const row = byId.get(id) as SetupRunDbRow | undefined;
      return row && toSetupRun(row);
    },
    listForRun(runId) {
      return (forRun.all(requireNonEmpty(runId, 'runId')) as SetupRunDbRow[]).map(toSetupRun);
    },
    listForAgentRun(agentRunId) {
      return (forAgent.all(requireNonEmpty(agentRunId, 'agentRunId')) as SetupRunDbRow[]).map(
        toSetupRun,
      );
    },
    listForProjectMain(projectId, options = {}) {
      return (forMain.all(projectId, pageLimit(options.limit)) as SetupRunDbRow[]).map(toSetupRun);
    },
  };
}
