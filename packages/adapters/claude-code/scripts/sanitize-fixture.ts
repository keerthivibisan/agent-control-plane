/**
 * Fixture sanitizer (P1-C task C1; rules in test-fixtures/claude-code/README.md).
 *
 * Keeps structure: keys, nesting, record types, line order, numbers, and booleans. Replaces ids
 * with deterministic fakes (shared across all files of one run, so cross-references survive),
 * paths with `/home/user/project…`, and every other string with `<redacted>`. Only short
 * enum-like values under a few known keys (type, model, version, …) are kept.
 *
 * The output still needs a human review before it is committed.
 *
 * Usage (Node 22 runs this file directly via type stripping; it imports only Node built-ins):
 *   pnpm --filter @acp/adapter-claude-code sanitize-fixture --out <dir> <file.jsonl|file.json>...
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REDACTED = '<redacted>';
export const UNPARSEABLE_LINE = '<redacted unparseable line>';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXED_ID_RE = /^([a-z]{2,12})_[A-Za-z0-9_-]+$/;
const ALNUM_RE = /^[A-Za-z0-9]+$/;
/** Values kept verbatim under KEEP_KEYS: short, enum-like, no spaces. */
const SAFE_TOKEN_RE = /^[A-Za-z0-9<][A-Za-z0-9._:+<>/-]{0,79}$/;
/** Built-in tool names are PascalCase words (Bash, Read, Agent, TodoWrite, …). */
const TOOL_NAME_RE = /^[A-Z][A-Za-z]{1,40}$/;
const SAFE_KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const MODEL_KEY_RE = /^(claude-[a-z0-9.-]{1,80}|<synthetic>)$/;

const KEEP_KEYS = new Set([
  'type',
  'subtype',
  'role',
  'model',
  'stop_reason',
  'version',
  'entrypoint',
  'userType',
  'level',
  'service_tier',
  'inference_geo',
  'speed',
  'media_type',
  'permissionMode',
  'agentType',
  'agent_type',
  'hook_event_name',
  'source',
  'reason',
  'notification_type',
  'timestamp',
]);

const ID_KEYS = new Set([
  'id',
  'uuid',
  'parentUuid',
  'logicalParentUuid',
  'leafUuid',
  'sessionId',
  'session_id',
  'agentId',
  'agent_id',
  'tool_use_id',
  'toolUseId',
  'toolUseID',
  'requestId',
  'request_id',
  'messageId',
  'promptId',
  'accountUuid',
  'organizationUuid',
]);
const ID_KEY_SUFFIX_RE = /(Id|ID|Uuid|UUID|_id|_uuid)$/;

const PATH_KEYS = new Set([
  'cwd',
  'path',
  'file_path',
  'filePath',
  'notebook_path',
  'worktreePath',
  'transcript_path',
  'agent_transcript_path',
  'projectPath',
]);

/** Deterministic replacement tables shared across every file sanitized by one instance. */
export class Sanitizer {
  private readonly ids = new Map<string, string>();
  private readonly paths = new Map<string, string>();
  private readonly pathRoots: Array<{ original: string[]; mapped: string }> = [];
  private readonly segments = new Map<string, string>();
  private readonly branches = new Map<string, string>();
  private readonly keys = new Map<string, string>();
  private counter = 0;

  /** Sanitizes a JSONL transcript; keeps line order, blank lines, and a missing final newline. */
  jsonl(text: string): string {
    return text
      .split('\n')
      .map((line) => {
        if (line.trim() === '') return line;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return UNPARSEABLE_LINE;
        }
        return JSON.stringify(this.value(parsed, undefined));
      })
      .join('\n');
  }

  /** Sanitizes one JSON document (subagent meta or hook payload). */
  json(text: string): string {
    return `${JSON.stringify(this.value(JSON.parse(text) as unknown, undefined), null, 2)}\n`;
  }

  /** Maps ids inside a transcript or meta file name, e.g. `<uuid>.jsonl`, `agent-<id>.meta.json`. */
  fileName(name: string): string {
    const agent = /^agent-([A-Za-z0-9]+)(\.jsonl|\.meta\.json)$/.exec(name);
    if (agent?.[1] !== undefined && agent[2] !== undefined) {
      return `agent-${this.id(agent[1], 'agentId')}${agent[2]}`;
    }
    const session = /^([0-9a-f-]{36})(\.jsonl)?$/i.exec(name);
    if (session?.[1] !== undefined && UUID_RE.test(session[1])) {
      return `${this.id(session[1], 'uuid')}${session[2] ?? ''}`;
    }
    return name;
  }

  private value(v: unknown, key: string | undefined): unknown {
    if (typeof v === 'string') return this.string(v, key);
    if (Array.isArray(v)) return v.map((item) => this.value(item, key));
    if (typeof v === 'object' && v !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v)) out[this.key(k)] = this.value(child, k);
      return out;
    }
    return v; // numbers, booleans, null: structure, not content
  }

  private key(k: string): string {
    if (SAFE_KEY_RE.test(k) || MODEL_KEY_RE.test(k)) return k;
    let mapped = this.keys.get(k);
    if (mapped === undefined) {
      mapped = `key-${this.next()}`;
      this.keys.set(k, mapped);
    }
    return mapped;
  }

  private string(s: string, key: string | undefined): string {
    if (key === 'name') return toolName(s);
    if (key === 'gitBranch') return this.branch(s);
    if (key !== undefined && KEEP_KEYS.has(key)) return SAFE_TOKEN_RE.test(s) ? s : REDACTED;
    if (UUID_RE.test(s)) return this.id(s, key);
    if (key !== undefined && (ID_KEYS.has(key) || ID_KEY_SUFFIX_RE.test(key))) {
      return this.id(s, key);
    }
    if ((key !== undefined && PATH_KEYS.has(key)) || looksLikePath(s)) return this.path(s);
    return REDACTED;
  }

  private id(s: string, key: string | undefined): string {
    const known = this.ids.get(s);
    if (known !== undefined) return known;
    const n = this.next();
    let fake: string;
    const prefixed = PREFIXED_ID_RE.exec(s);
    if (UUID_RE.test(s)) {
      fake = `${hex(n, 8)}-0000-4000-8000-${hex(n, 12)}`;
    } else if (prefixed?.[1] !== undefined) {
      fake = `${prefixed[1]}_fake${hex(n, 6)}`;
    } else if ((key === 'agentId' || key === 'agent_id') && ALNUM_RE.test(s)) {
      fake = `afake${hex(n, 6)}`;
    } else {
      fake = `id-fake-${hex(n, 6)}`;
    }
    this.ids.set(s, fake);
    return fake;
  }

  private path(s: string): string {
    const known = this.paths.get(s);
    if (known !== undefined) return known;
    const parts = s.split(/[\\/]+/).filter((p) => p.length > 0 && p !== '~');
    let mapped: string | undefined;
    for (const root of this.pathRoots) {
      if (root.original.length <= parts.length && root.original.every((p, i) => p === parts[i])) {
        const rest = parts.slice(root.original.length).map((p) => this.segment(p));
        mapped = [root.mapped, ...rest].join('/');
        break;
      }
    }
    if (mapped === undefined) {
      mapped =
        this.pathRoots.length === 0
          ? '/home/user/project'
          : `/home/user/project-${this.pathRoots.length + 1}`;
      this.pathRoots.push({ original: parts, mapped });
    }
    this.paths.set(s, mapped);
    return mapped;
  }

  private segment(p: string): string {
    let mapped = this.segments.get(p);
    if (mapped === undefined) {
      mapped = `d${this.segments.size + 1}`;
      this.segments.set(p, mapped);
    }
    return mapped;
  }

  private branch(s: string): string {
    if (s === 'main' || s === 'master' || s === 'HEAD') return s;
    let mapped = this.branches.get(s);
    if (mapped === undefined) {
      mapped = `branch-${this.branches.size + 1}`;
      this.branches.set(s, mapped);
    }
    return mapped;
  }

  private next(): number {
    this.counter += 1;
    return this.counter;
  }
}

function toolName(s: string): string {
  if (TOOL_NAME_RE.test(s)) return s;
  if (s.startsWith('mcp__')) return 'mcp__redacted__tool';
  return REDACTED;
}

function looksLikePath(s: string): boolean {
  return s.startsWith('/') || s.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(s);
}

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, '0');
}

function main(argv: string[]): void {
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex === -1 ? undefined : argv[outIndex + 1];
  const inputs = argv.filter((_, i) => i !== outIndex && i !== outIndex + 1);
  if (outDir === undefined || inputs.length === 0) {
    console.error('usage: sanitize-fixture --out <dir> <file.jsonl|file.json>...');
    process.exitCode = 2;
    return;
  }
  const sanitizer = new Sanitizer();
  mkdirSync(outDir, { recursive: true });
  for (const input of inputs) {
    const base = path.basename(input);
    if (!/\.(jsonl|json)$/.test(base)) {
      console.error(`skipped (not .jsonl or .json): ${base}`);
      continue;
    }
    const text = readFileSync(input, 'utf8');
    const output = base.endsWith('.jsonl') ? sanitizer.jsonl(text) : sanitizer.json(text);
    const target = path.join(outDir, sanitizer.fileName(base));
    writeFileSync(target, output);
    // Print only the output path: input names may contain real ids.
    console.error(`wrote ${target}`);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2));
}
