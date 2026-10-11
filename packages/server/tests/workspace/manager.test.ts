import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChangedFileDtoSchema } from '@acp/core/api';
import {
  SAFE_GIT_CONFIG,
  WorkspaceError,
  createWorkspaceManager,
  type GitRunner,
  type Workspace,
  type WorkspaceErrorCode,
} from '../../src/workspace/index.js';
import { git, head, makeRepo, spyingGit, tempDir, write } from './helpers.js';

function setup() {
  const dataDir = tempDir('acp-ws-data-');
  const spy = spyingGit();
  const manager = createWorkspaceManager({ dataDir, git: spy.git });
  return { dataDir, manager, calls: spy.calls };
}

async function refusal(promise: Promise<unknown>): Promise<WorkspaceErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WorkspaceError) return error.code;
    throw error;
  }
  throw new Error('expected a WorkspaceError');
}

const RUN = '3f1c2a9e-0b4d-4c55-9b0e-5a7d2f1e8c01';
const AGENT = 'b7e4d2a1-6c3f-4e8a-9d10-2f5b7c9e0a12';

describe('create', () => {
  it('adds a worktree on acp/<run>/<agent> from the project HEAD without touching the project', async () => {
    const { dataDir, manager } = setup();
    const repo = makeRepo();
    const before = head(repo);

    const ws = await manager.create(repo, RUN, AGENT);

    expect(ws.path).toBe(join(dataDir, 'worktrees', RUN, AGENT));
    expect(ws.cwd).toBe(ws.path);
    expect(ws.branch).toBe(`acp/${RUN}/${AGENT}`);
    expect(ws.baseBranch).toBe('main');
    expect(ws.baseCommit).toBe(before);
    expect(ws.repoRoot).toBe(repo);
    expect(readFileSync(join(ws.path, 'README.md'), 'utf8')).toBe('hello\n');
    expect(git(ws.path, 'symbolic-ref', '--short', 'HEAD').trim()).toBe(ws.branch);
    // The owner's checkout is unchanged.
    expect(head(repo)).toBe(before);
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('points cwd at the project subdirectory when the project is inside a larger repository', async () => {
    const { manager } = setup();
    const repo = makeRepo({ 'apps/web/index.ts': 'export {};\n', 'README.md': 'x\n' });
    const ws = await manager.create(join(repo, 'apps', 'web'), RUN, AGENT);
    expect(ws.repoRoot).toBe(repo);
    expect(ws.cwd).toBe(join(ws.path, 'apps', 'web'));
    expect(existsSync(join(ws.cwd, 'index.ts'))).toBe(true);
  });

  it.each([
    ['..'],
    ['../escape'],
    ['a/b'],
    ['a\\b'],
    [''],
    ['.hidden'],
    ['-rf'],
    ['--upload-pack=x'],
    ['a b'],
    ['a\0b'],
    ['name.lock'],
    ['x'.repeat(65)],
    ['$(touch pwned)'],
  ])('refuses the unsafe id %j before running git', async (bad) => {
    const { manager, calls, dataDir } = setup();
    const repo = makeRepo();
    expect(await refusal(manager.create(repo, bad, AGENT))).toBe('invalid-id');
    expect(await refusal(manager.create(repo, RUN, bad))).toBe('invalid-id');
    expect(calls).toHaveLength(0);
    expect(existsSync(join(dataDir, 'worktrees'))).toBe(false);
  });

  it('refuses a folder that is not a git repository, a detached HEAD and an empty repository', async () => {
    const { manager } = setup();
    expect(await refusal(manager.create(tempDir(), RUN, AGENT))).toBe('not-a-git-repo');
    expect(await refusal(manager.create(join(tempDir(), 'missing'), RUN, AGENT))).toBe(
      'not-a-git-repo',
    );
    expect(await refusal(manager.create('relative/path', RUN, AGENT))).toBe('not-a-git-repo');

    const detached = makeRepo();
    git(detached, 'checkout', '--quiet', '--detach');
    expect(await refusal(manager.create(detached, RUN, AGENT))).toBe('detached-head');

    const empty = tempDir();
    git(empty, 'init', '--quiet', '-b', 'main');
    expect(await refusal(manager.create(empty, RUN, AGENT))).toBe('no-commits');
  });

  it('refuses to create the same workspace twice', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    await manager.create(repo, RUN, AGENT);
    expect(await refusal(manager.create(repo, RUN, AGENT))).toBe('workspace-exists');
  });
});

describe('changes', () => {
  it('lists committed, uncommitted and new files with line counts, and the unified diff', async () => {
    const { manager } = setup();
    const repo = makeRepo({
      'README.md': 'hello\n',
      'src/keep.ts': 'export const a = 1;\n',
      'src/old-name.ts': 'line one\nline two\nline three\nline four\n',
      'docs/remove.md': 'bye\n',
    });
    const ws = await manager.create(repo, RUN, AGENT);

    // A commit the agent made itself ...
    write(ws.path, 'src/keep.ts', 'export const a = 2;\nexport const b = 3;\n');
    git(ws.path, 'commit', '--quiet', '-am', 'agent commit');
    // ... plus uncommitted work: a new file, a deletion, a rename and a binary file.
    write(ws.path, 'src/new.ts', 'export const fresh = true;\n');
    rmSync(join(ws.path, 'docs', 'remove.md'));
    git(ws.path, 'mv', 'src/old-name.ts', 'src/new-name.ts');
    write(ws.path, 'assets/logo.bin', Buffer.from([0, 1, 2, 3, 0, 255]));

    const changes = await manager.changes(ws);
    const byPath = Object.fromEntries(changes.files.map((f) => [f.path, f]));
    for (const f of changes.files) ChangedFileDtoSchema.parse(f);

    expect(byPath['src/keep.ts']).toEqual({
      path: 'src/keep.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
    });
    expect(byPath['src/new.ts']).toMatchObject({ status: 'added', additions: 1, deletions: 0 });
    expect(byPath['docs/remove.md']).toMatchObject({
      status: 'deleted',
      additions: 0,
      deletions: 1,
    });
    expect(byPath['src/new-name.ts']).toMatchObject({
      status: 'renamed',
      additions: 0,
      deletions: 0,
    });
    // Binary: the line count is unavailable, never 0.
    expect(byPath['assets/logo.bin']).toEqual({
      path: 'assets/logo.bin',
      status: 'added',
      additions: null,
      deletions: null,
    });
    expect(changes.files).toHaveLength(5);
    expect(changes.diffTruncated).toBe(false);
    expect(changes.diff).toContain('+export const b = 3;');
    expect(changes.diff).toContain('rename from src/old-name.ts');
    // The project itself is untouched.
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('reports no files and an empty diff when the agent changed nothing', async () => {
    const { manager } = setup();
    const ws = await manager.create(makeRepo(), RUN, AGENT);
    expect(await manager.changes(ws)).toEqual({ files: [], diff: '', diffTruncated: false });
  });

  it('cuts a large diff at a line boundary under the cap and flags it', async () => {
    const { manager } = setup();
    const ws = await manager.create(makeRepo(), RUN, AGENT);
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i} ${'é'.repeat(10)}`).join('\n');
    write(ws.path, 'big.txt', `${big}\n`);

    const changes = await manager.changes(ws, { maxDiffBytes: 4096 });
    expect(changes.diffTruncated).toBe(true);
    expect(Buffer.byteLength(changes.diff)).toBeLessThanOrEqual(4096);
    expect(changes.diff.endsWith('\n')).toBe(true);
    expect(changes.diff).not.toContain('�');
    expect(changes.files).toEqual([
      { path: 'big.txt', status: 'added', additions: 5000, deletions: 0 },
    ]);
  });
});

describe('merge', () => {
  async function workedOn(): Promise<{
    manager: ReturnType<typeof setup>['manager'];
    repo: string;
    ws: Workspace;
  }> {
    const { manager } = setup();
    const repo = makeRepo({ 'README.md': 'hello\n', 'src/app.ts': 'export const v = 1;\n' });
    const ws = await manager.create(repo, RUN, AGENT);
    write(ws.path, 'src/app.ts', 'export const v = 2;\n');
    write(ws.path, 'src/added.ts', 'export {};\n');
    return { manager, repo, ws };
  }

  it("commits the agent's pending work and fast-forwards the clean base branch", async () => {
    const { manager, repo, ws } = await workedOn();
    const before = head(repo);

    const result = await manager.merge(ws, { role: 'API\nbuilder' });

    expect(result).toMatchObject({
      outcome: 'merged',
      previousBaseCommit: before,
      integratedMovedBase: false,
    });
    expect(head(repo)).toBe(result.outcome === 'merged' ? result.commit : '');
    expect(readFileSync(join(repo, 'src/app.ts'), 'utf8')).toBe('export const v = 2;\n');
    expect(readFileSync(join(repo, 'src/added.ts'), 'utf8')).toBe('export {};\n');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    // A fast-forward: the agent's commit sits directly on the old base, attributed to the app.
    expect(git(repo, 'rev-parse', 'HEAD~1').trim()).toBe(before);
    expect(git(repo, 'log', '-1', '--format=%an <%ae>|%s').trim()).toBe(
      `Agent Control Plane <agent-control-plane@localhost>|Changes by "API builder" (run ${RUN}, agent ${AGENT})`,
    );
  });

  it('reports no-changes and leaves the base alone when the agent changed nothing', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    const ws = await manager.create(repo, RUN, AGENT);
    const before = head(repo);
    expect(await manager.merge(ws)).toEqual({ outcome: 'no-changes' });
    expect(head(repo)).toBe(before);
  });

  it('refuses to merge into a dirty base and changes nothing', async () => {
    const { manager, repo, ws } = await workedOn();
    write(repo, 'README.md', 'owner is editing\n');
    const before = head(repo);

    expect(await refusal(manager.merge(ws))).toBe('base-dirty');
    expect(head(repo)).toBe(before);
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('owner is editing\n');
    expect(head(repo, ws.branch)).toBe(ws.baseCommit);

    // Staged-only changes count as dirty too.
    git(repo, 'add', 'README.md');
    expect(await refusal(manager.merge(ws))).toBe('base-dirty');
  });

  it("does not count the owner's untracked files as dirty", async () => {
    const { manager, repo, ws } = await workedOn();
    write(repo, 'notes.txt', 'scratch\n');
    expect((await manager.merge(ws)).outcome).toBe('merged');
    expect(readFileSync(join(repo, 'notes.txt'), 'utf8')).toBe('scratch\n');
  });

  it('refuses when the project switched to another branch', async () => {
    const { manager, repo, ws } = await workedOn();
    git(repo, 'checkout', '--quiet', '-b', 'feature');
    expect(await refusal(manager.merge(ws))).toBe('base-branch-changed');
    expect(head(repo, 'main')).toBe(ws.baseCommit);
  });

  it('refuses when the base moved, unless integration is asked for', async () => {
    const { manager, repo, ws } = await workedOn();
    write(repo, 'README.md', 'owner moved on\n');
    git(repo, 'commit', '--quiet', '-am', 'owner commit');
    const moved = head(repo);

    expect(await refusal(manager.merge(ws))).toBe('base-moved');
    expect(head(repo)).toBe(moved);

    const result = await manager.merge(ws, { integrateMovedBase: true });
    expect(result).toMatchObject({
      outcome: 'merged',
      previousBaseCommit: moved,
      integratedMovedBase: true,
    });
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('owner moved on\n');
    expect(readFileSync(join(repo, 'src/app.ts'), 'utf8')).toBe('export const v = 2;\n');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('refuses a conflicting integration and leaves both sides as they were', async () => {
    const { manager, repo, ws } = await workedOn();
    write(repo, 'src/app.ts', 'export const v = 99;\n');
    git(repo, 'commit', '--quiet', '-am', 'owner conflicting commit');
    const moved = head(repo);

    expect(await refusal(manager.merge(ws, { integrateMovedBase: true }))).toBe('merge-conflict');
    expect(head(repo)).toBe(moved);
    expect(readFileSync(join(repo, 'src/app.ts'), 'utf8')).toBe('export const v = 99;\n');
    // The worktree is back on its own commit, with no merge in progress.
    expect(git(ws.path, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(ws.path, 'src/app.ts'), 'utf8')).toBe('export const v = 2;\n');
  });

  it("refuses when the agent's worktree left its branch", async () => {
    const { manager, ws } = await workedOn();
    git(ws.path, 'stash', '--include-untracked', '--quiet');
    git(ws.path, 'checkout', '--quiet', '--detach');
    expect(await refusal(manager.merge(ws))).toBe('workspace-branch-changed');
    expect(await refusal(manager.changes(ws))).toBe('workspace-branch-changed');
  });

  it('runs no repository hooks while creating and merging', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    const marker = join(repo, 'HOOK_RAN');
    for (const hook of ['post-checkout', 'pre-commit', 'commit-msg', 'post-commit', 'post-merge']) {
      write(join(repo, '.git', 'hooks'), hook, `#!/bin/sh\necho ${hook} >> "${marker}"\n`);
      chmodSync(join(repo, '.git', 'hooks', hook), 0o755);
    }
    const ws = await manager.create(repo, RUN, AGENT);
    write(ws.path, 'x.txt', 'x\n');
    await manager.changes(ws);
    expect((await manager.merge(ws)).outcome).toBe('merged');
    expect(existsSync(marker)).toBe(false);
  });
});

describe('discard', () => {
  it('removes the worktree, its branch and the empty run folder; repeating is harmless', async () => {
    const { dataDir, manager } = setup();
    const repo = makeRepo();
    const ws = await manager.create(repo, RUN, AGENT);
    write(ws.path, 'wip.txt', 'unfinished\n');

    await manager.discard(ws);

    expect(existsSync(ws.path)).toBe(false);
    expect(existsSync(join(dataDir, 'worktrees', RUN))).toBe(false);
    expect(git(repo, 'branch', '--list', 'acp/*')).toBe('');
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(ws.path);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    await expect(manager.discard(ws)).resolves.toBeUndefined();
  });

  it('keeps the merged commits when releasing a merged workspace', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    const ws = await manager.create(repo, RUN, AGENT);
    write(ws.path, 'feature.txt', 'done\n');
    const merged = await manager.merge(ws);
    await manager.discard(ws);
    expect(head(repo)).toBe(merged.outcome === 'merged' ? merged.commit : '');
    expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe('done\n');
  });

  it('still removes the worktree folder when the project repository is gone', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    const ws = await manager.create(repo, RUN, AGENT);
    rmSync(repo, { recursive: true, force: true });
    await manager.discard(ws);
    expect(existsSync(ws.path)).toBe(false);
  });

  it('rejects a tampered workspace record without deleting anything', async () => {
    const { manager } = setup();
    const repo = makeRepo();
    const ws = await manager.create(repo, RUN, AGENT);
    const victim = tempDir('acp-ws-victim-');
    write(victim, 'precious.txt', 'keep me\n');

    const tampered: Workspace[] = [
      { ...ws, path: victim },
      { ...ws, path: join(ws.path, '..', '..', '..', '..') },
      { ...ws, branch: 'main' },
      { ...ws, runId: '..' },
      { ...ws, cwd: join(ws.path, '..', 'other') },
      { ...ws, baseCommit: 'HEAD' },
      { ...ws, baseBranch: '--force' },
    ];
    for (const bad of tampered) {
      expect(await refusal(manager.discard(bad))).toMatch(/^invalid-(workspace|id)$/);
      expect(await refusal(manager.merge(bad))).toMatch(/^invalid-(workspace|id)$/);
    }
    expect(readFileSync(join(victim, 'precious.txt'), 'utf8')).toBe('keep me\n');
    expect(head(repo, 'main')).toBe(ws.baseCommit);
    expect(existsSync(ws.path)).toBe(true);
  });
});

describe('cleanupOrphans', () => {
  it('removes unknown worktrees and their branches, keeps known ones and foreign entries', async () => {
    const { dataDir, manager } = setup();
    const repo = makeRepo();
    const kept = await manager.create(repo, RUN, AGENT);
    const orphan = await manager.create(repo, RUN, 'orphan-agent');
    const otherRun = await manager.create(repo, 'other-run', 'a1');
    // A leftover folder that is not a worktree, and entries this manager would never create.
    const root = join(dataDir, 'worktrees');
    mkdirSync(join(root, 'stale-run', 'half-made'), { recursive: true });
    mkdirSync(join(root, '.not-ours', 'x'), { recursive: true });
    write(root, 'README.txt', 'not a run\n');

    const result = await manager.cleanupOrphans([{ runId: RUN, agentId: AGENT }]);

    expect(result.kept).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.removed).toEqual(
      expect.arrayContaining([
        { runId: RUN, agentId: 'orphan-agent' },
        { runId: 'other-run', agentId: 'a1' },
        { runId: 'stale-run', agentId: 'half-made' },
      ]),
    );
    expect(result.removed).toHaveLength(3);
    expect(existsSync(kept.path)).toBe(true);
    expect(existsSync(orphan.path)).toBe(false);
    expect(existsSync(otherRun.path)).toBe(false);
    expect(readdirSync(root).sort()).toEqual(['.not-ours', RUN, 'README.txt'].sort());
    expect(git(repo, 'branch', '--list', '--format=%(refname:short)', 'acp/*').trim()).toBe(
      kept.branch,
    );
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(orphan.path);
  });

  it('does nothing on a fresh data dir', async () => {
    const { manager } = setup();
    expect(await manager.cleanupOrphans([])).toEqual({ removed: [], kept: 0, failed: 0 });
  });
});

describe('no shell (ADR-0013 §1)', () => {
  it('starts only git, through execFile with an argument array, shell off and hooks disabled', async () => {
    const { manager, calls } = setup();
    const repo = makeRepo();
    const ws = await manager.create(repo, RUN, AGENT);
    // File names a shell would expand if one were ever involved.
    write(ws.path, '$(touch PWNED).txt', 'a\n');
    write(ws.path, '`touch PWNED2`; rm -rf x.txt', 'b\n');
    await manager.changes(ws);
    await manager.merge(ws, { role: '"; touch PWNED3; echo "' });
    await manager.discard(ws);
    await manager.cleanupOrphans([]);

    expect(calls.length).toBeGreaterThan(10);
    for (const call of calls) {
      expect(call.file).toBe('git');
      expect(Array.isArray(call.args)).toBe(true);
      const args = call.args as unknown[];
      expect(args.every((a) => typeof a === 'string')).toBe(true);
      expect(args.slice(0, SAFE_GIT_CONFIG.length)).toEqual([...SAFE_GIT_CONFIG]);
      expect(call.options.shell).toBe(false);
    }
    for (const dir of [repo, ws.path, process.cwd()]) {
      for (const name of ['PWNED', 'PWNED2', 'PWNED3'])
        expect(existsSync(join(dir, name))).toBe(false);
    }
    expect(readFileSync(join(repo, '$(touch PWNED).txt'), 'utf8')).toBe('a\n');
  });

  it('works with any injected runner and never passes it a command string', async () => {
    const seen: (readonly string[])[] = [];
    const { git: real } = spyingGit();
    const recording: GitRunner = (args, options) => {
      seen.push(args);
      return real(args, options);
    };
    const manager = createWorkspaceManager({ dataDir: tempDir(), git: recording });
    const ws = await manager.create(makeRepo(), RUN, AGENT);
    await manager.discard(ws);
    expect(seen.length).toBeGreaterThan(0);
    for (const args of seen) expect(Array.isArray(args)).toBe(true);
  });
});

it('requires an absolute data dir', () => {
  expect(() => createWorkspaceManager({ dataDir: 'relative' })).toThrow(WorkspaceError);
});
