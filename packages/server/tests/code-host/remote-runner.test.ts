// The origin URL parser and the CLI runner with a fake `gh` executable (G-A, ADR-0025). The fake
// is a small node script in a temp dir; nothing reaches GitHub. Synthetic data only.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCliRunner,
  createCodeHostService,
  parseRemoteUrl,
  providerOf,
} from '../../src/code-host/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { GIT_TEST_ENV, git, makeRepo, tempDir } from '../workspace/helpers.js';
import { CANARY, bareTip, withBareOrigin } from './fake-gh.js';

describe('parseRemoteUrl', () => {
  it('reads owner/name from every common form, never keeping a user or token', () => {
    const expected = { host: 'github.com', owner: 'acme', name: 'widgets' };
    for (const url of [
      'git@github.com:acme/widgets.git',
      'git@github.com:acme/widgets',
      'github.com:acme/widgets.git',
      'ssh://git@github.com/acme/widgets.git',
      'ssh://git@github.com:22/acme/widgets',
      'https://github.com/acme/widgets.git',
      'https://github.com/acme/widgets/',
      `https://octo:${CANARY}@github.com/acme/widgets.git`,
      'https://GitHub.com/acme/widgets',
      'git://github.com/acme/widgets.git',
    ]) {
      const parsed = parseRemoteUrl(url);
      expect(parsed, url).toEqual(expected);
      expect(JSON.stringify(parsed)).not.toContain(CANARY);
    }
    expect(parseRemoteUrl('git@ssh.github.com:acme/my.repo_1.git')).toEqual({
      host: 'ssh.github.com',
      owner: 'acme',
      name: 'my.repo_1',
    });
  });

  it('refuses paths, odd names, queries and local folders', () => {
    for (const url of [
      '',
      '/srv/git/widgets.git',
      'file:///srv/git/widgets.git',
      'https://github.com/acme',
      'https://github.com/acme/widgets/tree/main',
      'https://github.com/-acme/widgets',
      'https://github.com/acme/..',
      'https://github.com/acme/wid gets',
      'https://github.com/acme/widgets?x=1',
      'https://github.com/acme/%ZZ',
      'git@github.com:acme/widgets.git\nmalicious',
    ]) {
      expect(parseRemoteUrl(url), url).toBeNull();
    }
  });

  it('only github.com hosts are the GitHub provider', () => {
    const at = (url: string) => {
      const r = parseRemoteUrl(url);
      return r === null ? null : providerOf(r);
    };
    expect(at('git@github.com:a/b.git')).toBe('github');
    expect(at('https://www.github.com/a/b')).toBe('github');
    expect(at('https://gitlab.com/a/b')).toBeNull();
    expect(at('https://github.example.com/a/b')).toBeNull();
  });
});

/** A fake `gh` script: logs its argv and selected env to a file, writes the canary to stderr. */
function fakeGhScript(dir: string, behaviour: string): string {
  const path = join(dir, 'gh');
  writeFileSync(
    path,
    `#!${process.execPath}
const fs = require('node:fs');
const log = ${JSON.stringify(join(dir, 'calls.jsonl'))};
const args = process.argv.slice(2);
fs.appendFileSync(log, JSON.stringify({ args, prompt: process.env.GH_PROMPT_DISABLED ?? null,
  terminal: process.env.GIT_TERMINAL_PROMPT ?? null, gitDir: process.env.GIT_DIR ?? null }) + '\\n');
process.stderr.write(${JSON.stringify(`error: token ${CANARY}\n`)});
${behaviour}
`,
  );
  chmodSync(path, 0o755);
  return path;
}

const calls = (dir: string) =>
  readFileSync(join(dir, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(
      (l) => JSON.parse(l) as { args: string[]; prompt: string | null; terminal: string | null },
    );

describe('the CLI runner (execFile, no shell, no prompt, stderr dropped)', () => {
  it('passes arguments verbatim, sets no-prompt env, drops GIT_*, and never returns stderr', async () => {
    const dir = tempDir('acp-gh-');
    const gh = fakeGhScript(dir, `process.stdout.write('out ' + args.length); process.exit(3);`);
    // A server started from inside a git hook has GIT_DIR set: it never reaches the CLI.
    process.env['GIT_DIR'] = '/should/not/leak';
    let run;
    try {
      run = createCliRunner();
    } finally {
      delete process.env['GIT_DIR'];
    }
    const result = await run(gh, ['--title=$(touch x); `id`', 'a b'], {
      cwd: dir,
      timeoutMs: 10_000,
    });
    // A non-zero exit gives the code only: no stdout and never stderr.
    expect(result).toEqual({ exitCode: 3, stdout: '', timedOut: false, notFound: false });
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(calls(dir)).toEqual([
      { args: ['--title=$(touch x); `id`', 'a b'], prompt: '1', terminal: '0', gitDir: null },
    ]);
    // No shell: the command substitution was an ordinary argument.
    expect(existsSync(join(dir, 'x'))).toBe(false);
  });

  it('reports a missing executable and a timeout', async () => {
    const dir = tempDir('acp-gh-');
    const run = createCliRunner();
    expect(
      await run(join(dir, 'no-such-gh'), ['--version'], { cwd: dir, timeoutMs: 5_000 }),
    ).toEqual({ exitCode: null, stdout: '', timedOut: false, notFound: true });
    const slow = fakeGhScript(dir, `setTimeout(() => {}, 60_000);`);
    const result = await run(slow, ['pr', 'view', '1'], { cwd: dir, timeoutMs: 300 });
    expect(result).toMatchObject({ exitCode: null, timedOut: true, notFound: false });
  });

  it('a full open through the real runner: push to the bare origin, then gh pr create', async () => {
    const dir = tempDir('acp-gh-');
    const gh = fakeGhScript(
      dir,
      `const sub = args.slice(0, 2).join(' ');
if (args[0] === '--version' || sub === 'auth status') process.exit(0);
if (sub === 'pr list') { process.stdout.write('[]'); process.exit(0); }
if (sub === 'pr create') {
  const body = fs.readFileSync(args.find((a) => a.startsWith('--body-file=')).slice(12), 'utf8');
  fs.writeFileSync(${JSON.stringify(join(dir, 'body.txt'))}, body);
  process.stdout.write('https://github.com/acme/widgets/pull/7\\n'); process.exit(0);
}
if (sub === 'pr view') {
  process.stdout.write(JSON.stringify({ number: 7, url: 'https://github.com/acme/widgets/pull/7',
    state: 'OPEN', baseRefName: 'main', headRefName: 'fix/WEB-2', mergedAt: null, mergeCommit: null }));
  process.exit(0);
}
process.exit(9);`,
    );
    const repo = makeRepo();
    const bare = withBareOrigin(repo);
    git(repo, 'branch', 'fix/WEB-2');
    const service = createCodeHostService({
      git: createGitRunner({ env: GIT_TEST_ENV }),
      cli: createCliRunner(),
      ghCommand: gh,
      tmpDir: dir,
    });
    const opened = await service.openPullRequest(repo, {
      head: 'fix/WEB-2',
      base: 'main',
      title: 'WEB-2: Fix',
      body: 'Synthetic body',
      draft: false,
    });
    expect(opened).toMatchObject({ created: true, pullRequest: { number: 7, state: 'open' } });
    expect(bareTip(bare, 'fix/WEB-2')).not.toBeNull();
    expect(readFileSync(join(dir, 'body.txt'), 'utf8')).toBe('Synthetic body');
    // The temporary body file is removed after the call.
    expect(calls(dir).every((c) => c.prompt === '1' && c.terminal === '0')).toBe(true);
    const bodyArg = calls(dir)
      .flatMap((c) => c.args)
      .find((a) => a.startsWith('--body-file='));
    expect(bodyArg !== undefined && existsSync(bodyArg.slice(12))).toBe(false);
  });

  it('G-E: create a repository through the real runner: argv, no-prompt env, outside the checkout', async () => {
    const dir = tempDir('acp-gh-');
    const neutral = tempDir('acp-gh-tmp-');
    const gh = fakeGhScript(
      dir,
      `fs.appendFileSync(${JSON.stringify(join(dir, 'cwd.txt'))}, process.cwd() + '\\n');
const sub = args.slice(0, 2).join(' ');
if (args[0] === '--version' || sub === 'auth status') process.exit(0);
if (args[0] === 'api') { process.stdout.write('octo\\n'); process.exit(0); }
if (sub === 'repo create') { process.stdout.write('https://github.com/octo/new-app\\n'); process.exit(0); }
if (sub === 'repo view') { process.stdout.write('{"defaultBranchRef":{"name":"main"}}'); process.exit(0); }
process.exit(9);`,
    );
    const repo = makeRepo();
    const bare = tempDir('acp-bare-');
    git(bare, 'init', '--quiet', '--bare');
    git(repo, 'config', `url.${bare}.insteadOf`, 'https://github.com/octo/new-app.git');
    const service = createCodeHostService({
      git: createGitRunner({ env: GIT_TEST_ENV }),
      cli: createCliRunner(),
      ghCommand: gh,
      tmpDir: neutral,
    });
    const status = await service.createRepository(repo, {
      name: 'new-app',
      visibility: 'public',
      push: true,
    });
    expect(status).toMatchObject({ provider: 'github', repo: 'octo/new-app' });
    const made = calls(dir);
    expect(made.map((c) => c.args)).toEqual([
      ['--version'],
      ['auth', 'status', '--hostname=github.com'],
      ['api', '--hostname=github.com', 'user', '--jq=.login'],
      ['repo', 'create', 'new-app', '--public'],
      // The status answered afterwards.
      ['--version'],
      ['auth', 'status', '--hostname=github.com'],
      ['repo', 'view', 'octo/new-app', '--json=defaultBranchRef'],
    ]);
    expect(made.every((c) => c.prompt === '1' && c.terminal === '0')).toBe(true);
    // Creating ran in the neutral folder, never in the project's checkout.
    const cwds = readFileSync(join(dir, 'cwd.txt'), 'utf8').trim().split('\n');
    expect(cwds.slice(0, 4)).toEqual([neutral, neutral, neutral, neutral]);
    expect(git(repo, 'config', '--get', 'remote.origin.url').trim()).toBe(
      'https://github.com/octo/new-app.git',
    );
    expect(bareTip(bare, 'main')).not.toBeNull();
  });
});
