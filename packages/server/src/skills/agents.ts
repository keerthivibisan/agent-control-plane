import { AgentToolNameSchema, MAX_AGENT_BYTES, MAX_SKILL_DESCRIPTION } from '@acp/core';
import {
  AgentDefinitionWriteRequestSchema,
  type AgentDefinitionCommitResultDto,
  type AgentDefinitionDetailDto,
  type AgentDefinitionSummaryDto,
  type AgentDefinitionWriteRequest,
} from '@acp/core/api';
import type { Logger } from '../logger.js';
import type { GitRunner } from '../workspace/index.js';
import { skillError } from './errors.js';
import { parseAgentFile, serializeAgentFile } from './frontmatter.js';
import { agentTarget, listAgentFiles } from './paths.js';
import { createFileStore, type ProjectRef } from './store.js';

/**
 * Project agent definitions, `<project>/.claude/agents/<slug>.md` (Claude Code subagents; ADR-0018
 * amendment). Same path rules, writes, git state and commit as skills (`store.ts`). The front matter
 * is `name`, `description`, an optional `tools` list and an optional `model`; the app writes no
 * other keys. A hand-edited file's other keys are kept as they are and reported as a problem.
 * A workflow stage may use an agent file (ADR-0019 §6, `workflow/agent-profile.ts`); its delete is
 * not guarded, because a missing stage file never blocks a run (the agent starts without it).
 */

export interface AgentsServiceDeps {
  git: GitRunner;
  logger?: Logger;
  /** The owner's home folder, whose `.claude` is never opened. Injected so tests never use it. */
  homeDir?: string;
}

export interface AgentsService {
  list(project: ProjectRef): Promise<AgentDefinitionSummaryDto[]>;
  get(project: ProjectRef, name: string): Promise<AgentDefinitionDetailDto>;
  create(project: ProjectRef, body: unknown): Promise<AgentDefinitionDetailDto>;
  update(project: ProjectRef, name: string, body: unknown): Promise<AgentDefinitionDetailDto>;
  delete(project: ProjectRef, name: string): Promise<void>;
  commit(project: ProjectRef, name: string): Promise<AgentDefinitionCommitResultDto>;
}

function parseWrite(body: unknown): AgentDefinitionWriteRequest {
  const parsed = AgentDefinitionWriteRequestSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const instructions = (body as { instructions?: unknown } | null)?.instructions;
  if (typeof instructions === 'string' && Buffer.byteLength(instructions) > MAX_AGENT_BYTES) {
    throw skillError('too_large', `An agent file can be at most ${MAX_AGENT_BYTES / 1024} KiB`);
  }
  throw parsed.error;
}

export function toAgentDetail(file: {
  name: string;
  text: string | null;
  problems: readonly string[];
  relFile: string;
  sizeBytes: number;
  lastCommittedAt: string | null;
  uncommitted: boolean;
}): AgentDefinitionDetailDto {
  const problems = [...file.problems];
  let description = '';
  let instructions = '';
  let tools: string[] | null = null;
  let model: string | null = null;
  if (file.text !== null) {
    const parsed = parseAgentFile(file.text);
    problems.push(...parsed.problems);
    instructions = parsed.body;
    if (parsed.fields !== null) {
      const fmName = parsed.fields['name'];
      if (fmName === undefined || fmName === '') {
        problems.push('The front matter has no name.');
      } else if (fmName !== file.name) {
        problems.push('The name in the front matter differs from the file name.');
      }
      description = parsed.fields['description'] ?? '';
      if (description.trim() === '') {
        problems.push(
          'The front matter has no description, so Claude Code cannot tell when to use the agent.',
        );
      } else if (description.length > MAX_SKILL_DESCRIPTION) {
        description = description.slice(0, MAX_SKILL_DESCRIPTION);
        problems.push(
          `The description is longer than ${MAX_SKILL_DESCRIPTION} characters; only the start is shown.`,
        );
      }
      const listed = parsed.lists['tools'];
      if (listed !== undefined) {
        tools = listed.filter((t) => AgentToolNameSchema.safeParse(t).success);
        if (tools.length < listed.length) {
          problems.push('Some entries in tools are not tool names, so they are left out here.');
        }
      }
      const rawModel = parsed.fields['model'];
      if (rawModel !== undefined) {
        const trimmed = rawModel.trim();
        if (trimmed === '' || trimmed.length > 100) {
          problems.push('The model is empty or too long, so it is not shown.');
        } else {
          model = trimmed;
        }
      }
      if (parsed.extraKeys.length > 0) {
        problems.push(
          `The front matter has other keys (${parsed.extraKeys.join(', ')}): kept as is, not used by the app.`,
        );
      }
    }
  }
  return {
    name: file.name,
    description,
    path: file.relFile,
    tools,
    model,
    sizeBytes: file.sizeBytes,
    lastCommittedAt: file.lastCommittedAt,
    uncommitted: file.uncommitted,
    problems,
    instructions,
  };
}

export function createAgentsService(deps: AgentsServiceDeps): AgentsService {
  const store = createFileStore<AgentDefinitionWriteRequest, AgentDefinitionDetailDto>(
    {
      git: deps.git,
      ...(deps.logger !== undefined && { logger: deps.logger }),
      ...(deps.homeDir !== undefined && { homeDir: deps.homeDir }),
    },
    {
      scope: 'agents',
      noun: 'agent definition',
      maxBytes: MAX_AGENT_BYTES,
      target: agentTarget,
      list: listAgentFiles,
      missingProblem: 'The agent file is missing.',
      parseWrite,
      serialize: (request, current) =>
        serializeAgentFile({
          ...request,
          // Hand-written keys (permissionMode, hooks, …) stay as they are; the app never adds any.
          extraLines: current === null ? [] : parseAgentFile(current).extraLines,
        }),
      toDetail: (_project, file) =>
        Promise.resolve(toAgentDetail({ ...file, relFile: file.target.relFile })),
    },
  );

  const summary = ({
    instructions: _instructions,
    ...rest
  }: AgentDefinitionDetailDto): AgentDefinitionSummaryDto => rest;

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
