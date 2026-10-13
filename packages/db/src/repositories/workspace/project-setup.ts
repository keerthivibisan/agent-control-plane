import { ProjectAgentSetupSchema, type ProjectAgentSetup } from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStored, parseStoredJson } from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';

/** Everything in the setup except `updatedAt`, which the repository sets. */
export type ProjectSetupInput = Omit<ProjectAgentSetup, 'updatedAt'>;

export interface ProjectSetupRepository {
  get(projectId: string): ProjectAgentSetup | undefined;
  getByProjectKey(projectKey: string): ProjectAgentSetup | undefined;
  /**
   * Creates or replaces the project's setup. The ticket counter is kept, so changing the project
   * key only changes the keys of new tickets. `not_found` for an unknown project; `conflict` when
   * another project already uses the key.
   */
  upsert(input: ProjectSetupInput): ProjectAgentSetup;
}

interface SetupDbRow {
  project_id: string;
  project_key: string;
  setup: string;
  updated_at: string;
}

const T = 'project_setup';
const COLUMNS = 'project_id, project_key, setup, updated_at';
/** The JSON part: the setup without the columns stored separately. */
const SetupJsonSchema = ProjectAgentSetupSchema.omit({
  projectId: true,
  projectKey: true,
  updatedAt: true,
});

function toSetup(row: SetupDbRow): ProjectAgentSetup {
  const json = parseStoredJson(SetupJsonSchema, row.setup, T, 'setup');
  return parseStored(
    ProjectAgentSetupSchema,
    { ...json, projectId: row.project_id, projectKey: row.project_key, updatedAt: row.updated_at },
    T,
    '*',
  );
}

export function createProjectSetupRepository(ctx: RepositoryContext): ProjectSetupRepository {
  const c = ctx.connection;
  const byProject = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE project_id = ?`);
  const byKey = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE project_key = ?`);
  const keyOwner = c.prepare(`SELECT project_id FROM ${T} WHERE project_key = ?`).pluck();
  const upsert = c.prepare(
    `INSERT INTO ${T} (project_id, project_key, setup, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       project_key = excluded.project_key, setup = excluded.setup, updated_at = excluded.updated_at
     RETURNING ${COLUMNS}`,
  );

  return {
    get(projectId) {
      const row = byProject.get(projectId) as SetupDbRow | undefined;
      return row && toSetup(row);
    },
    getByProjectKey(projectKey) {
      const row = byKey.get(projectKey) as SetupDbRow | undefined;
      return row && toSetup(row);
    },
    upsert(input) {
      const at = ctx.now().toISOString();
      const valid = parseInput(
        ProjectAgentSetupSchema,
        { ...input, updatedAt: at },
        'project setup',
      );
      const { projectId, projectKey, updatedAt: _updatedAt, ...json } = valid;
      const owner = keyOwner.get(projectKey) as string | undefined;
      if (owner !== undefined && owner !== projectId) {
        throw new DbError('conflict', `project key ${projectKey} is used by another project`);
      }
      // The UNIQUE key constraint still guards a concurrent writer (guardWrite → conflict).
      return guardWrite('project setup', () =>
        toSetup(upsert.get(projectId, projectKey, JSON.stringify(json), at) as SetupDbRow),
      );
    },
  };
}
