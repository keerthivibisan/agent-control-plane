/**
 * Independent reference recomputation of Claude Code usage (P1-F task F1).
 *
 * Recomputes per-session and per-model token totals straight from allowlisted transcript JSONL
 * files, applying docs/usage-accounting.md §5 and §6 as written, so the result can be compared with
 * what the control plane stored. It deliberately imports **nothing** from the workspace: no
 * `@acp/core` selection/attribution, no adapter parsing. If both implementations agree, the rules
 * were implemented as specified; if they disagree, one of them (or the spec) is wrong.
 *
 * Rules applied (usage-accounting §5):
 *   - one usage record per message id, globally across all files and sessions;
 *   - selection: the observation with the greatest `output_tokens` (null lowest), ties to the
 *     earliest timestamp (null last), then the first one read; all four categories are taken from
 *     that one observation;
 *   - attribution: the session of the earliest observation (null last), ties broken by the lexical
 *     canonical session key `["claude-code", sessionId, agentId|null]`; a tie between different
 *     sessions is counted as ambiguous;
 *   - observations with model `<synthetic>` are excluded entirely;
 *   - a category is null (unavailable) when every contributing value is null, never 0 (§6).
 *
 * Session identity comes from the file path (`<uuid>.jsonl`, `<uuid>/subagents/agent-<id>.jsonl`),
 * as the adapter does: fork copies keep the old `sessionId` inside the line.
 *
 * File access follows docs/provider-adapters.md §3: only the two transcript shapes under
 * `<claudeDir>/projects/` are opened, after `realpath` containment. A transcript is included when the
 * `cwd` of its first record that has one is inside a `--root`; a subagent transcript is included when
 * its own first `cwd` or its parent transcript's is.
 *
 * Output is aggregates only (ids, model names, counts, token totals). No content field (text,
 * thinking, tool input or output, titles, paths from lines) is ever printed.
 *
 * Usage (Node 22.18+ runs this file directly through type stripping; it uses only Node built-ins):
 *   node scripts/reference-usage.ts --claude-dir <dir> --root <abs path> [--root <abs path>...]
 */
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TRANSCRIPT_RE = /^([0-9a-f-]{36})\.jsonl$/;
const SUBAGENT_TRANSCRIPT_RE = /^agent-([A-Za-z0-9]+)\.jsonl$/;
/** ISO-8601 with a mandatory zone, as the normalized event contract requires. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SYNTHETIC_MODEL = '<synthetic>';
const MAX_FILE_BYTES = 512 * 1024 * 1024;

export type Category = 'input' | 'output' | 'cacheCreation' | 'cacheRead';
export const CATEGORIES: readonly Category[] = ['input', 'output', 'cacheCreation', 'cacheRead'];
export type Tokens = Record<Category, number | null>;

export interface Totals {
  records: number;
  tokens: Tokens;
  /** Records whose value for the category is null (usage-accounting §6 "partial"). */
  recordsWithUnavailable: Record<Category, number>;
}

export interface SessionTotals extends Totals {
  sessionId: string;
  /** Null for the main transcript, the subagent id otherwise. */
  agentId: string | null;
  /** Records attributed here by the lexical tie-break between sessions (usage-accounting §5.2). */
  ambiguous: number;
}

export interface ModelTotals extends Totals {
  model: string | null;
}

export interface ReferenceReport {
  files: { transcripts: number; subagentTranscripts: number; skipped: number };
  lines: { complete: number; unparseable: number };
  observations: { total: number; synthetic: number };
  messages: number;
  sessions: SessionTotals[];
  models: ModelTotals[];
  total: Totals;
}

interface SourceFile {
  realPath: string;
  sessionId: string;
  agentId: string | null;
}

interface Observation {
  sessionId: string;
  agentId: string | null;
  canonicalKey: string;
  occurredMs: number | null;
  model: string | null;
  tokens: Tokens;
  /** Read order: file order (sorted paths) then line order. The last selection tie-break. */
  seq: number;
}

function isInside(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(candidate);
  return c === r || c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** Lists allowlisted transcripts (never meta, never anything else), in a stable order. */
function listTranscripts(claudeDir: string, skipped: { n: number }): SourceFile[] {
  let projects: string;
  try {
    projects = realpathSync(path.join(claudeDir, 'projects'));
  } catch {
    return [];
  }
  const out: SourceFile[] = [];
  const accept = (candidate: string, sessionId: string, agentId: string | null) => {
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      skipped.n++;
      return;
    }
    // A symlink may only resolve to the same allowlisted shape inside projects/.
    const rel = path.relative(projects, real).split(path.sep);
    const sameShape =
      agentId === null
        ? rel.length === 2 && rel[1] === `${sessionId}.jsonl`
        : rel.length === 4 &&
          rel[1] === sessionId &&
          rel[2] === 'subagents' &&
          rel[3] === `agent-${agentId}.jsonl`;
    if (!isInside(projects, real) || !sameShape || statSync(real).size > MAX_FILE_BYTES) {
      skipped.n++;
      return;
    }
    out.push({ realPath: real, sessionId, agentId });
  };

  const dirs = readdirSync(projects, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const dir of dirs) {
    const dirPath = path.join(projects, dir);
    for (const name of readdirSync(dirPath).sort()) {
      const m = TRANSCRIPT_RE.exec(name);
      if (m?.[1] !== undefined && SESSION_ID_RE.test(m[1])) {
        accept(path.join(dirPath, name), m[1], null);
        continue;
      }
      if (!SESSION_ID_RE.test(name)) continue;
      const subDir = path.join(dirPath, name, 'subagents');
      let entries: string[];
      try {
        if (!lstatSync(path.join(dirPath, name)).isDirectory()) continue;
        entries = readdirSync(subDir).sort();
      } catch {
        continue;
      }
      for (const entry of entries) {
        const s = SUBAGENT_TRANSCRIPT_RE.exec(entry);
        if (s?.[1] !== undefined) accept(path.join(subDir, entry), name, s[1]);
      }
    }
  }
  return out;
}

/** Complete lines only: a trailing fragment without `\n` may still be being written. */
function completeLines(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const end = text.lastIndexOf('\n');
  if (end === -1) return [];
  return text.slice(0, end).split('\n');
}

function parseRecord(line: string): Record<string, unknown> | null | 'error' {
  if (line.trim() === '') return null;
  try {
    const v: unknown = JSON.parse(line);
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : 'error';
  } catch {
    return 'error';
  }
}

const ENVELOPE_TYPES = new Set(['user', 'assistant', 'system']);

function firstCwd(lines: readonly string[]): string | null {
  for (const line of lines) {
    const r = parseRecord(line);
    if (r === null || r === 'error' || typeof r.type !== 'string' || !ENVELOPE_TYPES.has(r.type)) {
      continue;
    }
    if (typeof r.cwd === 'string' && path.isAbsolute(r.cwd)) return r.cwd;
  }
  return null;
}

function tokenCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

function timeMs(v: unknown): number | null {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** Ascending, null last. */
function cmpNullLast(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a - b;
}

/** Descending, null last (a null output ranks lowest). */
function cmpOutputDesc(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

function emptyTotals(): Totals {
  return {
    records: 0,
    tokens: { input: null, output: null, cacheCreation: null, cacheRead: null },
    recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
  };
}

function addRecord(t: Totals, tokens: Tokens): void {
  t.records++;
  for (const c of CATEGORIES) {
    const v = tokens[c];
    if (v === null) t.recordsWithUnavailable[c]++;
    else t.tokens[c] = (t.tokens[c] ?? 0) + v;
  }
}

export function computeReferenceUsage(opts: {
  claudeDir: string;
  roots: readonly string[];
}): ReferenceReport {
  const skipped = { n: 0 };
  const files = listTranscripts(opts.claudeDir, skipped);
  const report: ReferenceReport = {
    files: { transcripts: 0, subagentTranscripts: 0, skipped: 0 },
    lines: { complete: 0, unparseable: 0 },
    observations: { total: 0, synthetic: 0 },
    messages: 0,
    sessions: [],
    models: [],
    total: emptyTotals(),
  };

  const linesByFile = new Map<SourceFile, string[]>();
  for (const f of files) linesByFile.set(f, completeLines(f.realPath));
  const inRoots = (cwd: string | null) => cwd !== null && opts.roots.some((r) => isInside(r, cwd));
  const eligibleSessions = new Set(
    files
      .filter((f) => f.agentId === null && inRoots(firstCwd(linesByFile.get(f) ?? [])))
      .map((f) => f.sessionId),
  );

  const byMessage = new Map<string, Observation[]>();
  let seq = 0;
  for (const f of files) {
    const lines = linesByFile.get(f) ?? [];
    const eligible =
      eligibleSessions.has(f.sessionId) || (f.agentId !== null && inRoots(firstCwd(lines)));
    if (!eligible) {
      skipped.n++;
      continue;
    }
    if (f.agentId === null) report.files.transcripts++;
    else report.files.subagentTranscripts++;

    for (const line of lines) {
      const r = parseRecord(line);
      if (r === null) continue;
      report.lines.complete++;
      if (r === 'error') {
        report.lines.unparseable++;
        continue;
      }
      if (r.type !== 'assistant') continue;
      const message = r.message;
      if (typeof message !== 'object' || message === null || Array.isArray(message)) continue;
      const m = message as Record<string, unknown>;
      if (typeof m.id !== 'string' || m.id.length === 0) continue;
      const usage = m.usage;
      if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) continue;
      const u = usage as Record<string, unknown>;
      const model = typeof m.model === 'string' && m.model.length > 0 ? m.model : null;
      report.observations.total++;
      if (model === SYNTHETIC_MODEL) {
        report.observations.synthetic++;
        continue;
      }
      const obs: Observation = {
        sessionId: f.sessionId,
        agentId: f.agentId,
        canonicalKey: JSON.stringify(['claude-code', f.sessionId, f.agentId]),
        occurredMs: timeMs(r.timestamp),
        model,
        tokens: {
          input: tokenCount(u.input_tokens),
          output: tokenCount(u.output_tokens),
          cacheCreation: tokenCount(u.cache_creation_input_tokens),
          cacheRead: tokenCount(u.cache_read_input_tokens),
        },
        seq: seq++,
      };
      const list = byMessage.get(m.id);
      if (list === undefined) byMessage.set(m.id, [obs]);
      else list.push(obs);
    }
  }
  report.files.skipped = skipped.n;

  const sessions = new Map<string, SessionTotals>();
  const models = new Map<string, ModelTotals>();
  for (const observations of byMessage.values()) {
    report.messages++;
    // Selection: max output (null lowest), then earliest time (null last), then read order.
    const selected = [...observations].sort(
      (a, b) =>
        cmpOutputDesc(a.tokens.output, b.tokens.output) ||
        cmpNullLast(a.occurredMs, b.occurredMs) ||
        a.seq - b.seq,
    )[0];
    // Attribution: earliest time (null last), ties by lexical canonical key.
    const ordered = [...observations].sort(
      (a, b) =>
        cmpNullLast(a.occurredMs, b.occurredMs) ||
        (a.canonicalKey < b.canonicalKey ? -1 : a.canonicalKey > b.canonicalKey ? 1 : 0),
    );
    const owner = ordered[0];
    if (selected === undefined || owner === undefined) continue;
    const ambiguous = ordered.some(
      (o) =>
        cmpNullLast(o.occurredMs, owner.occurredMs) === 0 && o.canonicalKey !== owner.canonicalKey,
    );

    let s = sessions.get(owner.canonicalKey);
    if (s === undefined) {
      s = { sessionId: owner.sessionId, agentId: owner.agentId, ambiguous: 0, ...emptyTotals() };
      sessions.set(owner.canonicalKey, s);
    }
    addRecord(s, selected.tokens);
    if (ambiguous) s.ambiguous++;

    const modelKey = JSON.stringify(selected.model);
    let mt = models.get(modelKey);
    if (mt === undefined) {
      mt = { model: selected.model, ...emptyTotals() };
      models.set(modelKey, mt);
    }
    addRecord(mt, selected.tokens);
    addRecord(report.total, selected.tokens);
  }

  report.sessions = [...sessions.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => v);
  report.models = [...models.values()].sort((a, b) =>
    a.model === b.model
      ? 0
      : a.model === null
        ? 1
        : b.model === null
          ? -1
          : a.model < b.model
            ? -1
            : 1,
  );
  return report;
}

function parseArgs(argv: readonly string[]): { claudeDir: string; roots: string[] } {
  let claudeDir: string | undefined;
  const roots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if ((arg === '--claude-dir' || arg === '--root') && value !== undefined) {
      if (arg === '--claude-dir') claudeDir = value;
      else roots.push(value);
      i++;
    } else {
      throw new Error(`unknown or incomplete argument: ${String(arg)}`);
    }
  }
  // No default to ~/.claude on purpose: reading real data needs an explicit, consented choice.
  if (claudeDir === undefined || roots.length === 0 || !roots.every((r) => path.isAbsolute(r))) {
    throw new Error('usage: reference-usage.ts --claude-dir <dir> --root <abs path> [--root ...]');
  }
  return { claudeDir, roots };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const report = computeReferenceUsage(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'reference-usage failed');
    process.exitCode = 1;
  }
}
