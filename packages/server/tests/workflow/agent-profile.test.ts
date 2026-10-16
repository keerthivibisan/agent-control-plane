// Synthetic agent files in temp folders only (R-I). Never the real ~/.claude.
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_AGENT_BYTES } from '@acp/core';
import { createAgentProfiles, profileFromText } from '../../src/workflow/agent-profile.js';
import { tempDir } from '../workspace/helpers.js';

function project(): { root: string; home: string; agents: string } {
  const root = tempDir('acp-profile-repo-');
  const home = tempDir('acp-profile-home-');
  const agents = join(root, '.claude', 'agents');
  mkdirSync(agents, { recursive: true });
  return { root, home, agents };
}

const FILE = [
  '---',
  'name: reviewer-strict',
  'description: Reviews strictly.',
  'tools: Read, Grep, Bash',
  'model: claude-file-model',
  'permissionMode: acceptEdits',
  'mcpServers:',
  '  - github',
  'hooks:',
  '  PreToolUse: []',
  '---',
  '',
  '# Strict review',
  'Check every change twice.',
  '',
].join('\n');

describe('profileFromText (ADR-0019 §6)', () => {
  it('uses only the body, tools and model; every other key is ignored', () => {
    const r = profileFromText('reviewer-strict', FILE);
    expect(r).toEqual({
      ok: true,
      profile: {
        name: 'reviewer-strict',
        instructions: '# Strict review\nCheck every change twice.\n',
        tools: ['Read', 'Grep', 'Bash'],
      },
      model: 'claude-file-model',
    });
    expect(JSON.stringify(r)).not.toContain('acceptEdits');
    expect(JSON.stringify(r)).not.toContain('github');
  });

  it('gives null tools when the file has no tools key, and keeps an empty list as empty', () => {
    const none = profileFromText('a', '---\nname: a\ndescription: d\n---\nBody\n');
    expect(none).toMatchObject({ ok: true, profile: { tools: null }, model: null });
    const empty = profileFromText('a', '---\nname: a\ndescription: d\ntools: []\n---\nBody\n');
    expect(empty).toMatchObject({ ok: true, profile: { tools: [] } });
  });

  it('drops tool entries that are not tool names (this only narrows further)', () => {
    const r = profileFromText(
      'a',
      '---\nname: a\ndescription: d\ntools: [Read, "Bash(rm -rf)", Edit]\n---\nB\n',
    );
    expect(r).toMatchObject({ ok: true, profile: { tools: ['Read', 'Edit'] } });
  });

  it('ignores an empty or overlong model', () => {
    const long = 'm'.repeat(101);
    expect(profileFromText('a', `---\nname: a\nmodel: ${long}\n---\nB\n`)).toMatchObject({
      ok: true,
      model: null,
    });
    expect(profileFromText('a', `---\nname: a\nmodel: ""\n---\nB\n`)).toMatchObject({
      ok: true,
      model: null,
    });
  });

  it('treats a file without front matter, or with any front-matter problem, as unparsable', () => {
    for (const text of [
      'Just text, no front matter.\n',
      '---\nname: a\ndescription: never closed\n',
      '---\nname: a\ntools: Read\ntools: Bash\n---\nB\n',
      '---\nname: a\ntools: {Read: true}\n---\nB\n',
      '---\nname: a\ndescription: |\n  two\n  lines\n---\nB\n',
    ]) {
      expect(profileFromText('a', text), text).toEqual({ ok: false, problem: 'unparsable' });
    }
  });
});

describe('createAgentProfiles: reading from the project checkout', () => {
  it('reads `.claude/agents/<name>.md` under the project root', async () => {
    const p = project();
    writeFileSync(join(p.agents, 'reviewer-strict.md'), FILE);
    const r = await createAgentProfiles({ homeDir: p.home }).read(p.root, 'reviewer-strict');
    expect(r).toMatchObject({ ok: true, profile: { name: 'reviewer-strict' } });
  });

  it('answers missing for a missing file, folder or project', async () => {
    const p = project();
    const profiles = createAgentProfiles({ homeDir: p.home });
    expect(await profiles.read(p.root, 'nope')).toEqual({ ok: false, problem: 'missing' });
    const bare = tempDir('acp-profile-bare-');
    expect(await profiles.read(bare, 'nope')).toEqual({ ok: false, problem: 'missing' });
    expect(await profiles.read(join(bare, 'gone'), 'nope')).toEqual({
      ok: false,
      problem: 'missing',
    });
  });

  it('refuses an invalid name before touching the disk', async () => {
    const p = project();
    const profiles = createAgentProfiles({ homeDir: p.home });
    for (const name of ['../secret', 'Upper', '', 'a/b']) {
      expect(await profiles.read(p.root, name)).toEqual({ ok: false, problem: 'invalid-name' });
    }
  });

  it('never follows a symlinked file, agents folder or .claude folder', async () => {
    const outside = tempDir('acp-profile-outside-');
    writeFileSync(join(outside, 'x.md'), FILE);

    const linkedFile = project();
    symlinkSync(join(outside, 'x.md'), join(linkedFile.agents, 'x.md'));
    expect(
      await createAgentProfiles({ homeDir: linkedFile.home }).read(linkedFile.root, 'x'),
    ).toEqual({ ok: false, problem: 'unsafe' });

    const linkedDir = tempDir('acp-profile-repo-');
    mkdirSync(join(linkedDir, '.claude'));
    symlinkSync(outside, join(linkedDir, '.claude', 'agents'));
    expect(await createAgentProfiles({ homeDir: outside }).read(linkedDir, 'x')).toEqual({
      ok: false,
      problem: 'unsafe',
    });

    const linkedClaude = tempDir('acp-profile-repo-');
    mkdirSync(join(outside, 'agents'));
    writeFileSync(join(outside, 'agents', 'x.md'), FILE);
    symlinkSync(outside, join(linkedClaude, '.claude'));
    expect(await createAgentProfiles({ homeDir: linkedDir }).read(linkedClaude, 'x')).toEqual({
      ok: false,
      problem: 'unsafe',
    });
  });

  it("never opens the owner's personal ~/.claude, even for a project at the home folder", async () => {
    const home = tempDir('acp-profile-home-');
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(home, '.claude', 'agents', 'personal.md'), FILE);
    expect(await createAgentProfiles({ homeDir: home }).read(home, 'personal')).toEqual({
      ok: false,
      problem: 'unsafe',
    });
  });

  it('refuses a file over 64 KiB, or one that is not UTF-8 text', async () => {
    const p = project();
    writeFileSync(join(p.agents, 'big.md'), `---\nname: big\n---\n${'x'.repeat(MAX_AGENT_BYTES)}`);
    writeFileSync(join(p.agents, 'bin.md'), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe]));
    const profiles = createAgentProfiles({ homeDir: p.home });
    expect(await profiles.read(p.root, 'big')).toEqual({ ok: false, problem: 'too-large' });
    expect(await profiles.read(p.root, 'bin')).toEqual({ ok: false, problem: 'not-text' });
  });
});
