// The project branch routes (G-F, ADR-0025 §8): GET and POST /api/projects/:id/branches, with
// CSRF, the request contract and the refusal codes. Temp repositories and a local bare origin;
// no network. Synthetic names only.
import { ProjectBranchesDtoSchema } from '@acp/core/api';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCodeHostService } from '../../src/code-host/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { expectError } from '../control/helpers.js';
import { createFakeGh, bareTip } from '../code-host/fake-gh.js';
import { GIT_TEST_ENV, git, head, tempDir } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';

const TIMEOUT = 60_000;

async function setup(withCodeHost = true) {
  const codeHost = createCodeHostService({
    git: createGitRunner({ env: GIT_TEST_ENV }),
    cli: createFakeGh().run,
    tmpDir: tempDir('acp-gh-tmp-'),
  });
  const s = await setupBoard(withCodeHost ? { codeHost } : {});
  return { s, path: `/api/projects/${s.project.id}/branches` };
}

describe('GET /api/projects/:id/branches', { timeout: TIMEOUT }, () => {
  it('lists the local branches with the current one; 404 for an unknown project', async () => {
    const { s, path } = await setup();
    git(s.repo, 'branch', 'develop');
    const res = await request(s.app).get(path);
    expect(res.status).toBe(200);
    expect(ProjectBranchesDtoSchema.parse(res.body)).toEqual({
      current: 'main',
      hasOrigin: false,
      truncated: false,
      branches: [
        { name: 'develop', commit: head(s.repo), current: false, onOrigin: null },
        { name: 'main', commit: head(s.repo), current: true, onOrigin: null },
      ],
    });
    expectError(await request(s.app).get('/api/projects/nope/branches'), 404, 'not_found');
  });

  it('409 not_a_git_repository when the project folder is not a repository', async () => {
    const { s } = await setup();
    const plain = s.repos.projects.insert({ name: 'plain', rootPath: tempDir('acp-plain-') });
    expectError(
      await request(s.app).get(`/api/projects/${plain.id}/branches`),
      409,
      'not_a_git_repository',
    );
  });

  it('404 code_host_unavailable without the code host service', async () => {
    const { s, path } = await setup(false);
    expectError(await request(s.app).get(path), 404, 'code_host_unavailable');
  });
});

describe('POST /api/projects/:id/branches', { timeout: TIMEOUT }, () => {
  it('creates on the owner’s click only (CSRF) and answers the fresh list (201)', async () => {
    const { s, path } = await setup();
    const body = { name: 'dev', from: 'main' };
    expectError(await request(s.app).post(path).send(body), 403, 'csrf_missing');
    expect(() => git(s.repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/dev')).toThrow();

    const res = await s.post(path, body);
    expect(res.status).toBe(201);
    const dto = ProjectBranchesDtoSchema.parse(res.body);
    expect(dto.branches.map((b) => b.name)).toEqual(['dev', 'main']);
    expect(dto.current).toBe('main');
    expect(git(s.repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');

    expectError(await s.post(path, body), 409, 'branch_exists');
    expectError(await s.post(path, { name: 'x', from: 'nope' }), 404, 'base_branch_missing');
    expectError(await s.post(path, { name: 'x.lock/y', from: 'main' }), 422, 'invalid_branch_name');
  });

  it('400 invalid_request for a body outside the contract', async () => {
    const { s, path } = await setup();
    for (const bad of [
      {},
      { name: 'dev' },
      { name: '-dev', from: 'main' },
      { name: 'a b', from: 'main' },
      { name: 'dev', from: 'main', push: 'yes' },
    ]) {
      expectError(await s.post(path, bad), 400, 'invalid_request');
    }
  });

  it('push: to origin; 409 no_origin without one; a failed push keeps the branch', async () => {
    const { s, path } = await setup();
    expectError(await s.post(path, { name: 'dev', from: 'main', push: true }), 409, 'no_origin');
    expect(() => git(s.repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/dev')).toThrow();

    const bare = tempDir('acp-bare-');
    git(bare, 'init', '--quiet', '--bare');
    git(s.repo, 'remote', 'add', 'origin', bare);
    const res = await s.post(path, { name: 'dev', from: 'main', push: true });
    expect(res.status).toBe(201);
    expect(bareTip(bare, 'dev')).toBe(head(s.repo));
    const dto = ProjectBranchesDtoSchema.parse(res.body);
    expect(dto.hasOrigin).toBe(true);
    expect(dto.branches.find((b) => b.name === 'dev')?.onOrigin).toBe(true);

    git(s.repo, 'remote', 'set-url', 'origin', `${tempDir('acp-gone-')}/missing.git`);
    const failed = expectError(
      await s.post(path, { name: 'qa', from: 'main', push: true }),
      409,
      'push-rejected',
    );
    expect(failed.error.message).toContain('created qa in the project');
    expect(head(s.repo, 'refs/heads/qa')).toBe(head(s.repo));
  });
});
