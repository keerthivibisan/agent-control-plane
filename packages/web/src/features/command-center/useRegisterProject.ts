import { RegisterProjectInputSchema, type RegisterProjectInput } from '@acp/core';
import type { ProjectDto } from '@acp/core/api';
import { useCallback, useState } from 'react';
import { ApiError, registerProject } from '../../lib/api';
import { useQueryStore } from '../../lib/query';

export type RegisterResult =
  { ok: true; project: ProjectDto } | { ok: false; error: ApiError | string };

/**
 * POST /api/projects. Validates locally with the core input schema first; the server still decides
 * (it checks the path exists and normalizes it). On success, every view that depends on project
 * association is refetched.
 */
export function useRegisterProject() {
  const store = useQueryStore();
  const [pending, setPending] = useState(false);

  const register = useCallback(
    async (input: RegisterProjectInput): Promise<RegisterResult> => {
      const parsed = RegisterProjectInputSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
      }
      setPending(true);
      try {
        const project = await registerProject(store.client, parsed.data);
        store.invalidate((key) => !key.endsWith('/health'));
        return { ok: true, project };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, error: e };
        throw e;
      } finally {
        setPending(false);
      }
    },
    [store],
  );

  return { register, pending };
}
