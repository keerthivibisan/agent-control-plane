import {
  TicketPrioritySchema,
  TicketSchema,
  TicketStatusSchema,
  TicketTypeSchema,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStored, parseStoredJson, placeholders } from '../../internal/validate.js';
import { guardWrite, statusGuard } from '../orchestration/shared.js';

export interface TicketInsertInput {
  /** A project with a setup (`not_found` otherwise): the key prefix comes from it. */
  projectId: string;
  title: string;
  /** Defaults to ''. */
  description?: string;
  /** Defaults to `feature`. */
  type?: TicketType;
  /** Defaults to `medium`. */
  priority?: TicketPriority;
  /** Defaults to []. */
  labels?: string[];
  /** New tickets land in `BACKLOG` (default) or `READY`. */
  status?: Extract<TicketStatus, 'BACKLOG' | 'READY'>;
}

/** Owner-editable fields; absent fields are unchanged. */
export interface TicketUpdate {
  title?: string;
  description?: string;
  type?: TicketType;
  priority?: TicketPriority;
  labels?: string[];
}

export interface TicketStatusUpdate {
  /**
   * Only update when the current status is one of these; otherwise `DbError('conflict')`. The
   * server decides transitions; this guard keeps two writers from both applying one.
   */
  from?: readonly TicketStatus[];
  /**
   * Sets the current run (a run of this ticket, else `invalid_input`; unknown → `not_found`);
   * `null` clears it; absent leaves it unchanged.
   */
  currentRunId?: string | null;
}

export interface TicketListOptions {
  /** Only tickets in these statuses. */
  statuses?: readonly TicketStatus[];
}

export interface TicketsRepository {
  /**
   * Creates a ticket with the project's next number (`<PROJECT_KEY>-<n>`). The number comes from
   * an atomic per-project counter and is never reused.
   */
  insert(input: TicketInsertInput): Ticket;
  getById(id: string): Ticket | undefined;
  /** The project's tickets in creation order (by number). */
  listForProject(projectId: string, options?: TicketListOptions): Ticket[];
  /** Returns the updated ticket, or undefined when it does not exist. */
  update(id: string, patch: TicketUpdate): Ticket | undefined;
  setStatus(id: string, status: TicketStatus, update?: TicketStatusUpdate): Ticket | undefined;
  /** Tickets of a project, any status (a project with tickets cannot be removed; ADR-0016). */
  countForProject(projectId: string): number;
}

interface TicketDbRow {
  id: string;
  project_id: string;
  seq: number;
  key: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  labels: string;
  status: string;
  current_run_id: string | null;
  created_at: string;
  updated_at: string;
}

const T = 'tickets';
const COLUMNS = `id, project_id, seq, key, title, description, type, priority, labels, status,
  current_run_id, created_at, updated_at`;
const shape = TicketSchema.shape;

function toTicket(row: TicketDbRow): Ticket {
  return parseStored(
    TicketSchema,
    {
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      title: row.title,
      description: row.description,
      type: row.type,
      priority: row.priority,
      labels: parseStoredJson(shape.labels, row.labels, T, 'labels'),
      status: row.status,
      currentRunId: row.current_run_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    T,
    '*',
  );
}

export function createTicketsRepository(ctx: RepositoryContext): TicketsRepository {
  const c = ctx.connection;
  const nextSeq = c.prepare(
    `UPDATE project_setup SET next_ticket_seq = next_ticket_seq + 1 WHERE project_id = ?
     RETURNING next_ticket_seq - 1 AS seq, project_key`,
  );
  const projectExists = c.prepare('SELECT 1 FROM projects WHERE id = ?').pluck();
  const insert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
     RETURNING ${COLUMNS}`,
  );
  const byId = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`);
  const currentStatus = c.prepare(`SELECT status FROM ${T} WHERE id = ?`).pluck();
  const countForProject = c.prepare(`SELECT COUNT(*) FROM ${T} WHERE project_id = ?`).pluck();

  const insertTx = c.transaction(
    (
      projectId: string,
      fields: Omit<Ticket, 'id' | 'projectId' | 'key' | 'currentRunId' | 'createdAt' | 'updatedAt'>,
    ): Ticket => {
      // The counter update and the insert commit together: two writers never share a number.
      const next = nextSeq.get(projectId) as { seq: number; project_key: string } | undefined;
      if (!next) {
        throw new DbError(
          'not_found',
          projectExists.get(projectId) === undefined
            ? 'project not found'
            : 'project has no agent setup (no project key for ticket numbers)',
        );
      }
      const at = ctx.now().toISOString();
      return guardWrite('ticket', () =>
        toTicket(
          insert.get(
            ctx.newId(),
            projectId,
            next.seq,
            `${next.project_key}-${next.seq}`,
            fields.title,
            fields.description,
            fields.type,
            fields.priority,
            JSON.stringify(fields.labels),
            fields.status,
            at,
            at,
          ) as TicketDbRow,
        ),
      );
    },
  );

  return {
    insert(input) {
      const projectId = parseInput(shape.projectId, input.projectId, 'ticket projectId');
      const status = parseInput(shape.status, input.status ?? 'BACKLOG', 'ticket status');
      if (status !== 'BACKLOG' && status !== 'READY') {
        throw new DbError('invalid_input', 'a new ticket starts in BACKLOG or READY');
      }
      const fields = {
        title: parseInput(shape.title, input.title, 'ticket title'),
        description: parseInput(shape.description, input.description ?? '', 'ticket description'),
        type: parseInput(TicketTypeSchema, input.type ?? 'feature', 'ticket type'),
        priority: parseInput(TicketPrioritySchema, input.priority ?? 'medium', 'ticket priority'),
        labels: parseInput(shape.labels, input.labels ?? [], 'ticket labels'),
        status,
      };
      return insertTx.immediate(projectId, fields);
    },
    getById(id) {
      const row = byId.get(id) as TicketDbRow | undefined;
      return row && toTicket(row);
    },
    listForProject(projectId, options = {}) {
      const params: unknown[] = [projectId];
      let where = 'project_id = ?';
      if (options.statuses !== undefined) {
        if (options.statuses.length === 0) return [];
        const valid = options.statuses.map((s) => parseInput(TicketStatusSchema, s, 'status'));
        where += ` AND status IN (${placeholders(valid.length)})`;
        params.push(...valid);
      }
      const rows = c
        .prepare(`SELECT ${COLUMNS} FROM ${T} WHERE ${where} ORDER BY seq`)
        .all(...params) as TicketDbRow[];
      return rows.map(toTicket);
    },
    update(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.title !== undefined) {
        sets.push('title = ?');
        params.push(parseInput(shape.title, patch.title, 'ticket title'));
      }
      if (patch.description !== undefined) {
        sets.push('description = ?');
        params.push(parseInput(shape.description, patch.description, 'ticket description'));
      }
      if (patch.type !== undefined) {
        sets.push('type = ?');
        params.push(parseInput(TicketTypeSchema, patch.type, 'ticket type'));
      }
      if (patch.priority !== undefined) {
        sets.push('priority = ?');
        params.push(parseInput(TicketPrioritySchema, patch.priority, 'ticket priority'));
      }
      if (patch.labels !== undefined) {
        sets.push('labels = ?');
        params.push(JSON.stringify(parseInput(shape.labels, patch.labels, 'ticket labels')));
      }
      sets.push('updated_at = ?');
      params.push(ctx.now().toISOString(), id);
      const row = guardWrite(
        'ticket',
        () =>
          c
            .prepare(`UPDATE ${T} SET ${sets.join(', ')} WHERE id = ? RETURNING ${COLUMNS}`)
            .get(...params) as TicketDbRow | undefined,
      );
      return row && toTicket(row);
    },
    setStatus(id, status, update = {}) {
      const next = parseInput(TicketStatusSchema, status, 'ticket status');
      const from = statusGuard(TicketStatusSchema, update.from, 'ticket status');
      const sets = ['status = ?', 'updated_at = ?'];
      const params: unknown[] = [next, ctx.now().toISOString()];
      if (update.currentRunId !== undefined) {
        sets.push('current_run_id = ?');
        params.push(
          update.currentRunId === null
            ? null
            : parseInput(shape.currentRunId, update.currentRunId, 'ticket currentRunId'),
        );
      }
      let where = 'id = ?';
      params.push(id);
      if (from) {
        where += ` AND status IN (${placeholders(from.length)})`;
        params.push(...from);
      }
      const row = guardWrite(
        'ticket',
        () =>
          c
            .prepare(`UPDATE ${T} SET ${sets.join(', ')} WHERE ${where} RETURNING ${COLUMNS}`)
            .get(...params) as TicketDbRow | undefined,
      );
      if (row) return toTicket(row);
      const current = currentStatus.get(id) as string | undefined;
      if (current === undefined) return undefined;
      throw new DbError('conflict', `ticket is ${current}, expected one of ${from?.join(', ')}`);
    },
    countForProject(projectId) {
      return countForProject.get(projectId) as number;
    },
  };
}
