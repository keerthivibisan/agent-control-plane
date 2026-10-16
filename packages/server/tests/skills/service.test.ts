import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_SKILL_BYTES } from '@acp/core';
import { HttpError } from '../../src/errors.js';
import { git, head, tempDir, write } from '../workspace/helpers.js';
import { body, setupSkills, snapshot, workflowUsing } from './helpers.js';

/** The refusal an operation fails with, as `{ status, code }`. */
async function refusal(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  const error = await promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (e: unknown) => e,
  );
  if (error instanceof HttpError) return { status: error.status, code: error.code };
  if (error instanceof Error && error.name === 'ZodError')
    return { status: 400, code: 'invalid_request' };
  throw error;
}

const SKILL = '.claude/skills/code-review/SKILL.md';

describe('skills service: create, list, get, update, delete, commit', () => {
  it('creates exactly .claude/skills/<slug>/SKILL.md with front matter, uncommitted', async () => {
    const { root, project, skills } = setupSkills();
    const before = snapshot(root);
    const dto = await skills.create(project, body('code-review'));
    expect(readFileSync(join(root, SKILL), 'utf8')).toBe(
      '---\nname: code-review\ndescription: "Use code-review when needed"\n---\n\n# code-review\n\nDo the thing.\n',
    );
    expect(dto).toMatchObject({
      name: 'code-review',
      description: 'Use code-review when needed',
      path: SKILL,
      usedBy: [],
      uncommitted: true,
      lastCommittedAt: null,
      problems: [],
      instructions: '# code-review\n\nDo the thing.\n',
    });
    expect(dto.sizeBytes).toBe(Buffer.byteLength(readFileSync(join(root, SKILL))));
    // Nothing outside the skill folder changed.
    expect(snapshot(root, ['.claude/skills/code-review'])).toEqual(before);
    expect(git(root, 'status', '--porcelain', '--untracked-files=all')).toBe(`?? ${SKILL}\n`);
  });

  it('lists skills with "used by" from the workflow, and commits only the skill folder', async () => {
    const { root, project, skills, state } = setupSkills();
    await skills.create(project, body('code-review'));
    await skills.create(project, body('plan'));
    state.workflow = workflowUsing('p1', 'code-review', ['helpers', 'code-review']);

    const list = await skills.list(project);
    expect(list.map((s) => [s.name, s.usedBy, s.uncommitted])).toEqual([
      ['code-review', ['helpers', 'code-review'], true],
      ['plan', [], true],
    ]);
    expect(list[0]).not.toHaveProperty('instructions');

    const before = head(root);
    const result = await skills.commit(project, 'code-review');
    expect(result.branch).toBe('main');
    expect(result.commit).toBe(head(root));
    expect(git(root, 'rev-parse', 'HEAD~1').trim()).toBe(before);
    expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('chore(skills): create code-review');
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe(SKILL);
    // The other skill is still uncommitted; this one is clean with a commit time.
    const after = await skills.list(project);
    expect(after.map((s) => [s.name, s.uncommitted])).toEqual([
      ['code-review', false],
      ['plan', true],
    ]);
    expect(after[0]?.lastCommittedAt).toMatch(/Z$/);
  });

  it('update replaces the text, keeps unmanaged front-matter keys, and commits as "update"', async () => {
    const { root, project, skills } = setupSkills();
    write(
      root,
      SKILL,
      '---\nname: code-review\ndescription: old\nallowed-tools:\n  - Read\n---\nold body\n',
    );
    git(root, 'add', '--all');
    git(root, 'commit', '--quiet', '-m', 'add skill');

    const dto = await skills.update(project, 'code-review', {
      name: 'code-review',
      description: 'new',
      instructions: 'new body\n',
    });
    expect(dto).toMatchObject({
      description: 'new',
      instructions: 'new body\n',
      uncommitted: true,
    });
    expect(readFileSync(join(root, SKILL), 'utf8')).toBe(
      '---\nname: code-review\ndescription: "new"\nallowed-tools:\n  - Read\n---\n\nnew body\n',
    );
    await skills.commit(project, 'code-review');
    expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('chore(skills): update code-review');
  });

  it('delete removes the file and the empty folder; commit records "remove"', async () => {
    const { root, project, skills } = setupSkills();
    await skills.create(project, body('code-review'));
    await skills.commit(project, 'code-review');
    await skills.delete(project, 'code-review');
    expect(existsSync(join(root, '.claude/skills/code-review'))).toBe(false);
    expect(await skills.list(project)).toEqual([]);
    await skills.commit(project, 'code-review');
    expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('chore(skills): remove code-review');
    expect(git(root, 'status', '--porcelain', '--untracked-files=all')).toBe('');
  });

  it('delete keeps other files the owner put next to SKILL.md', async () => {
    const { root, project, skills } = setupSkills();
    await skills.create(project, body('code-review'));
    write(root, '.claude/skills/code-review/checklist.md', 'mine\n');
    await skills.delete(project, 'code-review');
    expect(existsSync(join(root, SKILL))).toBe(false);
    expect(readFileSync(join(root, '.claude/skills/code-review/checklist.md'), 'utf8')).toBe(
      'mine\n',
    );
  });

  it('refuses create when the skill exists, and unknown names on get, update, delete', async () => {
    const { project, skills } = setupSkills();
    await skills.create(project, body('code-review'));
    expect(await refusal(skills.create(project, body('code-review')))).toEqual({
      status: 409,
      code: 'conflict',
    });
    expect(await refusal(skills.get(project, 'nope'))).toEqual({ status: 404, code: 'not_found' });
    expect(await refusal(skills.update(project, 'nope', body('nope')))).toEqual({
      status: 404,
      code: 'not_found',
    });
    expect(await refusal(skills.delete(project, 'nope'))).toEqual({
      status: 404,
      code: 'not_found',
    });
    // A rename through update is refused (the folder name is the skill's identity).
    expect(await refusal(skills.update(project, 'code-review', body('other')))).toEqual({
      status: 400,
      code: 'invalid_request',
    });
  });

  it('reports problems in plain sentences: no SKILL.md, name mismatch, no description, not text', async () => {
    const { root, project, skills } = setupSkills();
    mkdirSync(join(root, '.claude/skills/empty'), { recursive: true });
    write(root, '.claude/skills/mismatch/SKILL.md', '---\nname: other\ndescription: d\n---\nx\n');
    write(root, '.claude/skills/nodesc/SKILL.md', '---\nname: nodesc\n---\nx\n');
    write(root, '.claude/skills/binary/SKILL.md', Buffer.from([0xff, 0xfe, 0x00, 0x41]));
    const problems = Object.fromEntries(
      (await skills.list(project)).map((s) => [s.name, s.problems]),
    );
    expect(problems).toEqual({
      binary: ['SKILL.md is not UTF-8 text, so the app does not open it.'],
      empty: ['There is no SKILL.md in this folder, so Claude Code ignores it.'],
      mismatch: ['The name in the front matter differs from the folder name.'],
      nodesc: [
        'The front matter has no description, so Claude Code cannot tell when to use the skill.',
      ],
    });
  });

  it('works when the project is a subfolder of a repository', async () => {
    const { root, skills } = setupSkills({ files: { 'app/README.md': 'x\n', 'other.txt': 'o\n' } });
    const project = { id: 'p1', rootPath: join(root, 'app') };
    await skills.create(project, body('plan'));
    await skills.commit(project, 'plan');
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe(
      'app/.claude/skills/plan/SKILL.md',
    );
    // Staged work elsewhere in the repository (outside the project folder) still blocks a commit.
    await skills.update(project, 'plan', { ...body('plan'), description: 'changed' });
    write(root, 'other.txt', 'changed\n');
    git(root, 'add', 'other.txt');
    expect(await refusal(skills.commit(project, 'plan'))).toEqual({
      status: 409,
      code: 'staged_changes',
    });
  });
});

describe('skills service: ADR-0018 path and commit safety', () => {
  it("never opens the owner's personal ~/.claude, even for a project at the home folder", async () => {
    const { skills, homeDir } = setupSkills();
    git(homeDir, 'init', '--quiet', '-b', 'main');
    const atHome = { id: 'home', rootPath: homeDir };
    const unsafe = { status: 400, code: 'unsafe_path' };
    // No ~/.claude yet: creating one there is refused too.
    expect(await refusal(skills.create(atHome, body('plan')))).toEqual(unsafe);
    expect(existsSync(join(homeDir, '.claude'))).toBe(false);
    write(homeDir, '.claude/skills/personal/SKILL.md', '---\nname: personal\n---\nmine\n');
    expect(await refusal(skills.list(atHome))).toEqual(unsafe);
    expect(await refusal(skills.get(atHome, 'personal'))).toEqual(unsafe);
    expect(await refusal(skills.delete(atHome, 'personal'))).toEqual(unsafe);
    // A project registered inside ~/.claude is refused as well.
    const inside = { id: 'in', rootPath: join(homeDir, '.claude/skills') };
    expect(await refusal(skills.list(inside))).toEqual(unsafe);
    expect(readFileSync(join(homeDir, '.claude/skills/personal/SKILL.md'), 'utf8')).toContain(
      'mine',
    );
  });

  it('refuses a symlinked .claude and writes nothing through it', async () => {
    const { root, project, skills } = setupSkills();
    const outside = tempDir('acp-skills-outside-');
    symlinkSync(outside, join(root, '.claude'));
    expect(await refusal(skills.create(project, body('code-review')))).toEqual({
      status: 400,
      code: 'unsafe_path',
    });
    expect(await refusal(skills.list(project))).toEqual({ status: 400, code: 'unsafe_path' });
    expect(snapshot(outside)).toEqual({});
  });

  it('refuses a symlinked .claude/skills', async () => {
    const { root, project, skills } = setupSkills();
    const outside = tempDir('acp-skills-outside-');
    mkdirSync(join(root, '.claude'));
    symlinkSync(outside, join(root, '.claude/skills'));
    expect(await refusal(skills.create(project, body('plan')))).toEqual({
      status: 400,
      code: 'unsafe_path',
    });
    expect(snapshot(outside)).toEqual({});
  });

  it('refuses a symlinked slug folder for every operation, and the list skips it', async () => {
    const { root, project, skills } = setupSkills();
    const outside = tempDir('acp-skills-outside-');
    writeFileSync(join(outside, 'SKILL.md'), '---\nname: code-review\ndescription: x\n---\nkeep\n');
    mkdirSync(join(root, '.claude/skills'), { recursive: true });
    symlinkSync(outside, join(root, '.claude/skills/code-review'));
    const unsafe = { status: 400, code: 'unsafe_path' };
    expect(await refusal(skills.create(project, body('code-review')))).toEqual(unsafe);
    expect(await refusal(skills.update(project, 'code-review', body('code-review')))).toEqual(
      unsafe,
    );
    expect(await refusal(skills.get(project, 'code-review'))).toEqual(unsafe);
    expect(await refusal(skills.delete(project, 'code-review'))).toEqual(unsafe);
    expect(await skills.list(project)).toEqual([]);
    expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).toContain('keep');
  });

  it('refuses to write through a symlinked SKILL.md and shows it as a problem', async () => {
    const { root, project, skills } = setupSkills();
    const outside = tempDir('acp-skills-outside-');
    writeFileSync(join(outside, 'target.md'), 'keep\n');
    mkdirSync(join(root, '.claude/skills/code-review'), { recursive: true });
    symlinkSync(join(outside, 'target.md'), join(root, SKILL));
    expect(await refusal(skills.update(project, 'code-review', body('code-review')))).toEqual({
      status: 400,
      code: 'unsafe_path',
    });
    expect(await refusal(skills.delete(project, 'code-review'))).toEqual({
      status: 400,
      code: 'unsafe_path',
    });
    const [listed] = await skills.list(project);
    expect(listed?.problems).toEqual(['SKILL.md is a symbolic link, so the app does not open it.']);
    expect(readFileSync(join(outside, 'target.md'), 'utf8')).toBe('keep\n');
  });

  it('refuses `..`, uppercase and slashed names (schema), touching nothing', async () => {
    const { root, project, skills } = setupSkills();
    const before = snapshot(root);
    for (const name of ['..', '../x', 'Code-Review', 'a/b', '-lead', '', 'a'.repeat(65)]) {
      expect(await refusal(skills.create(project, body(name)))).toEqual({
        status: 400,
        code: 'invalid_request',
      });
      expect(await refusal(skills.get(project, name))).toEqual({
        status: 400,
        code: 'invalid_request',
      });
      expect(await refusal(skills.delete(project, name))).toEqual({
        status: 400,
        code: 'invalid_request',
      });
      expect(await refusal(skills.commit(project, name))).toEqual({
        status: 400,
        code: 'invalid_request',
      });
    }
    expect(snapshot(root)).toEqual(before);
  });

  it('refuses an oversize file (also when multibyte text fits the character limit)', async () => {
    const { root, project, skills } = setupSkills();
    expect(
      await refusal(skills.create(project, body('big', 'x'.repeat(MAX_SKILL_BYTES + 1)))),
    ).toEqual({ status: 413, code: 'too_large' });
    // 30 000 three-byte characters: under the schema's character cap, over the byte cap.
    expect(await refusal(skills.create(project, body('big', '€'.repeat(30_000))))).toEqual({
      status: 413,
      code: 'too_large',
    });
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('refuses text that is not valid UTF-8 (a lone surrogate) or holds NUL', async () => {
    const { project, skills } = setupSkills();
    for (const text of ['bad \uD800 half', 'nul \u0000 byte']) {
      expect(await refusal(skills.create(project, body('odd', text)))).toEqual({
        status: 400,
        code: 'invalid_request',
      });
    }
  });

  it('refuses a commit while other files are staged, leaving the index and HEAD alone', async () => {
    const { root, project, skills } = setupSkills();
    await skills.create(project, body('code-review'));
    write(root, 'src/app.ts', 'export const owner = 1;\n');
    git(root, 'add', 'src/app.ts');
    const before = head(root);
    expect(await refusal(skills.commit(project, 'code-review'))).toEqual({
      status: 409,
      code: 'staged_changes',
    });
    expect(head(root)).toBe(before);
    expect(git(root, 'diff', '--cached', '--name-only').trim()).toBe('src/app.ts');
    // The owner's unstaged edits are never swept in either.
    git(root, 'reset', '--quiet');
    await skills.commit(project, 'code-review');
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe(SKILL);
    expect(git(root, 'status', '--porcelain').trim()).toBe('M src/app.ts');
  });

  it('refuses to delete a skill that a workflow stage uses', async () => {
    const { root, project, skills, state } = setupSkills();
    await skills.create(project, body('code-review'));
    state.workflow = workflowUsing('p1', 'code-review', ['plan']);
    const error = await skills.delete(project, 'code-review').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'skill_in_use' });
    expect((error as Error).message).toContain('Plan');
    expect(existsSync(join(root, SKILL))).toBe(true);
  });

  it('refuses a folder that is not a git repository, a detached HEAD and an empty commit', async () => {
    const { project, skills, root } = setupSkills();
    const plain = tempDir('acp-skills-plain-');
    const noRepo = { id: 'p2', rootPath: plain };
    expect(await refusal(skills.list(noRepo))).toEqual({ status: 409, code: 'not_a_git_repo' });
    expect(await refusal(skills.create(noRepo, body('plan')))).toEqual({
      status: 409,
      code: 'not_a_git_repo',
    });
    expect(snapshot(plain)).toEqual({});

    await skills.create(project, body('plan'));
    await skills.commit(project, 'plan');
    expect(await refusal(skills.commit(project, 'plan'))).toEqual({
      status: 409,
      code: 'nothing_to_commit',
    });
    git(root, 'checkout', '--quiet', '--detach');
    await skills.update(project, 'plan', { ...body('plan'), description: 'changed' });
    expect(await refusal(skills.commit(project, 'plan'))).toEqual({
      status: 409,
      code: 'detached_head',
    });
  });

  it('runs only argv git (no shell, never push) and never logs file contents', async () => {
    const { project, skills, calls, logs } = setupSkills();
    const secret = 'TOP-SECRET-INSTRUCTION-TEXT';
    await skills.create(project, {
      name: 'plan',
      description: 'secret description',
      instructions: secret,
    });
    await skills.update(project, 'plan', { name: 'plan', description: 'd2', instructions: secret });
    await skills.commit(project, 'plan');
    await skills.list(project);
    await skills.delete(project, 'plan');
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.file).toBe('git');
      expect(call.options.shell).toBe(false);
      expect(call.args).not.toContain('push');
      expect(call.args).toEqual(expect.arrayContaining(['core.hooksPath=/dev/null']));
    }
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('secret description');
    expect(logs.map((l) => l.message)).toEqual([
      'skill written',
      'skill written',
      'skill committed',
      'skill removed',
    ]);
  });
});
