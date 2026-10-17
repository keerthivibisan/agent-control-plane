import {
  ChangeDeciderSchema,
  ChangeDecisionSchema,
  ChangeReviewerKindSchema,
  ChangeVerdictSchema,
  type ChangeDecider,
  type ChangeDecision,
  type ChangeReviewerKind,
  type ChangeVerdict,
  type IsoTimestamp,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import {
  nonEmptyOrNull,
  parseInput,
  parseStored,
  requireNonEmpty,
  storedTimestamp,
  storedTimestampOrNull,
} from '../../internal/validate.js';
import { guardWrite, nonNegativeInt, nullable } from '../orchestration/shared.js';

/**
 * One review round of a helper's change and its decision (ADR-0021 §3, migration 0006
 * `change_reviews`). No text: the findings or the decider's note are a ticket comment, linked by
 * `commentId`. `decision`, `decidedBy` and `decidedAt` are set together, once.
 */

export interface ChangeReviewInsertInput {
  runId: string;
  /** The helper or tester whose change it is; must be in `runId`. */
  agentRunId: string;
  round: number;
  reviewer: ChangeReviewerKind;
  /** The review agent, when `reviewer` is `agent`; must be in `runId`. */
  reviewerAgentRunId?: string | null;
}

export interface ChangeReviewRow {
  id: string;
  runId: string;
  agentRunId: string;
  round: number;
  reviewer: ChangeReviewerKind;
  reviewerAgentRunId: string | null;
  verdict: ChangeVerdict | null;
  decision: ChangeDecision | null;
  decidedBy: ChangeDecider | null;
  commentId: string | null;
  createdAt: IsoTimestamp;
  decidedAt: IsoTimestamp | null;
}

export interface ChangeReviewDecisionInput {
  decision: ChangeDecision;
  decidedBy: ChangeDecider;
  /** The ticket comment with the decider's note, when there is one (kept if absent). */
  commentId?: string | null;
}

export interface ChangeReviewsRepository {
  /** `not_found` when an agent is not in the run. */
  insert(input: ChangeReviewInsertInput): ChangeReviewRow;
  getById(id: string): ChangeReviewRow | undefined;
  /** Oldest first. */
  listForRun(runId: string): ChangeReviewRow[];
  /** Oldest first. */
  listForAgentRun(agentRunId: string): ChangeReviewRow[];
  /** The review agent's verdict and the comment holding its findings. */
  setVerdict(
    id: string,
    verdict: ChangeVerdict,
    commentId: string | null,
  ): ChangeReviewRow | undefined;
  /** Links the round to a ticket comment (findings or a note) without deciding it. */
  setComment(id: string, commentId: string | null): ChangeReviewRow | undefined;
  /** Decides the round once; deciding it again is a `conflict`. */
  decide(id: string, input: ChangeReviewDecisionInput): ChangeReviewRow | undefined;
}

interface ChangeReviewDbRow {
  id: string;
  run_id: string;
  agent_run_id: string;
  round: number;
  reviewer: string;
  reviewer_agent_run_id: string | null;
  verdict: string | null;
  decision: string | null;
  decided_by: string | null;
  comment_id: string | null;
  created_at: string;
  decided_at: string | null;
}

const T = 'change_reviews';
const COLUMNS = `id, run_id, agent_run_id, round, reviewer, reviewer_agent_run_id, verdict,
  decision, decided_by, comment_id, created_at, decided_at`;

function toRow(row: ChangeReviewDbRow): ChangeReviewRow {
  return {
    id: row.id,
    runId: row.run_id,
    agentRunId: row.agent_run_id,
    round: parseStored(nonNegativeInt, row.round, T, 'round'),
    reviewer: parseStored(ChangeReviewerKindSchema, row.reviewer, T, 'reviewer'),
    reviewerAgentRunId: row.reviewer_agent_run_id,
    verdict: parseStored(nullable(ChangeVerdictSchema), row.verdict, T, 'verdict'),
    decision: parseStored(nullable(ChangeDecisionSchema), row.decision, T, 'decision'),
    decidedBy: parseStored(nullable(ChangeDeciderSchema), row.decided_by, T, 'decided_by'),
    commentId: row.comment_id,
    createdAt: storedTimestamp(row.created_at, T, 'created_at'),
    decidedAt: storedTimestampOrNull(row.decided_at, T, 'decided_at'),
  };
}

export function createChangeReviewsRepository(ctx: RepositoryContext): ChangeReviewsRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL) RETURNING ${COLUMNS}`,
  );
  const byId = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`);
  const forRun = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE run_id = ? ORDER BY created_at, round, rowid`,
  );
  const forAgent = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE agent_run_id = ? ORDER BY round, created_at, rowid`,
  );
  const setVerdict = c.prepare(
    `UPDATE ${T} SET verdict = ?, comment_id = COALESCE(?, comment_id) WHERE id = ?
     RETURNING ${COLUMNS}`,
  );
  const setComment = c.prepare(`UPDATE ${T} SET comment_id = ? WHERE id = ? RETURNING ${COLUMNS}`);
  const decide = c.prepare(
    `UPDATE ${T} SET decision = ?, decided_by = ?, decided_at = ?,
       comment_id = CASE WHEN ? THEN ? ELSE comment_id END
     WHERE id = ? AND decision IS NULL RETURNING ${COLUMNS}`,
  );

  return {
    insert(input) {
      const reviewerAgentRunId = nonEmptyOrNull(
        input.reviewerAgentRunId,
        'change review reviewerAgentRunId',
      );
      return guardWrite('change review', () =>
        toRow(
          insert.get(
            ctx.newId(),
            requireNonEmpty(input.runId, 'change review runId'),
            requireNonEmpty(input.agentRunId, 'change review agentRunId'),
            parseInput(nonNegativeInt, input.round, 'change review round'),
            parseInput(ChangeReviewerKindSchema, input.reviewer, 'change reviewer'),
            reviewerAgentRunId,
            ctx.now().toISOString(),
          ) as ChangeReviewDbRow,
        ),
      );
    },
    getById(id) {
      const row = byId.get(id) as ChangeReviewDbRow | undefined;
      return row && toRow(row);
    },
    listForRun(runId) {
      return (forRun.all(runId) as ChangeReviewDbRow[]).map(toRow);
    },
    listForAgentRun(agentRunId) {
      return (forAgent.all(agentRunId) as ChangeReviewDbRow[]).map(toRow);
    },
    setVerdict(id, verdict, commentId) {
      const row = guardWrite(
        'change review verdict',
        () =>
          setVerdict.get(
            parseInput(ChangeVerdictSchema, verdict, 'change verdict'),
            nonEmptyOrNull(commentId, 'change review commentId'),
            id,
          ) as ChangeReviewDbRow | undefined,
      );
      return row && toRow(row);
    },
    setComment(id, commentId) {
      const row = guardWrite(
        'change review comment',
        () =>
          setComment.get(nonEmptyOrNull(commentId, 'change review commentId'), id) as
            ChangeReviewDbRow | undefined,
      );
      return row && toRow(row);
    },
    decide(id, input) {
      const decision = parseInput(ChangeDecisionSchema, input.decision, 'change decision');
      const decidedBy = parseInput(ChangeDeciderSchema, input.decidedBy, 'change decidedBy');
      const hasComment = input.commentId !== undefined;
      const commentId = hasComment
        ? nonEmptyOrNull(input.commentId, 'change review commentId')
        : null;
      const row = guardWrite(
        'change review decision',
        () =>
          decide.get(
            decision,
            decidedBy,
            ctx.now().toISOString(),
            hasComment ? 1 : 0,
            commentId,
            id,
          ) as ChangeReviewDbRow | undefined,
      );
      if (row !== undefined) return toRow(row);
      if (byId.get(id) === undefined) return undefined;
      throw new DbError('conflict', 'this review round is already decided');
    },
  };
}
