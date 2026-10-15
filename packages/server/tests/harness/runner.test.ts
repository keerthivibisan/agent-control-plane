import { spawn } from 'node:child_process';
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  CheckRunSchema,
  MAX_CHECK_OUTPUT_BYTES,
  type CheckRun,
  type HarnessCheck,
} from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  createCheckRunner,
  type CheckSpawnFn,
  type CheckSpawnOptions,
} from '../../src/harness/index.js';
import { tempDir, write } from '../workspace/helpers.js';

/**
 * The checks are tiny Node scripts in a temp folder, started as `node <script>`: `node` is a bare
 * command name found through PATH, exactly like `pnpm` in a real manifest.
 */

const SCRIPTS: Record<string, string> = {
  'pass.mjs': "console.log('all good');",
  'fail.mjs': "console.error('2 tests failed'); process.exit(3);",
  'cwd.mjs': 'console.log(process.cwd());',
  'env.mjs': 'console.log(JSON.stringify(Object.keys(process.env)));',
  'noisy.mjs': [
    "const line = 'x'.repeat(99) + '\\n';",
    'for (let i = 0; i < 1000; i++) process.stdout.write(line);',
    "process.stderr.write('\\u001b[31mred\\u001b[0m deploy with api_key=sk_live_abcdef123456\\n');",
  ].join('\n'),
  // Starts a grandchild that would run forever, records its pid, then hangs itself.
  'hang.mjs': [
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "writeFileSync('grandchild.pid', String(child.pid));",
    "console.log('started');",
    'setInterval(() => {}, 1000);',
  ].join('\n'),
  // Appends start/end lines to a shared log, to prove two runs never overlap.
  'slow.mjs': [
    "import { appendFileSync } from 'node:fs';",
    'const tag = process.argv[2];',
    "appendFileSync('order.log', `start ${tag}\\n`);",
    "setTimeout(() => { appendFileSync('order.log', `end ${tag}\\n`); }, 150);",
  ].join('\n'),
};

function checkout(): string {
  const root = tempDir('acp-checks-');
  for (const [name, body] of Object.entries(SCRIPTS)) write(root, `scripts/${name}`, body);
  write(root, 'pkg/.keep', '');
  return root;
}

const check = (id: string, argv: string[], over: Partial<HarnessCheck> = {}): HarnessCheck => ({
  id,
  name: `Check ${id}`,
  argv,
  timeoutSec: 30,
  required: true,
  ...over,
});

interface SpawnCall {
  file: string;
  args: string[];
  options: CheckSpawnOptions;
}

function spyingSpawn(): { spawn: CheckSpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  return {
    calls,
    spawn: (file, args, options) => {
      calls.push({ file, args: [...args], options });
      return spawn(file, args, options);
    },
  };
}

let seq = 0;
const ids = () => `check-${++seq}`;
const base = { projectId: 'p1', runId: 'r1', agentRunId: 'a1' };

function expectValid(results: CheckRun[]): void {
  for (const r of results) expect(CheckRunSchema.safeParse(r).success).toBe(true);
}

// Real child processes: allow for a heavily loaded machine instead of the 5 s default.
describe('createCheckRunner', { timeout: 30_000 }, () => {
  it('runs checks in order with argv and no shell, and reports pass and fail', async () => {
    const root = checkout();
    const { spawn: spy, calls } = spyingSpawn();
    const runner = createCheckRunner({
      spawn: spy,
      newId: ids,
      now: () => new Date('2026-10-13T10:00:00.000Z'),
    });
    const seen: string[] = [];
    const results = await runner.run({
      ...base,
      root,
      checks: [
        check('pass', ['node', 'scripts/pass.mjs']),
        check('fail', ['node', 'scripts/fail.mjs'], { required: false }),
      ],
      onResult: (r) => seen.push(r.checkId),
    });
    expectValid(results);
    expect(seen).toEqual(['pass', 'fail']);
    expect(results[0]).toMatchObject({
      checkId: 'pass',
      name: 'Check pass',
      required: true,
      status: 'passed',
      exitCode: 0,
      runId: 'r1',
      agentRunId: 'a1',
      projectId: 'p1',
      startedAt: '2026-10-13T10:00:00.000Z',
    });
    expect(results[0]?.outputTail).toBe('all good\n');
    expect(results[1]).toMatchObject({ status: 'failed', exitCode: 3, required: false });
    expect(results[1]?.outputTail).toContain('2 tests failed');

    // No shell: the file is argv[0] itself and every argument is passed separately.
    expect(calls.map((c) => [c.file, c.args])).toEqual([
      ['node', ['scripts/pass.mjs']],
      ['node', ['scripts/fail.mjs']],
    ]);
    for (const c of calls) {
      expect(c.options.shell).toBe(false);
      expect(c.options.cwd).toBe(root);
      expect(c.options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    }
  });

  it('passes shell metacharacters through as plain arguments', async () => {
    const root = checkout();
    write(root, 'scripts/args.mjs', 'console.log(JSON.stringify(process.argv.slice(2)));');
    const runner = createCheckRunner();
    const [result] = await runner.run({
      ...base,
      root,
      checks: [
        check('args', [
          'node',
          'scripts/args.mjs',
          '$(touch pwned)',
          '&&',
          'rm',
          '-rf',
          '*',
          '|',
          '>out',
        ]),
      ],
    });
    expect(result?.status).toBe('passed');
    expect(JSON.parse(result?.outputTail ?? '')).toEqual([
      '$(touch pwned)',
      '&&',
      'rm',
      '-rf',
      '*',
      '|',
      '>out',
    ]);
  });

  it('refuses a check whose first word is not a bare command name, without starting anything', async () => {
    const root = checkout();
    const { spawn: spy, calls } = spyingSpawn();
    const runner = createCheckRunner({ spawn: spy });
    const results = await runner.run({
      ...base,
      root,
      checks: [
        check('path', ['./scripts/pass.mjs']),
        check('abs', ['/bin/sh', '-c', 'echo hi']),
        check('spaced', ['sh -c', 'echo hi']),
      ],
    });
    expectValid(results);
    expect(calls).toEqual([]);
    for (const r of results) {
      expect(r).toMatchObject({ status: 'error', exitCode: null });
      expect(r.outputTail).toBe('\n[This check is not valid and was not run.]');
    }
  });

  it('reports a command that is not on PATH', async () => {
    const [result] = await createCheckRunner().run({
      ...base,
      root: checkout(),
      checks: [check('missing', ['acp-no-such-command-xyz'])],
    });
    expect(result).toMatchObject({ status: 'error', exitCode: null });
    expect(result?.outputTail).toContain(
      "The command 'acp-no-such-command-xyz' was not found on PATH.",
    );
  });

  it('runs in the check folder, inside the checkout only', async () => {
    const root = checkout();
    const outside = tempDir('acp-checks-outside-');
    symlinkSync(outside, join(root, 'escape'));
    const { spawn: spy, calls } = spyingSpawn();
    const results = await createCheckRunner({ spawn: spy }).run({
      ...base,
      root,
      checks: [
        check('sub', ['node', '../scripts/cwd.mjs'], { cwd: 'pkg' }),
        check('escape', ['node', 'x.mjs'], { cwd: 'escape' }),
        check('missing', ['node', 'x.mjs'], { cwd: 'nope' }),
      ],
    });
    expect(results[0]?.status).toBe('passed');
    expect(results[0]?.outputTail.trim()).toBe(join(root, 'pkg'));
    expect(calls).toHaveLength(1);
    expect(results[1]).toMatchObject({ status: 'error' });
    expect(results[1]?.outputTail).toContain(
      "The check's folder (escape) does not exist inside the checkout.",
    );
    expect(results[2]).toMatchObject({ status: 'error' });
  });

  it('reports every check as an error when the checkout is missing', async () => {
    const results = await createCheckRunner().run({
      ...base,
      root: join(tempDir(), 'gone'),
      checks: [check('a', ['node', '-v']), check('b', ['node', '-v'])],
    });
    expect(results.map((r) => r.status)).toEqual(['error', 'error']);
    expect(results[0]?.outputTail).toContain('does not exist');
  });

  it('filters ACP_* and GIT_* out of the environment', async () => {
    const root = checkout();
    const { spawn: spy, calls } = spyingSpawn();
    const [result] = await createCheckRunner({
      spawn: spy,
      env: {
        PATH: process.env.PATH,
        ACP_HOOK_TOKEN: 'secret',
        acp_lower: 'x',
        GIT_DIR: '/elsewhere/.git',
        HOME_HINT: 'kept',
      },
    }).run({ ...base, root, checks: [check('env', ['node', 'scripts/env.mjs'])] });
    const keys = Object.keys(calls[0]?.options.env ?? {});
    expect(keys).toContain('PATH');
    expect(keys).toContain('HOME_HINT');
    expect(keys.some((k) => /^(acp|git)_/i.test(k))).toBe(false);
    const childKeys = JSON.parse(result?.outputTail ?? '[]') as string[];
    expect(childKeys.some((k) => /^(acp|git)_/i.test(k))).toBe(false);
  });

  it('keeps only the last 16 KiB of output, redacted and without terminal codes', async () => {
    const [result] = await createCheckRunner().run({
      ...base,
      root: checkout(),
      checks: [check('noisy', ['node', 'scripts/noisy.mjs'])],
    });
    expect(result?.status).toBe('passed');
    const tail = result?.outputTail ?? '';
    expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(MAX_CHECK_OUTPUT_BYTES);
    expect(tail.startsWith('[… earlier output cut]\n')).toBe(true);
    expect(tail).not.toContain('sk_live_abcdef123456');
    expect(tail).toContain('api_key=');
    expect(tail).not.toContain('\u001b');
    expect(tail).toContain('red deploy');
  });

  it('stops a check at its timeout, including its child processes', async () => {
    const root = checkout();
    const [result] = await createCheckRunner({ killGraceMs: 200 }).run({
      ...base,
      root,
      checks: [check('hang', ['node', 'scripts/hang.mjs'], { timeoutSec: 1 })],
    });
    expect(result).toMatchObject({ status: 'timed-out', exitCode: null });
    expect(result?.durationMs).toBeGreaterThanOrEqual(900);
    expect(result?.outputTail).toContain('started');
    expect(result?.outputTail).toContain('Stopped after 1 s: the time limit was reached.');
    const pid = Number(readFileSync(join(root, 'grandchild.pid'), 'utf8'));
    await expect.poll(() => isAlive(pid), { timeout: 3000 }).toBe(false);
  }, 15_000);

  it('runs one check at a time, even across concurrent calls', async () => {
    const root = checkout();
    const runner = createCheckRunner();
    const call = (tag: string) =>
      runner.run({
        ...base,
        root,
        checks: [check(tag, ['node', 'scripts/slow.mjs', tag])],
      });
    const results = await Promise.all([call('a'), call('b'), call('c')]);
    expect(results.flat().map((r) => r.status)).toEqual(['passed', 'passed', 'passed']);
    expect(readFileSync(join(root, 'order.log'), 'utf8')).toBe(
      'start a\nend a\nstart b\nend b\nstart c\nend c\n',
    );
  });

  it('skips the remaining checks when stopped, and stops the running one', async () => {
    const root = checkout();
    const controller = new AbortController();
    const results = await createCheckRunner({ killGraceMs: 200 }).run({
      ...base,
      root,
      checks: [
        check('hang', ['node', 'scripts/hang.mjs'], { timeoutSec: 60 }),
        check('pass', ['node', 'scripts/pass.mjs']),
      ],
      onResult: () => undefined,
      signal: (() => {
        setTimeout(() => controller.abort(), 500);
        return controller.signal;
      })(),
    });
    expectValid(results);
    expect(results[0]?.status).toBe('error');
    expect(results[0]?.outputTail).toContain('Stopped before it finished');
    expect(results[1]).toMatchObject({ status: 'skipped', exitCode: null, durationMs: 0 });
  }, 15_000);
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
