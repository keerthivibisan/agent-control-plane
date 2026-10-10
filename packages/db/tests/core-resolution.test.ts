import { describe, expect, it } from 'vitest';

describe('workspace resolution', () => {
  it('resolves @acp/core to its TypeScript source under vitest (development condition)', () => {
    expect(import.meta.resolve('@acp/core')).toMatch(/\/packages\/core\/src\/index\.ts$/);
  });
});
