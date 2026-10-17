import { describe, expect, it } from 'vitest';
import { ProjectAgentSetupDtoSchema } from '@acp/core/api';
import { expectError } from '../control/helpers.js';
import { setupBoard } from './helpers.js';

/** The project's approval settings (ADR-0021 §1, RL-B). Synthetic project. */

const BODY = {
  projectKey: 'WEB',
  maxConcurrentHelpers: 3,
  maxDepth: 1,
  defaultBudgetTokensPerAgent: 100_000,
  model: null,
  allowlist: { editInOwnWorktree: false, runHarnessChecks: true },
  contextFiles: [],
};

describe('project approvals (ADR-0021 §1)', () => {
  it('a new setup starts on Auto edits; PUT saves approvals and keeps them when absent', async () => {
    const s = await setupBoard();
    const url = `/api/projects/${s.project.id}/setup`;
    const created = ProjectAgentSetupDtoSchema.parse((await s.get(url)).body);
    expect(created.approvals).toEqual({ mode: 'auto-edits', commands: [] });

    const approvals = {
      mode: 'auto',
      commands: [
        { argv: ['npm'], match: 'prefix' },
        { argv: ['git', 'status'], match: 'exact' },
      ],
    };
    const saved = await s.send('put', url, { ...BODY, approvals });
    expect(saved.status).toBe(200);
    expect(ProjectAgentSetupDtoSchema.parse(saved.body).approvals).toEqual(approvals);
    // An older client (no `approvals`) does not wipe them.
    const kept = await s.send('put', url, BODY);
    expect(ProjectAgentSetupDtoSchema.parse(kept.body).approvals).toEqual(approvals);

    for (const bad of [
      { mode: 'yolo', commands: [] },
      { mode: 'auto', commands: [{ argv: ['bash', '-c'], match: 'prefix' }] },
      { mode: 'auto', commands: [{ argv: ['git', 'push'], match: 'prefix' }] },
      { mode: 'auto', commands: [{ argv: ['npm', 'run', 'x;rm'], match: 'exact' }] },
    ]) {
      expectError(await s.send('put', url, { ...BODY, approvals: bad }), 400, 'invalid_request');
    }
  });

  it('a setup saved before ADR-0021 keeps no approvals (its legacy mapping applies)', async () => {
    const s = await setupBoard();
    const { approvals: _dropped, ...legacy } = await s.board.getSetup(s.project.id);
    s.workspace.projectSetup.upsert({ ...legacy, planFirst: true });
    const url = `/api/projects/${s.project.id}/setup`;
    expect(ProjectAgentSetupDtoSchema.parse((await s.get(url)).body).approvals).toBeUndefined();
    const res = await s.send('put', url, BODY);
    expect(ProjectAgentSetupDtoSchema.parse(res.body).approvals).toBeUndefined();
  });
});
