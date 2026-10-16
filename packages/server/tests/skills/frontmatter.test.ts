import { describe, expect, it } from 'vitest';
import { parseSkillFile, serializeSkillFile } from '../../src/skills/index.js';

describe('parseSkillFile', () => {
  it('reads name, description and the body after the front matter', () => {
    const parsed = parseSkillFile(
      '---\nname: code-review\ndescription: Review a diff for bugs\n---\n\n# Steps\n\n1. Read.\n',
    );
    expect(parsed.fields).toEqual({ name: 'code-review', description: 'Review a diff for bugs' });
    expect(parsed.body).toBe('# Steps\n\n1. Read.\n');
    expect(parsed.problems).toEqual([]);
  });

  it('unquotes double- and single-quoted values and drops trailing comments', () => {
    const parsed = parseSkillFile(
      [
        '---',
        'name: plan # the slug',
        `description: "Use it: when \\"planning\\" a C:\\\\ path"`,
        '---',
        'body',
      ].join('\n'),
    );
    expect(parsed.fields).toEqual({
      name: 'plan',
      description: 'Use it: when "planning" a C:\\ path',
    });
    expect(parseSkillFile("---\nname: x\ndescription: 'it''s fine'\n---\n").fields).toEqual({
      name: 'x',
      description: "it's fine",
    });
  });

  it('keeps other keys, with their nested lines, verbatim', () => {
    const parsed = parseSkillFile(
      '---\nname: docs\nallowed-tools:\n  - Read\n  - Grep\ndescription: Write docs\nmodel: opus\n---\nx\n',
    );
    expect(parsed.extraLines).toEqual(['allowed-tools:', '  - Read', '  - Grep', 'model: opus']);
    expect(parsed.problems).toEqual([]);
  });

  it('reports what it cannot read as plain sentences, without quoting the file', () => {
    expect(parseSkillFile('# no front matter\n').problems).toEqual([
      'The file has no front matter, so Claude Code cannot name or describe it.',
    ]);
    expect(parseSkillFile('---\nname: a\n').problems).toEqual([
      'The front matter is not closed with a line that says ---.',
    ]);
    const odd = parseSkillFile(
      '---\nname: a\nname: b\ndescription: |\n  multi\nsecret words here\n---\n',
    );
    expect(odd.problems).toEqual([
      'The front matter sets name more than once.',
      'The description on line 4 is not a plain one-line text value.',
      'Line 5 continues a value over several lines.',
      'Line 6 of the front matter is not a "key: value" pair.',
    ]);
    expect(odd.problems.join(' ')).not.toContain('secret');
  });

  it('treats a Windows line ending like a Unix one', () => {
    const parsed = parseSkillFile('---\r\nname: a\r\ndescription: b\r\n---\r\nbody\r\n');
    expect(parsed.fields).toEqual({ name: 'a', description: 'b' });
  });
});

describe('serializeSkillFile', () => {
  it('writes front matter the parser reads back, whatever the description holds', () => {
    const description = 'Use when: "reviewing" a\\path # not a comment\nsecond line';
    const text = serializeSkillFile({ name: 'code-review', description, instructions: '# Go' });
    expect(text).toBe(
      '---\nname: code-review\ndescription: "Use when: \\"reviewing\\" a\\\\path # not a comment second line"\n---\n\n# Go\n',
    );
    const back = parseSkillFile(text);
    expect(back.fields).toEqual({
      name: 'code-review',
      description: 'Use when: "reviewing" a\\path # not a comment second line',
    });
    expect(back.body).toBe('# Go\n');
    expect(back.problems).toEqual([]);
  });

  it('keeps extra front-matter lines between the managed keys and the closing fence', () => {
    const text = serializeSkillFile({
      name: 'docs',
      description: 'd',
      instructions: 'x\n',
      extraLines: ['model: opus'],
    });
    expect(text).toBe('---\nname: docs\ndescription: "d"\nmodel: opus\n---\n\nx\n');
  });
});
