/**
 * Parses the unified diff the server sends (`git diff -M --no-color`, ADR-0025 §6) into files and
 * hunks for the diff viewer. Pure and tolerant: the server may cut a diff at its size limit
 * (`diffTruncated`), so the text can end anywhere after a complete line, and a hunk can be shorter
 * than its header says. Lines are read by the hunk header's counts, not by their first character
 * alone, so a removed line that itself starts with `-- ` is never taken for a file header.
 */

export type DiffFileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
export type DiffLineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: DiffLineKind;
  /** The line without its `+`/`-`/space prefix (and without a trailing carriage return). */
  text: string;
  /** Line number in the old file (context and removed lines), else null. */
  oldNo: number | null;
  /** Line number in the new file (context and added lines), else null. */
  newNo: number | null;
  /** Position among this file's old-side lines in the diff (for syntax tokens), else null. */
  oldIndex: number | null;
  /** Position among this file's new-side lines in the diff, else null. */
  newIndex: number | null;
  /** Followed by "\ No newline at end of file". */
  noNewlineAtEnd: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The text after the second `@@` (git's function or section name), maybe empty. */
  section: string;
  lines: DiffLine[];
}

export interface DiffFile {
  /** Stable within one parse: `file-<index>`. */
  id: string;
  /** Null for an added file. */
  oldPath: string | null;
  /** Null for a deleted file. */
  newPath: string | null;
  /** The path to show: the new path, or the old one for a deleted file. */
  path: string;
  status: DiffFileStatus;
  binary: boolean;
  /** Rename or copy similarity in percent, when git reports it. */
  similarity: number | null;
  oldMode: string | null;
  newMode: string | null;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** The text ended inside this file: its last hunk is shorter than its header says. */
  cut: boolean;
}

export interface ParsedDiff {
  files: DiffFile[];
  additions: number;
  deletions: number;
  /** Every line in every hunk (context included): the size the large-diff guard reads. */
  lineCount: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Decodes git's C-style quoted path (`"caf\303\251.txt"`): escapes and octal UTF-8 bytes. */
export function unquoteGitPath(s: string): string {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s;
  const body = s.slice(1, -1);
  const bytes: number[] = [];
  const ESC: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 };
  const encoder = new TextEncoder();
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] ?? '';
    if (ch !== '\\') {
      bytes.push(...encoder.encode(ch));
      continue;
    }
    const next = body[i + 1] ?? '';
    if (/[0-7]/.test(next)) {
      const oct = /^[0-7]{1,3}/.exec(body.slice(i + 1))?.[0] ?? next;
      bytes.push(parseInt(oct, 8) & 0xff);
      i += oct.length;
    } else {
      bytes.push(ESC[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** `a/src/x.ts` → `src/x.ts`; `/dev/null` → null. Quoted names are decoded first. */
function stripPrefix(raw: string): string | null {
  // git appends a tab to `---`/`+++` names that contain a space.
  const name = unquoteGitPath(raw.replace(/\t$/, ''));
  if (name === '/dev/null') return null;
  return /^[ab]\//.test(name) ? name.slice(2) : name;
}

/** Reads one possibly quoted token from the start of `s`: [token, rest after one space]. */
function takeQuoted(s: string): [string, string] | null {
  if (!s.startsWith('"')) return null;
  for (let i = 1; i < s.length; i += 1) {
    if (s[i] === '\\') {
      i += 1;
      continue;
    }
    if (s[i] === '"') return [s.slice(0, i + 1), s.slice(i + 2)];
  }
  return null;
}

/** The two paths of `diff --git a/x b/y`, prefixes removed. Spaces in names are allowed. */
export function parseGitHeaderPaths(rest: string): { oldPath: string; newPath: string } | null {
  const first = takeQuoted(rest);
  if (first !== null) {
    const second = takeQuoted(first[1]) ?? [first[1], ''];
    const oldPath = stripPrefix(first[0]);
    const newPath = stripPrefix(second[0]);
    return oldPath !== null && newPath !== null ? { oldPath, newPath } : null;
  }
  const quotedSecond = rest.indexOf(' "');
  if (quotedSecond > 0) {
    const oldPath = stripPrefix(rest.slice(0, quotedSecond));
    const newPath = stripPrefix(rest.slice(quotedSecond + 1));
    return oldPath !== null && newPath !== null ? { oldPath, newPath } : null;
  }
  // The same name twice (`a/N b/N`, the common case) splits exactly, even with " b/" inside N.
  const n = (rest.length - 5) / 2;
  if (Number.isInteger(n) && n > 0 && rest.startsWith('a/') && rest.slice(n + 2, n + 5) === ' b/') {
    const a = rest.slice(2, n + 2);
    if (a === rest.slice(n + 5)) return { oldPath: a, newPath: a };
  }
  const split = rest.indexOf(' b/');
  if (split < 0) return null;
  return { oldPath: stripPrefix(rest.slice(0, split)) ?? '', newPath: rest.slice(split + 3) };
}

/** `Binary files a/x and b/y differ` → the two names (either may be /dev/null). */
function binaryPaths(line: string): { oldPath: string | null; newPath: string | null } | null {
  const m = /^Binary files (.+) and (.+) differ$/.exec(line);
  if (m === null) return null;
  return { oldPath: stripPrefix(m[1] ?? ''), newPath: stripPrefix(m[2] ?? '') };
}

function newFile(index: number, oldPath: string | null, newPath: string | null): DiffFile {
  return {
    id: `file-${index}`,
    oldPath,
    newPath,
    path: newPath ?? oldPath ?? '',
    status: 'modified',
    binary: false,
    similarity: null,
    oldMode: null,
    newMode: null,
    hunks: [],
    additions: 0,
    deletions: 0,
    cut: false,
  };
}

/** Settles the status and display path once a file's header has been read. */
function finish(file: DiffFile): void {
  if (file.status === 'modified' || file.status === 'added' || file.status === 'deleted') {
    if (file.oldPath === null && file.newPath !== null) file.status = 'added';
    else if (file.newPath === null && file.oldPath !== null) file.status = 'deleted';
  }
  file.path = file.newPath ?? file.oldPath ?? file.path;
}

export function parseDiff(text: string): ParsedDiff {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let remOld = 0;
  let remNew = 0;
  let oldNo = 0;
  let newNo = 0;
  let oldIndex = 0;
  let newIndex = 0;
  let lineCount = 0;

  const lines = text.length === 0 ? [] : text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const closeFile = () => {
    if (file === null) return;
    if (hunk !== null && (remOld > 0 || remNew > 0)) file.cut = true;
    finish(file);
    files.push(file);
    file = null;
    hunk = null;
    remOld = 0;
    remNew = 0;
  };

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (file !== null && hunk !== null && (remOld > 0 || remNew > 0)) {
      const sign = line[0];
      // Some tools drop the space of an empty context line; git does not, but accept it.
      const kind: DiffLineKind | null =
        line === '' || sign === ' '
          ? 'context'
          : sign === '-'
            ? 'del'
            : sign === '+'
              ? 'add'
              : null;
      const fits =
        kind === 'add' ? remNew > 0 : kind === 'del' ? remOld > 0 : remOld > 0 && remNew > 0;
      if (kind !== null && fits) {
        const isOld = kind !== 'add';
        const isNew = kind !== 'del';
        hunk.lines.push({
          kind,
          text: line.slice(1),
          oldNo: isOld ? oldNo : null,
          newNo: isNew ? newNo : null,
          oldIndex: isOld ? oldIndex : null,
          newIndex: isNew ? newIndex : null,
          noNewlineAtEnd: false,
        });
        if (isOld) {
          oldNo += 1;
          oldIndex += 1;
          remOld -= 1;
        }
        if (isNew) {
          newNo += 1;
          newIndex += 1;
          remNew -= 1;
        }
        if (kind === 'add') file.additions += 1;
        if (kind === 'del') file.deletions += 1;
        lineCount += 1;
        continue;
      }
      if (sign === '\\') {
        const last = hunk.lines[hunk.lines.length - 1];
        if (last !== undefined) last.noNewlineAtEnd = true;
        continue;
      }
      // A malformed hunk ended early; read the line as a header below.
      remOld = 0;
      remNew = 0;
    }

    if (line.startsWith('diff --git ')) {
      closeFile();
      const paths = parseGitHeaderPaths(line.slice('diff --git '.length));
      file = newFile(files.length, paths?.oldPath ?? null, paths?.newPath ?? null);
      oldIndex = 0;
      newIndex = 0;
      continue;
    }
    if (file === null) continue; // A preamble before the first file.

    if (line.startsWith('\\')) {
      // "\ No newline at end of file" after the hunk's last line.
      const last = hunk?.lines[hunk.lines.length - 1];
      if (last !== undefined) last.noNewlineAtEnd = true;
      continue;
    }
    const h = HUNK_HEADER.exec(line);
    if (h !== null) {
      const oldLines = h[2] === undefined ? 1 : Number(h[2]);
      const newLines = h[4] === undefined ? 1 : Number(h[4]);
      hunk = {
        oldStart: Number(h[1]),
        oldLines,
        newStart: Number(h[3]),
        newLines,
        section: h[5] ?? '',
        lines: [],
      };
      file.hunks.push(hunk);
      remOld = oldLines;
      remNew = newLines;
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      continue;
    }
    if (hunk !== null) continue; // Stray text between hunks: not part of the change.

    // The extended header lines between `diff --git` and the first hunk.
    const value = (prefix: string) => line.slice(prefix.length);
    if (line.startsWith('new file mode ')) {
      file.status = 'added';
      file.oldPath = null;
      file.newMode = value('new file mode ');
    } else if (line.startsWith('deleted file mode ')) {
      file.status = 'deleted';
      file.newPath = null;
      file.oldMode = value('deleted file mode ');
    } else if (line.startsWith('old mode ')) {
      file.oldMode = value('old mode ');
    } else if (line.startsWith('new mode ')) {
      file.newMode = value('new mode ');
    } else if (line.startsWith('similarity index ')) {
      file.similarity = parseInt(value('similarity index '), 10);
    } else if (line.startsWith('rename from ')) {
      file.status = 'renamed';
      file.oldPath = unquoteGitPath(value('rename from '));
    } else if (line.startsWith('rename to ')) {
      file.status = 'renamed';
      file.newPath = unquoteGitPath(value('rename to '));
    } else if (line.startsWith('copy from ')) {
      file.status = 'copied';
      file.oldPath = unquoteGitPath(value('copy from '));
    } else if (line.startsWith('copy to ')) {
      file.status = 'copied';
      file.newPath = unquoteGitPath(value('copy to '));
    } else if (line.startsWith('--- ')) {
      file.oldPath = stripPrefix(value('--- '));
    } else if (line.startsWith('+++ ')) {
      file.newPath = stripPrefix(value('+++ '));
    } else if (line === 'GIT binary patch') {
      file.binary = true;
    } else {
      const bin = binaryPaths(line);
      if (bin !== null) {
        file.binary = true;
        file.oldPath = bin.oldPath;
        file.newPath = bin.newPath;
      }
      // `index …`, `dissimilarity index …` and anything unknown: nothing to show.
    }
  }
  closeFile();

  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { files, additions, deletions, lineCount };
}

/** Every line of a file's hunks. */
export function fileLineCount(file: DiffFile): number {
  let n = 0;
  for (const h of file.hunks) n += h.lines.length;
  return n;
}
