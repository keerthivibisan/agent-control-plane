// The Settings routes that connect a project to GitHub (G-E, ADR-0025 §7): CSRF, the request
// contracts and the refusal codes, with a fake `gh`. No network. Synthetic names only.
import { CodeHostStatusDtoSchema } from '@acp/core/api';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCodeHostService } from '../../src/code-host/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { expectError } from '../control/helpers.js';
import { CANARY, createFakeGh } from '../code-host/fake-gh.js';
import { GIT_TEST_ENV, git, tempDir } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';

const TIMEOUT = 60_000;

async function setup() {
  const gh = createFakeGh();
  const codeHost = createCodeHostService({
    git: createGitRunner({ env: GIT_TEST_ENV }),
    cli: gh.run,
    tmpDir: tempDir('acp-gh-tmp-'),
  });
  const s = await setupBoard({ codeHost });
  const origin = () => {
    try {
      return git(s.repo, 'config', '--get', 'remote.origin.url').trim();
    } catch {
      return null;
    }
  };
  return { s, gh, origin };
}

describe('POST /api/projects/:id/code-host/repository', { timeout: TIMEOUT }, () => {
  it('creates and sets origin on the owner’s click only (CSRF), then refuses a second', async () => {
    const { s, gh, origin } = await setup();
    const path = `/api/projects/${s.project.id}/code-host/repository`;
    const body = { name: 'web-app', visibility: 'private', push: false };
    expectError(await request(s.app).post(path).send(body), 403, 'csrf_missing');
    expect(gh.repos).toEqual([]);

    const res = await s.post(path, body);
    expect(res.status).toBe(200);
    expect(CodeHostStatusDtoSchema.parse(res.body)).toMatchObject({
      provider: 'github',
      repo: 'octo/web-app',
      problem: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(CANARY);
    expect(origin()).toBe('https://github.com/octo/web-app.git');

    const again = expectError(await s.post(path, body), 409, 'origin_exists');
    expect(again.error.message).toContain('already has a remote named origin');
    expect(gh.repos).toHaveLength(1);
  });

  it('400 for a body outside the contract; 409 code_host_not_ready; 422 when GitHub says no', async () => {
    const { s, gh, origin } = await setup();
    const path = `/api/projects/${s.project.id}/code-host/repository`;
    for (const bad of [
      {},
      { name: 'a b', visibility: 'private', push: false },
      { name: 'x.git', visibility: 'private', push: false },
      { name: 'ok', owner: '-bad', visibility: 'private', push: false },
      { name: 'ok', visibility: 'internal', push: false },
    ]) {
      expectError(await s.post(path, bad), 400, 'invalid_request');
    }
    gh.state.loggedIn = false;
    expectError(
      await s.post(path, { name: 'ok', visibility: 'private', push: false }),
      409,
      'code_host_not_ready',
    );
    gh.state.loggedIn = true;
    gh.repos.push({ slug: 'octo/taken', visibility: 'public' });
    const refused = expectError(
      await s.post(path, { name: 'taken', visibility: 'public', push: false }),
      422,
      'repository_create_failed',
    );
    expect(refused.error.message).toBe(
      'GitHub refused to create the repository: it may already exist, or the name is not allowed.',
    );
    expect(origin()).toBeNull();
    expectError(
      await s.post('/api/projects/nope/code-host/repository', {
        name: 'ok',
        visibility: 'private',
        push: false,
      }),
      404,
      'not_found',
    );
  });
});

describe('POST /api/projects/:id/code-host/remote', { timeout: TIMEOUT }, () => {
  it('connects an existing repository, rebuilt from owner/name; refuses bad text and a second', async () => {
    const { s, gh, origin } = await setup();
    const path = `/api/projects/${s.project.id}/code-host/remote`;
    expectError(
      await request(s.app).post(path).send({ repository: 'acme/widgets' }),
      403,
      'csrf_missing',
    );
    expectError(await s.post(path, { repository: 'x' }), 400, 'invalid_request');
    expectError(
      await s.post(path, { repository: 'https://user:pw@github.com/acme/widgets' }),
      422,
      'invalid_repository',
    );
    expect(origin()).toBeNull();

    const res = await s.post(path, { repository: ' https://github.com/acme/widgets/ ' });
    expect(res.status).toBe(200);
    expect(CodeHostStatusDtoSchema.parse(res.body)).toMatchObject({ repo: 'acme/widgets' });
    expect(origin()).toBe('https://github.com/acme/widgets.git');
    expect(gh.calls.some((c) => c.args[1] === 'create')).toBe(false);

    expectError(await s.post(path, { repository: 'acme/other' }), 409, 'origin_exists');
    expect(origin()).toBe('https://github.com/acme/widgets.git');
  });
});
