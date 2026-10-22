// Reading the app's own ticket comments (ADR-0024 §3, v0.3.0 S-B). The server's exact text may
// change, so these pin the reading rules, not one format. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  parseMergeLine,
  parseRunSummary,
  splitRunSummary,
} from '../../src/features/ticket/run-summary';

describe('parseRunSummary', () => {
  it('reads headings, lists and text, and drops a first line that repeats the title', () => {
    const body = [
      'Run summary',
      '',
      'What the lead says:',
      'The login form now checks the email.',
      'Tests cover the new branch.',
      '',
      'Plan: 2 steps',
      '- Step 1: Frontend helper',
      '  - 3 files, +40 −2',
      '- Step 2: API helper',
      '',
      'Tokens:',
      '- Lead: 12,000',
    ].join('\n');
    expect(parseRunSummary(body)).toEqual([
      { type: 'heading', text: 'What the lead says' },
      {
        type: 'text',
        lines: ['The login form now checks the email.', 'Tests cover the new branch.'],
      },
      { type: 'text', lines: ['Plan: 2 steps'] },
      {
        type: 'list',
        items: [
          { text: 'Step 1: Frontend helper', depth: 0 },
          { text: '3 files, +40 −2', depth: 1 },
          { text: 'Step 2: API helper', depth: 0 },
        ],
      },
      { type: 'heading', text: 'Tokens' },
      { type: 'list', items: [{ text: 'Lead: 12,000', depth: 0 }] },
    ]);
  });

  it('shows text it does not recognise as is, line breaks kept', () => {
    const body =
      'Something new\n  indented line\n* not a list\nA long sentence that happens to end with a colon because the writer kept on going and going:';
    expect(parseRunSummary(body)).toEqual([
      {
        type: 'text',
        lines: [
          'Something new',
          '  indented line',
          '* not a list',
          'A long sentence that happens to end with a colon because the writer kept on going and going:',
        ],
      },
    ]);
  });

  it('keeps a list together across blank lines, and handles Windows line ends', () => {
    expect(parseRunSummary('- a\r\n\r\n- b')).toEqual([
      {
        type: 'list',
        items: [
          { text: 'a', depth: 0 },
          { text: 'b', depth: 0 },
        ],
      },
    ]);
  });

  it('keeps "Run summary" when it is not the first line', () => {
    expect(parseRunSummary('Note\nRun summary')).toEqual([
      { type: 'text', lines: ['Note', 'Run summary'] },
    ]);
  });
});

describe('parseMergeLine', () => {
  it('reads the note after the owner’s merge', () => {
    expect(parseMergeLine('Merged acp/WEB-12 into main at 1a2b3c4')).toEqual({
      branch: 'acp/WEB-12',
      into: 'main',
      at: '1a2b3c4',
    });
    expect(parseMergeLine('Merged acp/WEB-12 into main at 1a2b3c4.\n')).toEqual({
      branch: 'acp/WEB-12',
      into: 'main',
      at: '1a2b3c4',
    });
  });

  it('keeps what the server adds after the commit: the tip checks, a merge anyway', () => {
    expect(
      parseMergeLine('Merged acp/WEB-12 into main at 1a2b3c4; checks passed on the tip (2).'),
    ).toEqual({
      branch: 'acp/WEB-12',
      into: 'main',
      at: '1a2b3c4',
      detail: '; checks passed on the tip (2)',
    });
    expect(
      parseMergeLine(
        'Merged acp/WEB-12 into main at 1a2b3c4 (merged anyway, with a reason); checks on the tip: 1 of 2 passed; failed: Unit tests.',
      ),
    ).toMatchObject({
      at: '1a2b3c4',
      detail:
        ' (merged anyway, with a reason); checks on the tip: 1 of 2 passed; failed: Unit tests',
    });
  });

  it('is not a merge note when it has more lines or another shape', () => {
    expect(parseMergeLine('Merged acp/WEB-12 into main at 1a2b3c4\nMore')).toBeNull();
    expect(parseMergeLine('Run summary\n- Merged 2 changes')).toBeNull();
    expect(parseMergeLine('Merged everything')).toBeNull();
  });
});

describe('splitRunSummary (the S-C layout)', () => {
  const details = [
    'Details:',
    '- Plan v1 was approved with 1 step: Helpers.',
    '- Budget tokens used: 900 by the lead.',
  ];
  const factsBlock = {
    type: 'list',
    items: [
      { text: 'Plan v1 was approved with 1 step: Helpers.', depth: 0 },
      { text: 'Budget tokens used: 900 by the lead.', depth: 0 },
    ],
  };

  it('reads the lead’s note, line breaks kept, and the facts after Details', () => {
    const body = [
      'Run summary',
      '',
      'From the lead:',
      'Explored the code.',
      'Added a switch.',
      '',
      ...details,
    ].join('\n');
    expect(splitRunSummary(body)).toEqual({
      updated: false,
      note: 'Explored the code.\nAdded a switch.',
      text: 'Explored the code.\nAdded a switch.',
      details: [factsBlock],
    });
  });

  it('reads the app’s one sentence when there is no note, and the updated heading', () => {
    const body = [
      'Run summary (updated)',
      '',
      'The run failed before the work was handed over.',
      '',
      ...details,
    ].join('\r\n');
    expect(splitRunSummary(body)).toEqual({
      updated: true,
      note: null,
      text: 'The run failed before the work was handed over.',
      details: [factsBlock],
    });
  });

  it('keeps a note that has its own “Details:” line: the facts start after the last one', () => {
    const body = [
      'Run summary',
      '',
      'From the lead:',
      'Added it.',
      'Details:',
      'See the plan.',
      '',
      ...details,
    ].join('\n');
    const split = splitRunSummary(body);
    expect(split?.note).toBe('Added it.\nDetails:\nSee the plan.');
    expect(split?.details).toEqual([factsBlock]);
  });

  it('is null for an older summary, or one with nothing before Details', () => {
    expect(
      splitRunSummary(
        "Run summary\nWEB-12: the lead handed the work over.\n\nChanges: none.\n\nLead's note:\nDone.",
      ),
    ).toBeNull();
    expect(splitRunSummary('Run summary\n\nDetails:\n- x.')).toBeNull();
    expect(splitRunSummary('Run summary\n\nFrom the lead:\n\nDetails:\n- x.')).toBeNull();
  });
});
