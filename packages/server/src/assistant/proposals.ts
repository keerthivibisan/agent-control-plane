import {
  AGENTS_DIR,
  AgentToolNameSchema,
  MAX_AGENT_BYTES,
  MAX_SKILL_BYTES,
  SKILL_FILE,
  SKILLS_DIR,
} from '@acp/core';
import {
  AgentDefinitionWriteRequestSchema,
  SkillWriteRequestSchema,
  type AgentDefinitionWriteRequest,
  type AssistantProposalKind,
  type SkillWriteRequest,
} from '@acp/core/api';
import { ZodError } from 'zod';
import { HttpError } from '../errors.js';
import {
  parseAgentFile,
  parseSkillFile,
  serializeAgentFile,
  serializeSkillFile,
  type AgentsService,
  type ProjectRef,
  type SkillsService,
} from '../skills/index.js';

/**
 * The assistant's `propose_skill` and `propose_agent` (ADR-0035 §3, §5). A proposal is the full
 * file text; it is checked with the Skills & Agents page's own rules (the front matter parser, the
 * write request schemas, the size caps) and written only through the ADR-0018 writer (the skills
 * and agents services: path rules, symlink checks, atomic writes). This module never touches the
 * file system itself.
 */

/** Thrown with a plain, content-free sentence the assistant (and the panel) may see. */
export class ProposalRefusedError extends Error {
  override readonly name = 'ProposalRefusedError';
}

export interface CheckedProposal {
  kind: AssistantProposalKind;
  slug: string;
  /** Repo-relative, exactly `.claude/skills/<slug>/SKILL.md` or `.claude/agents/<slug>.md`. */
  path: string;
  /** The file exactly as the writer serializes it, for the preview. */
  content: string;
  request: SkillWriteRequest | AgentDefinitionWriteRequest;
  /** Whether a file of that slug exists now. */
  exists: boolean;
}

export interface ProposalWriters {
  skills: Pick<SkillsService, 'list' | 'create' | 'update'>;
  agents: Pick<AgentsService, 'list' | 'create' | 'update'>;
}

export function proposalPath(kind: AssistantProposalKind, slug: string): string {
  return kind === 'skill' ? `${SKILLS_DIR}/${slug}/${SKILL_FILE}` : `${AGENTS_DIR}/${slug}.md`;
}

/** A refusal's sentence: the writer's own message, or the first schema issues by field. */
export function problemOf(error: unknown): string {
  if (error instanceof ProposalRefusedError || error instanceof HttpError) {
    return error.message.slice(0, 500);
  }
  if (error instanceof ZodError) {
    const issues = error.issues
      .slice(0, 3)
      .map((i) => `${i.path.length > 0 ? i.path.join('.') : 'file'}: ${i.message}`)
      .join('; ');
    return `The file does not pass the checks (${issues}).`.slice(0, 500);
  }
  return 'The file could not be written.';
}

function refuse(message: string): never {
  throw new ProposalRefusedError(message);
}

/** The write request a file's text stands for, by the page's parser and schemas. */
function requestOf(
  kind: AssistantProposalKind,
  slug: string,
  content: string,
): SkillWriteRequest | AgentDefinitionWriteRequest {
  const max = kind === 'skill' ? MAX_SKILL_BYTES : MAX_AGENT_BYTES;
  if (Buffer.byteLength(content, 'utf8') > max) {
    refuse(`The file is larger than ${max / 1024} KiB.`);
  }
  const parsed = kind === 'skill' ? parseSkillFile(content) : parseAgentFile(content);
  if (parsed.problems.length > 0 || parsed.fields === null) {
    refuse(
      parsed.problems.length > 0
        ? parsed.problems.slice(0, 3).join(' ')
        : 'The file has no front matter.',
    );
  }
  if (parsed.extraKeys.length > 0) {
    // The writer keeps only the keys the page manages, so the written file would differ from the
    // one the owner saw; refused instead of silently dropped.
    refuse(
      kind === 'skill'
        ? 'The front matter may only set name and description.'
        : 'The front matter may only set name, description, tools and model.',
    );
  }
  const fields = parsed.fields;
  if (fields['name'] !== slug) refuse('The name in the front matter must equal the slug.');
  const base = {
    name: slug,
    description: fields['description'] ?? '',
    instructions: parsed.body,
  };
  if (kind === 'skill') return SkillWriteRequestSchema.parse(base);
  const tools = parsed.lists['tools'];
  if (tools !== undefined && tools.some((t) => !AgentToolNameSchema.safeParse(t).success)) {
    refuse('Every entry in tools must be a tool name, such as Read or Bash.');
  }
  return AgentDefinitionWriteRequestSchema.parse({
    ...base,
    tools: tools ?? null,
    model: fields['model'] ?? null,
  });
}

async function existingNames(
  writers: ProposalWriters,
  kind: AssistantProposalKind,
  project: ProjectRef,
): Promise<string[]> {
  // The listing walks `.claude/<kind>` with the writer's own checks: a symlinked folder throws.
  const list =
    kind === 'skill' ? await writers.skills.list(project) : await writers.agents.list(project);
  return list.map((entry) => entry.name);
}

/**
 * Checks a proposal: the file's front matter and size (the page's rules), the slug, and whether it
 * replaces a file. Throws `ProposalRefusedError` (or the writer's `HttpError`, or a `ZodError`)
 * with the reason; `problemOf` turns any of them into a sentence.
 */
export async function checkProposal(
  writers: ProposalWriters,
  project: ProjectRef,
  input: { kind: AssistantProposalKind; slug: string; content: string; replace: boolean },
): Promise<CheckedProposal> {
  const { kind, slug, content } = input;
  const request = requestOf(kind, slug, content);
  const exists = (await existingNames(writers, kind, project)).includes(slug);
  const noun = kind === 'skill' ? 'skill' : 'agent definition';
  if (exists && !input.replace) {
    refuse(
      `A ${noun} named ${slug} already exists. Ask the owner whether to replace it, then propose it again with replace: true.`,
    );
  }
  const preview =
    kind === 'skill'
      ? serializeSkillFile(request)
      : serializeAgentFile(request as AgentDefinitionWriteRequest);
  return { kind, slug, path: proposalPath(kind, slug), content: preview, request, exists };
}

/**
 * Writes a checked proposal through the ADR-0018 writer: a replacement updates the existing file,
 * a new slug creates it. A file that appeared since the proposal (without `replace`) is refused by
 * the writer's own conflict check.
 */
export async function writeProposal(
  writers: ProposalWriters,
  project: ProjectRef,
  proposal: Pick<CheckedProposal, 'kind' | 'slug' | 'request'> & { replace: boolean },
): Promise<void> {
  const exists = (await existingNames(writers, proposal.kind, project)).includes(proposal.slug);
  const target = proposal.kind === 'skill' ? writers.skills : writers.agents;
  if (exists && proposal.replace) await target.update(project, proposal.slug, proposal.request);
  else await target.create(project, proposal.request);
}
