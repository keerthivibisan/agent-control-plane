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

  it('is null when the folder does not exist or the name is not a file name', async () => {
    const ws = worktree();
    expect(await resolveEditTarget(join(ws.path, 'nope/deeper/x.ts'), ws.cwd)).toBeNull();
    expect(await resolveEditTarget(`${ws.path}/src/..`, ws.cwd)).not.toBeNull();
    expect(await resolveEditTarget('bad\0name', ws.cwd)).toBeNull();
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
