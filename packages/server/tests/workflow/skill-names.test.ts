// Synthetic skill folders in temp directories only; the real ~/.claude is never touched (R-G).
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listProjectSkillNames } from '../../src/workflow/skill-names.js';
import { tempDir } from '../workspace/helpers.js';

function skill(root: string, name: string, body = '---\nname: x\n---\n'): void {
  mkdirSync(join(root, '.claude', 'skills', name), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), body);
}

describe('listProjectSkillNames (R-G, ADR-0018 path rules)', () => {
  const homeDir = () => tempDir('acp-home-');

  it('lists skill folders that hold a SKILL.md, sorted, by name only', async () => {
    const root = tempDir();
    skill(root, 'unit-tests');
    skill(root, 'code-review');
    mkdirSync(join(root, '.claude', 'skills', 'no-file'), { recursive: true });
    skill(root, 'Bad_Name');
    writeFileSync(join(root, '.claude', 'skills', 'loose.md'), 'not a folder');
    expect(await listProjectSkillNames(root, { homeDir: homeDir() })).toEqual([
      'code-review',
      'unit-tests',
    ]);
  });

  it('answers none for a project without skills or whose folder is gone', async () => {
    const root = tempDir();
    expect(await listProjectSkillNames(root, { homeDir: homeDir() })).toEqual([]);
    mkdirSync(join(root, '.claude'));
    expect(await listProjectSkillNames(root, { homeDir: homeDir() })).toEqual([]);
    expect(await listProjectSkillNames(join(root, 'gone'), { homeDir: homeDir() })).toEqual([]);
  });

  it('never follows a symlinked .claude, skills folder, skill folder or SKILL.md', async () => {
    const outside = tempDir('acp-outside-');
    skill(outside, 'stolen');

    const linkedClaude = tempDir();
    symlinkSync(join(outside, '.claude'), join(linkedClaude, '.claude'));
    expect(await listProjectSkillNames(linkedClaude, { homeDir: homeDir() })).toEqual([]);

    const linkedSkills = tempDir();
    mkdirSync(join(linkedSkills, '.claude'));
    symlinkSync(join(outside, '.claude', 'skills'), join(linkedSkills, '.claude', 'skills'));
    expect(await listProjectSkillNames(linkedSkills, { homeDir: homeDir() })).toEqual([]);

    const linkedEntries = tempDir();
    skill(linkedEntries, 'real');
    symlinkSync(
      join(outside, '.claude', 'skills', 'stolen'),
      join(linkedEntries, '.claude', 'skills', 'stolen'),
    );
    mkdirSync(join(linkedEntries, '.claude', 'skills', 'file-link'));
    symlinkSync(
      join(outside, '.claude', 'skills', 'stolen', 'SKILL.md'),
      join(linkedEntries, '.claude', 'skills', 'file-link', 'SKILL.md'),
    );
    expect(await listProjectSkillNames(linkedEntries, { homeDir: homeDir() })).toEqual(['real']);
  });

  it("never lists the owner's personal skills, even for a project at the home directory", async () => {
    const home = tempDir('acp-home-');
    skill(home, 'personal');
    expect(await listProjectSkillNames(home, { homeDir: home })).toEqual([]);
  });

  it('resolves a symlinked project root first, then applies the rules inside it', async () => {
    const real = tempDir();
    skill(real, 'plan');
    const parent = tempDir('acp-links-');
    symlinkSync(real, join(parent, 'repo'));
    expect(await listProjectSkillNames(join(parent, 'repo'), { homeDir: homeDir() })).toEqual([
      'plan',
    ]);
  });
});
