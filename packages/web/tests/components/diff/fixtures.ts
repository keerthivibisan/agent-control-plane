/*
 * Synthetic unified diffs in the shape `git diff -M --no-color` prints (the server's command,
 * ADR-0025 §6). Paths and code are invented.
 */

export const MODIFIED = [
  'diff --git a/src/search/api.ts b/src/search/api.ts',
  'index 1111111..2222222 100644',
  '--- a/src/search/api.ts',
  '+++ b/src/search/api.ts',
  '@@ -10,6 +10,7 @@ export function search(query: string) {',
  '   const params = new URLSearchParams();',
  '   params.set("q", query);',
  '-  const pageSize = 50;',
  '+  const pageSize = Math.min(requested, 100);',
  '+  params.set("size", String(pageSize));',
  '   return fetchJson(`/search?${params}`);',
  ' }',
  ' ',
].join('\n');

export const ADDED = [
  'diff --git a/docs/notes.md b/docs/notes.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/docs/notes.md',
  '@@ -0,0 +1,2 @@',
  '+# Notes',
  '+Search is capped at 100 results.',
].join('\n');

export const DELETED = [
  'diff --git a/src/old.ts b/src/old.ts',
  'deleted file mode 100644',
  'index 4444444..0000000',
  '--- a/src/old.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-export const old = 1;',
  '-export const older = 2;',
].join('\n');

export const RENAMED_ONLY = [
  'diff --git a/src/a.ts b/src/b.ts',
  'similarity index 100%',
  'rename from src/a.ts',
  'rename to src/b.ts',
].join('\n');

export const RENAMED_EDITED = [
  'diff --git a/lib/util.py b/lib/helpers.py',
  'similarity index 87%',
  'rename from lib/util.py',
  'rename to lib/helpers.py',
  'index 5555555..6666666 100644',
  '--- a/lib/util.py',
  '+++ b/lib/helpers.py',
  '@@ -1,3 +1,3 @@',
  ' def add(a, b):',
  '-    return a+b',
  '+    return a + b',
  ' ',
].join('\n');

export const BINARY = [
  'diff --git a/assets/logo.png b/assets/logo.png',
  'new file mode 100644',
  'index 0000000..7777777',
  'Binary files /dev/null and b/assets/logo.png differ',
].join('\n');

export const NO_NEWLINE = [
  'diff --git a/VERSION b/VERSION',
  'index 8888888..9999999 100644',
  '--- a/VERSION',
  '+++ b/VERSION',
  '@@ -1 +1 @@',
  '-0.2.0',
  '\\ No newline at end of file',
  '+0.3.0',
  '\\ No newline at end of file',
].join('\n');

export const MODE_ONLY = [
  'diff --git a/scripts/run.sh b/scripts/run.sh',
  'old mode 100644',
  'new mode 100755',
].join('\n');

/** A file whose hunk has long unchanged runs (as `git diff -U10` would print). */
export function longContextDiff(): string {
  const ctx = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ` const line${from + i} = ${from + i};`);
  return [
    'diff --git a/src/long.ts b/src/long.ts',
    'index aaaaaaa..bbbbbbb 100644',
    '--- a/src/long.ts',
    '+++ b/src/long.ts',
    '@@ -1,21 +1,21 @@',
    ...ctx(1, 10),
    '-const value = 1;',
    '+const value = 2;',
    ...ctx(12, 10),
  ].join('\n');
}

/** One modified file with `n` added lines. */
export function bigFile(path: string, n: number): string {
  return [
    `diff --git a/${path} b/${path}`,
    'index ccccccc..ddddddd 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${n} @@`,
    ...Array.from({ length: n }, (_, i) => `+line ${i + 1}`),
  ].join('\n');
}

export function join(...parts: string[]): string {
  return `${parts.join('\n')}\n`;
}
