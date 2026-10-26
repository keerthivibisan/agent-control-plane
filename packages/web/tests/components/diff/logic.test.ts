import { describe, expect, it } from 'vitest';
import { languageFor } from '../../../src/components/diff/language';
import {
  CONTEXT_LINES,
  foldId,
  hunkRows,
  initiallyShown,
  missingPaths,
  splitRows,
  type UnifiedRow,
} from '../../../src/components/diff/layout';
import { parseDiff, type DiffHunk } from '../../../src/components/diff/parse';
import { lineSegments } from '../../../src/components/diff/segments';
import {
  hunkWordChanges,
  tokenizeWords,
  wordChanges,
} from '../../../src/components/diff/word-diff';
import { ADDED, BINARY, MODIFIED, bigFile, join, longContextDiff } from './fixtures';

const firstHunk = (text: string): DiffHunk => {
  const h = parseDiff(text).files[0]?.hunks[0];
  if (h === undefined) throw new Error('no hunk');
  return h;
};

/** A compact picture of rows: `c`/`+`/`-` per line, `[n]` per fold. */
const shape = (rows: readonly UnifiedRow[]) =>
  rows
    .map((r) =>
      r.type === 'fold'
        ? `[${r.lines.length}]`
        : r.line.kind === 'add'
          ? '+'
          : r.line.kind === 'del'
            ? '-'
            : 'c',
    )
    .join('');

describe('word-level changes', () => {
  it('tokenizes into words, spaces and single symbols', () => {
    expect(tokenizeWords('a.b(c, 10)')).toEqual(['a', '.', 'b', '(', 'c', ',', ' ', '10', ')']);
    expect(tokenizeWords('café_1 x')).toEqual(['café_1', ' ', 'x']);
  });

  it('marks only the words that changed', () => {
    const changes = wordChanges('const pageSize = 50;', 'const pageSize = 100;');
    expect(changes).toEqual({ old: [[17, 19]], new: [[17, 20]] });
  });

  it('merges neighbouring changed tokens into one range', () => {
    const changes = wordChanges('return a+b', 'return a + b');
    expect(changes?.old).toEqual([]);
    expect(changes?.new).toEqual([
      [8, 9],
      [10, 11],
    ]);
  });

  it('gives no marks when the lines share too little, or are the same', () => {
    expect(wordChanges('alpha beta gamma', 'totally different words here')).toBeNull();
    expect(wordChanges('same', 'same')).toBeNull();
    expect(wordChanges('', 'x')).toBeNull();
  });

  it('pairs removed and added lines of a block in order', () => {
    const hunk = firstHunk(
      join(
        'diff --git a/a.ts b/a.ts',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,3 +1,4 @@',
        '-let a = 1;',
        '-let b = 2;',
        '+let a = 10;',
        '+let b = 20;',
        '+let c = 30;',
        ' end();',
      ),
    );
    const marks = hunkWordChanges(hunk);
    const [delA, delB, addA, addB, addC] = hunk.lines;
    expect(marks.get(delA as never)).toEqual([[8, 9]]);
    expect(marks.get(addA as never)).toEqual([[8, 10]]);
    expect(marks.has(delB as never) && marks.has(addB as never)).toBe(true);
    // The third added line has no partner.
    expect(marks.has(addC as never)).toBe(false);
  });
});

describe('segments', () => {
  it('cuts syntax tokens at the word-change boundaries', () => {
    const tokens = [
      { content: 'const', color: 'var(--shiki-token-keyword)' },
      { content: ' x = ' },
      { content: '50', color: 'var(--shiki-token-constant)' },
    ];
    expect(lineSegments('const x = 50', tokens, [[10, 12]])).toEqual([
      { content: 'const', color: 'var(--shiki-token-keyword)', changed: false },
      { content: ' x = ', changed: false },
      { content: '50', color: 'var(--shiki-token-constant)', changed: true },
    ]);
    expect(
      lineSegments('const x = 50', tokens, [[3, 7]]).map((s) => [s.content, s.changed]),
    ).toEqual([
      ['con', false],
      ['st', true],
      [' x', true],
      [' = ', false],
      ['50', false],
    ]);
  });

  it('falls back to one plain token when the tokens do not spell the line', () => {
    expect(lineSegments('abc', [{ content: 'xyz' }], undefined)).toEqual([
      { content: 'abc', changed: false },
    ]);
    expect(lineSegments('abc', undefined, undefined)).toEqual([{ content: 'abc', changed: false }]);
  });
});

describe('folding unchanged lines', () => {
  const hunk = firstHunk(longContextDiff());

  it(`keeps ${CONTEXT_LINES} lines next to a change and folds the rest`, () => {
    // 10 unchanged, a change, 10 unchanged: 7 fold before and 7 after.
    expect(shape(hunkRows(hunk, 0, new Set()))).toBe('[7]ccc-+ccc[7]');
  });

  it('a fold shown by id draws all of its lines', () => {
    const rows = hunkRows(hunk, 0, new Set());
    const first = rows[0];
    expect(first?.type === 'fold' ? first.id : null).toBe(foldId(0, 0));
    expect(shape(hunkRows(hunk, 0, new Set([foldId(0, 0)])))).toBe('cccccccccc-+ccc[7]');
  });

  it('folds the middle of a run between two changes, never a single line', () => {
    const between = (n: number) =>
      firstHunk(
        join(
          'diff --git a/m.ts b/m.ts',
          '--- a/m.ts',
          '+++ b/m.ts',
          `@@ -1,${n + 2} +1,${n + 2} @@`,
          '-a',
          '+A',
          ...Array.from({ length: n }, (_, i) => ` k${i}`),
          '-b',
          '+B',
        ),
      );
    expect(shape(hunkRows(between(10), 0, new Set()))).toBe('-+ccc[4]ccc-+');
    // 7 between: hiding 1 line saves nothing, so all 7 stay.
    expect(shape(hunkRows(between(7), 0, new Set()))).toBe('-+ccccccc-+');
    // git's own 3 lines of context never fold.
    expect(shape(hunkRows(firstHunk(MODIFIED), 0, new Set()))).toBe('cc-++ccc');
  });

  it('side by side: unchanged lines on both sides, removed beside added', () => {
    const rows = splitRows(hunkRows(firstHunk(MODIFIED), 0, new Set()));
    expect(
      rows.map((r) =>
        r.type === 'fold' ? 'fold' : `${r.left?.kind ?? '_'}|${r.right?.kind ?? '_'}`,
      ),
    ).toEqual([
      'context|context',
      'context|context',
      'del|add',
      '_|add',
      'context|context',
      'context|context',
      'context|context',
    ]);
    expect(splitRows(hunkRows(hunk, 0, new Set()))[0]?.type).toBe('fold');
  });
});

describe('the large-diff guard', () => {
  const files = parseDiff(
    join(bigFile('a.ts', 300), bigFile('huge.ts', 500), bigFile('b.ts', 300), BINARY, ADDED),
  ).files;

  it('holds back a file over the per-file limit and stops at the total budget', () => {
    const shown = initiallyShown(files, { fileLines: 400, totalLines: 700 });
    // a (300) and b (300) fit; huge (500) is over the per-file limit; binary costs nothing;
    // notes (2) would fit but the budget order is kept: it still fits under 700.
    expect(files.filter((f) => shown.has(f.id)).map((f) => f.path)).toEqual([
      'a.ts',
      'b.ts',
      'assets/logo.png',
      'docs/notes.md',
    ]);
    const tight = initiallyShown(files, { fileLines: 400, totalLines: 500 });
    // After b.ts overflows the budget, every later file with lines waits.
    expect(files.filter((f) => tight.has(f.id)).map((f) => f.path)).toEqual([
      'a.ts',
      'assets/logo.png',
    ]);
  });

  it('names the listed files a cut diff does not include', () => {
    expect(missingPaths(files, ['a.ts', 'c.ts', 'docs/notes.md'])).toEqual(['c.ts']);
    expect(missingPaths(files, undefined)).toEqual([]);
  });
});

describe('languages', () => {
  it('maps the bounded set of extensions and nothing else', () => {
    expect(languageFor('src/a.ts')).toBe('typescript');
    expect(languageFor('src/App.TSX')).toBe('tsx');
    expect(languageFor('x.mjs')).toBe('javascript');
    expect(languageFor('a/b.yml')).toBe('yaml');
    expect(languageFor('run.sh')).toBe('shellscript');
    expect(languageFor('k.kts')).toBe('kotlin');
    expect(languageFor('h.hpp')).toBe('cpp');
    expect(languageFor('README')).toBeNull();
    expect(languageFor('.env')).toBeNull();
    expect(languageFor('data.toml')).toBeNull();
  });
});
