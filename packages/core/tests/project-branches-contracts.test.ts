// Contract tests for listing and creating a project's branches (ADR-0025 §8, v0.3.0 G-F).
// Synthetic names only.
import { describe, expect, it } from 'vitest';
import { CreateBranchRequestSchema, ProjectBranchesDtoSchema } from '../src/api/index.js';

const SHA = 'a'.repeat(40);

describe('project branches', () => {
  it('reads a list with the current branch and origin presence', () => {
    const dto = ProjectBranchesDtoSchema.parse({
      current: 'main',
      hasOrigin: true,
      branches: [
        { name: 'dev', commit: SHA, current: false, onOrigin: false },
        { name: 'main', commit: SHA, current: true, onOrigin: true },
      ],
      truncated: false,
    });
    expect(dto.branches.map((b) => b.name)).toEqual(['dev', 'main']);
  });

  it('creates from a local branch, refusing names git would misread', () => {
    expect(CreateBranchRequestSchema.parse({ name: 'dev', from: 'main' })).toEqual({
      name: 'dev',
      from: 'main',
    });
    for (const name of ['-f', 'HEAD', 'refs/heads/x', 'a..b', 'x.lock', 'a b', 'feat/.x', '']) {
      expect(CreateBranchRequestSchema.safeParse({ name, from: 'main' }).success, name).toBe(false);
      expect(CreateBranchRequestSchema.safeParse({ name: 'ok', from: name }).success, name).toBe(
        false,
      );
    }
  });
});
