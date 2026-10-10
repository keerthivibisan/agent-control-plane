import { SessionStatusSchema } from '@acp/core';
import { SessionDetailDtoSchema } from '@acp/core/api';
import { describe, expect, it } from 'vitest';

/**
 * `resolve.conditions` includes `development`, so @acp/core resolves to its TypeScript source and
 * these imports work without building core first (CI runs tests before `pnpm build`).
 */
describe('workspace resolution', () => {
  it('imports @acp/core and @acp/core/api from source', () => {
    expect(SessionStatusSchema.options).not.toContain('completed');
    expect(typeof SessionDetailDtoSchema.safeParse).toBe('function');
  });
});
