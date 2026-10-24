import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRANCH_CHECK_NOTE,
  BRANCH_SETUP_NOTE,
  createCheckRunner,
  createMainChecks,
} from '../../src/harness/index.js';
import { SAFE_GIT_CONFIG } from '../../src/workspace/index.js';
import { git, makeRepo, spyingGit, tempDir, write } from '../workspace/helpers.js';

const MANIFEST = JSON.stringify({
  version: 1,
  checks: [
    { id: 'test', name: 'Unit tests', argv: ['node', 'check.mjs'], timeoutSec: 30, required: true },
    {
      id: 'sub',
      name: 'Package check',
      argv: ['node', 'inner.mjs'],
      cwd: 'pkg',
      timeoutSec: 30,
      required: false,
    },
  ],
});

/** A project whose committed `check.mjs` passes and also writes a build file into its cwd. */
function project(): string {
  return makeRepo({
    '.acp/harness.json': MANIFEST,
    'check.mjs':
      "import { writeFileSync } from 'node:fs'; writeFileSync('built.txt', 'x'); console.log('ok');",
    'pkg/inner.mjs': 'console.log(process.cwd());',
  });
}

function setup() {
  const dataDir = tempDir('acp-data-');
  const { git: gitRunner, calls } = spyingGit();
  const mainChecks = createMainChecks({
    dataDir,
    git: gitRunner,
    runner: createCheckRunner({ killGraceMs: 200 }),
    now: () => new Date('2026-10-13T10:00:00.000Z'),
  });
  return { dataDir, calls, mainChecks, checksDir: join(dataDir, 'harness-checks') };
}

// Real git and child processes: allow for a heavily loaded machine instead of the 5 s default.
describe('createMainChecks', { timeout: 30_000 }, () => {
  it("runs the committed checks in a temporary detached checkout, never the owner's tree", async () => {
    const repo = project();
    // The owner's uncommitted edit would make the check fail; only the commit counts.
    write(repo, 'check.mjs', 'process.exit(1);');
    const { mainChecks, calls, checksDir } = setup();
    const progress: string[] = [];
    const result = await mainChecks.run({
      projectRoot: repo,
      projectId: 'p1',
      onResult: (r) => progress.push(r.checkId),
    });

    expect(result.commit).toBe(git(repo, 'rev-parse', 'HEAD').trim());
    expect(result.status.state).toBe('ready');
    expect(result.results.map((r) => [r.checkId, r.status])).toEqual([
      ['test', 'passed'],
      ['sub', 'passed'],
    ]);
    expect(progress).toEqual(['test', 'sub']);
    for (const r of result.results) {
      expect(r).toMatchObject({ runId: null, agentRunId: null, projectId: 'p1' });
    }
    // The check ran in the temporary checkout (its pkg/ folder), not in the project.
    const ranIn = result.results[1]?.outputTail.trim() ?? '';
    expect(ranIn.startsWith(`${checksDir}/`)).toBe(true);
    expect(ranIn.endsWith('/pkg')).toBe(true);

    // The owner's tree is untouched and the temporary checkout is gone.
    expect(existsSync(join(repo, 'built.txt'))).toBe(false);
    expect(readFileSync(join(repo, 'check.mjs'), 'utf8')).toBe('process.exit(1);');
    expect(readdirSync(checksDir)).toEqual([]);
    expect(git(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);

    // Every git call goes through the workspace safety config; the checkout is detached.
    for (const c of calls) {
      expect(c.file).toBe('git');
      expect((c.args as string[]).slice(0, SAFE_GIT_CONFIG.length)).toEqual(SAFE_GIT_CONFIG);
      expect(c.options.shell).toBe(false);
    }
    const add = calls.find((c) => (c.args as string[]).includes('add'));
    expect(add?.args).toEqual(
      expect.arrayContaining(['worktree', 'add', '--detach', result.commit]),
    );
    expect(git(repo, 'branch', '--list').trim()).toBe('* main');
  });

  it('returns the status without running anything when the commit has no valid manifest', async () => {
    const { mainChecks, checksDir } = setup();
    const none = await mainChecks.run({ projectRoot: makeRepo(), projectId: 'p1' });
    expect(none.status.state).toBe('none');
    expect(none.results).toEqual([]);

    const broken = makeRepo({ '.acp/harness.json': '{ nope' });
    const invalid = await mainChecks.run({ projectRoot: broken, projectId: 'p1' });
    expect(invalid.status.state).toBe('invalid');
    expect(invalid.results).toEqual([]);
    expect(readdirSync(checksDir)).toEqual([]);
  });

  it('uses the manifest from the commit, not an uncommitted one', async () => {
    const repo = makeRepo();
    write(repo, '.acp/harness.json', MANIFEST);
    const { mainChecks } = setup();
    const result = await mainChecks.run({ projectRoot: repo, projectId: 'p1' });
    expect(result.status.state).toBe('none');
  });

  it('works when the project is a subfolder of its repository', async () => {
    const repo = project();
    write(repo, 'apps/web/.keep', '');
    git(repo, 'add', '--all');
    git(repo, 'commit', '--quiet', '-m', 'sub');
    const { mainChecks } = setup();
    const result = await mainChecks.run({ projectRoot: join(repo, 'apps/web'), projectId: 'p1' });
    expect(result.results.map((r) => r.status)).toEqual(['passed', 'passed']);
  });

  it('refuses a folder that is not a repository, or a repository without commits', async () => {
    const { mainChecks } = setup();
    await expect(
      mainChecks.run({ projectRoot: tempDir('acp-nogit-'), projectId: 'p1' }),
    ).rejects.toMatchObject({ code: 'not-a-git-repo' });
    const empty = tempDir('acp-empty-');
    git(empty, 'init', '--quiet', '-b', 'main');
    await expect(mainChecks.run({ projectRoot: empty, projectId: 'p1' })).rejects.toMatchObject({
      code: 'no-commits',
    });
    await expect(
      mainChecks.run({ projectRoot: 'relative', projectId: 'p1' }),
    ).rejects.toMatchObject({ code: 'invalid-root' });
  });

  it('removes the temporary checkout even when the checks are stopped', async () => {
    const repo = project();
    const { mainChecks, checksDir } = setup();
    const controller = new AbortController();
    controller.abort();
    const result = await mainChecks.run({
      projectRoot: repo,
      projectId: 'p1',
      signal: controller.signal,
    });
    expect(result.results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
    expect(readdirSync(checksDir)).toEqual([]);
  });

  it('cleans up checkouts left behind by a crash, and leaves other folders alone', async () => {
    const repo = project();
    const { mainChecks, checksDir, dataDir } = setup();
    git(repo, 'worktree', 'add', '--quiet', '--detach', join(checksDir, 'leftover'), 'HEAD');
    write(checksDir, 'not.safe.name/x', '');
    write(dataDir, 'other/keep.txt', 'keep');
    expect(await mainChecks.cleanupOrphans()).toBe(1);
    expect(readdirSync(checksDir)).toEqual(['not.safe.name']);
    expect(existsSync(join(dataDir, 'other/keep.txt'))).toBe(true);
    expect(git(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
  });
});

/**
 * ADR-0027 §1–2: "Run setup and checks now". The setup steps run in the temporary checkout first
 * (never in the owner's tree); when one does not pass, every check is recorded as not run.
 */
function setupProject(network: boolean): string {
  return makeRepo({
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
        },
      ],
    }),
    'prepare.mjs':
      "import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('prepared'); writeFileSync('prepared/ok', 'y');",
    // Passes only after the setup ran in the same checkout.
    'check.mjs':
      "import { existsSync } from 'node:fs'; process.exit(existsSync('prepared/ok') ? 0 : 4);",
  });
}

describe('createMainChecks with setup steps (ADR-0027)', { timeout: 30_000 }, () => {
  it('runs the setup in the temporary checkout before the checks', async () => {
    const repo = setupProject(false);
    const { mainChecks, checksDir } = setup();
    const steps: string[] = [];
    const result = await mainChecks.run({
      projectRoot: repo,
      projectId: 'p1',
      onSetupResult: (r) => steps.push(`${r.stepId}:${r.status}`),
    });
    expect(steps).toEqual(['prepare:passed']);
    expect(result.setupRuns).toHaveLength(1);
    expect(result.setupRuns[0]).toMatchObject({
      runId: null,
      agentRunId: null,
      projectId: 'p1',
      commit: git(repo, 'rev-parse', 'HEAD').trim(),
    });
    expect(result.results.map((r) => [r.checkId, r.status])).toEqual([['test', 'passed']]);
    // Never in the owner's tree; the checkout is gone.
    expect(existsSync(join(repo, 'prepared'))).toBe(false);
    expect(readdirSync(checksDir)).toEqual([]);
  });

  it('records the checks as not run when a network step is refused, and runs it when allowed', async () => {
    const repo = setupProject(true);
    const { mainChecks } = setup();
    const refused = await mainChecks.run({ projectRoot: repo, projectId: 'p1' });
    expect(refused.setupRuns.map((r) => r.status)).toEqual(['refused']);
    expect(refused.results.map((r) => [r.checkId, r.status])).toEqual([['test', 'skipped']]);
    expect(refused.results[0]?.outputTail).toContain(
      'Not run: Setup step \'Prepare\' was not run: it uses the network, and "Setup may use the network" is off.',
    );
    const allowed = await mainChecks.run({
      projectRoot: repo,
      projectId: 'p1',
      setupNetwork: true,
    });
    expect(allowed.setupRuns.map((r) => r.status)).toEqual(['passed']);
    expect(allowed.results.map((r) => r.status)).toEqual(['passed']);
  });
});

/**
 * F-2: the main branch's "Run checks now" goes through the same runner, so a branch-managing git
 * check or setup step is never started there either: no branch appears in the owner's repository.
 */
describe('createMainChecks with branch-managing steps (F-2)', { timeout: 30_000 }, () => {
  it('records a branch-managing check as an error and runs the others', async () => {
    const repo = makeRepo({
      '.acp/harness.json': JSON.stringify({
        version: 1,
        checks: [
          {
            id: 'branch',
            name: 'Branch',
            argv: ['git', 'branch', 'planted'],
            timeoutSec: 30,
            required: true,
          },
          {
            id: 'test',
            name: 'Unit tests',
            argv: ['node', 'check.mjs'],
            timeoutSec: 30,
            required: true,
          },
        ],
      }),
      'check.mjs': "console.log('ok');",
    });
    const { mainChecks } = setup();
    const result = await mainChecks.run({ projectRoot: repo, projectId: 'p1' });
    expect(result.results.map((r) => [r.checkId, r.status])).toEqual([
      ['branch', 'error'],
      ['test', 'passed'],
    ]);
    expect(result.results[0]?.outputTail).toContain(BRANCH_CHECK_NOTE);
    expect(git(repo, 'branch', '--list').trim()).toBe('* main');
  });

  it('refuses a branch-managing setup step and records every check as not run', async () => {
    const repo = makeRepo({
      '.acp/harness.json': JSON.stringify({
        version: 1,
        setup: [
          {
            id: 'switch',
            name: 'Switch',
            argv: ['git', 'switch', '-c', 'planted'],
            timeoutSec: 30,
          },
          { id: 'prepare', name: 'Prepare', argv: ['node', 'check.mjs'], timeoutSec: 30 },
        ],
        checks: [
          {
            id: 'test',
            name: 'Unit tests',
            argv: ['node', 'check.mjs'],
            timeoutSec: 30,
            required: true,
          },
        ],
      }),
      'check.mjs': "console.log('ok');",
    });
    const { mainChecks } = setup();
    // With the network switch on: the branch rule never depends on it.
    const result = await mainChecks.run({ projectRoot: repo, projectId: 'p1', setupNetwork: true });
    expect(result.setupRuns.map((r) => [r.stepId, r.status])).toEqual([['switch', 'refused']]);
    expect(result.setupRuns[0]?.outputTail).toContain(BRANCH_SETUP_NOTE);
    expect(result.results.map((r) => [r.checkId, r.status])).toEqual([['test', 'skipped']]);
    expect(result.results[0]?.outputTail).toContain(
      "Not run: Setup step 'Switch' was not run: it changes branches, and the app owns branches and commits.",
    );
    expect(git(repo, 'branch', '--list').trim()).toBe('* main');
  });
});
