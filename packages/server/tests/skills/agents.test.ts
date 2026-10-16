import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MAX_AGENT_BYTES, defaultProjectWorkflow } from '@acp/core';
import {
  AgentDefinitionDetailDtoSchema,
  AgentDefinitionSummaryDtoSchema,
  CSRF_HEADER,
  ErrorDtoSchema,
} from '@acp/core/api';
import { HttpError } from '../../src/errors.js';
import { errorHandler, notFoundHandler, requestId } from '../../src/http/middleware.js';
import { createAgentsRouter } from '../../src/routes/agents.js';
import { parseAgentFile, serializeAgentFile } from '../../src/skills/index.js';
import { git, head, tempDir, write } from '../workspace/helpers.js';
import { SKILLS_NOW, setupSkills, snapshot } from './helpers.js';

/** Agent definitions (ADR-0018 amendment): `.claude/agents/<slug>.md`, same rules as skills. */

const FILE = '.claude/agents/reviewer.md';

function agent(name: string, over: Record<string, unknown> = {}) {
  return {
    name,
    description: `Use ${name} for reviews`,
    tools: ['Read', 'Grep'],
    model: 'sonnet',
    instructions: `You are ${name}.\n`,
    ...over,
  };
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  const error = await promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (e: unknown) => e,
  );
  if (error instanceof HttpError) return { status: error.status, code: error.code };
  if (error instanceof Error && error.name === 'ZodError') {
    return { status: 400, code: 'invalid_request' };
  }
  throw error;
}

describe('agent file front matter', () => {
  it('writes Claude Code format: tools on one line, optional model, nothing else', () => {
    const text = serializeAgentFile({
      name: 'reviewer',
      description: 'Reviews "risky" diffs',
      tools: ['Read', 'Grep', 'mcp__github__get_pr'],
      model: 'sonnet',
      instructions: 'Body',
    });
    expect(text).toBe(
      '---\nname: reviewer\ndescription: "Reviews \\"risky\\" diffs"\ntools: Read, Grep, mcp__github__get_pr\nmodel: sonnet\n---\n\nBody\n',
    );
    expect(
      serializeAgentFile({
        name: 'a',
        description: 'd',
        tools: null,
        model: null,
        instructions: '',
      }),
    ).toBe('---\nname: a\ndescription: "d"\n---\n\n\n');
    expect(
      serializeAgentFile({
        name: 'a',
        description: 'd',
        tools: [],
        model: null,
        instructions: 'x',
      }),
    ).toContain('tools: []\n');
  });

  it('reads tools as a comma list, a flow list or a block list, and names other keys', () => {
    expect(parseAgentFile('---\nname: a\ntools: Read, Grep\n---\n').lists).toEqual({
      tools: ['Read', 'Grep'],
    });
    expect(parseAgentFile('---\nname: a\ntools: [Read, "Bash"]\n---\n').lists).toEqual({
      tools: ['Read', 'Bash'],
    });
    const block = parseAgentFile(
      '---\nname: a\ntools:\n  - Read\n  - Edit\npermissionMode: acceptEdits\nhooks:\n  x: y\n---\nbody\n',
    );
    expect(block.lists).toEqual({ tools: ['Read', 'Edit'] });
    expect(block.extraKeys).toEqual(['permissionMode', 'hooks']);
    expect(block.extraLines).toEqual(['permissionMode: acceptEdits', 'hooks:', '  x: y']);
    expect(block.problems).toEqual([]);
  });
});

describe('agents service', () => {
  it('creates exactly .claude/agents/<slug>.md, lists it uncommitted, and commits only that file', async () => {
    const { root, project, agents } = setupSkills();
    const before = snapshot(root);
    const dto = await agents.create(project, agent('reviewer'));
    expect(readFileSync(join(root, FILE), 'utf8')).toBe(
      '---\nname: reviewer\ndescription: "Use reviewer for reviews"\ntools: Read, Grep\nmodel: sonnet\n---\n\nYou are reviewer.\n',
    );
    expect(dto).toMatchObject({
      name: 'reviewer',
      path: FILE,
      tools: ['Read', 'Grep'],
      model: 'sonnet',
      uncommitted: true,
      lastCommittedAt: null,
      problems: [],
      instructions: 'You are reviewer.\n',
    });
    expect(snapshot(root, [FILE])).toEqual(before);

    // Another agent file stays out of the commit.
    await agents.create(project, agent('tester', { tools: null, model: null }));
    const result = await agents.commit(project, 'reviewer');
    expect(result).toMatchObject({ name: 'reviewer', branch: 'main', commit: head(root) });
    expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('chore(agents): create reviewer');
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe(FILE);
    const list = await agents.list(project);
    expect(list.map((a) => [a.name, a.uncommitted, a.tools, a.model])).toEqual([
      ['reviewer', false, ['Read', 'Grep'], 'sonnet'],
      ['tester', true, null, null],
    ]);
    expect(list[0]).not.toHaveProperty('instructions');
  });

  it('update keeps hand-written keys and reports them; commit says "update", delete then "remove"', async () => {
    const { root, project, agents } = setupSkills();
    write(
      root,
      FILE,
      '---\nname: reviewer\ndescription: old\npermissionMode: acceptEdits\ncolor: blue\n---\nold\n',
    );
    git(root, 'add', '--all');
    git(root, 'commit', '--quiet', '-m', 'add agent');
    const before = await agents.get(project, 'reviewer');
    expect(before.problems).toEqual([
      'The front matter has other keys (permissionMode, color): kept as is, not used by the app.',
    ]);
    expect(before).toMatchObject({ tools: null, model: null });

    await agents.update(project, 'reviewer', agent('reviewer', { tools: ['Read'], model: null }));
    expect(readFileSync(join(root, FILE), 'utf8')).toBe(
      '---\nname: reviewer\ndescription: "Use reviewer for reviews"\ntools: Read\npermissionMode: acceptEdits\ncolor: blue\n---\n\nYou are reviewer.\n',
    );
    await agents.commit(project, 'reviewer');
    expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('chore(agents): update reviewer');

    await agents.delete(project, 'reviewer');
    expect(existsSync(join(root, FILE))).toBe(false);
    expect(existsSync(join(root, '.claude/agents'))).toBe(true);
    await agents.commit(project, 'reviewer');
    expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('chore(agents): remove reviewer');
  });

  it('reports unreadable parts as problems: bad tool names, name mismatch, no description', async () => {
    const { root, project, agents } = setupSkills();
    write(root, '.claude/agents/odd.md', '---\nname: other\ntools: Read, not a tool\n---\nx\n');
    const [odd] = await agents.list(project);
    expect(odd?.tools).toEqual(['Read']);
    expect(odd?.problems).toEqual([
      'The name in the front matter differs from the file name.',
      'The front matter has no description, so Claude Code cannot tell when to use the agent.',
      'Some entries in tools are not tool names, so they are left out here.',
    ]);
  });

  it('refuses a symlinked .claude/agents, a symlinked agent file, and lists neither', async () => {
    const { root, project, agents } = setupSkills();
    const outside = tempDir('acp-agents-outside-');
    writeFileSync(join(outside, 'reviewer.md'), 'keep\n');
    mkdirSync(join(root, '.claude'));
    symlinkSync(outside, join(root, '.claude/agents'));
    const unsafe = { status: 400, code: 'unsafe_path' };
    expect(await refusal(agents.create(project, agent('reviewer')))).toEqual(unsafe);
    expect(await refusal(agents.list(project))).toEqual(unsafe);
    expect(readFileSync(join(outside, 'reviewer.md'), 'utf8')).toBe('keep\n');

    const { root: root2, project: p2, agents: agents2 } = setupSkills();
    mkdirSync(join(root2, '.claude/agents'), { recursive: true });
    symlinkSync(join(outside, 'reviewer.md'), join(root2, FILE));
    expect(await refusal(agents2.create(p2, agent('reviewer')))).toEqual(unsafe);
    expect(await refusal(agents2.update(p2, 'reviewer', agent('reviewer')))).toEqual(unsafe);
    expect(await refusal(agents2.delete(p2, 'reviewer'))).toEqual(unsafe);
    expect(await agents2.list(p2)).toEqual([]);
    expect(readFileSync(join(outside, 'reviewer.md'), 'utf8')).toBe('keep\n');
  });

  it('refuses `..`, uppercase and bad tool names, an oversize file, and staged unrelated files', async () => {
    const { root, project, agents } = setupSkills();
    const before = snapshot(root);
    for (const name of ['..', '../x', 'Reviewer', 'a/b']) {
      expect(await refusal(agents.create(project, agent(name)))).toEqual({
        status: 400,
        code: 'invalid_request',
      });
      expect(await refusal(agents.get(project, name))).toEqual({
        status: 400,
        code: 'invalid_request',
      });
    }
    expect(await refusal(agents.create(project, agent('x', { tools: ['Read; rm'] })))).toEqual({
      status: 400,
      code: 'invalid_request',
    });
    expect(
      await refusal(
        agents.create(project, agent('big', { instructions: 'x'.repeat(MAX_AGENT_BYTES + 1) })),
      ),
    ).toEqual({ status: 413, code: 'too_large' });
    expect(snapshot(root)).toEqual(before);

    await agents.create(project, agent('reviewer'));
    write(root, 'README.md', 'owner edit\n');
    git(root, 'add', 'README.md');
    const at = head(root);
    expect(await refusal(agents.commit(project, 'reviewer'))).toEqual({
      status: 409,
      code: 'staged_changes',
    });
    expect(head(root)).toBe(at);
  });

  it('refuses to delete an agent file a workflow stage uses, naming the stages (409)', async () => {
    const { root, project, agents, state } = setupSkills();
    await agents.create(project, agent('reviewer'));
    const w = defaultProjectWorkflow('p1', SKILLS_NOW.toISOString());
    w.stages.orchestrate.agent = 'reviewer';
    // A stage that is switched off still names the file, so it still counts (as for skills).
    w.stages['code-review'] = { enabled: false, model: null, skill: null, agent: 'reviewer' };
    state.workflow = w;
    const error = await agents.delete(project, 'reviewer').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'agent_in_use' });
    expect((error as Error).message).toBe(
      'The agent file is used by these workflow stages: Orchestrate, Final code review. Remove it from them first.',
    );
    expect(existsSync(join(root, FILE))).toBe(true);

    // Another file, and the same file once no stage names it, delete as before.
    await agents.create(project, agent('planner'));
    await agents.delete(project, 'planner');
    state.workflow = defaultProjectWorkflow('p1', SKILLS_NOW.toISOString());
    await agents.delete(project, 'reviewer');
    expect(existsSync(join(root, FILE))).toBe(false);
  });

  it("never opens the owner's personal ~/.claude/agents", async () => {
    const { agents, homeDir } = setupSkills();
    git(homeDir, 'init', '--quiet', '-b', 'main');
    write(homeDir, '.claude/agents/mine.md', '---\nname: mine\n---\nmine\n');
    const atHome = { id: 'home', rootPath: homeDir };
    expect(await refusal(agents.list(atHome))).toEqual({ status: 400, code: 'unsafe_path' });
    expect(await refusal(agents.create(atHome, agent('reviewer')))).toEqual({
      status: 400,
      code: 'unsafe_path',
    });
    expect(existsSync(join(homeDir, '.claude/agents/reviewer.md'))).toBe(false);
  });
});

describe('agents routes', () => {
  const TOKEN = 'b'.repeat(64);
  function setupApi() {
    const s = setupSkills();
    const app = express();
    app.use(requestId);
    app.use(
      '/api',
      createAgentsRouter({
        agents: s.agents,
        projectOf: (id) => (id === s.project.id ? s.project : undefined),
        csrfToken: TOKEN,
      }),
    );
    app.use('/api', notFoundHandler);
    app.use(errorHandler({ log() {} }));
    return { ...s, app };
  }
  const base = '/api/projects/p1/agents';
  const code = (res: request.Response) => ErrorDtoSchema.parse(res.body).error.code;

  it('mirrors the skills routes: 201, list, get, put, commit, 204', async () => {
    const { app, root } = setupApi();
    const created = await request(app).post(base).set(CSRF_HEADER, TOKEN).send(agent('reviewer'));
    expect(created.status).toBe(201);
    expect(AgentDefinitionDetailDtoSchema.parse(created.body).path).toBe(FILE);
    const list = await request(app).get(base);
    expect(
      AgentDefinitionSummaryDtoSchema.array()
        .parse(list.body)
        .map((a) => a.name),
    ).toEqual(['reviewer']);
    expect((await request(app).get(`${base}/reviewer`)).status).toBe(200);
    const put = await request(app)
      .put(`${base}/reviewer`)
      .set(CSRF_HEADER, TOKEN)
      .send(agent('reviewer', { tools: null }));
    expect(AgentDefinitionDetailDtoSchema.parse(put.body).tools).toBeNull();
    const committed = await request(app).post(`${base}/reviewer/commit`).set(CSRF_HEADER, TOKEN);
    expect(committed.status).toBe(200);
    expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('chore(agents): create reviewer');
    expect((await request(app).delete(`${base}/reviewer`).set(CSRF_HEADER, TOKEN)).status).toBe(
      204,
    );
  });

  it('requires CSRF on every mutation and answers typed refusals', async () => {
    const { app, root } = setupApi();
    for (const res of [
      await request(app).post(base).send(agent('x')),
      await request(app).put(`${base}/x`).send(agent('x')),
      await request(app).delete(`${base}/x`),
      await request(app).post(`${base}/x/commit`),
    ]) {
      expect(res.status).toBe(403);
      expect(code(res)).toBe('csrf_missing');
    }
    expect(existsSync(join(root, '.claude'))).toBe(false);
    const post = (b: object) => request(app).post(base).set(CSRF_HEADER, TOKEN).send(b);
    expect((await post(agent('reviewer'))).status).toBe(201);
    const dup = await post(agent('reviewer'));
    expect([dup.status, code(dup)]).toEqual([409, 'conflict']);
    const missing = await request(app).get(`${base}/nope`);
    expect([missing.status, code(missing)]).toEqual([404, 'not_found']);
    const bad = await request(app).get(`${base}/Bad`);
    expect([bad.status, code(bad)]).toEqual([400, 'invalid_request']);
    const unknown = await request(app).get('/api/projects/zzz/agents');
    expect([unknown.status, code(unknown)]).toEqual([404, 'not_found']);
  });

  it('answers 409 agent_in_use with the stage names when a stage uses the file', async () => {
    const { app, root, state } = setupApi();
    expect(
      (await request(app).post(base).set(CSRF_HEADER, TOKEN).send(agent('reviewer'))).status,
    ).toBe(201);
    state.workflow.stages.helpers.agent = 'reviewer';
    const refused = await request(app).delete(`${base}/reviewer`).set(CSRF_HEADER, TOKEN);
    expect(refused.status).toBe(409);
    const { error } = ErrorDtoSchema.parse(refused.body);
    expect(error.code).toBe('agent_in_use');
    expect(error.message).toContain('Helpers');
    expect(existsSync(join(root, FILE))).toBe(true);
  });
});
