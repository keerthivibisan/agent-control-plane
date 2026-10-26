// Connecting a project to GitHub from Settings (G-E, ADR-0025 §7): create a repository with a
// fake `gh`, connect an existing one, and every refusal. Pushes go to a local bare repository
// (`insteadOf` in the test repository's own config); nothing reaches GitHub. Synthetic names only.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CodeHostError,
  codeHostHttpError,
  createCodeHostService,
  type CodeHostErrorCode,
} from '../../src/code-host/index.js';
import { MESSAGES } from '../../src/code-host/errors.js';
import { GitCommandError, createGitRunner, type GitRunner } from '../../src/workspace/index.js';
import { GIT_TEST_ENV, git, head, makeRepo, tempDir } from '../workspace/helpers.js';
import { CANARY, bareTip, createFakeGh } from './fake-gh.js';

const TIMEOUT = 30_000;

function setup(options: { repo?: string; git?: (real: GitRunner) => GitRunner } = {}) {
  const repo = options.repo ?? makeRepo();
  const gh = createFakeGh();
  const neutral = tempDir('acp-gh-tmp-');
  const lines: string[] = [];
  const real = createGitRunner({ env: GIT_TEST_ENV });
  const service = createCodeHostService({
    git: options.git === undefined ? real : options.git(real),
    cli: gh.run,
    tmpDir: neutral,
    logger: {
      log: (level, message, fields) => lines.push(JSON.stringify({ level, message, fields })),
    },
  });
  return { repo, gh, neutral, service, lines };
}

/** Points `https://github.com/<slug>.git` at a new local bare repository, for this repo only. */
function bareFor(repo: string, slug: string): string {
  const bare = tempDir('acp-bare-');
  git(bare, 'init', '--quiet', '--bare');
  git(repo, 'config', `url.${bare}.insteadOf`, `https://github.com/${slug}.git`);
  return bare;
}

function origin(repo: string): string | null {
  try {
    return git(repo, 'config', '--get', 'remote.origin.url').trim();
  } catch {
    return null;
  }
}

const remotes = (repo: string): string[] => git(repo, 'remote').split('\n').filter(Boolean);

async function refusal(promise: Promise<unknown>): Promise<CodeHostError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CodeHostError) return error;
    throw error;
  }
  throw new Error('expected a CodeHostError');
}

const code = async (promise: Promise<unknown>): Promise<CodeHostErrorCode> =>
  (await refusal(promise)).code;

const ghArgs = (gh: ReturnType<typeof createFakeGh>) => gh.calls.map((c) => c.args);

describe('create a repository (gh repo create, then origin)', { timeout: TIMEOUT }, () => {
  it('in the logged-in account, private, pushing the current branch', async () => {
    const { repo, gh, neutral, service, lines } = setup();
    const bare = bareFor(repo, 'octo/web-app');
    const status = await service.createRepository(repo, {
      name: 'web-app',
      visibility: 'private',
      push: true,
    });
    expect(status).toEqual({
      provider: 'github',
      repo: 'octo/web-app',
      defaultBranch: 'main',
      cli: { name: 'gh', installed: true, loggedIn: true },
      problem: null,
    });
    // Exactly these gh calls, as argument arrays; the account name from `gh api user`.
    expect(ghArgs(gh).slice(0, 4)).toEqual([
      ['--version'],
      ['auth', 'status', '--hostname=github.com'],
      ['api', '--hostname=github.com', 'user', '--jq=.login'],
      ['repo', 'create', 'web-app', '--private'],
    ]);
    // gh ran outside the checkout, with a time limit.
    const create = gh.calls.find((c) => c.args[1] === 'create');
    expect(create?.options.cwd).toBe(neutral);
    expect(create?.options.timeoutMs).toBeGreaterThan(0);
    expect(gh.repos).toEqual([{ slug: 'octo/web-app', visibility: 'private' }]);
    // origin is rebuilt from owner and name; the branch is on the (bare) origin with upstream.
    expect(origin(repo)).toBe('https://github.com/octo/web-app.git');
    expect(bareTip(bare, 'main')).toBe(head(repo));
    expect(git(repo, 'config', '--get', 'branch.main.remote').trim()).toBe('origin');
    // gh's output (with the canary) never reaches the answer or the log.
    expect(JSON.stringify(status)).not.toContain(CANARY);
    expect(lines.join('\n')).not.toContain(CANARY);
    expect(lines.join('\n')).not.toContain('web-app');
  });

  it('in an organization, public, without pushing: no account lookup, nothing pushed', async () => {
    const { repo, gh, service } = setup();
    const bare = bareFor(repo, 'acme-org/widgets');
    const status = await service.createRepository(repo, {
      name: 'widgets',
      owner: 'acme-org',
      visibility: 'public',
      push: false,
    });
    expect(status.repo).toBe('acme-org/widgets');
    expect(ghArgs(gh)).toContainEqual(['repo', 'create', 'acme-org/widgets', '--public']);
    expect(ghArgs(gh).some((a) => a[0] === 'api')).toBe(false);
    expect(origin(repo)).toBe('https://github.com/acme-org/widgets.git');
    expect(bareTip(bare, 'main')).toBeNull();
    expect(git(bare, 'for-each-ref').trim()).toBe('');
  });

  it('a name that starts with "-" goes as <account>/<name>, never as an option', async () => {
    const { repo, gh, service } = setup();
    await service.createRepository(repo, { name: '-dash', visibility: 'private', push: false });
    expect(ghArgs(gh)).toContainEqual(['repo', 'create', 'octo/-dash', '--private']);
    expect(origin(repo)).toBe('https://github.com/octo/-dash.git');
  });

  it('pushes nothing when the branch has no commits yet', async () => {
    const empty = tempDir('acp-ws-repo-');
    git(empty, 'init', '--quiet', '-b', 'main');
    const { gh, service } = setup({ repo: empty });
    const bare = bareFor(empty, 'octo/fresh');
    const status = await service.createRepository(empty, {
      name: 'fresh',
      visibility: 'private',
      push: true,
    });
    expect(status.repo).toBe('octo/fresh');
    expect(gh.repos).toHaveLength(1);
    expect(git(bare, 'for-each-ref').trim()).toBe('');
  });

  it('origin_exists: any origin, GitHub or not, before gh is asked to create', async () => {
    const { repo, gh, service } = setup();
    git(repo, 'remote', 'add', 'origin', 'https://gitlab.example.com/acme/x.git');
    const e = await refusal(
      service.createRepository(repo, { name: 'x', visibility: 'private', push: true }),
    );
    expect(e.code).toBe('origin_exists');
    expect(e.message).toBe(MESSAGES.originExists);
    expect(gh.calls).toHaveLength(0);
    expect(origin(repo)).toBe('https://gitlab.example.com/acme/x.git');
    expect(codeHostHttpError(e).status).toBe(409);
  });

  it('code_host_not_ready: gh missing or not logged in (exit codes); nothing created', async () => {
    const s = setup();
    s.gh.state.loggedIn = false;
    const out = await refusal(
      s.service.createRepository(s.repo, { name: 'x', visibility: 'private', push: false }),
    );
    expect([out.code, out.message]).toEqual(['code_host_not_ready', MESSAGES.createNotLoggedIn]);
    s.gh.state.installed = false;
    const missing = await refusal(
      s.service.createRepository(s.repo, { name: 'x', visibility: 'private', push: false }),
    );
    expect([missing.code, missing.message]).toEqual([
      'code_host_not_ready',
      MESSAGES.createNotInstalled,
    ]);
    expect(s.gh.calls.some((c) => c.args[1] === 'create')).toBe(false);
    expect(remotes(s.repo)).toEqual([]);
  });

  it('detached HEAD with "push now" is refused before anything is created', async () => {
    const { repo, gh, service } = setup();
    git(repo, 'checkout', '--quiet', '--detach');
    const e = await refusal(
      service.createRepository(repo, { name: 'x', visibility: 'private', push: true }),
    );
    expect(e.code).toBe('detached_head');
    expect(gh.repos).toEqual([]);
    expect(remotes(repo)).toEqual([]);
    // Without pushing, a detached HEAD is fine.
    await service.createRepository(repo, { name: 'x', visibility: 'private', push: false });
    expect(origin(repo)).toBe('https://github.com/octo/x.git');
  });

  it('repository_create_failed: one plain sentence, never gh’s words; no origin', async () => {
    const { repo, gh, service } = setup();
    gh.repos.push({ slug: 'octo/taken', visibility: 'private' });
    const e = await refusal(
      service.createRepository(repo, { name: 'taken', visibility: 'private', push: true }),
    );
    expect([e.code, e.message]).toEqual(['repository_create_failed', MESSAGES.createFailed]);
    expect(e.message).not.toContain(CANARY);
    expect(codeHostHttpError(e).status).toBe(422);
    expect(remotes(repo)).toEqual([]);
  });

  it('a timeout or an odd account name is a plain error; no origin', async () => {
    const s = setup();
    s.gh.fail['repo-create'] = { exitCode: null, stdout: '', timedOut: true, notFound: false };
    expect(
      await code(
        s.service.createRepository(s.repo, { name: 'x', visibility: 'private', push: false }),
      ),
    ).toBe('timeout');
    delete s.gh.fail['repo-create'];
    s.gh.fail.login = { exitCode: 0, stdout: '-not an owner\n', timedOut: false, notFound: false };
    expect(
      await code(
        s.service.createRepository(s.repo, { name: 'x', visibility: 'private', push: false }),
      ),
    ).toBe('gh-failed');
    expect(s.gh.repos).toEqual([]);
    expect(remotes(s.repo)).toEqual([]);
  });

  it('remote_add_failed after the repository was created says so plainly', async () => {
    const failing = (real: GitRunner): GitRunner => {
      return (args, options) =>
        args.includes('remote') && args.includes('add')
          ? Promise.reject(new GitCommandError('remote', 128, 'synthetic failure'))
          : real(args, options);
    };
    const { repo, gh, service } = setup({ git: failing });
    const e = await refusal(
      service.createRepository(repo, { name: 'web-app', visibility: 'private', push: true }),
    );
    expect(e.code).toBe('remote_add_failed');
    expect(e.message).toContain('GitHub created octo/web-app');
    expect(e.message).toContain('git remote add origin https://github.com/octo/web-app.git');
    expect(e.message).not.toContain('synthetic failure');
    expect(gh.repos).toHaveLength(1);
    expect(remotes(repo)).toEqual([]);
  });

  it('an origin added meanwhile is origin_exists, and is left as it is', async () => {
    const racing = (real: GitRunner): GitRunner => {
      return async (args, options) => {
        if (args.includes('remote') && args.includes('add')) {
          git(options.cwd, 'remote', 'add', 'origin', 'https://github.com/someone/else.git');
          throw new GitCommandError('remote', 3, 'exists');
        }
        return real(args, options);
      };
    };
    const { repo, service } = setup({ git: racing });
    expect(
      await code(service.createRepository(repo, { name: 'a', visibility: 'private', push: false })),
    ).toBe('origin_exists');
    expect(origin(repo)).toBe('https://github.com/someone/else.git');
  });

  it('a failed push after creating keeps origin and says what happened', async () => {
    const { repo, service } = setup();
    // origin points at a folder that is not a repository: the push fails.
    git(
      repo,
      'config',
      `url.${join(tempDir(), 'missing')}.insteadOf`,
      'https://github.com/octo/p.git',
    );
    const e = await refusal(
      service.createRepository(repo, { name: 'p', visibility: 'private', push: true }),
    );
    expect(e.code).toBe('push-rejected');
    expect(e.message).toContain('GitHub created octo/p and it is now the project’s origin');
    expect(origin(repo)).toBe('https://github.com/octo/p.git');
  });

  it('not_a_git_repository for a plain folder', async () => {
    const plain = tempDir('acp-plain-');
    const { service } = setup({ repo: plain });
    expect(
      await code(service.createRepository(plain, { name: 'a', visibility: 'private', push: true })),
    ).toBe('not_a_git_repository');
  });
});

describe(
  'connect an existing repository (origin only, nothing pushed)',
  { timeout: TIMEOUT },
  () => {
    it.each([
      ['acme/widgets', 'https://github.com/acme/widgets.git'],
      ['https://github.com/acme/widgets', 'https://github.com/acme/widgets.git'],
      ['  https://github.com/acme/widgets.git/ ', 'https://github.com/acme/widgets.git'],
      ['git@github.com:acme/widgets.git', 'git@github.com:acme/widgets.git'],
      ['git@github.com:acme/widgets', 'git@github.com:acme/widgets.git'],
    ])('%s → origin %s', async (typed, written) => {
      const { repo, gh, service } = setup();
      const status = await service.connectRepository(repo, typed);
      expect(origin(repo)).toBe(written);
      expect(status).toMatchObject({ provider: 'github', repo: 'acme/widgets', problem: null });
      // Only the status checks ran: nothing created, nothing pushed.
      expect(gh.calls.some((c) => c.args[1] === 'create')).toBe(false);
      expect(git(repo, 'for-each-ref', 'refs/remotes').trim()).toBe('');
    });

    it('needs no gh: connecting works with the CLI missing', async () => {
      const { repo, gh, service } = setup();
      gh.state.installed = false;
      const status = await service.connectRepository(repo, 'acme/widgets');
      expect(status).toMatchObject({ repo: 'acme/widgets', cli: { installed: false } });
    });

    it.each([
      'https://gitlab.com/octo/acp',
      'https://user:pw@github.com/octo/acp',
      'https://github.com:8443/octo/acp',
      'https://github.com/octo/acp/tree/main',
      'https://github.com/octo/acp?x=1',
      'http://github.com/octo/acp',
      'octo/acp/extra',
      '-octo/acp',
      'octo/..',
      'octo/a b',
      'octo/acp; rm -rf /',
      'ext::sh -c touch% /tmp/x',
      '--upload-pack=x/acp',
    ])('invalid_repository: %s, and git is never run', async (bad) => {
      const { repo, service, gh } = setup();
      const e = await refusal(service.connectRepository(repo, bad));
      expect([e.code, e.message]).toEqual(['invalid_repository', MESSAGES.invalidRepository]);
      expect(codeHostHttpError(e).status).toBe(422);
      expect(remotes(repo)).toEqual([]);
      expect(gh.calls).toHaveLength(0);
    });

    it('origin_exists leaves the existing origin as it is', async () => {
      const { repo, service } = setup();
      git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/old.git');
      expect(await code(service.connectRepository(repo, 'acme/new'))).toBe('origin_exists');
      expect(origin(repo)).toBe('git@github.com:acme/old.git');
    });

    it('another remote that is not origin is fine and untouched', async () => {
      const { repo, service } = setup();
      git(repo, 'remote', 'add', 'upstream', 'https://github.com/acme/upstream.git');
      await service.connectRepository(repo, 'acme/widgets');
      expect(remotes(repo).sort()).toEqual(['origin', 'upstream']);
      expect(git(repo, 'config', '--get', 'remote.upstream.url').trim()).toBe(
        'https://github.com/acme/upstream.git',
      );
    });

    it('writes only the origin remote in .git/config', async () => {
      const { repo, service } = setup();
      const before = git(repo, 'status', '--porcelain');
      await service.connectRepository(repo, 'acme/widgets');
      expect(git(repo, 'status', '--porcelain')).toBe(before);
      expect(git(repo, 'config', '--get-regexp', '^remote\\.').trim().split('\n')).toEqual([
        'remote.origin.url https://github.com/acme/widgets.git',
        'remote.origin.fetch +refs/heads/*:refs/remotes/origin/*',
      ]);
    });
  },
);

describe('the G-E codes map to HTTP', () => {
  it('with the app’s own words', () => {
    const cases: [CodeHostErrorCode, number][] = [
      ['origin_exists', 409],
      ['code_host_not_ready', 409],
      ['invalid_repository', 422],
      ['repository_create_failed', 422],
      ['remote_add_failed', 500],
      ['detached_head', 409],
      ['not_a_git_repository', 409],
    ];
    for (const [c, status] of cases) {
      const http = codeHostHttpError(new CodeHostError(c, 'Plain words'));
      expect([http.status, http.code, http.message]).toEqual([status, c, 'Plain words']);
    }
  });
});
