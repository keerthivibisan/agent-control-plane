import {
  DEFAULT_APPROVAL_MODE,
  MAX_SKILL_BYTES,
  MAX_SKILL_DESCRIPTION,
  defaultProjectWorkflow,
} from '@acp/core';
import {
  SkillWriteRequestSchema,
  type SkillCommitResultDto,
  type SkillDetailDto,
  type SkillSummaryDto,
  type SkillWriteRequest,
} from '@acp/core/api';
import type { Logger } from '../logger.js';
import type { GitRunner } from '../workspace/index.js';
import { skillError } from './errors.js';
import { parseSkillFile, serializeSkillFile } from './frontmatter.js';
import { effectiveWorkflow, nodesUsing, stagesUsing } from '../workflow/graph.js';
import { refuseWhenInUse, type WorkflowUse } from './in-use.js';
import { listSkillFolders, skillTarget } from './paths.js';
import { createFileStore, type ProjectRef } from './store.js';

/**
 * Project skills (ADR-0018, docs/redesign/README.md §4.3): list, read, write and commit
 * `<project>/.claude/skills/<slug>/SKILL.md`. The path rules, writes and git live in `store.ts`,
 * shared with agent definitions; this file is the skill format and the "used by" guard.
 */

export type SkillProject = ProjectRef;

export interface SkillsServiceDeps {
  git: GitRunner;
  now: () => Date;
  /**
   * The project's effective workflow (ADR-0023: its graph, plus the version 1 workflow it came
   * from), for "used by" and the delete guard. Default: the default workflow.
   */
  workflowOf?: (projectId: string) => WorkflowUse | Promise<WorkflowUse>;
  logger?: Logger;
  /** The owner's home folder, whose `.claude` is never opened. Injected so tests never use it. */
  homeDir?: string;
}

export interface SkillsService {
  list(project: SkillProject): Promise<SkillSummaryDto[]>;
  get(project: SkillProject, name: string): Promise<SkillDetailDto>;
  create(project: SkillProject, body: unknown): Promise<SkillDetailDto>;
  update(project: SkillProject, name: string, body: unknown): Promise<SkillDetailDto>;
  delete(project: SkillProject, name: string): Promise<void>;
  commit(project: SkillProject, name: string): Promise<SkillCommitResultDto>;
}

/** The request body; an oversize text gets `too_large` rather than a generic schema error. */
function parseWrite(body: unknown): SkillWriteRequest {
  const parsed = SkillWriteRequestSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const instructions = (body as { instructions?: unknown } | null)?.instructions;
  if (typeof instructions === 'string' && Buffer.byteLength(instructions) > MAX_SKILL_BYTES) {
    throw skillError('too_large', `SKILL.md can be at most ${MAX_SKILL_BYTES / 1024} KiB`);
  }
  throw parsed.error;
}

export function createSkillsService(deps: SkillsServiceDeps): SkillsService {
  const { now } = deps;
  const workflowOf =
    deps.workflowOf ??
    ((projectId: string): WorkflowUse =>
      effectiveWorkflow(
        { kind: 'default', workflow: defaultProjectWorkflow(projectId, now().toISOString()) },
        DEFAULT_APPROVAL_MODE,
      ));

  const store = createFileStore<SkillWriteRequest, SkillDetailDto>(
    {
      git: deps.git,
      ...(deps.logger !== undefined && { logger: deps.logger }),
      ...(deps.homeDir !== undefined && { homeDir: deps.homeDir }),
    },
    {
      scope: 'skills',
      noun: 'skill',
      maxBytes: MAX_SKILL_BYTES,
      target: skillTarget,
      list: listSkillFolders,
      missingProblem: 'There is no SKILL.md in this folder, so Claude Code ignores it.',
      parseWrite,
      serialize: (request, current) =>
        serializeSkillFile({
          ...request,
          // Keep front-matter keys the app does not edit (for example `allowed-tools`).
          extraLines: current === null ? [] : parseSkillFile(current).extraLines,
        }),
      async toDetail(project, file) {
        const problems = [...file.problems];
        let description = '';
        let instructions = '';
        if (file.text !== null) {
          const parsed = parseSkillFile(file.text);
          problems.push(...parsed.problems);
          instructions = parsed.body;
          if (parsed.fields !== null) {
            const fmName = parsed.fields['name'];
            if (fmName === undefined || fmName === '') {
              problems.push('The front matter has no name.');
            } else if (fmName !== file.name) {
              problems.push('The name in the front matter differs from the folder name.');
            }
            description = parsed.fields['description'] ?? '';
            if (description.trim() === '') {
              problems.push(
                'The front matter has no description, so Claude Code cannot tell when to use the skill.',
              );
            } else if (description.length > MAX_SKILL_DESCRIPTION) {
              description = description.slice(0, MAX_SKILL_DESCRIPTION);
              problems.push(
                `The description is longer than ${MAX_SKILL_DESCRIPTION} characters; only the start is shown.`,
              );
            }
          }
        }
        const workflow = await workflowOf(project.id);
        return {
          name: file.name,
          description,
          path: file.target.relFile,
          usedBy: stagesUsing(workflow, 'skill', file.name),
          usedByNodes: nodesUsing(workflow.graph, 'skill', file.name),
          sizeBytes: file.sizeBytes,
          lastCommittedAt: file.lastCommittedAt,
          uncommitted: file.uncommitted,
          problems,
          instructions,
        };
      },
      async beforeDelete(project, name) {
        refuseWhenInUse(await workflowOf(project.id), 'skill', name);
      },
    },
  );

  const summary = ({ instructions: _instructions, ...rest }: SkillDetailDto): SkillSummaryDto =>
    rest;

  return {
    async list(project) {
      return (await store.list(project)).map(summary);
    },
    get: (project, name) => store.get(project, name),
    create: (project, body) => store.create(project, body),
    update: (project, name, body) => store.update(project, name, body),
    delete: (project, name) => store.delete(project, name),
    commit: (project, name) => store.commit(project, name),
  };
}
