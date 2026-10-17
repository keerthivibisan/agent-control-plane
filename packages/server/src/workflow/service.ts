import {
  approvalsOf,
  isGraphRunnable,
  validateWorkflowGraph,
  type GraphIssue,
  type ProjectAgentSetup,
  type ProjectWorkflow,
  type WorkflowGraph,
} from '@acp/core';
import {
  UpdateWorkflowGraphRequestSchema,
  UpdateWorkflowRequestSchema,
  type ProjectWorkflowDto,
  type StreamNoticeDto,
  type ValidateWorkflowGraphResultDto,
  type WorkflowGraphDto,
} from '@acp/core/api';
import {
  WorkflowStoredAsGraphError,
  createRedesignRepositories,
  type AcpDatabase,
  type Repositories,
} from '@acp/db';
import { HttpError, notFound } from '../errors.js';
import { effectiveWorkflow, type EffectiveWorkflow } from './graph.js';
import {
  listProjectAgentNames,
  listProjectSkillNames,
  type SkillListingOptions,
} from './skill-names.js';

/**
 * A project's workflow (docs/redesign/README.md §4.2, ADR-0019; ADR-0023 graphs).
 *
 * - **Version 2, the graph** (`/workflow-graph`): the stored graph, or the version 1 workflow
 *   (stored or the default) migrated with the project's approval mode. A PUT is validated with
 *   `validateWorkflowGraph` (the same function the editor and the run start use) and stored as
 *   version 2 only without errors (422 `workflow_invalid` otherwise).
 * - **Version 1** (`/workflow`, until WG-V removes it): which optional stages run, and each agent
 *   stage's model and skill. It answers 409 `workflow_is_graph` once the project stores a graph,
 *   so an older page can never silently overwrite one.
 *
 * Limits and the allowlist stay in the agent setup (one source for each value), so the DTOs carry
 * the setup alongside, plus the project's skill (and agent file) names so the page can offer them
 * and flag one that no longer exists. A missing skill or agent file never blocks a run: the agent
 * starts without it (ADR-0019 §4), and the graph validator only warns.
 */
export interface WorkflowService {
  get(projectId: string): Promise<ProjectWorkflowDto>;
  /** Replaces the stage configuration (`UpdateWorkflowRequest`). */
  put(projectId: string, body: unknown): Promise<ProjectWorkflowDto>;
  /** The project's graph, how it is stored, and its issues (`WorkflowGraphDto`). */
  getGraph(projectId: string): Promise<WorkflowGraphDto>;
  /** Validates and stores a graph (`UpdateWorkflowGraphRequest`); 422 when it has an error. */
  putGraph(projectId: string, body: unknown): Promise<WorkflowGraphDto>;
  /** Validates a graph without saving it (`ValidateWorkflowGraphResultDto`). */
  validateGraph(projectId: string, body: unknown): Promise<ValidateWorkflowGraphResultDto>;
  /** The graph a new run of this project follows, with the version 1 workflow it came from. */
  effective(projectId: string): Promise<EffectiveWorkflow>;
}

export interface WorkflowServiceDeps {
  db: AcpDatabase;
  repos: Repositories;
  /** The board's setup lookup, which creates the default setup row on first use. */
  setupFor: (projectId: string) => Promise<ProjectAgentSetup>;
  now: () => Date;
  publish: (notice: StreamNoticeDto) => void;
  skills?: SkillListingOptions;
}

/** A version 1 request for a project that stores a graph (ADR-0023 §9). */
export function workflowIsGraph(): HttpError {
  return new HttpError(
    409,
    'workflow_is_graph',
    'This project’s workflow is a graph now; open it on the Workflow page to change it',
  );
}

/** The 422 for a graph with errors: a short plain summary; the issues come from `/validate`. */
function workflowInvalid(issues: readonly GraphIssue[]): HttpError {
  const errors = issues.filter((i) => i.severity === 'error');
  const first = errors[0]?.message ?? '';
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : '';
  const count = `${errors.length} problem${errors.length === 1 ? '' : 's'}`;
  return new HttpError(
    422,
    'workflow_invalid',
    `The workflow was not saved: it has ${count}. ${first}${more}`.trim(),
  );
}

export function createWorkflowService(deps: WorkflowServiceDeps): WorkflowService {
  const redesign = createRedesignRepositories(deps.db, { now: deps.now });

  function project(projectId: string) {
    const p = deps.repos.projects.getById(projectId);
    if (p === undefined) throw notFound(`Project ${projectId} not found`);
    return p;
  }

  function v1Workflow(projectId: string): ProjectWorkflow {
    let workflow: ProjectWorkflow | undefined;
    try {
      workflow = redesign.workflow.get(projectId);
    } catch (error) {
      if (error instanceof WorkflowStoredAsGraphError) throw workflowIsGraph();
      throw error;
    }
    if (workflow === undefined) throw notFound(`Project ${projectId} not found`);
    return workflow;
  }

  async function effective(projectId: string): Promise<EffectiveWorkflow> {
    project(projectId);
    const stored = redesign.workflow.stored(projectId);
    if (stored === undefined) throw notFound(`Project ${projectId} not found`);
    const setup = await deps.setupFor(projectId);
    return effectiveWorkflow(stored, approvalsOf(setup).mode);
  }

  function changed(projectId: string): void {
    deps.publish({
      kind: 'projects-changed',
      lastEventId: deps.repos.events.maxId() ?? 0,
      sessionIds: [],
      projectIds: [projectId],
    });
  }

  async function dto(projectId: string, workflow: ProjectWorkflow): Promise<ProjectWorkflowDto> {
    const p = project(projectId);
    const [setup, skills] = await Promise.all([
      deps.setupFor(projectId),
      listProjectSkillNames(p.rootPath, deps.skills),
    ]);
    return { workflow, setup, skills };
  }

  /** What the validator checks besides the graph: the project's files, helper limit and mode. */
  async function projectFacts(projectId: string) {
    const p = project(projectId);
    const [setup, skills, agents] = await Promise.all([
      deps.setupFor(projectId),
      listProjectSkillNames(p.rootPath, deps.skills),
      listProjectAgentNames(p.rootPath, deps.skills),
    ]);
    return { setup, skills, agents };
  }

  function issuesOf(
    graph: WorkflowGraph,
    facts: { setup: ProjectAgentSetup; skills: readonly string[]; agents: readonly string[] },
  ): GraphIssue[] {
    return validateWorkflowGraph(graph, {
      skills: facts.skills,
      agents: facts.agents,
      maxConcurrentHelpers: facts.setup.maxConcurrentHelpers,
      projectMode: approvalsOf(facts.setup).mode,
    });
  }

  return {
    async get(projectId) {
      project(projectId);
      return dto(projectId, v1Workflow(projectId));
    },
    async put(projectId, body) {
      project(projectId);
      const input = UpdateWorkflowRequestSchema.parse(body);
      let saved: ProjectWorkflow;
      try {
        saved = redesign.workflow.put({ projectId, ...input });
      } catch (error) {
        if (error instanceof WorkflowStoredAsGraphError) throw workflowIsGraph();
        throw error;
      }
      changed(projectId);
      return dto(projectId, saved);
    },
    async getGraph(projectId) {
      const workflow = await effective(projectId);
      const facts = await projectFacts(projectId);
      return {
        graph: workflow.graph,
        stored: workflow.stored,
        issues: issuesOf(workflow.graph, facts),
        ...facts,
        updatedAt: workflow.updatedAt,
      };
    },
    async putGraph(projectId, body) {
      project(projectId);
      const { graph } = UpdateWorkflowGraphRequestSchema.parse(body);
      const facts = await projectFacts(projectId);
      const issues = issuesOf(graph, facts);
      if (!isGraphRunnable(issues)) throw workflowInvalid(issues);
      const saved = redesign.workflow.putGraph(projectId, graph);
      changed(projectId);
      return { graph: saved.graph, stored: 'v2', issues, ...facts, updatedAt: saved.updatedAt };
    },
    async validateGraph(projectId, body) {
      project(projectId);
      const { graph } = UpdateWorkflowGraphRequestSchema.parse(body);
      const issues = issuesOf(graph, await projectFacts(projectId));
      return { ok: isGraphRunnable(issues), issues };
    },
    effective,
  };
}
