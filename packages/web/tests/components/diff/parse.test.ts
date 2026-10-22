import { describe, expect, it } from 'vitest';
import {
  fileLineCount,
  parseDiff,
  parseGitHeaderPaths,
  unquoteGitPath,
} from '../../../src/components/diff/parse';
import {
  ADDED,
  BINARY,
  DELETED,
  MODE_ONLY,
  MODIFIED,
  NO_NEWLINE,
  RENAMED_EDITED,
  RENAMED_ONLY,
  join,
} from './fixtures';

describe('parseDiff', () => {
  it('reads nothing from an empty diff', () => {
    expect(parseDiff('')).toEqual({ files: [], additions: 0, deletions: 0, lineCount: 0 });
  });

  it('a modified file: hunk, line numbers, counts and the section name', () => {
    const { files, additions, deletions, lineCount } = parseDiff(join(MODIFIED));
    expect(files).toHaveLength(1);
    const f = files[0];
    expect(f).toMatchObject({
      id: 'file-0',
      path: 'src/search/api.ts',
      oldPath: 'src/search/api.ts',
      newPath: 'src/search/api.ts',
      status: 'modified',
      binary: false,
      additions: 2,
      deletions: 1,
      cut: false,
    });
    expect([additions, deletions, lineCount]).toEqual([2, 1, 8]);
    const hunk = f?.hunks[0];
    expect(hunk).toMatchObject({
      oldStart: 10,
      oldLines: 6,
      newStart: 10,
      newLines: 7,
      section: 'export function search(query: string) {',
    });
    expect(hunk?.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['context', 10, 10],
      ['context', 11, 11],
      ['del', 12, null],
      ['add', null, 12],
      ['add', null, 13],
      ['context', 13, 14],
      ['context', 14, 15],
      ['context', 15, 16],
    ]);
    // Prefixes are removed; the side indexes count each side's lines in the diff.
    expect(hunk?.lines[2]).toMatchObject({
      text: '  const pageSize = 50;',
      oldIndex: 2,
      newIndex: null,
    });
    expect(hunk?.lines[4]).toMatchObject({ oldIndex: null, newIndex: 3 });
    expect(hunk?.lines[7]?.text).toBe('');
  });

  it('an added file: no old path, numbers from 1', () => {
    const f = parseDiff(ADDED).files[0];
    expect(f).toMatchObject({
      status: 'added',
      oldPath: null,
      newPath: 'docs/notes.md',
      path: 'docs/notes.md',
      newMode: '100644',
      additions: 2,
      deletions: 0,
    });
    expect(f?.hunks[0]?.lines.map((l) => l.newNo)).toEqual([1, 2]);
  });

  it('a deleted file: shown under its old path', () => {
    const f = parseDiff(DELETED).files[0];
    expect(f).toMatchObject({
      status: 'deleted',
      oldPath: 'src/old.ts',
      newPath: null,
      path: 'src/old.ts',
      oldMode: '100644',
      deletions: 2,
    });
  });

  it('a pure rename has no hunks; an edited rename keeps its similarity and lines', () => {
    const [pure, edited] = parseDiff(join(RENAMED_ONLY, RENAMED_EDITED)).files;
    expect(pure).toMatchObject({
      status: 'renamed',
      oldPath: 'src/a.ts',
      newPath: 'src/b.ts',
      path: 'src/b.ts',
      similarity: 100,
      hunks: [],
    });
    expect(edited).toMatchObject({
      status: 'renamed',
      oldPath: 'lib/util.py',
      newPath: 'lib/helpers.py',
      similarity: 87,
      additions: 1,
      deletions: 1,
    });
  });

  it('a binary file: flagged, no lines', () => {
    const f = parseDiff(BINARY).files[0];
    expect(f).toMatchObject({
      status: 'added',
      binary: true,
      oldPath: null,
      newPath: 'assets/logo.png',
      hunks: [],
    });
    const modified = parseDiff(
      'diff --git a/a.bin b/a.bin\nindex 1..2 100644\nBinary files a/a.bin and b/a.bin differ\n',
    ).files[0];
    expect(modified).toMatchObject({ status: 'modified', binary: true, path: 'a.bin' });
  });

  it('"\\ No newline at end of file" marks the line before it, on either side', () => {
    const lines = parseDiff(NO_NEWLINE).files[0]?.hunks[0]?.lines ?? [];
    expect(lines.map((l) => [l.kind, l.text, l.noNewlineAtEnd])).toEqual([
      ['del', '0.2.0', true],
      ['add', '0.3.0', true],
    ]);
    // `@@ -1 +1 @@`: an omitted count is 1.
    expect(parseDiff(NO_NEWLINE).files[0]?.hunks[0]).toMatchObject({ oldLines: 1, newLines: 1 });
  });

  it('a mode change only', () => {
    expect(parseDiff(MODE_ONLY).files[0]).toMatchObject({
      status: 'modified',
      oldMode: '100644',
      newMode: '100755',
      hunks: [],
    });
  });

  it('reads lines by the hunk counts: a removed "-- x" line is not a file header', () => {
    const text = join(
      'diff --git a/a.sql b/a.sql',
      '--- a/a.sql',
      '+++ b/a.sql',
      '@@ -1,2 +1,1 @@',
      '--- a comment',
      '-+++ not a header',
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    );
    const { files } = parseDiff(text);
    expect(files.map((f) => f.path)).toEqual(['a.sql', 'b.txt']);
    expect(files[0]?.hunks[0]?.lines.map((l) => l.text)).toEqual([
      '-- a comment',
      '+++ not a header',
    ]);
  });

  it('several hunks keep their own numbers; text between files is ignored', () => {
    const text = join(
      'some preamble',
      'diff --git a/x.go b/x.go',
      '--- a/x.go',
      '+++ b/x.go',
      '@@ -1,2 +1,2 @@',
      '-a',
      '+b',
      ' c',
      '@@ -40,1 +40,2 @@ func main() {',
      ' d',
      '+e',
    );
    const f = parseDiff(text).files[0];
    expect(f?.hunks.map((h) => [h.oldStart, h.newStart, h.section])).toEqual([
      [1, 1, ''],
      [40, 40, 'func main() {'],
    ]);
    expect(f?.hunks[1]?.lines.map((l) => [l.oldNo, l.newNo])).toEqual([
      [40, 40],
      [null, 41],
    ]);
    expect(f ? fileLineCount(f) : 0).toBe(5);
  });

  it('a diff cut by the server inside a hunk marks that file as cut', () => {
    const text = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,5 +1,5 @@',
      ' one',
      '-two',
      '+TWO',
      '',
    ].join('\n');
    const f = parseDiff(text).files[0];
    expect(f?.cut).toBe(true);
    expect(f?.hunks[0]?.lines).toHaveLength(3);
  });

  it('a complete diff marks nothing as cut', () => {
    expect(parseDiff(join(MODIFIED, ADDED)).files.map((f) => f.cut)).toEqual([false, false]);
  });

  it('strips carriage returns of CRLF files', () => {
    const f = parseDiff(
      'diff --git a/w.txt b/w.txt\n--- a/w.txt\n+++ b/w.txt\n@@ -1 +1 @@\n-a\r\n+b\r\n',
    ).files[0];
    expect(f?.hunks[0]?.lines.map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('names with spaces and quoted names', () => {
    const spaced = parseDiff(
      join(
        'diff --git a/my docs/a b/c.md b/my docs/a b/c.md',
        '--- a/my docs/a b/c.md\t',
        '+++ b/my docs/a b/c.md\t',
        '@@ -1 +1 @@',
        '-x',
        '+y',
      ),
    ).files[0];
    expect(spaced?.path).toBe('my docs/a b/c.md');
    const quoted = parseDiff(
      join(
        'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
        'new file mode 100644',
        '--- /dev/null',
        '+++ "b/caf\\303\\251.txt"',
        '@@ -0,0 +1 @@',
        '+x',
      ),
    ).files[0];
    expect(quoted?.path).toBe('café.txt');
  });
});

describe('git path helpers', () => {
  it('unquotes C-style names', () => {
    expect(unquoteGitPath('"a\\tb\\"c\\\\d"')).toBe('a\tb"c\\d');
    expect(unquoteGitPath('plain')).toBe('plain');
  });

  it('splits the header paths', () => {
    expect(parseGitHeaderPaths('a/x.ts b/x.ts')).toEqual({ oldPath: 'x.ts', newPath: 'x.ts' });
    expect(parseGitHeaderPaths('a/old.ts b/new.ts')).toEqual({
      oldPath: 'old.ts',
      newPath: 'new.ts',
    });
    expect(parseGitHeaderPaths('a/x b/y "b/z w"')).toEqual({ oldPath: 'x b/y', newPath: 'z w' });
    expect(parseGitHeaderPaths('nonsense')).toBeNull();
  });
});
