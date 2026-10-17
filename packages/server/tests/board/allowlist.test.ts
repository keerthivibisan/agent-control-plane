import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowlistVerdict, resolveEditTarget } from '../../src/control/allowlist.js';
import { tempDir } from '../workspace/helpers.js';

/*
 * The server half of the project allowlist (ADR-0013 amendment): paths are resolved on disk
 * (realpath) before the engine's pure `evaluateAllowlist`, so a symlink can never carry an
 * auto-approved edit out of the helper's worktree.
 */

const ON = { editInOwnWorktree: true, runHarnessChecks: true };
const CHECKS = [{ id: 'test', argv: ['pnpm', 'test'] }];

function worktree() {
  const path = tempDir('acp-allow-wt-');
  mkdirSync(join(path, 'src'));
  writeFileSync(join(path, 'src', 'app.ts'), 'export {};\n');
  return { path, cwd: path };
}

describe('resolveEditTarget', () => {
  it('resolves an existing file, a new file in an existing folder, and a relative path', async () => {
    const ws = worktree();
    expect(await resolveEditTarget(join(ws.path, 'src/app.ts'), ws.cwd)).toBe(
      join(ws.path, 'src/app.ts'),
    );
    expect(await resolveEditTarget(join(ws.path, 'src/new.ts'), ws.cwd)).toBe(
      join(ws.path, 'src/new.ts'),
    );
    expect(await resolveEditTarget('src/app.ts', ws.cwd)).toBe(join(ws.path, 'src/app.ts'));
  });

  it('resolves a new file in new nested folders through the nearest existing ancestor', async () => {
    const ws = worktree();
    expect(await resolveEditTarget(join(ws.path, 'bin/slug.mjs'), ws.cwd)).toBe(
      join(ws.path, 'bin/slug.mjs'),
    );
    expect(await resolveEditTarget(join(ws.path, 'src/a/b/c/d/e.ts'), ws.cwd)).toBe(
      join(ws.path, 'src/a/b/c/d/e.ts'),
    );
    expect(await resolveEditTarget('test/unit/slug.test.mjs', ws.cwd)).toBe(
      join(ws.path, 'test/unit/slug.test.mjs'),
    );
    // A relative path is taken from the agent's cwd, which may be a folder inside the worktree.
    expect(await resolveEditTarget('lib/x.ts', join(ws.path, 'src'))).toBe(
      join(ws.path, 'src/lib/x.ts'),
    );
    // `..` inside the part that exists is resolved by the file system.
    expect(await resolveEditTarget(`${ws.path}/src/../docs/new.md`, ws.cwd)).toBe(
      join(ws.path, 'docs/new.md'),
    );
    expect(await resolveEditTarget(`${ws.path}/src/..`, ws.cwd)).toBe(ws.path);
  });

  it('is null for a segment to create that is not a plain name, or an unusable path', async () => {
    const ws = worktree();
    for (const path of [
      `${ws.path}/nope/../src/x.ts`,
      `${ws.path}/nope/./x.ts`,
      `${ws.path}/nope//x.ts`,
      `${ws.path}/nope/x/`,
      'nope/../../x.ts',
      'bad\0name',
      '',
    ]) {
      expect(await resolveEditTarget(path, ws.cwd), JSON.stringify(path)).toBeNull();
    }
  });

  it('is null for a dangling symlink, which a write would follow to create its target', async () => {
    const ws = worktree();
    const outside = tempDir('acp-allow-out-');
    symlinkSync(join(outside, 'created.txt'), join(ws.path, 'dangling.txt'));
    symlinkSync(join(outside, 'no-such-dir'), join(ws.path, 'dangling-dir'));
    expect(await resolveEditTarget(join(ws.path, 'dangling.txt'), ws.cwd)).toBeNull();
    expect(await resolveEditTarget(join(ws.path, 'dangling-dir/new/x.ts'), ws.cwd)).toBeNull();
  });
});

describe('allowlistVerdict', () => {
  it('allows an edit inside the helper worktree when the project allows edits', async () => {
    const ws = worktree();
    const verdict = await allowlistVerdict({
      target: { kind: 'edit', toolName: 'Edit', path: join(ws.path, 'src/app.ts') },
      context: { allowlist: ON, checks: CHECKS },
      workspace: ws,
    });
    expect(verdict).toEqual({ allowed: true, rule: 'edit-in-own-worktree' });
  });

  it('allows a new file in a new nested folder inside the worktree (RL-F)', async () => {
    const ws = worktree();
    for (const path of [
      join(ws.path, 'src/slug.mjs'),
      join(ws.path, 'bin/slug.mjs'),
      join(ws.path, 'test/deep/er/slug.test.mjs'),
      'bin/cli/main.mjs',
    ]) {
      const auto = await allowlistVerdict({
        target: { kind: 'edit', toolName: 'Write', path },
        context: { policy: { mode: 'auto-edits', commands: [] }, checks: CHECKS },
        workspace: ws,
      });
      expect(auto, path).toEqual({ allowed: true, rule: 'edit-in-own-worktree' });
    }
  });

  it('asks for a new path whose nearest existing ancestor leaves the worktree', async () => {
    const ws = worktree();
    const outside = tempDir('acp-allow-out-');
    symlinkSync(outside, join(ws.path, 'out'));
    for (const path of [
      join(ws.path, 'out/new/deep/x.ts'),
      `${ws.path}/out/../escape/x.ts`,
      `${ws.path}/new/../../escape/x.ts`,
      '../escape/new/x.ts',
      join(ws.path, '.git/hooks/new/pre-commit'),
      join(ws.path, '.claude/new/settings.json'),
    ]) {
      const verdict = await allowlistVerdict({
        target: { kind: 'edit', toolName: 'Write', path },
        context: { policy: { mode: 'auto-edits', commands: [] }, checks: CHECKS },
        workspace: ws,
      });
      expect(verdict.allowed, path).toBe(false);
    }
  });

  it('asks for a symlink that points outside the worktree', async () => {
    const ws = worktree();
    const outside = tempDir('acp-allow-out-');
    writeFileSync(join(outside, 'secret.txt'), 'x');
    symlinkSync(join(outside, 'secret.txt'), join(ws.path, 'link.txt'));
    symlinkSync(outside, join(ws.path, 'linkdir'));
    for (const path of [join(ws.path, 'link.txt'), join(ws.path, 'linkdir/new.txt')]) {
      const verdict = await allowlistVerdict({
        target: { kind: 'edit', toolName: 'Write', path },
        context: { allowlist: ON, checks: CHECKS },
        workspace: ws,
      });
      expect(verdict.allowed).toBe(false);
    }
  });

  it('asks without a worktree, with edits off, and for .git paths', async () => {
    const ws = worktree();
    const target = { kind: 'edit', toolName: 'Edit', path: join(ws.path, 'src/app.ts') } as const;
    expect(
      (await allowlistVerdict({ target, context: { allowlist: ON, checks: [] }, workspace: null }))
        .allowed,
    ).toBe(false);
    const off = { editInOwnWorktree: false, runHarnessChecks: true };
    expect(
      (await allowlistVerdict({ target, context: { allowlist: off, checks: [] }, workspace: ws }))
        .allowed,
    ).toBe(false);
    mkdirSync(join(ws.path, '.git'));
    const git = { kind: 'edit', toolName: 'Edit', path: join(ws.path, '.git/config') } as const;
    expect(
      (
        await allowlistVerdict({
          target: git,
          context: { allowlist: ON, checks: [] },
          workspace: ws,
        })
      ).allowed,
    ).toBe(false);
  });

  it('allows only an exact check command line', async () => {
    const ws = worktree();
    const ask = (command: string) =>
      allowlistVerdict({
        target: { kind: 'bash', command },
        context: { allowlist: ON, checks: CHECKS },
        workspace: ws,
      });
    expect(await ask('pnpm test')).toEqual({
      allowed: true,
      rule: 'run-harness-check',
      checkId: 'test',
    });
    expect((await ask('pnpm test && rm -rf /')).allowed).toBe(false);
    expect((await ask('pnpm  test')).allowed).toBe(false);
  });
});
