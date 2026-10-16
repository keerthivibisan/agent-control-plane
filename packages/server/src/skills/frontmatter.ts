/**
 * SKILL.md front matter (ADR-0018). Claude Code reads a YAML block between `---` lines; the app only
 * needs `name` and `description`, so this is a tiny parser for a safe YAML subset: top-level
 * `key: value` pairs whose value is a plain or quoted string. It never evaluates anything, and it
 * reports what it cannot read as plain sentences instead of guessing.
 *
 * Problem sentences never quote the file, so they are safe to show and to return in any response.
 */

export interface ParsedSkillFile {
  /** Top-level string pairs; null when the file has no (complete) front matter. */
  fields: Readonly<Record<string, string>> | null;
  /** Raw front-matter lines other than `name` and `description` (kept verbatim on update). */
  extraLines: readonly string[];
  /** The Markdown after the front matter (the whole file when there is none). */
  body: string;
  problems: string[];
}

const FENCE = '---';
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/;
const MANAGED_KEYS = new Set(['name', 'description']);

function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** A plain scalar, or a single- or double-quoted one. Null when the value is not a simple string. */
function scalar(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return '';
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) return null;
    let out = '';
    const inner = value.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"') return null;
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const next = inner[++i];
      if (next === '"' || next === '\\') out += next;
      else if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else return null;
    }
    return out;
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) return null;
    const inner = value.slice(1, -1);
    if (inner.replaceAll("''", '').includes("'")) return null;
    return inner.replaceAll("''", "'");
  }
  // Block scalars, flow collections, anchors, tags and aliases are not part of the subset.
  if (/^[|>[{&*!]/.test(value)) return null;
  // A ` #` starts a YAML comment.
  const comment = value.search(/\s#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

export function parseSkillFile(text: string): ParsedSkillFile {
  const all = lines(text);
  if (all[0]?.trim() !== FENCE) {
    return {
      fields: null,
      extraLines: [],
      body: text,
      problems: ['The file has no front matter, so Claude Code cannot name or describe the skill.'],
    };
  }
  const end = all.findIndex((line, i) => i > 0 && line.trim() === FENCE);
  if (end === -1) {
    return {
      fields: null,
      extraLines: [],
      body: text,
      problems: ['The front matter is not closed with a line that says ---.'],
    };
  }

  const fields: Record<string, string> = {};
  const extraLines: string[] = [];
  const problems: string[] = [];
  /** Whether indented continuation lines belong to a key the app keeps verbatim. */
  let keepingContinuation = false;
  for (let i = 1; i < end; i++) {
    const line = all[i] ?? '';
    const lineNo = i + 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      if (keepingContinuation || line.trim() !== '') extraLines.push(line);
      continue;
    }
    if (/^\s/.test(line) || line.startsWith('- ')) {
      // A nested value (a list or a map) under the previous key.
      if (keepingContinuation) extraLines.push(line);
      else problems.push(`Line ${lineNo} continues a name or description over several lines.`);
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (match === null) {
      problems.push(`Line ${lineNo} of the front matter is not a "key: value" pair.`);
      keepingContinuation = false;
      continue;
    }
    const key = match[1] ?? '';
    if (!MANAGED_KEYS.has(key)) {
      extraLines.push(line);
      keepingContinuation = true;
      continue;
    }
    keepingContinuation = false;
    if (key in fields) {
      problems.push(`The front matter sets ${key} more than once.`);
      continue;
    }
    const value = scalar(match[2] ?? '');
    if (value === null) {
      problems.push(`The ${key} on line ${lineNo} is not a plain one-line text value.`);
      continue;
    }
    fields[key] = value;
  }

  // The body starts after the closing fence; one blank separator line is formatting, not content.
  const rest = all.slice(end + 1);
  if (rest[0]?.trim() === '') rest.shift();
  return { fields, extraLines, body: rest.join('\n'), problems };
}

/** Double-quoted YAML; control characters were already replaced by `normalizeDescription`. */
function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** A description is one line of text: newlines and other control characters become spaces. */
export function normalizeDescription(description: string): string {
  // eslint-disable-next-line no-control-regex -- matching control characters is the point here
  return description.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

export interface SkillFileInput {
  name: string;
  description: string;
  instructions: string;
  /** Other front-matter lines from the file being replaced, kept in place. */
  extraLines?: readonly string[];
}

export function serializeSkillFile(input: SkillFileInput): string {
  const head = [
    FENCE,
    `name: ${input.name}`,
    `description: ${quote(normalizeDescription(input.description))}`,
    ...(input.extraLines ?? []),
    FENCE,
  ];
  const body = input.instructions.endsWith('\n') ? input.instructions : `${input.instructions}\n`;
  return `${head.join('\n')}\n\n${body}`;
}
