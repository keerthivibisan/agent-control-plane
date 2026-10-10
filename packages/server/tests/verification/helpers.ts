import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { createClaudeCodeAdapter } from '@acp/adapter-claude-code';
import type { TokenCounts } from '@acp/core';
import {
  createQueries,
  createRepositories,
  openDatabase,
  type AcpDatabase,
  type Queries,
  type Repositories,
} from '@acp/db';
import { silentLogger } from '../../src/logger.js';
import { createPipeline, type Pipeline } from '../../src/pipeline/ingest.js';
import type { ReferenceReport } from '../../../../scripts/reference-usage.js';

/*
 * P1-F verification helpers. Everything runs against copies of synthetic fixtures in temp
 * directories; nothing here ever looks at a real Claude data directory.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '..', '..', '..', '..');
export const FIXTURES = join(REPO_ROOT, 'test-fixtures', 'claude-code');
export const REFERENCE_SCRIPT = join(REPO_ROOT, 'scripts', 'reference-usage.ts');
/** The root every fixture's `cwd` lives under (test-fixtures/claude-code/README.md). */
export const FIXTURE_ROOT = '/home/user/project';
export const NOW = new Date('2026-10-10T12:00:00.000Z');

/** Every fixture scenario with transcripts (07 has two versions of one file). */
export const SCENARIOS = [
  '01-streaming-duplicates',
  '02-fork',
  '03-subagent-with-meta',
  '04-subagent-without-meta',
  '05-nested-subagent',
  '06-partial-last-line',
  '07-truncated-replaced/v1',
  '07-truncated-replaced/v2',
  '08-unknown-record-types',
  '09-cost-state',
  '10-cwd-change',
  '11-api-error-and-edge-lines',
  '12-missing-usage-categories',
  '13-hooks',
  '14-denied-files',
  '15-unparseable-line',
  '16-titles',
];

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

export function tempDir(prefix = 'acp-verify-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Copies a fixture scenario's `projects/` tree into a fresh temp Claude data root. */
export function copyScenario(relative: string): string {
  const claudeDir = tempDir('acp-verify-claude-');
  cpSync(join(FIXTURES, relative, 'projects'), join(claudeDir, 'projects'), { recursive: true });
  return claudeDir;
}

/** Writes JSONL lines (objects or raw strings) to `<claudeDir>/projects/<rel>`. */
export function writeTranscript(
  claudeDir: string,
  rel: string,
  lines: readonly (object | string)[],
  options: { trailingNewline?: boolean } = {},
): void {
  const file = join(claudeDir, 'projects', rel);
  mkdirSync(dirname(file), { recursive: true });
  const body = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');
  writeFileSync(file, options.trailingNewline === false ? body : `${body}\n`);
}

export interface LiveStack {
  db: AcpDatabase;
  repos: Repositories;
  queries: Queries;
  pipeline: Pipeline;
  close(): void;
}

/**
 * What live mode builds (bootstrap.ts): a file database, repositories, queries, and the pipeline.
 * The project is registered with the fixture root, which does not exist on this machine, so it is
 * inserted directly instead of through the realpath-checking route.
 */
export function openLiveStack(
  dbPath: string,
  roots: readonly string[] = [FIXTURE_ROOT],
): LiveStack {
  const db = openDatabase(dbPath);
  let open = true;
  const close = () => {
    if (open) db.close();
    open = false;
  };
  cleanups.push(close);
  const repos = createRepositories(db);
  const queries = createQueries(db);
  for (const [i, rootPath] of roots.entries()) {
    if (repos.projects.getByRootPath(rootPath) === undefined) {
      repos.projects.insert({ name: `project-${i}`, rootPath });
    }
  }
  const pipeline = createPipeline({
    db,
    repos,
    logger: silentLogger,
    now: () => NOW,
    publish: () => {},
  });
  return { db, repos, queries, pipeline, close };
}

export function registeredRoots(stack: LiveStack) {
  return stack.repos.projects.list().map((p) => ({ projectId: p.id, rootPath: p.rootPath }));
}

/** Polls the Claude Code adapter once, ingesting every batch. Returns the number of batches. */
export async function ingestOnce(
  stack: LiveStack,
  claudeDir: string,
  options: { chunkBytes?: number; stopAfter?: number } = {},
): Promise<number> {
  const adapter = createClaudeCodeAdapter({
    claudeDir,
    now: () => NOW,
    ...(options.chunkBytes !== undefined && { chunkBytes: options.chunkBytes }),
  });
  let n = 0;
  for await (const batch of adapter.poll(registeredRoots(stack), stack.repos.checkpoints)) {
    stack.pipeline.ingestBatch(batch);
    n++;
    if (options.stopAfter !== undefined && n >= options.stopAfter) break;
  }
  return n;
}

/** Polls until a poll produces no batch (a full drain), with a safety bound. */
export async function ingestUntilIdle(
  stack: LiveStack,
  claudeDir: string,
  options: { chunkBytes?: number } = {},
): Promise<number> {
  let total = 0;
  for (let i = 0; i < 1000; i++) {
    const n = await ingestOnce(stack, claudeDir, options);
    if (n === 0) return total;
    total += n;
  }
  throw new Error('ingestion did not become idle');
}

export interface ComparableTotals {
  records: number;
  tokens: TokenCounts;
  recordsWithUnavailable: Record<keyof TokenCounts, number>;
}

export interface ComparableSession extends ComparableTotals {
  ambiguous: number;
}

/** Per-session direct usage from the database, keyed like the reference (`sid/agent|main`). */
export function dbSessionTotals(stack: LiveStack): Record<string, ComparableSession> {
  const rows = stack.queries.listSessions({}, { limit: 200 }).items;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Record<string, ComparableSession> = {};
  for (const g of stack.queries.usageSummary('session')) {
    const row = g.key === null ? undefined : byId.get(g.key);
    if (row === undefined) throw new Error('usage attributed to an unknown session row');
    out[sessionLabel(row.providerSessionId, row.providerAgentId)] = {
      records: g.totals.recordCount,
      tokens: g.totals.tokens,
      recordsWithUnavailable: g.totals.recordsWithUnavailable,
      ambiguous: stack.queries.ambiguousAttributionCount(row.id),
    };
  }
  return out;
}

export function dbModelTotals(stack: LiveStack): Record<string, ComparableTotals> {
  const out: Record<string, ComparableTotals> = {};
  for (const g of stack.queries.usageSummary('model')) {
    out[g.key ?? '<unknown>'] = {
      records: g.totals.recordCount,
      tokens: g.totals.tokens,
      recordsWithUnavailable: g.totals.recordsWithUnavailable,
    };
  }
  return out;
}

export function sessionLabel(sessionId: string, agentId: string | null): string {
  return `${sessionId}/${agentId ?? 'main'}`;
}

/** Runs the reference script as a separate process, exactly as a user would, and parses its JSON. */
export function runReference(claudeDir: string, roots: readonly string[] = [FIXTURE_ROOT]) {
  const stdout = execFileSync(
    process.execPath,
    [REFERENCE_SCRIPT, '--claude-dir', claudeDir, ...roots.flatMap((r) => ['--root', r])],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const report = JSON.parse(stdout) as ReferenceReport;
  const sessions: Record<string, ComparableSession> = {};
  for (const s of report.sessions) {
    sessions[sessionLabel(s.sessionId, s.agentId)] = {
      records: s.records,
      tokens: s.tokens,
      recordsWithUnavailable: s.recordsWithUnavailable,
      ambiguous: s.ambiguous,
    };
  }
  const models: Record<string, ComparableTotals> = {};
  for (const m of report.models) {
    models[m.model ?? '<unknown>'] = {
      records: m.records,
      tokens: m.tokens,
      recordsWithUnavailable: m.recordsWithUnavailable,
    };
  }
  return { report, stdout, sessions, models };
}

/** Everything a re-ingest or restart must leave unchanged. */
export function snapshotState(stack: LiveStack) {
  const c = stack.db.connection;
  const count = (table: string) =>
    (c.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return {
    sessions: dbSessionTotals(stack),
    models: dbModelTotals(stack),
    counts: {
      events: count('events'),
      sessions: count('sessions'),
      edges: count('session_edges'),
      observations: count('usage_observations'),
      records: count('usage_records'),
      snapshots: count('usage_snapshots'),
    },
    edges: c
      .prepare(
        `SELECT e.kind, e.provenance, e.evidence, p.provider_session_id AS parent, p.provider_agent_id AS parentAgent,
                ch.provider_session_id AS child, ch.provider_agent_id AS childAgent
         FROM session_edges e
         JOIN sessions p ON p.id = e.parent_session_id
         JOIN sessions ch ON ch.id = e.child_session_id
         ORDER BY e.kind, child, childAgent`,
      )
      .all(),
    // Session evidence columns, without internal ids (they differ between databases).
    sessionRows: c
      .prepare(
        `SELECT provider_session_id, provider_agent_id, origin, launch_cwd, git_branch, entrypoint,
                provider_version, title, agent_type, description, first_seen_at, last_event_at,
                ended_at, end_reason, last_attention_at, metadata,
                (SELECT root_path FROM projects WHERE projects.id = sessions.project_id) AS root
         FROM sessions ORDER BY provider_session_id, provider_agent_id`,
      )
      .all(),
    dedupKeys: (
      c.prepare('SELECT dedup_key FROM events ORDER BY dedup_key').all() as { dedup_key: string }[]
    ).map((r) => r.dedup_key),
    duplicateDedupKeys: (
      c
        .prepare(
          'SELECT COUNT(*) AS n FROM (SELECT dedup_key FROM events GROUP BY dedup_key HAVING COUNT(*) > 1)',
        )
        .get() as { n: number }
    ).n,
  };
}
