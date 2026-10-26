import {
  CheckRunPlaceSchema,
  CheckRunSchema,
  CheckRunStatusSchema,
  MAX_CHECK_OUTPUT_BYTES,
  redact,
  type CheckRun,
} from '@acp/core';
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

/** A check result to store; the repository assigns the id. */
export type CheckRunInsertInput = Omit<CheckRun, 'id'>;

export interface CheckRunListOptions {
  /** 1..MAX_PAGE_SIZE; default 50. */
  limit?: number;
}

export interface CheckRunsRepository {
  /**
   * Stores a result. The output tail is `redact()`ed again and cut to its last
   * MAX_CHECK_OUTPUT_BYTES characters. `not_found` for an unknown project, run, or an agent that is
   * not in the run; `invalid_input` when the run belongs to another project.
   */
  insert(input: CheckRunInsertInput): CheckRun;
  getById(id: string): CheckRun | undefined;
  /** Every check of the run (all agents), oldest first. */
  listForRun(runId: string): CheckRun[];
  /** One agent's checks, oldest first. */
  listForAgentRun(agentRunId: string): CheckRun[];
  /** The latest result per check id for one agent (for the merge rule), ordered by check id. */
  latestForAgentRun(agentRunId: string): CheckRun[];
  /** "Run checks now" results on the main branch (`runId` null), newest first. */
  listForProjectMain(projectId: string, options?: CheckRunListOptions): CheckRun[];
}

interface CheckRunDbRow {
  id: string;
  project_id: string;
  run_id: string | null;
  agent_run_id: string | null;
  check_id: string;
  name: string;
  required: number;
  status: string;
  exit_code: number | null;
  duration_ms: number;
  output_tail: string;
  started_at: string;
  /** Migration 0010 (ADR-0027); absent on older schemas. */
  place?: string | null;
  block_node_id?: string | null;
}

const T = 'check_runs';
const BASE_COLUMNS = `id, project_id, run_id, agent_run_id, check_id, name, required, status, exit_code,
  duration_ms, output_tail, started_at`;
/** Any length on the way in: the repository keeps only the tail. */
const AnyText = textParser(0, Number.MAX_SAFE_INTEGER);

function toCheckRun(row: CheckRunDbRow): CheckRun {
  // ADR-0027: where it ran; rows from before migration 0010 have neither field.
  const place =
    row.place === undefined || row.place === null
      ? {}
      : { place: row.place, blockNodeId: row.block_node_id ?? null };
  return parseStored(
    CheckRunSchema,
    {
      id: row.id,
      projectId: row.project_id,
      runId: row.run_id,
      agentRunId: row.agent_run_id,
      checkId: row.check_id,
      name: row.name,
      required: row.required === 1,
      status: row.status,
      exitCode: row.exit_code,
      durationMs: row.duration_ms,
      outputTail: row.output_tail,
      startedAt: row.started_at,
      ...place,
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

export function createCheckRunsRepository(ctx: RepositoryContext): CheckRunsRepository {
  const c = ctx.connection;
  // Migration 0010 (ADR-0027) added `place` and `block_node_id`; this repository still works on
  // older schemas (the upgrade tests store rows before the migration that adds them).
  const hasPlace = (c.pragma(`table_info(${T})`) as { name: string }[]).some(
    (col) => col.name === 'place',
  );
  const COLUMNS = hasPlace ? `${BASE_COLUMNS}, place, block_node_id` : BASE_COLUMNS;
  const insert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${hasPlace ? ', ?, ?' : ''})
     RETURNING ${COLUMNS}`,
  );
  const runProject = c.prepare('SELECT project_id FROM orchestration_runs WHERE id = ?').pluck();
  const byId = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`);
  const forRun = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE run_id = ? ORDER BY started_at, rowid`,
  );
  const forAgent = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE agent_run_id = ? ORDER BY started_at, rowid`,
  );
  const latestForAgent = c.prepare(
    `SELECT ${COLUMNS} FROM (
       SELECT *, ROW_NUMBER() OVER (
         PARTITION BY check_id ORDER BY started_at DESC, rowid DESC
       ) AS rn
       FROM ${T} WHERE agent_run_id = ?
     ) WHERE rn = 1 ORDER BY check_id`,
  );
  const forMain = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE project_id = ? AND run_id IS NULL
     ORDER BY started_at DESC, rowid DESC LIMIT ?`,
  );

  return {
    insert(input) {
      // Defense in depth: the runner already redacts; a stray secret must not reach the DB.
      const outputTail = tailOf(redact(parseInput(AnyText, input.outputTail, 'check outputTail')));
      const valid = parseInput(
        CheckRunSchema.omit({ id: true }),
        { ...input, outputTail },
        'check run',
      );
      if (valid.agentRunId !== null && valid.runId === null) {
        throw new DbError('invalid_input', "an agent's check run needs its runId");
      }
      if (valid.runId !== null) {
        const project = runProject.get(valid.runId) as string | undefined;
        if (project === undefined) throw new DbError('not_found', 'orchestration run not found');
        if (project !== valid.projectId) {
          throw new DbError('invalid_input', 'check run project is not the run project');
        }
      }
      const place =
        valid.place === undefined
          ? null
          : parseInput(CheckRunPlaceSchema, valid.place, 'check place');
      if (place === null && valid.blockNodeId !== undefined && valid.blockNodeId !== null) {
        throw new DbError('invalid_input', "a check run's block needs its place");
      }
      const placeValues = hasPlace
        ? [place, place === null ? null : (valid.blockNodeId ?? null)]
        : [];
      return guardWrite('check run', () =>
        toCheckRun(
          insert.get(
            ctx.newId(),
            valid.projectId,
            valid.runId,
            valid.agentRunId,
            valid.checkId,
            valid.name,
            valid.required ? 1 : 0,
            parseInput(CheckRunStatusSchema, valid.status, 'check status'),
            valid.exitCode,
            valid.durationMs,
            valid.outputTail,
            toStoredTimestamp(valid.startedAt, 'check startedAt'),
            ...placeValues,
          ) as CheckRunDbRow,
        ),
      );
    },
    getById(id) {
      const row = byId.get(id) as CheckRunDbRow | undefined;
      return row && toCheckRun(row);
    },
    listForRun(runId) {
      return (forRun.all(requireNonEmpty(runId, 'runId')) as CheckRunDbRow[]).map(toCheckRun);
    },
    listForAgentRun(agentRunId) {
      return (forAgent.all(requireNonEmpty(agentRunId, 'agentRunId')) as CheckRunDbRow[]).map(
        toCheckRun,
      );
    },
    latestForAgentRun(agentRunId) {
      return (latestForAgent.all(requireNonEmpty(agentRunId, 'agentRunId')) as CheckRunDbRow[]).map(
        toCheckRun,
      );
    },
    listForProjectMain(projectId, options = {}) {
      return (forMain.all(projectId, pageLimit(options.limit)) as CheckRunDbRow[]).map(toCheckRun);
    },
  };
}
