// F-2: the owner's pushes go to origin's own address only, never to a push URL or a push-only
// rewrite planted in the repository's config. Local bare repositories and a fake `gh`; no network.
// Repositories, branches and addresses are synthetic.
import { describe, expect, it } from 'vitest';
import {
  CodeHostError,
  createCodeHostService,
  type CodeHostErrorCode,
} from '../../src/code-host/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { GIT_TEST_ENV, git, head, makeRepo, tempDir } from '../workspace/helpers.js';
import { REMOTE_URL, bareTip, createFakeGh, withBareOrigin } from './fake-gh.js';

const TIMEOUT = 30_000;
const BRANCH = 'feature/WEB-1-dark-mode';

function setup() {
  const repo = makeRepo();
  const bare = withBareOrigin(repo);
  git(repo, 'branch', BRANCH);
  const evil = tempDir('acp-f2-evil-');
  git(evil, 'init', '--quiet', '--bare');
  const service = createCodeHostService({
    git: createGitRunner({ env: GIT_TEST_ENV }),
    cli: createFakeGh().run,
  });
  return { repo, bare, evil, service };
}

const refsIn = (bare: string) => git(bare, 'for-each-ref').trim();

async function code(promise: Promise<unknown>): Promise<CodeHostErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CodeHostError) return error.code;
    throw error;
  }
  throw new Error('expected a CodeHostError');
}

describe('the owner push and a planted push address', { timeout: TIMEOUT }, () => {
  it('a remote.origin.pushurl is never used: origin gets the push, with tracking and upstream', async () => {
    const { repo, bare, evil, service } = setup();
    git(repo, 'remote', 'set-url', '--push', 'origin', evil);
    // Two push URLs: git would push to both.
    git(repo, 'config', '--add', 'remote.origin.pushurl', REMOTE_URL);
    await service.push(repo, BRANCH);
    expect(bareTip(bare, BRANCH)).toBe(head(repo, BRANCH));
    expect(refsIn(evil)).toBe('');
    expect(head(repo, `refs/remotes/origin/${BRANCH}`)).toBe(head(repo, BRANCH));
    expect(git(repo, 'config', '--get', `branch.${BRANCH}.remote`).trim()).toBe('origin');
    expect(git(repo, 'config', '--get', `branch.${BRANCH}.merge`).trim()).toBe(
      `refs/heads/${BRANCH}`,
    );
  });

  it('a push-only rewrite of origin’s address is refused before anything is pushed', async () => {
    const { repo, bare, evil, service } = setup();
    git(repo, 'config', `url.${evil}.pushInsteadOf`, 'https://github.com/');
    const error = await service.push(repo, BRANCH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodeHostError);
    expect((error as CodeHostError).code).toBe('push-rejected');
    expect((error as CodeHostError).message).toContain('pushInsteadOf');
    expect(bareTip(bare, BRANCH)).toBeNull();
    expect(refsIn(evil)).toBe('');
  });

  it('a push-only rewrite of another address does not block the push', async () => {
    const { repo, bare, evil, service } = setup();
    git(repo, 'config', `url.${evil}.pushInsteadOf`, 'https://example.invalid/');
    await service.push(repo, BRANCH);
    expect(bareTip(bare, BRANCH)).toBe(head(repo, BRANCH));
    expect(refsIn(evil)).toBe('');
  });

  it('an origin address the app does not recognise is refused (ext:: never runs)', async () => {
    const { repo, service } = setup();
    git(repo, 'remote', 'set-url', 'origin', 'ext::sh -c touch% /tmp/acp-f2-never');
    expect(await code(service.push(repo, BRANCH))).toBe('push-rejected');
    git(repo, 'remote', 'set-url', 'origin', 'ssh://-oProxyCommand=x/acme/widgets.git');
    expect(await code(service.push(repo, BRANCH))).toBe('push-rejected');
  });

  it('no origin at all: no_origin', async () => {
    const { repo, service } = setup();
    git(repo, 'remote', 'remove', 'origin');
    expect(await code(service.push(repo, BRANCH))).toBe('no_origin');
  });

  it('deleting the ticket branch on origin ignores a planted push URL too', async () => {
    const { repo, bare, evil, service } = setup();
    await service.push(repo, BRANCH);
    git(evil, 'fetch', '--quiet', bare, `refs/heads/${BRANCH}:refs/heads/${BRANCH}`);
    git(repo, 'remote', 'set-url', '--push', 'origin', evil);
    const presence = await service.deleteTicketBranch(repo, BRANCH, ['main']);
    expect(presence).toMatchObject({ localExists: false, onOrigin: false });
    expect(bareTip(bare, BRANCH)).toBeNull();
    // The planted address kept its copy: the delete never went there.
    expect(bareTip(evil, BRANCH)).not.toBeNull();
  });
});
