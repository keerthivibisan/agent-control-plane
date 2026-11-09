import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ManagedExecutionAdapter } from '@acp/core';
import {
  CSRF_HEADER,
  CodeMapSummaryDtoSchema,
  CsrfTokenDtoSchema,
  ProjectDtoSchema,
  RunDetailDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  WorkflowGraphDtoSchema,
  type CodeMapSummaryDto,
  type RunDetailDto,
} from '@acp/core/api';
import { createManagedClaudeCode } from '@acp/adapter-claude-code';
import { createManagedCodex } from '@acp/adapter-codex';
import { openDatabase } from '@acp/db';
import { startServer, type RunningServer } from '../../../../src/bootstrap.js';
import { loadConfig } from '../../../../src/config.js';
import { managedAgentEnv } from '../../../../src/control/env.js';
import { createLogger } from '../../../../src/logger.js';
import { git } from '../../control/harness.js';
import {
  HARNESS_FILES,
  TICKETS,
  UsageRecorder,
  emptySums,
  measureGraph,
  mergeSums,
  parseSettings,
  recordUsage,
  schedule,
  sumUsageRecords,
  summarize,
  type AgentRecord,
  type IndexCost,
  type RunRecord,
  type Slot,
  type UsageRecordRow,
} from './record.js';

/*
 * CM-5 measurement driver (ADR-0034): the same small tickets with and without the code map, on a
 * copy of this repository (a mid-size TypeScript monorepo), comparing how much the agents read,
 * search and spend.
 *
 * THIS STARTS REAL AGENTS (`claude` through the Agent SDK, or `codex app-server`) AND SPENDS
 * TOKENS. It runs only when the owner has consented in chat AND sets ACP_REAL_RUN=1; never in CI;
 * never from `pnpm test` (the file is not `*.test.ts`). Run it from packages/server:
 *
 *   ACP_REAL_RUN=1 node --conditions=development --import tsx \
 *     tests/verification/code-map/real-run/drive.ts > cm5-summary.json
 *
 * Settings (env; `record.ts` parseSettings refuses anything outside them):
 * - ACP_REAL_RUN_PROVIDER `claude-code` (default) or `codex`; every agent node uses it;
 * - ACP_REAL_RUN_MODEL: default `haiku` (Claude) or `gpt-6-luna` (Codex);
 * - ACP_REAL_RUN_EFFORT `low` (default) or `medium`; anything higher is refused;
 * - ACP_REAL_RUN_ARMS (default `on,off`), ACP_REAL_RUN_REPEATS (default 1), ACP_REAL_RUN_TICKETS
 *   (default `A,B`); ACP_REAL_RUN_COMMIT (default: this worktree's HEAD);
 * - ACP_REAL_RUN_LIMIT_MS per run (default 15 minutes); ACP_REAL_RUN_KEEP=1 keeps the temp root.
 *
 * Setup: ONE temp root under the home folder (`~/.acp-cm5-real-run-*`), never the system temp
 * folder (Codex refuses repositories under temp roots). This repository is cloned there
 * (`--no-hardlinks`) at the commit, as `main`, without `origin`; the owner commits a one-check
 * harness (`git diff --check`, no install needed). Each run (repeat × ticket × arm, the arm order
 * alternating per repeat) gets a FRESH clone of that seed, a FRESH data dir, an EMPTY Claude dir
 * (the real ~/.claude is never read) and a FRESH in-process server on an ephemeral 127.0.0.1 port
 * with ACP_CODE_MAP set to the arm, so no map or cache leaks between arms. For `on` the map is
 * built before the ticket starts (refresh, then poll until ready) and its cost recorded.
 * Through the routes the UI uses (CSRF included) the driver plays the owner as the CX driver
 * does: setup, the graph (lead plus helpers, no change or final review, Auto edits), the ticket,
 * Start, the plan approval, a deny for anything that still asks, merge-or-discard for a change
 * handed to the owner, and the one merge of the ticket branch.
 *
 * Recorded, aggregates only (never prompt, reply, plan, finding, diff, path or tool-input text):
 * per run its outcome, per agent its role, provider, model, tool counts by category, budget used,
 * duration, model responses and token sums; Codex `usage_records` sums; the plan's starting-point
 * counts; the index cost; wall time. The summary (medians per arm, success rates, index cost,
 * deltas off − on, every run) goes to stdout.
 *
 * Stop: Ctrl-C stops the current run (`POST /api/runs/:id/stop`), closes its server, prints the
 * runs so far and deletes the temp root (unless kept). A run over its limit is stopped the same
 * way and the next one starts.
 */

if (process.env['ACP_REAL_RUN'] !== '1') {
  console.error('Refusing: this starts real Claude Code or Codex agents. Set ACP_REAL_RUN=1.');
  process.exit(2);
}
if (process.env['CI'] !== undefined) {
  console.error('Refusing: never in CI.');
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_REPO = git(HERE, 'rev-parse', '--show-toplevel').trim();
const parsed = parseSettings(process.env, git(SOURCE_REPO, 'rev-parse', 'HEAD').trim());
if (!parsed.ok) {
  console.error(`Refusing: ${parsed.error}.`);
  process.exit(2);
}
const S = parsed.settings;
const MODE = 'auto-edits';
// Generous so the budget never cuts an arm short (a raise would be denied and skew the result).
const BUDGET = 300_000;
const ENDED = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const slots = schedule(S);

// ------------------------------------------------------------------ the temp root and the seed

const root = realpathSync(mkdtempSync(join(homedir(), '.acp-cm5-real-run-')));
const seed = join(root, 'repo');
console.error(`CM-5: temp root ${root}; ${slots.length} run(s)`);

function cleanup(): void {
  if (S.keep) console.error(`CM-5: kept for inspection: ${root}`);
  else rmSync(root, { recursive: true, force: true });
}

let commit: string;
try {
  commit = git(SOURCE_REPO, 'rev-parse', '--verify', `${S.commit}^{commit}`).trim();
  git(root, 'clone', '--quiet', '--no-hardlinks', SOURCE_REPO, seed);
  git(seed, 'checkout', '--quiet', '-B', 'main', commit);
  git(seed, 'remote', 'remove', 'origin');
  for (const b of git(seed, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split(
    '\n',
  )) {
    if (b.trim() !== '' && b.trim() !== 'main') git(seed, 'branch', '--quiet', '-D', b.trim());
  }
  for (const [path, content] of Object.entries(HARNESS_FILES)) {
    mkdirSync(dirname(join(seed, path)), { recursive: true });
    writeFileSync(join(seed, path), content);
  }
  git(seed, 'add', '--', ...Object.keys(HARNESS_FILES));
  git(seed, 'commit', '--quiet', '-m', 'Add the CM-5 measurement harness');
} catch (error) {
  console.error(`Refusing: the copy could not be prepared (${(error as Error).name}).`);
  cleanup();
  process.exit(2);
}

// ------------------------------------------------------------------ HTTP as the owner

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Client {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
  put: (path: string, body: unknown) => Promise<unknown>;
}

async function clientFor(base: string): Promise<Client> {
  let csrf = '';
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers[CSRF_HEADER] = csrf;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) {
      let code = 'unknown';
      try {
        code = (JSON.parse(text) as { error?: { code?: string } }).error?.code ?? code;
      } catch {
        // Not JSON.
      }
      // Only the method, status and code: a message may quote agent text, a path an id.
      throw new HttpFailure(res.status, code, `${method} → ${res.status} ${code}`);
    }
    return text === '' ? null : (JSON.parse(text) as unknown);
  };
  const client: Client = {
    get: (path) => call('GET', path),
    post: (path, body = {}) => call('POST', path, body),
    put: (path, body) => call('PUT', path, body),
  };
  csrf = CsrfTokenDtoSchema.parse(await client.get('/api/control/token')).token;
  return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The database file and its WAL, in bytes (the index cost is the growth during the build). */
function dbBytes(path: string): number {
  let total = 0;
  for (const p of [path, `${path}-wal`]) if (existsSync(p)) total += statSync(p).size;
  return total;
}

// ------------------------------------------------------------------ stopping

let interrupted = false;
let active: { server: RunningServer; client: Client | null; runId: string | null } | null = null;
let closed = false;

async function closeActive(): Promise<void> {
  const a = active;
  active = null;
  if (a === null) return;
  if (a.runId !== null && a.client !== null) {
    await a.client.post(`/api/runs/${a.runId}/stop`).catch(() => undefined);
  }
  await a.server.close().catch(() => undefined);
}

const runs: RunRecord[] = [];

function printSummary(): void {
  process.stdout.write(`${JSON.stringify(summarize(runs, S), null, 2)}\n`);
}

process.once('SIGINT', () => {
  interrupted = true;
  console.error('CM-5: Ctrl-C; stopping the current run');
  void closeActive().finally(() => {
    if (!closed) {
      closed = true;
      printSummary();
      cleanup();
    }
    process.exit(130);
  });
});

// ------------------------------------------------------------------ one run

function errorLabel(error: unknown): string {
  // The driver's own errors and fetch failures carry no agent text; for anything else (a schema
  // error may quote a received value) only the name.
  if (!(error instanceof Error)) return 'failed';
  const plain =
    error instanceof HttpFailure || error.name === 'Error' || error.name === 'TypeError';
  return plain ? error.message : error.name;
}

async function runOne(slot: Slot, index: number): Promise<RunRecord> {
  const dir = join(root, 'runs', `${index}-${slot.ticket}-${slot.arm}`);
  const dataDir = join(dir, 'data');
  const claudeDir = join(dir, 'claude'); // empty: observation never sees the real ~/.claude
  for (const d of [dataDir, claudeDir]) mkdirSync(d, { recursive: true });
  const repo = join(dir, 'repo');
  git(dir, 'clone', '--quiet', '--no-hardlinks', '--branch', 'main', seed, repo);
  git(repo, 'remote', 'remove', 'origin');
  const logFile = join(dataDir, 'server.log');
  writeFileSync(logFile, '');

  const recorder = new UsageRecorder();
  const inner: ManagedExecutionAdapter =
    S.provider === 'codex'
      ? createManagedCodex({ env: process.env })
      : createManagedClaudeCode({ env: managedAgentEnv(process.env) });
  const config = loadConfig({
    ACP_MODE: 'live',
    ACP_MANAGED: 'on',
    ACP_DATA_DIR: dataDir,
    ACP_CLAUDE_DIR: claudeDir,
    // Only for the config; the server listens on an ephemeral port below.
    ACP_PORT: '7794',
    ACP_POLL_INTERVAL_MS: '2000',
    ACP_CODE_MAP: slot.arm,
  });
  const server = await startServer({
    config,
    port: 0,
    logger: createLogger((line) => appendFileSync(logFile, `${line}\n`)),
    managedAdapters: [recordUsage(inner, recorder)],
  });
  active = { server, client: null, runId: null };
  const client = await clientFor(`http://127.0.0.1:${server.port}`);
  active.client = client;
  const { get, post, put } = client;
  const deadline = Date.now() + S.limitMs;
  const ticketDef = TICKETS[slot.ticket];

  const project = ProjectDtoSchema.parse(
    await post('/api/projects', { name: `acp-cm5-${index}`, rootPath: repo }),
  );
  const p = `/api/projects/${project.id}`;
  await put(`${p}/setup`, {
    projectKey: 'CM',
    maxConcurrentHelpers: 1,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: BUDGET,
    model: null,
    approvals: { mode: MODE, commands: [] },
    contextFiles: [],
  });
  const saved = WorkflowGraphDtoSchema.parse(
    await put(`${p}/workflow-graph`, { graph: measureGraph(S) }),
  );
  const graphErrors = saved.issues.filter((i) => i.severity === 'error').length;
  if (graphErrors > 0) throw new Error(`the graph has ${graphErrors} error(s)`);

  // The `on` arm: build the map before the ticket, and measure what it costs.
  let indexCost: IndexCost | null = null;
  let mapCommit: string | null = null;
  if (slot.arm === 'on') {
    const before = dbBytes(config.databasePath);
    const t0 = Date.now();
    await post(`${p}/code-map/refresh`);
    let summary: CodeMapSummaryDto;
    for (;;) {
      summary = CodeMapSummaryDtoSchema.parse(await get(`${p}/code-map`));
      if (summary.status === 'ready' || summary.status === 'failed') break;
      if (Date.now() > deadline || interrupted) throw new Error('the map build did not finish');
      await sleep(250);
    }
    const buildMs = Date.now() - t0;
    if (summary.status !== 'ready' || summary.manifest === null) {
      throw new Error(`the map build failed (${summary.errorCode ?? 'unknown'})`);
    }
    mapCommit = summary.manifest.commit;
    indexCost = {
      buildMs,
      files: summary.manifest.counts.files,
      indexed: summary.manifest.counts.indexed,
      symbols: summary.manifest.counts.symbols,
      dbBytes: Math.max(0, dbBytes(config.databasePath) - before),
    };
  }

  const ticket = TicketDtoSchema.parse(
    await post(`${p}/tickets`, {
      title: ticketDef.title,
      description: ticketDef.description,
      type: 'feature',
      priority: 'medium',
      labels: [],
    }),
  );
  await post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
  const startedAt = Date.now();
  const started = TicketDetailDtoSchema.parse(
    await post(`/api/tickets/${ticket.id}/start`, { approvalMode: MODE }),
  );
  const rid = started.currentRun?.id;
  if (rid === undefined) throw new Error('the ticket has no run');
  active.runId = rid;
  console.error(`CM-5: run ${index + 1}/${slots.length} started (${slot.ticket}, ${slot.arm})`);
  const detail = async (): Promise<RunDetailDto> =>
    RunDetailDtoSchema.parse(await get(`/api/runs/${rid}`));

  const decided = new Set<string>();
  let finalMerge: string | null = null;
  let timedOut = false;
  for (;;) {
    if (Date.now() > deadline || interrupted) {
      timedOut = true;
      break;
    }
    const r = await detail();
    if (ENDED.has(r.status)) break;

    const t = TicketDetailDtoSchema.parse(await get(`/api/tickets/${ticket.id}`));
    const proposed = t.plans.find((x) => x.runId === rid && x.status === 'proposed');
    if (t.ticket.stage === 'PLAN_REVIEW' && proposed !== undefined) {
      await post(`/api/tickets/${ticket.id}/plans/${proposed.id}/decision`, {
        decision: 'approve',
      }).catch((error: unknown) => {
        if (!(error instanceof HttpFailure) || error.status !== 409) throw error;
      });
    }
    // No human clicks: whatever still asks is denied.
    for (const a of r.approvals.filter((x) => x.status === 'pending')) {
      await post(`/api/approvals/${a.id}`, { decision: 'deny', message: 'Not in this run.' }).catch(
        (error: unknown) => {
          if (!(error instanceof HttpFailure) || error.status !== 409) throw error;
        },
      );
    }
    // A change handed to the owner: merge it when its checks passed, else discard.
    for (const c of r.changes ?? []) {
      const key = `${c.agentRunId}:${c.reworkRounds}`;
      if (c.state !== 'needs-owner' || decided.has(key)) continue;
      const passed = c.checks.length > 0 && c.checks.every((k) => k.status === 'passed');
      try {
        await post(`/api/runs/${rid}/review`, {
          agentRunId: c.agentRunId,
          action: passed ? 'merge' : 'discard',
        });
        decided.add(key);
      } catch (error) {
        if (!(error instanceof HttpFailure) || error.code !== 'checks_running') throw error;
      }
    }
    // The owner's one merge of the ticket branch; refused with `checks_running` until passed.
    if (r.status === 'REVIEW' && finalMerge === null) {
      try {
        await post(`/api/runs/${rid}/ticket-branch`, { action: 'merge' });
        finalMerge = 'merged';
      } catch (error) {
        if (!(error instanceof HttpFailure)) throw error;
        if (error.code !== 'checks_running') {
          finalMerge = `refused:${error.code}`;
          break;
        }
      }
    }
    await sleep(2000);
  }
  if (timedOut) await post(`/api/runs/${rid}/stop`).catch(() => undefined);
  const wallMs = Date.now() - startedAt;

  // ---- the end state, aggregated
  const end = await detail();
  const tEnd = TicketDetailDtoSchema.parse(await get(`/api/tickets/${ticket.id}`));
  const plan = tEnd.plans.filter((x) => x.runId === rid).at(-1);
  const stepFiles = [...new Set((plan?.steps ?? []).flatMap((s) => s.files ?? []))];
  let notFoundInMap: number | null = null;
  if (mapCommit !== null) {
    notFoundInMap = 0;
    for (const f of stepFiles) {
      const q = new URLSearchParams({ path: f, commit: mapCommit });
      try {
        await get(`${p}/code-map/file?${q.toString()}`);
      } catch (error) {
        if (!(error instanceof HttpFailure) || error.status >= 500) throw error;
        // 404 (not in the map) or 400 (not a repository path): not found either way.
        notFoundInMap++;
      }
    }
  }
  const branch = end.ticketBranch ?? null;
  const changed =
    branch === null
      ? []
      : git(repo, 'diff', '--name-only', branch.baseCommit, 'main')
          .split('\n')
          .filter((l) => l.trim() !== '');
  const changeChecks = (end.changes ?? []).flatMap((c) => c.checks.map((k) => k.status));
  const checksPassed =
    finalMerge === 'merged'
      ? true
      : changeChecks.length === 0
        ? null
        : changeChecks.every((s) => s === 'passed');

  const agents: AgentRecord[] = end.agents.map((a) => {
    const usage = recorder.of(a.id);
    return {
      role: a.kind,
      provider: a.provider ?? 'claude-code',
      model: S.model,
      status: a.status,
      toolCounts: a.toolCounts ?? null,
      budgetUsed: a.budget.used,
      durationMs: a.endedAt === null ? null : Date.parse(a.endedAt) - Date.parse(a.createdAt),
      responses: usage?.responses ?? null,
      tokens: usage?.tokens ?? null,
    };
  });
  const tokens = emptySums();
  for (const a of agents) if (a.tokens !== null) mergeSums(tokens, a.tokens);

  // Every agent has ended; the database is read once the server is closed.
  await closeActive();
  let codexUsageRecords: RunRecord['codexUsageRecords'] = null;
  if (S.provider === 'codex') {
    const db = openDatabase(config.databasePath);
    try {
      const rows = db.connection
        .prepare(
          'SELECT provider, input_tokens, output_tokens, cache_creation_tokens, ' +
            'cache_read_tokens FROM usage_records',
        )
        .all() as UsageRecordRow[];
      codexUsageRecords = sumUsageRecords(rows, 'codex');
    } finally {
      db.close();
    }
  }
  if (!S.keep) rmSync(dir, { recursive: true, force: true });

  return {
    ...slot,
    provider: S.provider,
    model: S.model,
    effort: S.effort,
    wallMs,
    outcome: {
      runStatus: end.status,
      timedOut,
      ticketFileChanged: changed.includes(ticketDef.expectedFile),
      changedFilesOnMain: changed.length,
      checksPassed,
      finalMerge,
    },
    index: indexCost,
    startingPoints: {
      steps: plan?.steps.length ?? 0,
      stepsWithFiles: (plan?.steps ?? []).filter((s) => (s.files?.length ?? 0) > 0).length,
      files: stepFiles.length,
      notFoundInMap,
    },
    agents,
    tokens,
    codexUsageRecords,
  };
}

// ------------------------------------------------------------------ all runs

for (const [i, slot] of slots.entries()) {
  if (interrupted) break;
  try {
    runs.push(await runOne(slot, i));
  } catch (error) {
    const label = errorLabel(error);
    console.error(`CM-5: run ${i + 1} failed: ${label}`);
    await closeActive();
    runs.push({
      ...slot,
      provider: S.provider,
      model: S.model,
      effort: S.effort,
      wallMs: 0,
      outcome: {
        runStatus: 'ERROR',
        timedOut: false,
        ticketFileChanged: false,
        changedFilesOnMain: 0,
        checksPassed: null,
        finalMerge: null,
      },
      index: null,
      startingPoints: { steps: 0, stepsWithFiles: 0, files: 0, notFoundInMap: null },
      agents: [],
      tokens: emptySums(),
      codexUsageRecords: null,
      error: label,
    });
  }
}

if (!closed) {
  closed = true;
  printSummary();
  cleanup();
}
process.exit(runs.some((r) => r.error !== undefined) ? 1 : 0);
