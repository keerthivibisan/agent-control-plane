/**
 * SKILL.md and agent-definition front matter (ADR-0018 and its amendment). Claude Code reads a YAML
 * block between `---` lines; the app only needs a few keys, so this is a tiny parser for a safe YAML
 * subset: top-level `key: value` pairs whose value is a plain or quoted string, plus, for list keys
 * (an agent's `tools`), a comma-separated value, a `[a, b]` flow list or a `- item` block list. It
 * never evaluates anything, and reports what it cannot read as plain sentences instead of guessing.
 *
 * Problem sentences never quote values from the file, so they are safe to show in any response.
 * Keys the app does not manage are kept verbatim (`extraLines`) and named in `extraKeys`.
 */

export interface ParsedFrontMatter {
  /** Managed string keys; null when the file has no (complete) front matter. */
  fields: Readonly<Record<string, string>> | null;
  /** Managed list keys that were present. */
  lists: Readonly<Record<string, readonly string[]>>;
  /** Raw front-matter lines of unmanaged keys (kept verbatim on update). */
  extraLines: readonly string[];
  /** The unmanaged keys, in file order. */
  extraKeys: readonly string[];
  /** The Markdown after the front matter (the whole file when there is none). */
  body: string;
  problems: string[];
}

/** Kept for the skills code: a skill manages `name` and `description`. */
export type ParsedSkillFile = ParsedFrontMatter;

export interface FrontMatterKeys {
  /** One-line string keys. */
  strings: readonly string[];
  /** List keys. */
  lists?: readonly string[];
}

const FENCE = '---';
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/;
const LIST_ITEM = /^\s*-\s+(.*)$/;

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

/** `Read, Grep` or `[Read, "Grep"]`; null when an item is not a simple string. */
function inlineList(raw: string): string[] | null {
  let value = raw.trim();
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) return null;
    value = value.slice(1, -1);
  } else {
    const plain = scalar(value);
    if (plain === null) return null;
    value = plain;
  }
  const items: string[] = [];
  for (const part of value.split(',')) {
    if (part.trim() === '') continue;
    const item = scalar(part);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

export function parseFrontMatter(text: string, keys: FrontMatterKeys): ParsedFrontMatter {
  const all = lines(text);
  const empty = { fields: null, lists: {}, extraLines: [], extraKeys: [], body: text };
  if (all[0]?.trim() !== FENCE) {
    return {
      ...empty,
      problems: ['The file has no front matter, so Claude Code cannot name or describe it.'],
    };
  }
  const end = all.findIndex((line, i) => i > 0 && line.trim() === FENCE);
  if (end === -1) {
    return { ...empty, problems: ['The front matter is not closed with a line that says ---.'] };
  }

  const strings = new Set(keys.strings);
  const listKeys = new Set(keys.lists ?? []);
  const fields: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const extraLines: string[] = [];
  const extraKeys: string[] = [];
  const problems: string[] = [];
  /** What indented lines after a key belong to. */
  let mode: { kind: 'none' } | { kind: 'keep' } | { kind: 'list'; key: string } = { kind: 'none' };
  for (let i = 1; i < end; i++) {
    const line = all[i] ?? '';
    const lineNo = i + 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      if (mode.kind === 'keep' || line.trim() !== '') extraLines.push(line);
      continue;
    }
    if (/^\s/.test(line) || line.startsWith('- ')) {
      // A nested value (a list or a map) under the previous key.
      if (mode.kind === 'keep') {
        extraLines.push(line);
      } else if (mode.kind === 'list') {
        const item = LIST_ITEM.exec(line);
        const value = item === null ? null : scalar(item[1] ?? '');
        if (value === null) problems.push(`Line ${lineNo} is not a simple list item.`);
        else lists[mode.key]?.push(value);
      } else {
        problems.push(`Line ${lineNo} continues a value over several lines.`);
      }
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (match === null) {
      problems.push(`Line ${lineNo} of the front matter is not a "key: value" pair.`);
      mode = { kind: 'none' };
      continue;
    }
    const key = match[1] ?? '';
    const raw = match[2] ?? '';
    if (!strings.has(key) && !listKeys.has(key)) {
      extraLines.push(line);
      if (!extraKeys.includes(key)) extraKeys.push(key);
      mode = { kind: 'keep' };
      continue;
    }
    mode = { kind: 'none' };
    if (key in fields || key in lists) {
      problems.push(`The front matter sets ${key} more than once.`);
      continue;
    }
    if (listKeys.has(key)) {
      if (raw.trim() === '') {
        lists[key] = [];
        mode = { kind: 'list', key };
        continue;
      }
      const items = inlineList(raw);
      if (items === null) problems.push(`The ${key} on line ${lineNo} is not a simple list.`);
      else lists[key] = items;
      continue;
    }
    const value = scalar(raw);
    if (value === null) {
      problems.push(`The ${key} on line ${lineNo} is not a plain one-line text value.`);
      continue;
    }
    fields[key] = value;
  }

  // The body starts after the closing fence; one blank separator line is formatting, not content.
  const rest = all.slice(end + 1);
  if (rest[0]?.trim() === '') rest.shift();
  return { fields, lists, extraLines, extraKeys, body: rest.join('\n'), problems };
}

export function parseSkillFile(text: string): ParsedFrontMatter {
  return parseFrontMatter(text, { strings: ['name', 'description'] });
}

export function parseAgentFile(text: string): ParsedFrontMatter {
  return parseFrontMatter(text, { strings: ['name', 'description', 'model'], lists: ['tools'] });
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

function finish(head: string[], instructions: string): string {
  const body = instructions.endsWith('\n') ? instructions : `${instructions}\n`;
  return `${[FENCE, ...head, FENCE].join('\n')}\n\n${body}`;
}

export interface SkillFileInput {
  name: string;
  description: string;
  instructions: string;
  /** Other front-matter lines from the file being replaced, kept in place. */
  extraLines?: readonly string[];
}

export function serializeSkillFile(input: SkillFileInput): string {
  return finish(
    [
      `name: ${input.name}`,
      `description: ${quote(normalizeDescription(input.description))}`,
      ...(input.extraLines ?? []),
    ],
    input.instructions,
  );
}

export interface AgentFileInput extends SkillFileInput {
  /** Null: no `tools` key, so the agent inherits every tool (Claude Code's default). */
  tools: readonly string[] | null;
  /** Null: no `model` key (Claude Code's default). */
  model: string | null;
}

/**
 * Claude Code's own format: `tools` as one comma-separated line. Tool names are schema-checked
 * (`AgentToolNameSchema`: no spaces, commas or quotes), so they need no quoting.
 */
export function serializeAgentFile(input: AgentFileInput): string {
  const model = input.model === null ? null : normalizeDescription(input.model);
  return finish(
    [
      `name: ${input.name}`,
      `description: ${quote(normalizeDescription(input.description))}`,
      ...(input.tools === null
        ? []
        : [`tools: ${input.tools.length === 0 ? '[]' : input.tools.join(', ')}`]),
      ...(model === null || model === ''
        ? []
        : [`model: ${/^[A-Za-z0-9._/-]+$/.test(model) ? model : quote(model)}`]),
      ...(input.extraLines ?? []),
    ],
    input.instructions,
  );
}
