import { useCallback, useState } from 'react';
import { MAX_SKILL_BYTES, SkillNameSchema } from '@acp/core';
import { ApiError, isSkillsPath, type ApiClient } from '../../lib/api';
import { useQueryStore } from '../../lib/query';
import { SKILLS_COPY } from '../../lib/copy';

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
        store.invalidate(isSkillsPath(projectId));
      }
    },
    [store, fn, projectId],
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
