// Contract tests for harness setup steps and Checks blocks (ADR-0027, v0.3.0 H-0). Additive: older
// harness files, check runs and graphs still parse. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  CHECK_FAILURE_ROUTES,
  CheckRunSchema,
  HarnessManifestSchema,
  SetupRunSchema,
  WorkflowNodeSchema,
} from '../src/index.js';

const check = { id: 'lint', name: 'Lint', argv: ['pnpm', 'lint'], timeoutSec: 60, required: true };
const install = {
  id: 'install',
  name: 'Install',
  argv: ['pnpm', 'install', '--frozen-lockfile'],
  timeoutSec: 600,
  network: true,
  outputs: ['node_modules'],
};

describe('the harness file (ADR-0027 §1, §4)', () => {
  it('still reads a file without setup or labels', () => {
    expect(HarnessManifestSchema.parse({ version: 1, checks: [check] }).setup).toBeUndefined();
  });

  it('reads setup steps and labels', () => {
    const m = HarnessManifestSchema.parse({
      version: 1,
      setup: [install],
      checks: [{ ...check, labels: ['fast'] }],
    });
    expect(m.setup?.[0]?.outputs).toEqual(['node_modules']);
    expect(m.checks[0]?.labels).toEqual(['fast']);
  });

  it('refuses a path as the command, duplicate ids, too many steps, an escaping output', () => {
    const bad = [
      { setup: [{ ...install, argv: ['./install.sh'] }] },
      { setup: [install, install] },
      { setup: Array.from({ length: 6 }, (_, i) => ({ ...install, id: `s${i}` })) },
      { setup: [{ ...install, outputs: ['../outside'] }] },
      { checks: [{ ...check, labels: ['Not A Slug'] }] },
    ];
    for (const extra of bad) {
      const parsed = HarnessManifestSchema.safeParse({ version: 1, checks: [check], ...extra });
      expect(parsed.success, JSON.stringify(extra)).toBe(false);
    }
  });
});

describe('check and setup runs (ADR-0027 §1, §5)', () => {
  const run = {
    id: 'c1',
    runId: 'r1',
    agentRunId: 'a1',
    projectId: 'p1',
    checkId: 'lint',
    name: 'Lint',
    required: true,
    status: 'passed',
    exitCode: 0,
    durationMs: 10,
    outputTail: '',
    startedAt: '2026-10-23T09:00:00.000Z',
  };

  it('keeps older check runs and reads the place and block', () => {
    expect(CheckRunSchema.parse(run).place).toBeUndefined();
    expect(
      CheckRunSchema.parse({ ...run, place: 'change', blockNodeId: 'fast-checks' }),
    ).toMatchObject({ place: 'change', blockNodeId: 'fast-checks' });
  });

  it('reads a refused setup run', () => {
    const setup = SetupRunSchema.parse({
      id: 's1',
      projectId: 'p1',
      runId: 'r1',
      agentRunId: 'a1',
      stepId: 'install',
      name: 'Install',
      status: 'refused',
      exitCode: null,
      durationMs: 0,
      outputTail: 'Setup may not use the network in this project.',
      startedAt: '2026-10-23T09:00:00.000Z',
      commit: null,
    });
    expect(setup.status).toBe('refused');
  });
});

describe('Checks blocks (ADR-0027 §5)', () => {
  it('reads the block before ADR-0027 unchanged', () => {
    const node = WorkflowNodeSchema.parse({ type: 'checks', id: 'checks', label: 'Checks' });
    expect(node).toEqual({ type: 'checks', id: 'checks', label: 'Checks' });
  });

  it('reads a block on a change that selects labels and reworks the helper', () => {
    const node = WorkflowNodeSchema.parse({
      type: 'checks',
      id: 'fast-checks',
      label: 'Fast checks',
      place: 'change',
      select: { kind: 'labels', labels: ['fast'] },
      onFailure: 'helper',
    });
    expect(node).toMatchObject({ place: 'change', onFailure: 'helper' });
  });

  it('allows a failure route per place, the lead first where it can decide', () => {
    expect(CHECK_FAILURE_ROUTES).toEqual({
      change: ['lead', 'owner', 'helper'],
      merge: ['lead', 'owner'],
      branch: ['owner'],
    });
  });
});
