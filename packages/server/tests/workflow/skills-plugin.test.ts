// Synthetic skill folders in temp directories only; the real ~/.claude is never touched (R-G).
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_SKILL_BYTES } from '@acp/core';
import {
  createSkillsPlugins,
  parseSkillFile,
  reducedSkill,
} from '../../src/workflow/skills-plugin.js';
import { tempDir } from '../workspace/helpers.js';

const RUN = 'run-1';

function skill(root: string, name: string, body: string | Buffer): void {
  mkdirSync(join(root, '.claude', 'skills', name), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), body);
}

describe('parseSkillFile', () => {
  it('reads a plain, a quoted and a block description', () => {
    expect(parseSkillFile('---\nname: a\ndescription: Short one.\n---\nBody\n')).toEqual({
      description: 'Short one.',
      body: 'Body\n',
    });
    expect(parseSkillFile('---\ndescription: "Has: a colon"\n---\n').description).toBe(
      'Has: a colon',
    );
    expect(parseSkillFile("---\ndescription: 'It''s quoted'\n---\n").description).toBe(
      "It's quoted",
    );
    expect(
      parseSkillFile('---\ndescription: >\n  Folded\n  text\nname: x\n---\n').description,
    ).toBe('Folded text');
    expect(parseSkillFile('---\ndescription: |\n  Line one\n  Line two\n---\n').description).toBe(
      'Line one\nLine two',
    );
    expect(parseSkillFile('---\ndescription: Plain\n  continued\n---\n').description).toBe(
      'Plain continued',
    );
  });

  it('keeps a file without front matter as the body, and handles CRLF', () => {
    expect(parseSkillFile('# Just text\n')).toEqual({ description: '', body: '# Just text\n' });
    expect(parseSkillFile('---\r\ndescription: Windows\r\n---\r\nBody\r\n')).toEqual({
      description: 'Windows',
      body: 'Body\r\n',
    });
  });
});

describe('reducedSkill', () => {
  it('keeps only name and description; allowed-tools, hooks and model are dropped', () => {
    const text = [
      '---',
      'name: other-name',
      'description: Review code.',
      'allowed-tools: Bash(rm:*), Write',
      'model: opus',
      'hooks:',
      '  PreToolUse: run-me',
      '---',
      'Steps.',
      '',
    ].join('\n');
    expect(reducedSkill('code-review', text)).toBe(
      '---\nname: code-review\ndescription: "Review code."\n---\nSteps.\n',
    );
  });

  it('cannot be broken out of by a description that looks like YAML', () => {
    const text = '---\ndescription: "x\\nallowed-tools: Bash"\n---\nBody\n';
    const reduced = reducedSkill('safe', text);
    expect(reduced.split('\n').filter((l) => l.startsWith('allowed-tools'))).toEqual([]);
    expect(reduced).toContain('description: "x\\nallowed-tools: Bash"');
  });
});

describe('createSkillsPlugins (ADR-0019 §4)', () => {
  function setup() {
    const dataDir = tempDir('acp-plugin-data-');
    const homeDir = tempDir('acp-plugin-home-');
    const root = tempDir('acp-plugin-repo-');
    return {
      dataDir,
      homeDir,
      root,
      plugins: createSkillsPlugins({ dataDir, skills: { homeDir } }),
    };
  }

  it('builds a skills-only plugin and refuses what the path rules refuse', async () => {
    const { dataDir, homeDir, root, plugins } = setup();
    skill(root, 'good', '---\nname: good\ndescription: Fine.\nallowed-tools: Bash\n---\nUse it.\n');
    const outside = tempDir('acp-plugin-outside-');
    skill(outside, 'linked', '---\ndescription: Not ours.\n---\n');
    symlinkSync(
      join(outside, '.claude', 'skills', 'linked'),
      join(root, '.claude', 'skills', 'linked'),
    );
    mkdirSync(join(root, '.claude', 'skills', 'file-link'));
    symlinkSync(
      join(outside, '.claude', 'skills', 'linked', 'SKILL.md'),
      join(root, '.claude', 'skills', 'file-link', 'SKILL.md'),
    );
    skill(root, 'too-big', 'x'.repeat(MAX_SKILL_BYTES + 1));
    skill(root, 'not-text', Buffer.from([0xff, 0xfe, 0x00, 0x41]));

    const built = await plugins.build({
      runId: RUN,
      projectRoot: root,
      skills: ['good', 'linked', 'file-link', 'too-big', 'not-text', 'missing', 'good'],
    });
    const path = join(dataDir, 'runs', RUN, 'skills-plugin');
    expect(built).toEqual({
      path,
      skills: ['good'],
      refused: ['linked', 'file-link', 'too-big', 'not-text', 'missing'],
    });
    expect(readdirSync(path).sort()).toEqual(['.claude-plugin', 'skills']);
    expect(readdirSync(join(path, '.claude-plugin'))).toEqual(['plugin.json']);
    expect(readdirSync(join(path, 'skills'))).toEqual(['good']);
    expect(readFileSync(join(path, 'skills', 'good', 'SKILL.md'), 'utf8')).toBe(
      '---\nname: good\ndescription: "Fine."\n---\nUse it.\n',
    );
    expect(existsSync(join(homeDir, '.claude'))).toBe(false);
  });

  it("never copies the owner's personal skills, even for a project at the home directory", async () => {
    const { homeDir, plugins } = setup();
    skill(homeDir, 'personal', '---\ndescription: Mine.\n---\n');
    const built = await plugins.build({ runId: RUN, projectRoot: homeDir, skills: ['personal'] });
    expect(built.skills).toEqual([]);
    expect(built.refused).toEqual(['personal']);
  });

  it('removes a run plugin, and every plugin on start', async () => {
    const { dataDir, root, plugins } = setup();
    skill(root, 'good', '---\ndescription: Fine.\n---\n');
    await plugins.build({ runId: RUN, projectRoot: root, skills: ['good'] });
    await plugins.build({ runId: 'run-2', projectRoot: root, skills: ['good'] });
    await plugins.remove(RUN);
    expect(existsSync(join(dataDir, 'runs', RUN))).toBe(false);
    expect(await plugins.cleanupAll()).toBe(1);
    expect(existsSync(join(dataDir, 'runs', 'run-2', 'skills-plugin'))).toBe(false);
    await expect(
      plugins.build({ runId: '../x', projectRoot: root, skills: ['good'] }),
    ).rejects.toThrow(/unsafe run id/);
  });
});
