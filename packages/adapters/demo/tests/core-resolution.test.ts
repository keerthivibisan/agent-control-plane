import { describe, expect, it } from 'vitest';

describe('workspace resolution', () => {
  it('resolves @acp/core to its TypeScript source (development condition), not dist', () => {
    expect(import.meta.resolve('@acp/core')).toMatch(/packages\/core\/src\/index\.ts$/);
  });
});
