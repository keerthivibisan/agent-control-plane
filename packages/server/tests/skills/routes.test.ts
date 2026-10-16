import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MAX_SKILL_BYTES } from '@acp/core';
import {
  CSRF_HEADER,
  ErrorDtoSchema,
  SkillCommitResultDtoSchema,
  SkillDetailDtoSchema,
  SkillSummaryDtoSchema,
} from '@acp/core/api';
import { errorHandler, notFoundHandler, requestId } from '../../src/http/middleware.js';
import { createSkillsRouter } from '../../src/routes/skills.js';
import { git, tempDir, write } from '../workspace/helpers.js';
import { body, setupSkills, snapshot, workflowUsing } from './helpers.js';

/**
 * The skills router mounted the way app.ts mounts its routers (request ids, `/api`, the error
 * middleware), over the real service and a throwaway git repository.
 */

const TOKEN = 'a'.repeat(64);

function setupApi() {
  const s = setupSkills();
  const app = express();
  app.use(requestId);
  app.use(
    '/api',
    createSkillsRouter({
      skills: s.skills,
      projectOf: (id) => (id === s.project.id ? s.project : undefined),
      csrfToken: TOKEN,
    }),
  );
  app.use('/api', notFoundHandler);
  app.use(errorHandler({ log() {} }));
  return { ...s, app };
}

const base = '/api/projects/p1/skills';

function expectError(res: request.Response, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(ErrorDtoSchema.parse(res.body).error.code).toBe(code);
}

describe('skills routes', () => {
  it('creates (201), lists, reads, updates, commits and deletes (204)', async () => {
    const { app, root } = setupApi();
    const created = await request(app).post(base).set(CSRF_HEADER, TOKEN).send(body('code-review'));
    expect(created.status).toBe(201);
    expect(SkillDetailDtoSchema.parse(created.body).uncommitted).toBe(true);

    const list = await request(app).get(base);
    expect(list.status).toBe(200);
    expect(
      SkillSummaryDtoSchema.array()
        .parse(list.body)
        .map((s) => s.name),
    ).toEqual(['code-review']);

    const got = await request(app).get(`${base}/code-review`);
    expect(SkillDetailDtoSchema.parse(got.body).instructions).toBe(
      '# code-review\n\nDo the thing.\n',
    );

    const updated = await request(app)
      .put(`${base}/code-review`)
      .set(CSRF_HEADER, TOKEN)
      .send({ ...body('code-review'), description: 'Changed' });
    expect(updated.status).toBe(200);
    expect(SkillDetailDtoSchema.parse(updated.body).description).toBe('Changed');

    const committed = await request(app).post(`${base}/code-review/commit`).set(CSRF_HEADER, TOKEN);
    expect(committed.status).toBe(200);
    expect(SkillCommitResultDtoSchema.parse(committed.body)).toMatchObject({
      name: 'code-review',
      branch: 'main',
    });
    expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('chore(skills): create code-review');

    const deleted = await request(app).delete(`${base}/code-review`).set(CSRF_HEADER, TOKEN);
    expect(deleted.status).toBe(204);
    expect(existsSync(join(root, '.claude/skills/code-review'))).toBe(false);
  });

  it('requires the CSRF header on every mutation (403) and writes nothing without it', async () => {
    const { app, root } = setupApi();
    await request(app).post(base).set(CSRF_HEADER, TOKEN).send(body('plan'));
    const before = snapshot(root);
    const head = git(root, 'rev-parse', 'HEAD');
    const attempts = [
      () => request(app).post(base).send(body('code-review')),
      () => request(app).put(`${base}/plan`).send(body('plan')),
      () => request(app).delete(`${base}/plan`),
      () => request(app).post(`${base}/plan/commit`),
    ];
    for (const attempt of attempts) expectError(await attempt(), 403, 'csrf_missing');
    expectError(
      await request(app).post(base).set(CSRF_HEADER, 'b'.repeat(64)).send(body('x')),
      403,
      'csrf_invalid',
    );
    expect(snapshot(root)).toEqual(before);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('answers typed refusals', async () => {
    const { app, root, state } = setupApi();
    const post = (b: unknown) =>
      request(app)
        .post(base)
        .set(CSRF_HEADER, TOKEN)
        .send(b as object);

    expectError(await request(app).get('/api/projects/nope/skills'), 404, 'not_found');
    expectError(await request(app).get(`${base}/missing`), 404, 'not_found');
    expectError(await request(app).get(`${base}/Bad-Name`), 400, 'invalid_request');
    expectError(await post(body('..')), 400, 'invalid_request');
    expectError(await post({ name: 'x' }), 400, 'invalid_request');
    expectError(await post(body('big', 'x'.repeat(MAX_SKILL_BYTES + 1))), 413, 'too_large');

    expect((await post(body('code-review'))).status).toBe(201);
    expectError(await post(body('code-review')), 409, 'conflict');

    state.workflow = workflowUsing('p1', 'code-review', ['helpers']);
    expectError(
      await request(app).delete(`${base}/code-review`).set(CSRF_HEADER, TOKEN),
      409,
      'skill_in_use',
    );

    write(root, 'README.md', 'owner edit\n');
    git(root, 'add', 'README.md');
    expectError(
      await request(app).post(`${base}/code-review/commit`).set(CSRF_HEADER, TOKEN),
      409,
      'staged_changes',
    );

    const outside = tempDir('acp-skills-outside-');
    mkdirSync(join(root, '.claude/skills'), { recursive: true });
    symlinkSync(outside, join(root, '.claude/skills/linked'));
    expectError(await post(body('linked')), 400, 'unsafe_path');
  });

  it('answers not_a_git_repo for a project folder without git', async () => {
    const plain = tempDir('acp-skills-plain-');
    const s = setupSkills();
    const app = express();
    app.use(requestId);
    app.use(
      '/api',
      createSkillsRouter({
        skills: s.skills,
        projectOf: (id) => ({ id, rootPath: plain }),
        csrfToken: TOKEN,
      }),
    );
    app.use(errorHandler({ log() {} }));
    expectError(await request(app).get('/api/projects/p9/skills'), 409, 'not_a_git_repo');
  });
});
