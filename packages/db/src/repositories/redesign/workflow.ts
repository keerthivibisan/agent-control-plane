import { ProjectWorkflowSchema, defaultProjectWorkflow, type ProjectWorkflow } from '@acp/core';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStored, parseStoredJson } from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';

/** Everything in a workflow except `updatedAt`, which the repository sets. */
export type ProjectWorkflowInput = Omit<ProjectWorkflow, 'updatedAt'>;

export interface ProjectWorkflowRepository {
  /**
   * The project's workflow. With no stored row this is `defaultProjectWorkflow()` (the Phase 4
   * flow), dated at the project's registration so repeated reads agree. Undefined for an unknown
   * project.
   */
  get(projectId: string): ProjectWorkflow | undefined;
  /** Whether the owner has saved a workflow (false: `get` answers the default). */
  isStored(projectId: string): boolean;
  /** Creates or replaces the project's workflow. `not_found` for an unknown project. */
  put(input: ProjectWorkflowInput): ProjectWorkflow;
}

interface WorkflowDbRow {
  project_id: string;
  workflow: string;
  updated_at: string;
}

const T = 'project_workflow';
const COLUMNS = 'project_id, workflow, updated_at';
/** The JSON part: the workflow without the columns stored separately. */
const WorkflowJsonSchema = ProjectWorkflowSchema.omit({ projectId: true, updatedAt: true });

function toWorkflow(row: WorkflowDbRow): ProjectWorkflow {
  const json = parseStoredJson(WorkflowJsonSchema, row.workflow, T, 'workflow');
  return parseStored(
    ProjectWorkflowSchema,
    { ...json, projectId: row.project_id, updatedAt: row.updated_at },
    T,
    '*',
  );
}

export function createProjectWorkflowRepository(ctx: RepositoryContext): ProjectWorkflowRepository {
  const c = ctx.connection;
  const byProject = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE project_id = ?`);
  const projectCreated = c.prepare('SELECT created_at FROM projects WHERE id = ?').pluck();
  const upsert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       workflow = excluded.workflow, updated_at = excluded.updated_at
     RETURNING ${COLUMNS}`,
  );

  return {
    get(projectId) {
      const row = byProject.get(projectId) as WorkflowDbRow | undefined;
      if (row !== undefined) return toWorkflow(row);
      const createdAt = projectCreated.get(projectId) as string | undefined;
      return createdAt === undefined ? undefined : defaultProjectWorkflow(projectId, createdAt);
    },
    isStored(projectId) {
      return byProject.get(projectId) !== undefined;
    },
    put(input) {
      const at = ctx.now().toISOString();
      const valid = parseInput(ProjectWorkflowSchema, { ...input, updatedAt: at }, 'workflow');
      const { projectId, updatedAt: _updatedAt, ...json } = valid;
      return guardWrite('project workflow', () =>
        toWorkflow(upsert.get(projectId, JSON.stringify(json), at) as WorkflowDbRow),
      );
    },
  };
}
