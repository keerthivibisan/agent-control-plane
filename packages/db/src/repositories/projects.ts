import { ProjectSchema, RegisterProjectInputSchema, type Project } from '@acp/core';
import type { RegisterProjectInput } from '@acp/core';
import { DbError } from '../errors.js';
import { isUniqueViolation, type RepositoryContext } from '../internal/context.js';
import { parseInput, parseStored } from '../internal/validate.js';

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
  };
}
