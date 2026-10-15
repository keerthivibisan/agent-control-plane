import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ContextCandidateDtoSchema } from '@acp/core/api';
import { MAX_CONTEXT_BYTES, MAX_CONTEXT_FILES } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  HarnessError,
  contextPathsFor,
  listContextCandidates,
  readContextFiles,
} from '../../src/harness/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { GIT_TEST_ENV, git, makeRepo, tempDir, write } from '../workspace/helpers.js';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('contextPathsFor', () => {
  it('puts the setup files first, then the manifest context, without duplicates', () => {
    expect(
      contextPathsFor(['CLAUDE.md', 'docs/a.md'], { context: ['docs/a.md', 'AGENTS.md'] }),
    ).toEqual(['CLAUDE.md', 'docs/a.md', 'AGENTS.md']);
    expect(contextPathsFor(['CLAUDE.md'], null)).toEqual(['CLAUDE.md']);
  });
});

describe('readContextFiles', () => {
  it('reads the chosen files in order, with a header per file, and the harness notes', async () => {
    const root = tempDir('acp-ctx-');
    write(root, 'CLAUDE.md', 'Use pnpm.\n');
    write(root, 'docs/style.md', 'Two spaces.\n');
    const result = await readContextFiles(root, ['CLAUDE.md', 'docs/style.md'], {
      notes: 'Run pnpm install first.',
    });
    expect(result.problems).toEqual([]);
    expect(result.files).toEqual([
      { path: 'CLAUDE.md', bytes: 10, truncated: false },
      { path: 'docs/style.md', bytes: 12, truncated: false },
    ]);
    expect(result.context).toContain('\n=== CLAUDE.md ===\nUse pnpm.\n');
    expect(result.context).toContain('\n=== docs/style.md ===\nTwo spaces.\n');
    expect(result.context).toContain(
      '=== Harness notes (.acp/harness.json) ===\nRun pnpm install first.',
    );
    expect(result.context.indexOf('CLAUDE.md')).toBeLessThan(result.context.indexOf('style.md'));
  });

  it('returns an empty context when nothing is chosen', async () => {
    expect(await readContextFiles(tempDir('acp-ctx-'), [])).toEqual({
      context: '',
      files: [],
      problems: [],
    });
  });

  it('skips files outside the repository, missing files, folders and binary files', async () => {
    const outside = tempDir('acp-ctx-outside-');
    write(outside, 'secret.md', 'outside secret');
    const root = tempDir('acp-ctx-');
    write(root, 'ok.md', 'fine');
    write(root, 'folder/x.md', 'x');
    write(root, 'bin.dat', Buffer.from([0x41, 0x00, 0x42]));
    symlinkSync(join(outside, 'secret.md'), join(root, 'link.md'));
    symlinkSync(outside, join(root, 'linkdir'));
    const result = await readContextFiles(root, [
      'ok.md',
      '../outside.md',
      '/etc/hosts',
      'link.md',
      'linkdir/secret.md',
      'missing.md',
      'folder',
      'bin.dat',
    ]);
    expect(result.files.map((f) => f.path)).toEqual(['ok.md']);
    expect(result.context).not.toContain('outside secret');
    expect(result.problems).toEqual([
      '"../outside.md" is not a path inside the repository and was skipped.',
      '"/etc/hosts" is not a path inside the repository and was skipped.',
      'link.md points outside the repository and was skipped.',
      'linkdir/secret.md points outside the repository and was skipped.',
      'missing.md was not found.',
      'folder is not a regular file and was skipped.',
      'bin.dat looks like a binary file and was skipped.',
    ]);
  });

  it('allows a symlink that stays inside the repository', async () => {
    const root = tempDir('acp-ctx-');
    write(root, 'real.md', 'inside');
    symlinkSync(join(root, 'real.md'), join(root, 'alias.md'));
    const result = await readContextFiles(root, ['alias.md']);
    expect(result.files).toEqual([{ path: 'alias.md', bytes: 6, truncated: false }]);
  });

  it(`uses at most ${MAX_CONTEXT_FILES} files`, async () => {
    const root = tempDir('acp-ctx-');
    const paths = Array.from({ length: 12 }, (_, i) => `f${i}.md`);
    for (const p of paths) write(root, p, p);
    const result = await readContextFiles(root, paths);
    expect(result.files).toHaveLength(MAX_CONTEXT_FILES);
    expect(result.problems).toEqual([
      'Only the first 10 context files are used; 2 more were left out.',
    ]);
  });

  it(`keeps the whole context within ${MAX_CONTEXT_BYTES} bytes, cutting and leaving out files`, async () => {
    const root = tempDir('acp-ctx-');
    write(root, 'a.md', 'a'.repeat(20_000));
    // Multi-byte characters: the cut must not split one.
    write(root, 'b.md', 'é'.repeat(10_000));
    write(root, 'c.md', 'never read');
    const result = await readContextFiles(root, ['a.md', 'b.md', 'c.md'], { notes: 'notes' });
    expect(bytes(result.context)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
    expect(result.context).not.toContain('\uFFFD');
    expect(result.files[0]).toEqual({ path: 'a.md', bytes: 20_000, truncated: false });
    expect(result.files[1]?.truncated).toBe(true);
    expect(result.context).not.toContain('never read');
    expect(result.problems).toEqual([
      'b.md was cut to fit the 32 KiB context limit.',
      'c.md was left out because the context size limit was reached.',
      'The harness notes were left out because the context size limit was reached.',
    ]);
  });

  it('throws a typed error for a missing root', async () => {
    await expect(readContextFiles(join(tempDir(), 'nope'), ['a.md'])).rejects.toBeInstanceOf(
      HarnessError,
    );
  });
});

describe('listContextCandidates', () => {
  it('offers tracked small text files, suggested ones first, never under .claude/', async () => {
    const repo = makeRepo({
      'README.md': 'readme',
      'CLAUDE.md': 'claude',
      'AGENTS.md': 'agents',
      'docs/guide.md': 'guide',
      'src/index.ts': 'code',
      '.claude/CLAUDE.md': 'private',
      'big.md': 'x'.repeat(MAX_CONTEXT_BYTES + 1),
    });
    write(repo, 'untracked.md', 'not in git');
    const gitRunner = createGitRunner({ env: GIT_TEST_ENV });
    const list = await listContextCandidates(repo, { git: gitRunner });
    expect(list).toEqual([
      { path: 'AGENTS.md', sizeBytes: 6, suggested: true },
      { path: 'CLAUDE.md', sizeBytes: 6, suggested: true },
      { path: 'docs/guide.md', sizeBytes: 5, suggested: false },
      { path: 'README.md', sizeBytes: 6, suggested: false },
    ]);
    for (const c of list) expect(ContextCandidateDtoSchema.safeParse(c).success).toBe(true);
    expect(await listContextCandidates(repo, { git: gitRunner, limit: 1 })).toHaveLength(1);
  });

  it('refuses a folder that is not a git repository', async () => {
    await expect(
      listContextCandidates(tempDir('acp-ctx-nogit-'), {
        git: createGitRunner({ env: GIT_TEST_ENV }),
      }),
    ).rejects.toMatchObject({ code: 'not-a-git-repo' });
  });

  it('skips a tracked file deleted from the working tree', async () => {
    const repo = makeRepo({ 'CLAUDE.md': 'c', 'gone.md': 'g' });
    rmSync(join(repo, 'gone.md'));
    expect(git(repo, 'ls-files')).toContain('gone.md');
    const list = await listContextCandidates(repo, { git: createGitRunner({ env: GIT_TEST_ENV }) });
    expect(list.map((c) => c.path)).toEqual(['CLAUDE.md']);
  });
});
