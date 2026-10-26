// Synthetic temp git repo only (R-G, for R-E's Harness page history).
import { describe, expect, it } from 'vitest';
import { branchStrategyPreset } from '@acp/core';
import {
  CheckRunDtoSchema,
  HarnessStatusDtoSchema,
  ProjectAgentSetupDtoSchema,
  SetupRunDtoSchema,
} from '@acp/core/api';
import { expectError } from '../control/helpers.js';
import { PASSING_WHEN_FIXED, setupBoard } from './helpers.js';

describe('GET /api/projects/:id/harness/checks (main-branch history)', () => {
  it('lists past "Run checks now" results, newest first, and is empty before any run', async () => {
    const s = await setupBoard({ files: { 'README.md': 'x\n', ...PASSING_WHEN_FIXED } });
    const path = `/api/projects/${s.project.id}/harness/checks`;
    const empty = await s.get(path);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    expect((await s.post(path, {})).status).toBe(200);
    s.clock.now = new Date(s.clock.now.getTime() + 60_000);
    expect((await s.post(path, {})).status).toBe(200);

    const res = await s.get(path);
    expect(res.status).toBe(200);
    const runs = CheckRunDtoSchema.array().parse(res.body);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.runId === null && r.checkId === 'test')).toBe(true);
    expect(runs[0]?.startedAt.localeCompare(runs[1]?.startedAt ?? '')).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('is 404 for an unknown project', async () => {
    const s = await setupBoard();
    expectError(await s.get('/api/projects/nope/harness/checks'), 404, 'not_found');
  });
});

/** ADR-0027: a harness with one setup step (it may need the network) the check depends on. */
function withSetup(network: boolean): Record<string, string> {
  return {
    'README.md': 'x\n',
    '.acp/harness.json': JSON.stringify({
      version: 1,
      setup: [
        {
          id: 'prepare',
          name: 'Prepare',
          argv: ['node', 'prepare.mjs'],
          timeoutSec: 30,
          ...(network && { network: true }),
          outputs: ['prepared'],
        },
      ],
      checks: [
        {
          id: 'test',
          name: 'Unit tests',
          argv: ['node', 'check.mjs'],
          timeoutSec: 30,
          required: true,
          labels: ['fast'],
        },
      ],
    }),
    'prepare.mjs':
      "import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('prepared'); writeFileSync('prepared/ok', 'y'); console.log('prepared');",
    'check.mjs':
      "import { existsSync } from 'node:fs'; process.exit(existsSync('prepared/ok') ? 0 : 4);",
  };
}

const SETUP_BODY = {
  projectKey: 'WEB',
  maxConcurrentHelpers: 3,
  maxDepth: 1,
  defaultBudgetTokensPerAgent: 100_000,
  model: null,
  contextFiles: [],
};

describe('the Harness API with setup steps (ADR-0027)', () => {
  it('shows the setup, runs it before "Run checks now" and lists its runs', async () => {
    const s = await setupBoard({ files: withSetup(false) });
    const id = s.project.id;
    const status = HarnessStatusDtoSchema.parse((await s.get(`/api/projects/${id}/harness`)).body);
    expect(status.setup).toEqual([
      expect.objectContaining({ id: 'prepare', name: 'Prepare', outputs: ['prepared'] }),
    ]);
    expect(status.checks[0]?.labels).toEqual(['fast']);
    expect((await s.get(`/api/projects/${id}/harness/setup-runs`)).body).toEqual([]);

    const ran = await s.post(`/api/projects/${id}/harness/checks`, {});
    expect(ran.status).toBe(200);
    const results = CheckRunDtoSchema.array().parse(ran.body);
    expect(results.map((r) => [r.checkId, r.status, r.place])).toEqual([
      ['test', 'passed', 'main'],
    ]);
    const history = CheckRunDtoSchema.array().parse(
      (await s.get(`/api/projects/${id}/harness/checks`)).body,
    );
    expect(history.map((r) => r.place)).toEqual(['main']);
    const setupRuns = SetupRunDtoSchema.array().parse(
      (await s.get(`/api/projects/${id}/harness/setup-runs`)).body,
    );
    expect(setupRuns.map((r) => [r.stepId, r.status, r.runId])).toEqual([
      ['prepare', 'passed', null],
    ]);
    expect(setupRuns[0]?.outputTail).toContain('prepared');
    expectError(await s.get('/api/projects/nope/harness/setup-runs'), 404, 'not_found');
  }, 60_000);

  it('refuses a network step until the owner turns the switch on, keeping the other settings', async () => {
    const s = await setupBoard({ files: withSetup(true) });
    const id = s.project.id;
    const url = `/api/projects/${id}/setup`;
    const approvals = { mode: 'auto', commands: [{ argv: ['npm'], match: 'prefix' }] };
    const branching = branchStrategyPreset('github-flow');
    const first = await s.send('put', url, { ...SETUP_BODY, approvals, branching });
    expect(first.status).toBe(200);
    expect(ProjectAgentSetupDtoSchema.parse(first.body).setupNetwork).toBeUndefined();

    const refused = CheckRunDtoSchema.array().parse(
      (await s.post(`/api/projects/${id}/harness/checks`, {})).body,
    );
    expect(refused.map((r) => [r.status, r.place])).toEqual([['skipped', 'main']]);
    expect(refused[0]?.outputTail).toContain('"Setup may use the network" is off');
    const refusedRuns = SetupRunDtoSchema.array().parse(
      (await s.get(`/api/projects/${id}/harness/setup-runs`)).body,
    );
    expect(refusedRuns.map((r) => r.status)).toEqual(['refused']);

    // The web's switch sends no approvals, allowlist or branching: they are kept.
    const on = ProjectAgentSetupDtoSchema.parse(
      (await s.send('put', url, { ...SETUP_BODY, setupNetwork: true })).body,
    );
    expect(on).toMatchObject({ setupNetwork: true, approvals, branching });
    // Absent keeps it.
    const kept = ProjectAgentSetupDtoSchema.parse(
      (await s.send('put', url, { ...SETUP_BODY, maxConcurrentHelpers: 2 })).body,
    );
    expect(kept).toMatchObject({ setupNetwork: true, maxConcurrentHelpers: 2, approvals });

    s.clock.now = new Date(s.clock.now.getTime() + 60_000);
    const passed = CheckRunDtoSchema.array().parse(
      (await s.post(`/api/projects/${id}/harness/checks`, {})).body,
    );
    expect(passed.map((r) => r.status)).toEqual(['passed']);
    const latest = SetupRunDtoSchema.array().parse(
      (await s.get(`/api/projects/${id}/harness/setup-runs`)).body,
    );
    expect(latest.map((r) => r.status)).toEqual(['passed', 'refused']);
  }, 60_000);
});
