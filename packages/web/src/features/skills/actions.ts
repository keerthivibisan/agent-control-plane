import { useCallback, useState } from 'react';
import { AgentToolNameSchema, MAX_AGENT_BYTES, MAX_SKILL_BYTES, SkillNameSchema } from '@acp/core';
import { ApiError, isSkillsPath, type ApiClient } from '../../lib/api';
import { useQueryStore } from '../../lib/query';
import { AGENTS_COPY, SKILLS_COPY } from '../../lib/copy';

export interface SkillActionState<R> {
  pending: boolean;
  error: ApiError | null;
  result: R | null;
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError({
    kind: 'parse',
    path: '',
    message: e instanceof Error ? e.message : 'unknown client error',
  });
}

/**
 * One skills mutation (`fn` is a module-level function from lib/api.ts). Afterwards, also after a
 * refusal, the project's cached skill list and skill pages refetch: a refusal often means the
 * files changed underneath (someone committed, a stage started using the skill).
 */
export function useSkillAction<A extends unknown[], R>(
  projectId: string,
  fn: (client: ApiClient, projectId: string, ...args: A) => Promise<R>,
  /** Which cached paths to refetch afterwards (default: the project's skills). */
  scope: (projectId: string) => (key: string) => boolean = isSkillsPath,
) {
  const store = useQueryStore();
  const [state, setState] = useState<SkillActionState<R>>({
    pending: false,
    error: null,
    result: null,
  });
  const run = useCallback(
    async (...args: A): Promise<R | null> => {
      setState({ pending: true, error: null, result: null });
      try {
        const result = await fn(store.client, projectId, ...args);
        setState({ pending: false, error: null, result });
        return result;
      } catch (e) {
        setState({ pending: false, error: toApiError(e), result: null });
        return null;
      } finally {
        store.invalidate(scope(projectId));
      }
    },
    [store, fn, projectId, scope],
  );
  const reset = useCallback(() => setState({ pending: false, error: null, result: null }), []);
  return { ...state, run, reset };
}

export interface SkillForm {
  name: string;
  description: string;
  instructions: string;
}

export interface SkillFormErrors {
  name?: string;
  description?: string;
  size?: string;
}

const encoder = new TextEncoder();

/**
 * About the size the server writes: the front matter plus the instructions. The server's 64 KiB
 * check is the real one; this only warns early.
 */
export function skillFileBytes(form: SkillForm): number {
  const head = `---\nname: ${form.name}\ndescription: "${form.description}"\n---\n\n`;
  return encoder.encode(head + form.instructions).length + 1;
}

export function validateSkillForm(
  form: SkillForm,
  options: { isNew: boolean; existing: readonly string[] },
): SkillFormErrors {
  const C = SKILLS_COPY.editor;
  const errors: SkillFormErrors = {};
  if (options.isNew) {
    if (!SkillNameSchema.safeParse(form.name).success) errors.name = C.nameInvalid;
    else if (options.existing.includes(form.name)) errors.name = C.nameTaken;
  }
  if (form.description.trim() === '') errors.description = C.descriptionRequired;
  if (skillFileBytes(form) > MAX_SKILL_BYTES) errors.size = C.tooLarge;
  return errors;
}

/** An agent definition being edited (`.claude/agents/<name>.md`). */
export interface AgentForm extends SkillForm {
  /** Null: "All tools" (no `tools` key, Claude Code's default). */
  tools: readonly string[] | null;
  /** Empty: the default model (no `model` key). */
  model: string;
}

export interface AgentFormErrors extends SkillFormErrors {
  tools?: string;
  model?: string;
}

/** The longest list the server accepts (`AgentDefinitionWriteRequestSchema`). */
export const MAX_AGENT_TOOLS = 50;

export function isToolName(tool: string): boolean {
  return AgentToolNameSchema.safeParse(tool).success;
}

/** About the size the server writes; the server's 64 KiB check is the real one. */
export function agentFileBytes(form: AgentForm): number {
  const tools = form.tools === null ? '' : `tools: ${form.tools.join(', ')}\n`;
  const model = form.model.trim() === '' ? '' : `model: ${form.model.trim()}\n`;
  return skillFileBytes(form) + encoder.encode(tools + model).length;
}

export function validateAgentForm(
  form: AgentForm,
  options: { isNew: boolean; existing: readonly string[] },
): AgentFormErrors {
  const errors: AgentFormErrors = validateSkillForm(form, options);
  if (errors.name === SKILLS_COPY.editor.nameTaken) errors.name = AGENTS_COPY.editor.nameTaken;
  if (form.tools !== null) {
    if (form.tools.length > MAX_AGENT_TOOLS || form.tools.some((t) => !isToolName(t))) {
      errors.tools = AGENTS_COPY.editor.toolInvalid;
    }
  }
  if (form.model.trim().length > 100) errors.model = AGENTS_COPY.editor.modelTooLong;
  if (agentFileBytes(form) > MAX_AGENT_BYTES) errors.size = AGENTS_COPY.editor.tooLarge;
  else delete errors.size;
  return errors;
}

/** The PUT/POST body: trimmed description, null model when empty. */
export function agentRequest(form: AgentForm) {
  return {
    name: form.name,
    description: form.description.trim(),
    tools: form.tools === null ? null : [...form.tools],
    model: form.model.trim() === '' ? null : form.model.trim(),
    instructions: form.instructions,
  };
}
