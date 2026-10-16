import type { ProjectAgentSetup, ProjectWorkflow } from '@acp/core';
import {
  UpdateWorkflowRequestSchema,
  type ProjectWorkflowDto,
  type StreamNoticeDto,
} from '@acp/core/api';
import { createRedesignRepositories, type AcpDatabase, type Repositories } from '@acp/db';
import { notFound } from '../errors.js';
import { listProjectSkillNames, type SkillListingOptions } from './skill-names.js';

/**
 * A project's workflow (docs/redesign/README.md §4.2, ADR-0019): which optional stages run, and
 * each agent stage's model and skill. Limits and the allowlist stay in the agent setup (one source
 * for each value), so the DTO carries the setup alongside, plus the project's skill names so the
 * page can offer them and flag a mapped skill that no longer exists. A mapped skill that does not
 * exist is accepted: the agent starts without it (ADR-0019 §4).
 */
export interface WorkflowService {
  get(projectId: string): Promise<ProjectWorkflowDto>;
  /** Replaces the stage configuration (`UpdateWorkflowRequest`). */
  put(projectId: string, body: unknown): Promise<ProjectWorkflowDto>;
  /** The workflow a new run of this project follows (the default until the owner saves one). */
  workflowFor(projectId: string): ProjectWorkflow;
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

export function createWorkflowService(deps: WorkflowServiceDeps): WorkflowService {
  const redesign = createRedesignRepositories(deps.db, { now: deps.now });

  function project(projectId: string) {
    const p = deps.repos.projects.getById(projectId);
    if (p === undefined) throw notFound(`Project ${projectId} not found`);
    return p;
  }

  function workflowFor(projectId: string): ProjectWorkflow {
    const workflow = redesign.workflow.get(projectId);
    if (workflow === undefined) throw notFound(`Project ${projectId} not found`);
    return workflow;
  }

  async function dto(projectId: string, workflow: ProjectWorkflow): Promise<ProjectWorkflowDto> {
    const p = project(projectId);
    const [setup, skills] = await Promise.all([
      deps.setupFor(projectId),
      listProjectSkillNames(p.rootPath, deps.skills),
    ]);
    return { workflow, setup, skills };
  }

  return {
    async get(projectId) {
      project(projectId);
      return dto(projectId, workflowFor(projectId));
    },
    async put(projectId, body) {
      project(projectId);
      const input = UpdateWorkflowRequestSchema.parse(body);
      const saved = redesign.workflow.put({ projectId, ...input });
      deps.publish({
        kind: 'projects-changed',
        lastEventId: deps.repos.events.maxId() ?? 0,
        sessionIds: [],
        projectIds: [projectId],
      });
      return dto(projectId, saved);
    },
    workflowFor,
  };
}
