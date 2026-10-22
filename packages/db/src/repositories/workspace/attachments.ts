import {
  AttachmentMimeTypeSchema,
  AttachmentNameSchema,
  AttachmentSchema,
  MAX_ATTACHMENTS_PER_TICKET,
  type Attachment,
  type AttachmentMimeType,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { lazy } from '../../internal/lazy.js';
import { parseInput, parseStored } from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';

/**
 * The owner's attachments on a ticket or one of its comments (ADR-0026 §4, migration 0009). Only
 * the rows: the server stores the bytes in the app's data folder by SHA-256 and checks the type
 * and content before it calls `insert`.
 */

export interface AttachmentInsertInput {
  ticketId: string;
  /** A comment of this ticket; null or absent for the ticket itself. */
  commentId?: string | null;
  name: string;
  mimeType: AttachmentMimeType;
  sizeBytes: number;
  sha256: string;
}

export interface AttachmentsRepository {
  /**
   * `not_found` for an unknown ticket or a comment that is not the ticket's; `conflict` when the
   * ticket already has `MAX_ATTACHMENTS_PER_TICKET`.
   */
  insert(input: AttachmentInsertInput): Attachment;
  getById(id: string): Attachment | undefined;
  /** Oldest first. */
  listForTicket(ticketId: string): Attachment[];
  countForTicket(ticketId: string): number;
  /**
   * Attaches uploaded, still unattached files of the ticket to one of its comments (all or none):
   * `not_found` when an id is not an attachment of this ticket or the comment is not its;
   * `conflict` when one is already on a comment.
   */
  attachToComment(ticketId: string, commentId: string, ids: readonly string[]): Attachment[];
  /** Deletes the row; returns it, or undefined when there was none. */
  delete(id: string): Attachment | undefined;
  /** Rows that still point at this content (the server removes the file at zero). */
  countBySha256(sha256: string): number;
}

interface AttachmentDbRow {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

const T = 'ticket_attachments';
const COLUMNS = 'id, ticket_id, comment_id, name, mime_type, size_bytes, sha256, created_at';
const shape = AttachmentSchema.shape;

function toAttachment(row: AttachmentDbRow): Attachment {
  return parseStored(
    AttachmentSchema,
    {
      id: row.id,
      ticketId: row.ticket_id,
      commentId: row.comment_id,
      name: row.name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      createdAt: row.created_at,
    },
    T,
    '*',
  );
}

export function createAttachmentsRepository(ctx: RepositoryContext): AttachmentsRepository {
  const c = ctx.connection;
  const insert = lazy(() =>
    c.prepare(`INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`),
  );
  const byId = lazy(() => c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`));
  const forTicket = lazy(() =>
    c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE ticket_id = ? ORDER BY created_at, rowid`),
  );
  const countTicket = lazy(() =>
    c.prepare(`SELECT COUNT(*) FROM ${T} WHERE ticket_id = ?`).pluck(),
  );
  const commentOfTicket = lazy(() =>
    c.prepare('SELECT 1 FROM ticket_comments WHERE id = ? AND ticket_id = ?').pluck(),
  );
  const setComment = lazy(() =>
    c.prepare(`UPDATE ${T} SET comment_id = ? WHERE id = ? RETURNING ${COLUMNS}`),
  );
  const remove = lazy(() => c.prepare(`DELETE FROM ${T} WHERE id = ? RETURNING ${COLUMNS}`));
  const countSha = lazy(() => c.prepare(`SELECT COUNT(*) FROM ${T} WHERE sha256 = ?`).pluck());

  const insertTx = c.transaction((input: AttachmentInsertInput): Attachment => {
    const ticketId = parseInput(shape.ticketId, input.ticketId, 'attachment ticketId');
    const commentId =
      input.commentId === undefined || input.commentId === null
        ? null
        : parseInput(shape.id, input.commentId, 'attachment commentId');
    const name = parseInput(AttachmentNameSchema, input.name, 'attachment name');
    const mimeType = parseInput(AttachmentMimeTypeSchema, input.mimeType, 'attachment type');
    const sizeBytes = parseInput(shape.sizeBytes, input.sizeBytes, 'attachment size');
    const sha256 = parseInput(shape.sha256, input.sha256, 'attachment sha256');
    if (commentId !== null && commentOfTicket().get(commentId, ticketId) === undefined) {
      throw new DbError('not_found', 'comment not found on this ticket');
    }
    if ((countTicket().get(ticketId) as number) >= MAX_ATTACHMENTS_PER_TICKET) {
      throw new DbError(
        'conflict',
        `a ticket has at most ${MAX_ATTACHMENTS_PER_TICKET} attachments`,
      );
    }
    return guardWrite('ticket attachment', () =>
      toAttachment(
        insert().get(
          ctx.newId(),
          ticketId,
          commentId,
          name,
          mimeType,
          sizeBytes,
          sha256,
          ctx.now().toISOString(),
        ) as AttachmentDbRow,
      ),
    );
  });

  const attachTx = c.transaction(
    (ticketId: string, commentId: string, ids: readonly string[]): Attachment[] => {
      if (commentOfTicket().get(commentId, ticketId) === undefined) {
        throw new DbError('not_found', 'comment not found on this ticket');
      }
      const out: Attachment[] = [];
      for (const id of new Set(ids)) {
        const row = byId().get(id) as AttachmentDbRow | undefined;
        if (row === undefined || row.ticket_id !== ticketId) {
          throw new DbError('not_found', 'attachment not found on this ticket');
        }
        if (row.comment_id !== null && row.comment_id !== commentId) {
          throw new DbError('conflict', 'attachment is already on a comment');
        }
        out.push(toAttachment(setComment().get(commentId, id) as AttachmentDbRow));
      }
      return out;
    },
  );

  return {
    insert(input) {
      return insertTx(input);
    },
    getById(id) {
      const row = byId().get(id) as AttachmentDbRow | undefined;
      return row && toAttachment(row);
    },
    listForTicket(ticketId) {
      return (forTicket().all(ticketId) as AttachmentDbRow[]).map(toAttachment);
    },
    countForTicket(ticketId) {
      return countTicket().get(ticketId) as number;
    },
    attachToComment(ticketId, commentId, ids) {
      return attachTx(ticketId, commentId, ids);
    },
    delete(id) {
      const row = remove().get(id) as AttachmentDbRow | undefined;
      return row && toAttachment(row);
    },
    countBySha256(sha256) {
      return countSha().get(sha256) as number;
    },
  };
}
