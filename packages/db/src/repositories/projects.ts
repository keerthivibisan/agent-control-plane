import { ProjectSchema, RegisterProjectInputSchema, type Project } from '@acp/core';
import type { RegisterProjectInput } from '@acp/core';
import { DbError } from '../errors.js';
import { isUniqueViolation, type RepositoryContext } from '../internal/context.js';
import { lazy } from '../internal/lazy.js';
import { parseInput, parseStored } from '../internal/validate.js';

/**
 * What `removeWithHistory` deleted that has files on disk, for the caller to clean up (ADR-0036).
 * The rows are already gone when the caller sees this.
 */
export interface ProjectRemoval {
  /** The project's orchestration runs, oldest first. */
  runIds: string[];
  /** Every recorded agent worktree of those runs, whatever its state. */
  workspacePaths: string[];
  /** Artifact paths relative to the data dir. */
  artifactPaths: string[];
  /** Distinct sha256 of the attachments of the project's tickets (files are shared by content). */
  attachmentSha256s: string[];
}

/** How much ACP history a project has (the removal preview, ADR-0036). */
export interface ProjectHistoryCounts {
  tickets: number;
  runs: number;
  attachments: number;
}

export interface ProjectsRepository {
  /**
   * Registers a project. `rootPath` must already be realpath-normalized by the caller.
   * Throws `DbError('conflict')` when the root is already registered.
   */
  insert(input: RegisterProjectInput): Project;
  getById(id: string): Project | undefined;
  getByRootPath(rootPath: string): Project | undefined;
  /** All projects, ordered by name then id. */
  list(): Project[];
  rename(id: string, name: string): Project | undefined;
  /** Unregisters a project. Its sessions and events are detached (`project_id = NULL`), not deleted. */
  remove(id: string): boolean;
  /**
   * Deletes the project with all of ACP's records for it in one transaction (ADR-0036): its runs
   * first (cascading agents, approvals, artifacts, workspaces, reviews, branches), then its
   * tickets (plans, comments, attachments), then the project (setup, workflow, check and setup
   * runs, code map). Observed sessions and events are detached, never deleted; usage rows stay.
   * Returns undefined when the project does not exist.
   */
  removeWithHistory(id: string): ProjectRemoval | undefined;
  historyCounts(id: string): ProjectHistoryCounts;
}

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, name, root_path, created_at, updated_at';

function toProject(row: ProjectRow): Project {
  return parseStored(
    ProjectSchema,
    {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    'projects',
    '*',
  );
}

export function createProjectsRepository(ctx: RepositoryContext): ProjectsRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO projects (${COLUMNS}) VALUES (?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  );
  const byId = c.prepare(`SELECT ${COLUMNS} FROM projects WHERE id = ?`);
  const byRoot = c.prepare(`SELECT ${COLUMNS} FROM projects WHERE root_path = ?`);
  const all = c.prepare(`SELECT ${COLUMNS} FROM projects ORDER BY name, id`);
  const rename = c.prepare(
    `UPDATE projects SET name = ?, updated_at = ? WHERE id = ? RETURNING ${COLUMNS}`,
  );
  const remove = c.prepare('DELETE FROM projects WHERE id = ?');
  // Lazy: these tables arrive in later migrations, and upgrade tests open older databases.
  const runIds = lazy(() =>
    c
      .prepare('SELECT id FROM orchestration_runs WHERE project_id = ? ORDER BY created_at, id')
      .pluck(),
  );
  const workspacePaths = lazy(() =>
    c
      .prepare(
        `SELECT DISTINCT w.worktree_path FROM managed_workspaces w
       JOIN orchestration_runs r ON r.id = w.run_id
       WHERE r.project_id = ? ORDER BY w.worktree_path`,
      )
      .pluck(),
  );
  const artifactPaths = lazy(() =>
    c
      .prepare(
        `SELECT DISTINCT a.storage_path FROM artifacts a
       JOIN orchestration_runs r ON r.id = a.run_id
       WHERE r.project_id = ? ORDER BY a.storage_path`,
      )
      .pluck(),
  );
  const attachmentShas = lazy(() =>
    c
      .prepare(
        `SELECT DISTINCT a.sha256 FROM ticket_attachments a
       JOIN tickets t ON t.id = a.ticket_id
       WHERE t.project_id = ? ORDER BY a.sha256`,
      )
      .pluck(),
  );
  const deleteRuns = lazy(() => c.prepare('DELETE FROM orchestration_runs WHERE project_id = ?'));
  const deleteTickets = lazy(() => c.prepare('DELETE FROM tickets WHERE project_id = ?'));
  const countTickets = lazy(() =>
    c.prepare('SELECT COUNT(*) FROM tickets WHERE project_id = ?').pluck(),
  );
  const countRuns = lazy(() =>
    c.prepare('SELECT COUNT(*) FROM orchestration_runs WHERE project_id = ?').pluck(),
  );
  const countAttachments = lazy(() =>
    c
      .prepare(
        `SELECT COUNT(*) FROM ticket_attachments a JOIN tickets t ON t.id = a.ticket_id
       WHERE t.project_id = ?`,
      )
      .pluck(),
  );

  return {
    insert(input) {
      const valid = parseInput(RegisterProjectInputSchema, input, 'project');
      const at = ctx.now().toISOString();
      try {
        return toProject(insert.get(ctx.newId(), valid.name, valid.rootPath, at, at) as ProjectRow);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DbError('conflict', 'a project with this root path is already registered', {
            cause: error,
          });
        }
        throw error;
      }
    },
    getById(id) {
      const row = byId.get(id) as ProjectRow | undefined;
      return row && toProject(row);
    },
    getByRootPath(rootPath) {
      const row = byRoot.get(rootPath) as ProjectRow | undefined;
      return row && toProject(row);
    },
    list() {
      return (all.all() as ProjectRow[]).map(toProject);
    },
    rename(id, name) {
      const valid = parseInput(RegisterProjectInputSchema.shape.name, name, 'project name');
      const row = rename.get(valid, ctx.now().toISOString(), id) as ProjectRow | undefined;
      return row && toProject(row);
    },
    remove(id) {
      return remove.run(id).changes > 0;
    },
    removeWithHistory(id) {
      return c.transaction((): ProjectRemoval | undefined => {
        if (byId.get(id) === undefined) return undefined;
        const removal: ProjectRemoval = {
          runIds: runIds().all(id) as string[],
          workspacePaths: workspacePaths().all(id) as string[],
          artifactPaths: artifactPaths().all(id) as string[],
          attachmentSha256s: attachmentShas().all(id) as string[],
        };
        // Order matters: runs and tickets reference the project (and runs the ticket) with
        // ON DELETE RESTRICT, so the children go first (migrations 0002/0003, ADR-0036).
        deleteRuns().run(id);
        deleteTickets().run(id);
        remove.run(id);
        return removal;
      })();
    },
    historyCounts(id) {
      return {
        tickets: countTickets().get(id) as number,
        runs: countRuns().get(id) as number,
        attachments: countAttachments().get(id) as number,
      };
    },
  };
}
