import {
  ApprovalKindSchema,
  ApprovalStatusSchema,
  redact,
  type ApprovalStatus,
  type IsoTimestamp,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import {
  parseInput,
  parseStored,
  requireNonEmpty,
  storedTimestamp,
  storedTimestampOrNull,
  toStoredTimestamp,
} from '../../internal/validate.js';
import { guardWrite, nullable, textParser } from './shared.js';

/** ADR-0013: the owner sees a short "tool and target" description, at most this long. */
export const MAX_APPROVAL_SUMMARY_LENGTH = 200;

/** Core exports the schema but not the type (proposed: `export type ApprovalKind`). */
export type ApprovalKind = ReturnType<typeof ApprovalKindSchema.parse>;
export type ApprovalDecision = Exclude<ApprovalStatus, 'pending'>;

export interface ApprovalInsertInput {
  runId: string;
  /** Must belong to `runId`. */
  agentRunId: string;
  kind: ApprovalKind;
  /** The tool for `tool-use`; null for `budget-raise`. */
  toolName: string | null;
  /**
   * Redacted description such as "Edit src/app.ts" (1..200 characters). It is passed through
   * core's `redact()` again before storage. Never tool input or output (ADR-0015).
   */
  summary: string;
}

/** Field-for-field the shape of core's `ApprovalDto`. */
export interface ApprovalRow {
  id: string;
  runId: string;
  agentRunId: string;
  kind: ApprovalKind;
  toolName: string | null;
  summary: string;
  status: ApprovalStatus;
  requestedAt: IsoTimestamp;
  decidedAt: IsoTimestamp | null;
}

export interface ApprovalListOptions {
  runId?: string;
}

export interface ApprovalsRepository {
  /** Creates a `pending` approval. `not_found` when the agent is not in that run. */
  insert(input: ApprovalInsertInput): ApprovalRow;
  getById(id: string): ApprovalRow | undefined;
  /** Oldest first. */
  listForRun(runId: string): ApprovalRow[];
  /** Pending approvals, oldest first, optionally for one run. */
  listPending(options?: ApprovalListOptions): ApprovalRow[];
  /**
   * Records the owner's (or the timeout's) decision. Decisions are immutable: deciding an approval
   * that is no longer pending throws `DbError('conflict')`. Returns undefined when it does not exist.
   * The owner's optional decision message is not stored (ADR-0015).
   */
  decide(id: string, decision: ApprovalDecision, decidedAt?: IsoTimestamp): ApprovalRow | undefined;
  /** Marks every approval still pending and requested at or before `cutoff` as `expired`. */
  expirePending(cutoff: IsoTimestamp, decidedAt?: IsoTimestamp): ApprovalRow[];
}

interface ApprovalDbRow {
  id: string;
  run_id: string;
  agent_run_id: string;
  kind: string;
  tool_name: string | null;
  summary: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
}

const T = 'approvals';
const COLUMNS =
  'id, run_id, agent_run_id, kind, tool_name, summary, status, requested_at, decided_at';
const SummaryParser = textParser(1, MAX_APPROVAL_SUMMARY_LENGTH);
const ToolNameParser = nullable(textParser(1, 200));

function toApproval(row: ApprovalDbRow): ApprovalRow {
  return {
    id: row.id,
    runId: row.run_id,
    agentRunId: row.agent_run_id,
    kind: parseStored(ApprovalKindSchema, row.kind, T, 'kind'),
    toolName: row.tool_name,
    summary: parseStored(SummaryParser, row.summary, T, 'summary'),
    status: parseStored(ApprovalStatusSchema, row.status, T, 'status'),
    requestedAt: storedTimestamp(row.requested_at, T, 'requested_at'),
    decidedAt: storedTimestampOrNull(row.decided_at, T, 'decided_at'),
  };
}

export function createApprovalsRepository(ctx: RepositoryContext): ApprovalsRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)
     RETURNING ${COLUMNS}`,
  );
  const byId = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`);
  const forRun = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE run_id = ? ORDER BY requested_at, rowid`,
  );
  const pending = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE status = 'pending' ORDER BY requested_at, rowid`,
  );
  const pendingForRun = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE status = 'pending' AND run_id = ?
     ORDER BY requested_at, rowid`,
  );
  const decide = c.prepare(
    `UPDATE ${T} SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'
     RETURNING ${COLUMNS}`,
  );
  const expire = c.prepare(
    `UPDATE ${T} SET status = 'expired', decided_at = ?
     WHERE status = 'pending' AND requested_at <= ? RETURNING ${COLUMNS}`,
  );

  return {
    insert(input) {
      const kind = parseInput(ApprovalKindSchema, input.kind, 'approval kind');
      const toolName = parseInput(ToolNameParser, input.toolName, 'approval toolName');
      // Defense in depth: the adapter already redacts; a stray secret must not reach the DB.
      const summary = parseInput(
        SummaryParser,
        redact(parseInput(SummaryParser, input.summary, 'approval summary')),
        'approval summary (redacted)',
      );
      return guardWrite('approval', () =>
        toApproval(
          insert.get(
            ctx.newId(),
            requireNonEmpty(input.runId, 'approval runId'),
            requireNonEmpty(input.agentRunId, 'approval agentRunId'),
            kind,
            toolName,
            summary,
            ctx.now().toISOString(),
          ) as ApprovalDbRow,
        ),
      );
    },
    getById(id) {
      const row = byId.get(id) as ApprovalDbRow | undefined;
      return row && toApproval(row);
    },
    listForRun(runId) {
      return (forRun.all(runId) as ApprovalDbRow[]).map(toApproval);
    },
    listPending(options = {}) {
      const rows = options.runId === undefined ? pending.all() : pendingForRun.all(options.runId);
      return (rows as ApprovalDbRow[]).map(toApproval);
    },
    decide(id, decision, decidedAt) {
      const status = parseInput(ApprovalStatusSchema, decision, 'approval decision');
      if (status === 'pending') {
        throw new DbError('invalid_input', 'a decision cannot be pending');
      }
      const at =
        decidedAt === undefined
          ? ctx.now().toISOString()
          : toStoredTimestamp(decidedAt, 'decidedAt');
      const row = decide.get(status, at, id) as ApprovalDbRow | undefined;
      if (row) return toApproval(row);
      const existing = byId.get(id) as ApprovalDbRow | undefined;
      if (!existing) return undefined;
      throw new DbError('conflict', `approval is already ${existing.status}`);
    },
    expirePending(cutoff, decidedAt) {
      const before = toStoredTimestamp(cutoff, 'cutoff');
      const at =
        decidedAt === undefined
          ? ctx.now().toISOString()
          : toStoredTimestamp(decidedAt, 'decidedAt');
      return (expire.all(at, before) as ApprovalDbRow[]).map(toApproval);
    },
  };
}
