import type { IsoTimestamp } from '@acp/core';
import type { RepositoryContext } from '../../internal/context.js';
import {
  pageLimit,
  parseInput,
  parseStored,
  requireNonEmpty,
  storedTimestamp,
} from '../../internal/validate.js';
import { guardWrite, literalParser, positiveInt, textParser } from './shared.js';

/**
 * The owner <-> lead chat (ADR-0015). Only the owner's messages and the lead's replies to the owner
 * are stored here; never worker conversation content.
 */
export const ORCHESTRATOR_MESSAGE_ROLES = ['owner', 'lead'] as const;
export type OrchestratorMessageRole = (typeof ORCHESTRATOR_MESSAGE_ROLES)[number];
/** Upper bound for one stored message (owner messages are capped at 8000 by the API). */
export const MAX_ORCHESTRATOR_MESSAGE_LENGTH = 100_000;
const RoleParser = literalParser(ORCHESTRATOR_MESSAGE_ROLES);
const TextParser = textParser(1, MAX_ORCHESTRATOR_MESSAGE_LENGTH);

export interface OrchestratorMessageInput {
  runId: string;
  role: OrchestratorMessageRole;
  text: string;
}

/** Core's `ChatMessageDto` plus `seq`, the message's position in its run (1, 2, ...). */
export interface OrchestratorMessageRow extends OrchestratorMessageInput {
  id: string;
  seq: number;
  createdAt: IsoTimestamp;
}

export interface OrchestratorMessageListOptions {
  /** 1..MAX_PAGE_SIZE; default 50. */
  limit?: number;
  /** Only messages with `seq` below this (load older). */
  beforeSeq?: number;
}

export interface OrchestratorMessagesRepository {
  /** Appends a message at the end of its run's chat. `not_found` for an unknown run. */
  insert(input: OrchestratorMessageInput): OrchestratorMessageRow;
  /** The latest `limit` messages (before `beforeSeq`), returned oldest first. */
  list(runId: string, options?: OrchestratorMessageListOptions): OrchestratorMessageRow[];
  count(runId: string): number;
}

interface MessageDbRow {
  id: string;
  run_id: string;
  seq: number;
  role: string;
  text: string;
  created_at: string;
}

const T = 'orchestrator_messages';
const COLUMNS = 'id, run_id, seq, role, text, created_at';

function toMessage(row: MessageDbRow): OrchestratorMessageRow {
  return {
    id: row.id,
    runId: row.run_id,
    seq: row.seq,
    role: parseStored(RoleParser, row.role, T, 'role'),
    text: row.text,
    createdAt: storedTimestamp(row.created_at, T, 'created_at'),
  };
}

export function createOrchestratorMessagesRepository(
  ctx: RepositoryContext,
): OrchestratorMessagesRepository {
  const c = ctx.connection;
  // The sequence is computed in the same statement, so concurrent appends cannot share a seq
  // (the UNIQUE (run_id, seq) constraint would reject one anyway).
  const insert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS})
     SELECT ?, ?, COALESCE((SELECT MAX(seq) FROM ${T} WHERE run_id = ?), 0) + 1, ?, ?, ?
     RETURNING ${COLUMNS}`,
  );
  const latest = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE run_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`,
  );
  const count = c.prepare(`SELECT COUNT(*) FROM ${T} WHERE run_id = ?`).pluck();

  return {
    insert(input) {
      const runId = requireNonEmpty(input.runId, 'message runId');
      const role = parseInput(RoleParser, input.role, 'message role');
      const text = parseInput(TextParser, input.text, 'message text');
      return guardWrite('orchestrator message', () =>
        toMessage(
          insert.get(
            ctx.newId(),
            runId,
            runId,
            role,
            text,
            ctx.now().toISOString(),
          ) as MessageDbRow,
        ),
      );
    },
    list(runId, options = {}) {
      const limit = pageLimit(options.limit);
      const before =
        options.beforeSeq === undefined
          ? Number.MAX_SAFE_INTEGER
          : parseInput(positiveInt, options.beforeSeq, 'beforeSeq');
      return (latest.all(runId, before, limit) as MessageDbRow[]).reverse().map(toMessage);
    },
    count(runId) {
      return count.get(runId) as number;
    },
  };
}
