// Contract tests for where a ticket branch starts (ADR-0025 §10, v0.3.0 G-H). Additive: older
// strategies, ticket settings and ticket branches still parse. Synthetic names only.
import { describe, expect, it } from 'vitest';
import { TicketBranchDtoSchema } from '../src/api/index.js';
import {
  BranchStrategySchema,
  TicketBranchPrefsPatchSchema,
  TicketBranchPrefsSchema,
  branchStrategyPreset,
} from '../src/index.js';

const SHA = 'b'.repeat(40);

describe('start-from branch', () => {
  it('keeps older strategies and ticket settings', () => {
    const s = BranchStrategySchema.parse(branchStrategyPreset('github-flow'));
    expect(s.defaultSourceBranch).toBeUndefined();
    expect(TicketBranchPrefsSchema.parse({ target: 'dev' }).from).toBeUndefined();
  });

  it('reads a project default and a ticket choice, and a reset to the project', () => {
    const s = BranchStrategySchema.parse({
      ...branchStrategyPreset('github-flow'),
      defaultSourceBranch: 'release/1.0',
    });
    expect(s.defaultSourceBranch).toBe('release/1.0');
    expect(TicketBranchPrefsSchema.parse({ from: 'dev' }).from).toBe('dev');
    expect(TicketBranchPrefsPatchSchema.parse({ from: null }).from).toBeNull();
    expect(TicketBranchPrefsSchema.safeParse({ from: '-x' }).success).toBe(false);
  });

  it('shows the source on a ticket branch only when it differs', () => {
    const row = {
      runId: 'r1',
      branch: 'acp/WEB-1',
      baseBranch: 'main',
      baseCommit: SHA,
      headCommit: SHA,
      state: 'open',
      mergedCommit: null,
      createdAt: '2026-10-24T09:00:00.000Z',
      updatedAt: '2026-10-24T09:00:00.000Z',
    };
    expect(TicketBranchDtoSchema.parse(row).sourceBranch).toBeUndefined();
    expect(TicketBranchDtoSchema.parse({ ...row, sourceBranch: 'release/1.0' }).sourceBranch).toBe(
      'release/1.0',
    );
  });
});
