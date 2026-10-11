import { RegisterProjectInputSchema, type RegisterProjectInput } from '@acp/core';
import type { ProjectDto } from '@acp/core/api';
import { useCallback, useState } from 'react';
import { ApiError, registerProject } from '../../lib/api';
import { SETUP_COPY } from '../../lib/copy';
import { useQueryStore } from '../../lib/query';

export interface FieldErrors {
  name?: string;
  rootPath?: string;
}

export type RegisterResult =
  | { ok: true; project: ProjectDto }
  /** Caught before calling the server: one plain message per field. */
  | { ok: false; kind: 'invalid'; fields: FieldErrors }
  /** The server (or the network) said no: a plain message, and the raw error for Details. */
  | { ok: false; kind: 'server'; message: string; error: ApiError };

const E = SETUP_COPY.errors;

/**
 * Checks the form the way the core schema does, but says what to do in plain words instead of the
 * schema's messages. The schema still runs afterwards as the single authority.
 */
export function validateProjectInput(input: RegisterProjectInput): FieldErrors {
  const fields: FieldErrors = {};
  if (input.name.length === 0) fields.name = E.nameMissing;
  else if (input.name.length > 200) fields.name = E.nameTooLong;
  if (input.rootPath.length === 0) fields.rootPath = E.pathMissing;
  else if (!RegisterProjectInputSchema.shape.rootPath.safeParse(input.rootPath).success) {
    fields.rootPath = E.pathNotAbsolute;
  }
  return fields;
}

/** Plain words for a failed POST /api/projects; the raw code and message stay in Details. */
export function registerErrorMessage(error: ApiError): string {
  if (error.kind === 'http') {
    if (error.code === 'invalid_root') return E.notFound;
    if (error.code === 'conflict') return E.duplicate;
  }
  return E.generic;
}

/**
 * POST /api/projects. Validates locally first; the server still decides (it checks the folder
 * exists and normalizes it). On success every view that depends on projects is refetched.
 */
export function useRegisterProject() {
  const store = useQueryStore();
  const [pending, setPending] = useState(false);

  const register = useCallback(
    async (raw: RegisterProjectInput): Promise<RegisterResult> => {
      const input = { name: raw.name.trim(), rootPath: raw.rootPath.trim() };
      const fields = validateProjectInput(input);
      const parsed = RegisterProjectInputSchema.safeParse(input);
      if (Object.keys(fields).length > 0 || !parsed.success) {
        return {
          ok: false,
          kind: 'invalid',
          fields: fields.name || fields.rootPath ? fields : { rootPath: E.generic },
        };
      }
      setPending(true);
      try {
        const project = await registerProject(store.client, parsed.data);
        store.invalidate((key) => !key.endsWith('/health'));
        return { ok: true, project };
      } catch (e) {
        if (e instanceof ApiError) {
          return { ok: false, kind: 'server', message: registerErrorMessage(e), error: e };
        }
        throw e;
      } finally {
        setPending(false);
      }
    },
    [store],
  );

  return { register, pending };
}
