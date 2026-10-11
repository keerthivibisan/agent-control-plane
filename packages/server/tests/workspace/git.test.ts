import { describe, expect, it } from 'vitest';
import {
  GitCommandError,
  createGitRunner,
  type ExecFileFn,
  type ExecFileOptions,
} from '../../src/workspace/index.js';
import { changedFiles, parseNameStatus, parseNumstat } from '../../src/workspace/diff.js';
import { subcommandOf } from '../../src/workspace/git.js';

function fakeExec(result: { code?: string | number; stdout?: string; stderr?: string } = {}): {
  execFile: ExecFileFn;
  seen: { file: string; args: string[]; options: ExecFileOptions }[];
} {
  const seen: { file: string; args: string[]; options: ExecFileOptions }[] = [];
  const execFile: ExecFileFn = (file, args, options, callback) => {
    seen.push({ file, args, options });
    const error =
      result.code === undefined ? null : Object.assign(new Error('x'), { code: result.code });
    callback(error, Buffer.from(result.stdout ?? ''), Buffer.from(result.stderr ?? ''));
  };
  return { execFile, seen };
}

describe('createGitRunner', () => {
  it('calls execFile("git", args) with shell off, a buffer limit and a timeout', async () => {
    const { execFile, seen } = fakeExec({ stdout: 'ok\n' });
    const run = createGitRunner({ execFile, timeoutMs: 1234 });
    expect(await run(['status', '--porcelain'], { cwd: '/repo' })).toEqual({
      stdout: 'ok\n',
      truncated: false,
    });
    expect(seen).toHaveLength(1);
    const [call] = seen;
    expect(call?.file).toBe('git');
    expect(call?.args).toEqual(['status', '--porcelain']);
    expect(call?.options).toMatchObject({ cwd: '/repo', shell: false, timeout: 1234 });
  });

  it('drops inherited GIT_* variables and never prompts', async () => {
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = '/somewhere/else/.git';
    try {
      const { execFile, seen } = fakeExec();
      await createGitRunner({ execFile, env: { GIT_CONFIG_NOSYSTEM: '1' } })(['status'], {
        cwd: '/r',
      });
      const env = seen[0]?.options.env ?? {};
      expect(env.GIT_DIR).toBeUndefined();
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
  });

  it('rejects with GitCommandError carrying the exit code', async () => {
    const { execFile } = fakeExec({ code: 128, stderr: 'fatal: secret/path' });
    const run = createGitRunner({ execFile });
    const error = await run(['-c', 'a=b', 'rev-parse', 'HEAD'], { cwd: '/r' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GitCommandError);
    expect(error).toMatchObject({ subcommand: 'rev-parse', exitCode: 128 });
    // The message never quotes stderr (it can hold paths or contents).
    expect((error as Error).message).toBe('git rev-parse failed (exit 128)');
  });

  it('truncates at a line boundary when a capped output overflows', async () => {
    const { execFile } = fakeExec({
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      stdout: 'one\ntwo\nthr',
    });
    const run = createGitRunner({ execFile });
    expect(await run(['diff'], { cwd: '/r', maxOutputBytes: 10 })).toEqual({
      stdout: 'one\ntwo\n',
      truncated: true,
    });
  });

  it('treats overflow without a cap as an error', async () => {
    const { execFile } = fakeExec({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', stdout: 'x' });
    await expect(createGitRunner({ execFile })(['diff'], { cwd: '/r' })).rejects.toBeInstanceOf(
      GitCommandError,
    );
  });

  it('names the subcommand after leading -c options', () => {
    expect(subcommandOf(['-c', 'core.hooksPath=/dev/null', 'worktree', 'add'])).toBe('worktree');
    expect(subcommandOf(['-c'])).toBe('unknown');
  });
});

describe('diff parsers', () => {
  it('parses -z name-status including renames and copies', () => {
    const out =
      'M\0src/a.ts\0A\0new.ts\0D\0gone.md\0R087\0old.ts\0moved.ts\0C100\0a.ts\0copy.ts\0T\0link\0';
    expect(parseNameStatus(out)).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'new.ts', status: 'added' },
      { path: 'gone.md', status: 'deleted' },
      { path: 'moved.ts', status: 'renamed' },
      { path: 'copy.ts', status: 'added' },
      { path: 'link', status: 'modified' },
    ]);
  });

  it('parses -z numstat with renames and binary files as unavailable', () => {
    const out = '3\t1\tsrc/a.ts\x002\t0\t\0old.ts\0moved.ts\0-\t-\timg.png\0';
    const counts = parseNumstat(out);
    expect(counts.get('src/a.ts')).toEqual({ additions: 3, deletions: 1 });
    expect(counts.get('moved.ts')).toEqual({ additions: 2, deletions: 0 });
    expect(counts.get('img.png')).toEqual({ additions: null, deletions: null });
  });

  it('keeps paths with tabs, spaces and newlines intact', () => {
    const name = 'we\tird\nname $(x).txt';
    expect(changedFiles(`A\0${name}\0`, `1\t0\t${name}\0`)).toEqual([
      { path: name, status: 'added', additions: 1, deletions: 0 },
    ]);
  });

  it('returns nothing for empty output', () => {
    expect(changedFiles('', '')).toEqual([]);
  });
});
