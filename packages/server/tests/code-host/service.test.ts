// The code host service with a fake `gh` and a local bare `origin` (G-A, ADR-0025). No network.
// Repositories, branches, titles and URLs are synthetic.
import { describe, expect, it } from 'vitest';
import {
  CodeHostError,
  codeHostHttpError,
  createCodeHostService,
  type CodeHostErrorCode,
} from '../../src/code-host/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { GIT_TEST_ENV, git, head, makeRepo, write } from '../workspace/helpers.js';
import { CANARY, bareTip, createFakeGh, withBareOrigin } from './fake-gh.js';

const TIMEOUT = 30_000;

function setup() {
  const repo = makeRepo();
  const bare = withBareOrigin(repo);
  git(repo, 'branch', 'feature/WEB-1-dark-mode');
  const gh = createFakeGh();
  const lines: string[] = [];
  const service = createCodeHostService({
    git: createGitRunner({ env: GIT_TEST_ENV }),
    cli: gh.run,
    logger: {
      log: (level, message, fields) => lines.push(JSON.stringify({ level, message, fields })),
    },
  });
  return { repo, bare, gh, service, lines };
}

async function code(promise: Promise<unknown>): Promise<CodeHostErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CodeHostError) return error.code;
    throw error;
  }
  throw new Error('expected a CodeHostError');
}

const input = {
  head: 'feature/WEB-1-dark-mode',
  base: 'main',
  title: 'WEB-1: Dark mode',
  body: 'Run summary\n\nSynthetic summary.\n\nOpened from Agent Control Plane',
  draft: false,
};

describe('status (exit codes only; owner/name, never the URL)', { timeout: TIMEOUT }, () => {
  it('reports the repository, the CLI and the default branch when all is set up', async () => {
    const { repo, service, gh } = setup();
    const status = await service.status(repo);
    expect(status).toEqual({
      provider: 'github',
      repo: 'acme/widgets',
      defaultBranch: 'main',
      cli: { name: 'gh', installed: true, loggedIn: true },
      problem: null,
    });
    expect(JSON.stringify(status)).not.toContain(CANARY);
    expect(gh.calls.map((c) => c.args.slice(0, 2))).toEqual([
      ['--version'],
      ['auth', 'status'],
      ['repo', 'view'],
    ]);
  });

  it('says what is missing: no remote, another host, no gh, not logged in', async () => {
    const plain = makeRepo();
    const s = setup();
    const none = await s.service.status(plain);
    expect(none).toMatchObject({ provider: null, repo: null, defaultBranch: null });
    expect(none.problem).toContain('no GitHub remote');
    git(plain, 'remote', 'add', 'origin', 'https://user:secret@gitlab.example.com/acme/x.git');
    const other = await s.service.status(plain);
    expect(other).toMatchObject({ provider: null, repo: null });
    expect(JSON.stringify(other)).not.toContain('secret');
    s.gh.state.loggedIn = false;
    const out = await s.service.status(s.repo);
    expect(out).toMatchObject({
      provider: 'github',
      defaultBranch: null,
      cli: { installed: true, loggedIn: false },
    });
    expect(out.problem).toContain('gh auth login');
    s.gh.state.installed = false;
    const missing = await s.service.status(s.repo);
    expect(missing).toMatchObject({ cli: { name: 'gh', installed: false, loggedIn: null } });
    expect(missing.problem).toContain('Install the GitHub CLI');
  });

  it('a remote with a user and token shows only owner/name', async () => {
    const { repo, service } = setup();
    git(repo, 'remote', 'set-url', 'origin', `https://octo:${CANARY}@github.com/acme/widgets.git`);
    const status = await service.status(repo);
    expect(status.repo).toBe('acme/widgets');
    expect(JSON.stringify(status)).not.toContain(CANARY);
    expect(JSON.stringify(status)).not.toContain('octo');
  });
});

describe('push (to the local bare origin; never forced)', { timeout: TIMEOUT }, () => {
  it('pushes the branch with an upstream, by argument array', async () => {
    const { repo, bare, service } = setup();
    await service.push(repo, 'feature/WEB-1-dark-mode');
    expect(bareTip(bare, 'feature/WEB-1-dark-mode')).toBe(head(repo));
    expect(git(repo, 'config', '--get', 'branch.feature/WEB-1-dark-mode.remote').trim()).toBe(
      'origin',
    );
  });

  it('push-rejected when origin has commits the branch lacks; the owner tree is untouched', async () => {
    const { repo, bare, service, lines } = setup();
    // Someone else pushed another commit to the same branch on origin.
    const other = makeRepo({ 'other.txt': 'x\n' });
    git(other, 'push', '--quiet', bare, 'HEAD:refs/heads/feature/WEB-1-dark-mode');
    const theirs = bareTip(bare, 'feature/WEB-1-dark-mode');
    expect(await code(service.push(repo, 'feature/WEB-1-dark-mode'))).toBe('push-rejected');
    expect(bareTip(bare, 'feature/WEB-1-dark-mode')).toBe(theirs);
    // The log has the exit code only, never git's stderr (it can quote the URL).
    expect(lines.join('\n')).not.toContain(bare);
    expect(lines.join('\n')).not.toContain('rejected');
  });

  it('refuses an unsafe branch name before git runs', async () => {
    const { repo, service } = setup();
    expect(await code(service.push(repo, '--force'))).toBe('gh-failed');
    expect(await code(service.push(repo, 'a..b'))).toBe('gh-failed');
  });
});

describe('open a pull request (create, link, refuse)', { timeout: TIMEOUT }, () => {
  it('pushes, then creates it with --flag=value arguments and the body in a file', async () => {
    const { repo, bare, gh, service } = setup();
    const result = await service.openPullRequest(repo, { ...input, title: '--draft; rm -rf /' });
    expect(result).toEqual({
      created: true,
      pullRequest: {
        number: 12,
        url: 'https://github.com/acme/widgets/pull/12',
        state: 'open',
        baseBranch: 'main',
        headBranch: 'feature/WEB-1-dark-mode',
        mergedAt: null,
        mergeCommit: null,
      },
    });
    expect(bareTip(bare, input.head)).toBe(head(repo));
    const create = gh.calls.find((c) => c.args[1] === 'create');
    expect(create?.args).toEqual([
      'pr',
      'create',
      '--repo=acme/widgets',
      '--base=main',
      '--head=feature/WEB-1-dark-mode',
      '--title=--draft; rm -rf /',
      expect.stringMatching(/^--body-file=.*body\.md$/),
    ]);
    expect(create?.options.timeoutMs).toBeGreaterThan(0);
    // The title stayed one argument; the body came from the file, which is gone now.
    expect(gh.prs[0]).toMatchObject({ title: '--draft; rm -rf /', body: input.body, draft: false });
  });

  it('links the open pull request for the same base instead of creating another', async () => {
    const { repo, gh, service } = setup();
    await service.openPullRequest(repo, input);
    write(repo, 'more.txt', 'more\n');
    git(repo, 'checkout', '--quiet', input.head);
    git(repo, 'add', '--all');
    git(repo, 'commit', '--quiet', '-m', 'more');
    git(repo, 'checkout', '--quiet', 'main');
    const again = await service.openPullRequest(repo, { ...input, draft: true });
    expect(again).toMatchObject({ created: false, pullRequest: { number: 12, state: 'open' } });
    expect(gh.prs).toHaveLength(1);
  });

  it('refuses one open against another base (pr-exists-elsewhere) before pushing', async () => {
    const { repo, bare, gh, service } = setup();
    git(repo, 'branch', 'develop');
    await service.openPullRequest(repo, { ...input, base: 'develop' });
    const pushed = bareTip(bare, input.head);
    write(repo, 'x.txt', 'x\n');
    git(repo, 'checkout', '--quiet', input.head);
    git(repo, 'add', '--all');
    git(repo, 'commit', '--quiet', '-m', 'x');
    git(repo, 'checkout', '--quiet', 'main');
    expect(await code(service.openPullRequest(repo, input))).toBe('pr-exists-elsewhere');
    expect(bareTip(bare, input.head)).toBe(pushed);
    expect(gh.prs).toHaveLength(1);
  });

  it('a draft is asked for with --draft', async () => {
    const { repo, gh, service } = setup();
    await service.openPullRequest(repo, { ...input, draft: true });
    expect(gh.prs[0]?.draft).toBe(true);
  });
});

describe('view: open, merged, closed', { timeout: TIMEOUT }, () => {
  it('maps the state and the merge commit', async () => {
    const { repo, gh, service } = setup();
    await service.openPullRequest(repo, input);
    expect((await service.view(repo, 12)).state).toBe('open');
    gh.merge(12, 'c'.repeat(40));
    expect(await service.view(repo, 12)).toMatchObject({
      state: 'merged',
      mergedAt: '2026-10-22T10:00:00Z',
      mergeCommit: 'c'.repeat(40),
    });
    gh.close(12);
    expect(await service.view(repo, 12)).toMatchObject({ state: 'closed' });
    expect(gh.calls.find((c) => c.args[1] === 'view')?.args).toEqual([
      'pr',
      'view',
      '12',
      '--repo=acme/widgets',
      '--json=number,url,state,baseRefName,headRefName,mergedAt,mergeCommit',
    ]);
  });
});

describe('every error code, with plain messages', { timeout: TIMEOUT }, () => {
  it('no-github-remote, gh-not-installed, gh-not-logged-in', async () => {
    const s = setup();
    expect(await code(s.service.openPullRequest(makeRepo(), input))).toBe('no-github-remote');
    s.gh.state.loggedIn = false;
    expect(await code(s.service.openPullRequest(s.repo, input))).toBe('gh-not-logged-in');
    expect(await code(s.service.view(s.repo, 1))).toBe('gh-not-logged-in');
    s.gh.state.installed = false;
    expect(await code(s.service.openPullRequest(s.repo, input))).toBe('gh-not-installed');
    // Nothing was pushed while gh was missing or logged out.
    expect(s.gh.calls.some((c) => c.args[1] === 'create')).toBe(false);
  });

  it('timeout and gh-failed (an exit code, an unreadable or unexpected answer)', async () => {
    const s = setup();
    s.gh.fail.list = { exitCode: null, stdout: '', timedOut: true, notFound: false };
    expect(await code(s.service.openPullRequest(s.repo, input))).toBe('timeout');
    s.gh.fail.list = { exitCode: 1, stdout: '', timedOut: false, notFound: false };
    expect(await code(s.service.openPullRequest(s.repo, input))).toBe('gh-failed');
    delete s.gh.fail.list;
    s.gh.fail.create = {
      exitCode: 0,
      stdout: 'done, somewhere\n',
      timedOut: false,
      notFound: false,
    };
    expect(await code(s.service.openPullRequest(s.repo, input))).toBe('gh-failed');
    delete s.gh.fail.create;
    await s.service.openPullRequest(s.repo, input);
    s.gh.fail.view = { exitCode: 0, stdout: '{"number":"x"}', timedOut: false, notFound: false };
    expect(await code(s.service.view(s.repo, 12))).toBe('gh-failed');
    s.gh.fail.view = { exitCode: 0, stdout: 'not json', timedOut: false, notFound: false };
    expect(await code(s.service.view(s.repo, 12))).toBe('gh-failed');
    s.gh.fail.view = {
      exitCode: 0,
      stdout: JSON.stringify({
        number: 13,
        url: 'https://github.com/acme/widgets/pull/13',
        state: 'OPEN',
        baseRefName: 'main',
        headRefName: 'x',
      }),
      timedOut: false,
      notFound: false,
    };
    expect(await code(s.service.view(s.repo, 12))).toBe('gh-failed');
    s.gh.fail.view = { exitCode: null, stdout: '', timedOut: false, notFound: true };
    expect(await code(s.service.view(s.repo, 12))).toBe('gh-not-installed');
  });

  it('maps to HTTP errors with exactly the seven codes and the app’s own words', () => {
    const cases: [CodeHostErrorCode, number][] = [
      ['gh-not-installed', 409],
      ['gh-not-logged-in', 409],
      ['no-github-remote', 409],
      ['push-rejected', 409],
      ['pr-exists-elsewhere', 409],
      ['timeout', 504],
      ['gh-failed', 502],
    ];
    for (const [c, status] of cases) {
      const http = codeHostHttpError(new CodeHostError(c, 'Plain words'));
      expect([http.status, http.code, http.message]).toEqual([status, c, 'Plain words']);
    }
  });
});
