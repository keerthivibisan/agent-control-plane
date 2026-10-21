import {
  ProjectWorkflowGraphSchema,
  ProjectWorkflowSchema,
  StoredWorkflowJsonSchema,
  WorkflowGraphSchema,
  defaultProjectWorkflow,
  type ProjectWorkflow,
  type ProjectWorkflowGraph,
  type WorkflowGraph,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStored, parseStoredJson } from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';

/** Everything in a workflow except `updatedAt`, which the repository sets. */
export type ProjectWorkflowInput = Omit<ProjectWorkflow, 'updatedAt'>;

/**
 * What a project's workflow row holds (ADR-0023 §9): a version 2 graph, a version 1 workflow saved
 * before graphs, or nothing yet (the default version 1 workflow, dated at the project's
 * registration so repeated reads agree).
 */
export type StoredProjectWorkflow =
  | { kind: 'v2'; graph: ProjectWorkflowGraph }
  | { kind: 'v1'; workflow: ProjectWorkflow }
  | { kind: 'default'; workflow: ProjectWorkflow };

/**
 * The project's workflow is stored as a version 2 graph, so a version 1 read or write cannot
 * answer for it (ADR-0023 §9: a version 1 write never silently replaces a graph). Code `conflict`.
 */
export class WorkflowStoredAsGraphError extends DbError {
  readonly projectId: string;

  constructor(projectId: string) {
    super('conflict', 'project workflow: stored as a workflow graph (version 2)');
    this.name = 'WorkflowStoredAsGraphError';
    this.projectId = projectId;
  }
}

export interface ProjectWorkflowRepository {
  /**
   * The project's version 1 workflow: the stored one, or `defaultProjectWorkflow()` (the Phase 4
   * flow) with no stored row. Undefined for an unknown project. `WorkflowStoredAsGraphError` when
   * the project stores a graph (read it with `stored`).
   */
  get(projectId: string): ProjectWorkflow | undefined;
  /** What the project stores, version 1 or 2, or its default. Undefined for an unknown project. */
  stored(projectId: string): StoredProjectWorkflow | undefined;
  /** Whether the owner has saved a workflow of either version (false: the default applies). */
  isStored(projectId: string): boolean;
  /**
   * Creates or replaces the project's version 1 workflow. `not_found` for an unknown project;
   * `WorkflowStoredAsGraphError` when the project already stores a graph, which is kept.
   */
  put(input: ProjectWorkflowInput): ProjectWorkflow;
  /**
   * Stores the project's workflow graph as `{version: 2, graph}`, replacing whatever was stored (a
   * version 1 workflow included: the graph is what runs from now on). Only the shape is checked
   * here; whether the graph may run is `validateWorkflowGraph`'s answer, which the server asks
   * first. `not_found` for an unknown project.
   */
  putGraph(projectId: string, graph: WorkflowGraph): ProjectWorkflowGraph;
}

interface WorkflowDbRow {
  project_id: string;
  workflow: string;
  updated_at: string;
}

const T = 'project_workflow';
const COLUMNS = 'project_id, workflow, updated_at';

function toStored(row: WorkflowDbRow): StoredProjectWorkflow {
  const json = parseStoredJson(StoredWorkflowJsonSchema, row.workflow, T, 'workflow');
  if ('version' in json) {
    return {
      kind: 'v2',
      graph: parseStored(
        ProjectWorkflowGraphSchema,
        { projectId: row.project_id, graph: json.graph, updatedAt: row.updated_at },
        T,
        '*',
      ),
    };
  }
  return {
    kind: 'v1',
    workflow: parseStored(
      ProjectWorkflowSchema,
      { ...json, projectId: row.project_id, updatedAt: row.updated_at },
      T,
      '*',
    ),
  };
}

export function createProjectWorkflowRepository(ctx: RepositoryContext): ProjectWorkflowRepository {
  const c = ctx.connection;
  const byProject = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE project_id = ?`);
  const projectCreated = c.prepare('SELECT created_at FROM projects WHERE id = ?').pluck();
  // A version 1 write replaces only a version 1 row (no `version` key); over a graph it changes
  // nothing and returns no row, in the same statement, so no other write can slip in between.
  const upsertV1 = c.prepare(
    `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       workflow = excluded.workflow, updated_at = excluded.updated_at
     WHERE json_type(${T}.workflow, '$.version') IS NULL
     RETURNING ${COLUMNS}`,
  );
  const upsertGraph = c.prepare(
    `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       workflow = excluded.workflow, updated_at = excluded.updated_at
     RETURNING ${COLUMNS}`,
  );

  function stored(projectId: string): StoredProjectWorkflow | undefined {
    const row = byProject.get(projectId) as WorkflowDbRow | undefined;
    if (row !== undefined) return toStored(row);
    const createdAt = projectCreated.get(projectId) as string | undefined;
    return createdAt === undefined
      ? undefined
      : { kind: 'default', workflow: defaultProjectWorkflow(projectId, createdAt) };
  }

  return {
    get(projectId) {
      const s = stored(projectId);
      if (s === undefined) return undefined;
      if (s.kind === 'v2') throw new WorkflowStoredAsGraphError(projectId);
      return s.workflow;
    },
    stored,
    isStored(projectId) {
      return byProject.get(projectId) !== undefined;
    },
    put(input) {
      const at = ctx.now().toISOString();
      const valid = parseInput(ProjectWorkflowSchema, { ...input, updatedAt: at }, 'workflow');
      const { projectId, updatedAt: _updatedAt, ...json } = valid;
      const row = guardWrite(
        'project workflow',
        () => upsertV1.get(projectId, JSON.stringify(json), at) as WorkflowDbRow | undefined,
      );
      if (row === undefined) throw new WorkflowStoredAsGraphError(projectId);
      const saved = toStored(row);
      // Written from a version 1 workflow, so it reads back as one.
      if (saved.kind !== 'v1') throw new WorkflowStoredAsGraphError(projectId);
      return saved.workflow;
    },
    putGraph(projectId, graph) {
      const at = ctx.now().toISOString();
      const valid = parseInput(WorkflowGraphSchema, graph, 'workflow graph');
      const json = JSON.stringify({ version: 2, graph: valid });
      const row = guardWrite(
        'project workflow',
        () => upsertGraph.get(projectId, json, at) as WorkflowDbRow,
      );
      const saved = toStored(row);
      if (saved.kind !== 'v2') {
        throw new DbError('invalid_stored_value', 'project workflow: the graph did not read back');
      }
      return saved.graph;
    },
  };
}
