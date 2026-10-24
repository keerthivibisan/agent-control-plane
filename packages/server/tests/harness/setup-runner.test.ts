import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SetupRunSchema, type HarnessCheck, type HarnessSetupStep, type SetupRun } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  ChecksShutdown,
  BRANCH_SETUP_NOTE,
  NETWORK_REFUSED_NOTE,
  checksNotRun,
  createCheckRunner,
  setupFailureNote,
  type CheckSpawnFn,
  type CheckSpawnOptions,
} from '../../src/harness/index.js';
import { tempDir, write } from '../workspace/helpers.js';

/**
 * ADR-0027 §1–2: setup steps run with the checks' policy (ADR-0017 §3): an argument list with a
 * bare command name, no shell, their own process group, a filtered environment, a time limit, and
 * the redacted last 16 KiB of output. In order; the first that does not pass stops the rest; a
 * step that declares `network: true` is refused, never started, while the project switch is off.
 */

const SCRIPTS: Record<string, string> = {
  'install.mjs': [
    "import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';",
    "mkdirSync('deps', { recursive: true });",
    "writeFileSync('deps/installed.txt', 'yes');",
    "appendFileSync('order.log', 'install\\n');",
    "console.log('installed with token=sk_live_abcdef123456');",
  ].join('\n'),
  'gen.mjs': [
    "import { appendFileSync } from 'node:fs';",
    "appendFileSync('order.log', 'gen\\n');",
    "console.log('generated');",
  ].join('\n'),
  'fail.mjs': "console.error('could not resolve a package'); process.exit(7);",
  'env.mjs': 'console.log(JSON.stringify(Object.keys(process.env)));',
  'hang.mjs': [
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "writeFileSync('grandchild.pid', String(child.pid));",
    "console.log('started');",
    'setInterval(() => {}, 1000);',
  ].join('\n'),
};

function checkout(): string {
  const root = tempDir('acp-setup-');
  for (const [name, body] of Object.entries(SCRIPTS)) write(root, `scripts/${name}`, body);
  return root;
}

const step = (
  id: string,
  argv: string[],
  over: Partial<HarnessSetupStep> = {},
): HarnessSetupStep => ({ id, name: `Step ${id}`, argv, timeoutSec: 30, ...over });

function spyingSpawn(): {
  spawn: CheckSpawnFn;
  calls: { file: string; args: string[]; options: CheckSpawnOptions }[];
} {
  const calls: { file: string; args: string[]; options: CheckSpawnOptions }[] = [];
  return {
    calls,
    spawn: (file, args, options) => {
      calls.push({ file, args: [...args], options });
      return spawn(file, args, options);
    },
  };
}

let seq = 0;
const ids = () => `setup-${++seq}`;
const base = {
  projectId: 'p1',
  runId: 'r1',
  agentRunId: 'a1',
  commit: 'a'.repeat(40),
  networkAllowed: false,
};

function expectValid(results: SetupRun[]): void {
  for (const r of results) expect(SetupRunSchema.safeParse(r).success).toBe(true);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('createCheckRunner().runSetup', { timeout: 30_000 }, () => {
  it('runs the steps in order with argv, no shell, its own process group and a filtered env', async () => {
    const root = checkout();
    const { spawn: spy, calls } = spyingSpawn();
    const runner = createCheckRunner({
      spawn: spy,
      newId: ids,
      now: () => new Date('2026-10-23T10:00:00.000Z'),
      env: { PATH: process.env['PATH'], HOME: '/tmp', ACP_SECRET: 'x', GIT_DIR: '/elsewhere' },
    });
    const seen: string[] = [];
    const results = await runner.runSetup({
      ...base,
      root,
      steps: [
        step('install', ['node', 'scripts/install.mjs']),
        step('gen', ['node', 'scripts/gen.mjs']),
        step('env', ['node', 'scripts/env.mjs']),
      ],
      onResult: (r) => seen.push(r.stepId),
    });
    expectValid(results);
    expect(seen).toEqual(['install', 'gen', 'env']);
    expect(results.map((r) => r.status)).toEqual(['passed', 'passed', 'passed']);
    expect(results[0]).toMatchObject({
      projectId: 'p1',
      runId: 'r1',
      agentRunId: 'a1',
      stepId: 'install',
      name: 'Step install',
      exitCode: 0,
      commit: 'a'.repeat(40),
      startedAt: '2026-10-23T10:00:00.000Z',
    });
    // Redacted, as for checks.
    expect(results[0]?.outputTail).toContain('installed with token=');
    expect(results[0]?.outputTail).not.toContain('sk_live_abcdef123456');
    expect(readFileSync(join(root, 'order.log'), 'utf8')).toBe('install\ngen\n');
    expect(existsSync(join(root, 'deps/installed.txt'))).toBe(true);
    const env = JSON.parse(results[2]?.outputTail ?? '[]') as string[];
    expect(env).toContain('PATH');
    expect(env.filter((k) => k.startsWith('ACP_') || k.startsWith('GIT_'))).toEqual([]);
    for (const c of calls) {
      expect(c.file).toBe('node');
      expect(c.options.shell).toBe(false);
      expect(c.options.cwd).toBe(root);
      expect(c.options.detached).toBe(process.platform !== 'win32');
    }
  });

  it('stops at the first step that does not pass', async () => {
    const root = checkout();
    const { spawn: spy, calls } = spyingSpawn();
    const results = await createCheckRunner({ spawn: spy }).runSetup({
      ...base,
      root,
      steps: [step('fail', ['node', 'scripts/fail.mjs']), step('gen', ['node', 'scripts/gen.mjs'])],
    });
    expectValid(results);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ stepId: 'fail', status: 'failed', exitCode: 7 });
    expect(results[0]?.outputTail).toContain('could not resolve a package');
    expect(calls).toHaveLength(1);
    expect(existsSync(join(root, 'order.log'))).toBe(false);
    expect(setupFailureNote(results[0] as SetupRun)).toBe(
      "Setup step 'Step fail' failed (exit 7).",
    );
  });

  it('refuses a network step while the switch is off, without starting anything', async () => {
    const root = checkout();
    const { spawn: spy, calls } = spyingSpawn();
    const runner = createCheckRunner({ spawn: spy });
    const steps = [
      step('install', ['node', 'scripts/install.mjs'], { network: true }),
      step('gen', ['node', 'scripts/gen.mjs']),
    ];
    const refused = await runner.runSetup({ ...base, root, steps });
    expectValid(refused);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ status: 'refused', exitCode: null, durationMs: 0 });
    expect(refused[0]?.outputTail).toContain(NETWORK_REFUSED_NOTE);
    expect(calls).toHaveLength(0);
    expect(existsSync(join(root, 'deps'))).toBe(false);
    expect(setupFailureNote(refused[0] as SetupRun)).toBe(
      'Setup step \'Step install\' was not run: it uses the network, and "Setup may use the network" is off.',
    );

    // The owner's switch on: it runs.
    const allowed = await runner.runSetup({ ...base, root, steps, networkAllowed: true });
    expect(allowed.map((r) => r.status)).toEqual(['passed', 'passed']);
    expect(calls).toHaveLength(2);
  });

  it('F-2: refuses a branch-managing git step without starting anything; it stops the rest', async () => {
    for (const argv of [
      ['git', 'checkout', 'dev'],
      ['git', 'push', 'origin', 'HEAD'],
      ['sh', '-c', 'git reset --hard main'],
      ['gh', 'pr', 'merge', '1'],
    ]) {
      const root = checkout();
      const { spawn: spy, calls } = spyingSpawn();
      // With the network switch on too: the branch rule never depends on it.
      const results = await createCheckRunner({ spawn: spy }).runSetup({
        ...base,
        networkAllowed: true,
        root,
        steps: [step('switch', argv), step('gen', ['node', 'scripts/gen.mjs'])],
      });
      expectValid(results);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ status: 'refused', exitCode: null, durationMs: 0 });
      expect(results[0]?.outputTail).toContain(BRANCH_SETUP_NOTE);
      expect(calls).toHaveLength(0);
      expect(existsSync(join(root, 'order.log'))).toBe(false);
      expect(setupFailureNote(results[0] as SetupRun)).toBe(
        "Setup step 'Step switch' was not run: it changes branches, and the app owns branches and commits.",
      );
    }
  });

  it('F-2: a reading git step still runs', async () => {
    const root = checkout();
    const { spawn: spy, calls } = spyingSpawn();
    const results = await createCheckRunner({ spawn: spy }).runSetup({
      ...base,
      root,
      steps: [step('version', ['git', '--version'])],
    });
    expect(results[0]?.status).toBe('passed');
    expect(calls).toHaveLength(1);
  });

  it('refuses a step whose first word is not a bare command name', async () => {
    const root = checkout();
    const { spawn: spy, calls } = spyingSpawn();
    const results = await createCheckRunner({ spawn: spy }).runSetup({
      ...base,
      root,
      steps: [step('abs', ['/bin/sh', '-c', 'echo hi'])],
    });
    expectValid(results);
    expect(results[0]).toMatchObject({ status: 'error', exitCode: null });
    expect(calls).toHaveLength(0);
  });

  it('stops a step at its time limit, with its child processes', async () => {
    const root = checkout();
    const [result] = await createCheckRunner({ killGraceMs: 200 }).runSetup({
      ...base,
      root,
      steps: [step('hang', ['node', 'scripts/hang.mjs'], { timeoutSec: 1 })],
    });
    expect(result).toMatchObject({ status: 'timed-out', exitCode: null });
    expect(result?.outputTail).toContain('Stopped after 1 s: the time limit was reached.');
    const pid = Number(readFileSync(join(root, 'grandchild.pid'), 'utf8'));
    await expect.poll(() => isAlive(pid), { timeout: 3000 }).toBe(false);
    expect(setupFailureNote(result as SetupRun)).toBe("Setup step 'Step hang' timed out.");
  }, 15_000);

  it('records a step the app stopped as interrupted', async () => {
    const root = checkout();
    const controller = new AbortController();
    controller.abort(new ChecksShutdown());
    const results = await createCheckRunner().runSetup({
      ...base,
      root,
      steps: [step('gen', ['node', 'scripts/gen.mjs'])],
      signal: controller.signal,
    });
    expect(results[0]).toMatchObject({ status: 'interrupted' });
    expect(existsSync(join(root, 'order.log'))).toBe(false);
  });
});

describe('checksNotRun', () => {
  const checks: HarnessCheck[] = [
    { id: 'lint', name: 'Lint', argv: ['pnpm', 'lint'], timeoutSec: 60, required: true },
    { id: 'e2e', name: 'E2E', argv: ['pnpm', 'e2e'], timeoutSec: 60, required: false },
  ];
  const input = { checks, projectId: 'p1', runId: 'r1', agentRunId: null };

  it('records every check as not run with the failed step, never as a pass', () => {
    const results = checksNotRun(input, { name: 'Install', status: 'failed', exitCode: 1 });
    expect(results.map((r) => [r.checkId, r.status, r.required])).toEqual([
      ['lint', 'skipped', true],
      ['e2e', 'skipped', false],
    ]);
    expect(results[0]?.outputTail).toContain("Not run: Setup step 'Install' failed (exit 1).");
  });

  it('records them as interrupted when the app stopped during the setup (WG-F3)', () => {
    const results = checksNotRun(input, { name: 'Install', status: 'interrupted', exitCode: null });
    expect(results.map((r) => r.status)).toEqual(['interrupted', 'interrupted']);
  });
});
