import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AgentRoleKind, ManagedAgentSpec, ManagedExecutionAdapter } from '@acp/core';
import {
  CSRF_HEADER,
  CsrfTokenDtoSchema,
  ProjectDtoSchema,
  RunDetailDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  WorkflowGraphDtoSchema,
  type AgentMessageMetaDto,
  type RunDetailDto,
} from '@acp/core/api';
import { createManagedClaudeCode, type ManagedQueryFn } from '@acp/adapter-claude-code';
import { createManagedCodex } from '@acp/adapter-codex';
import { openDatabase } from '@acp/db';
import { startServer } from '../../../../src/bootstrap.js';
import { loadConfig } from '../../../../src/config.js';
import { managedAgentEnv } from '../../../../src/control/env.js';
import { createLogger } from '../../../../src/logger.js';
import { dumpDatabase, git } from '../../control/harness.js';
import {
  HARNESS,
  TICKET,
  TICKET_FILES,
  codexChecks,
  count,
  observeManaged,
  outboxCounts,
  parseScenario,
  scenarioGraph,
  startsByProvider,
  summarizeUsage,
  type StartRecord,
  type UsageRow,
} from './record.js';

/*
 * CX REAL run driver: ACP end to end with real Codex and real Claude agents (ADR-0031..0033).
 *
 * THIS STARTS REAL `claude` PROCESSES THROUGH THE AGENT SDK AND A REAL `codex app-server`, AND
 * SPENDS CLAUDE AND CODEX TOKENS. It runs only when the owner has consented in chat AND sets
 * ACP_REAL_RUN=1; never in CI; never from `pnpm test` (the file is not `*.test.ts`, so vitest does
 * not collect it). Run it from packages/server:
 *
 *   ACP_REAL_RUN=1 ACP_REAL_RUN_SCENARIO=reviewer node --conditions=development --import tsx \
 *     tests/verification/codex/real-run/drive.ts
 *   ACP_REAL_RUN=1 ACP_REAL_RUN_SCENARIO=lead node --conditions=development --import tsx \
 *     tests/verification/codex/real-run/drive.ts
 *
 * Scenarios (today's setup graph, Auto edits, one tiny ticket: `add(a, b)` in src/math.mjs with
 * test/math.test.mjs):
 * - `reviewer`: the change reviewer runs on Codex (gpt-6.1-sol, effort low); lead and helper on
 *   Claude.
 * - `lead`: the lead runs on Codex (gpt-6.1-sol, effort low); the helper and the change reviewer
 *   on Claude.
 * Claude nodes use ACP_REAL_RUN_CLAUDE_MODEL when set, else the provider default (as the RL-V
 * driver does).
 *
 * Setup: ONE temp root under the home folder (`~/.acp-cx-real-run-*`), never under the system temp
 * folder: Codex refuses repositories under temp roots (`unsafe-git-location`) and its profile
 * denies /tmp. It holds the throwaway repo (with a one-check harness, `node check.mjs` running the
 * repo's `test/*.test.mjs` with `node --test`), the data dir and an EMPTY Claude dir for observation
 * (the real ~/.claude is never read; ~/.codex is never read by the app, only denied to Codex
 * agents). The server runs in-process on an ephemeral 127.0.0.1 port (never 7420/5173), live mode,
 * managed agents on, with the real Claude Code adapter (SDK `query` wrapped to record option
 * shapes, as RL-V) and the real Codex adapter, both wrapped to record each start. Through the HTTP
 * routes the UI uses (CSRF included) the driver plays the owner: setup, the graph, the ticket,
 * Start, the plan approval, a deny for anything that still asks, a decision on a change handed to
 * the owner (merge when its checks passed, else discard) and the one merge of the ticket branch.
 *
 * Recorded, aggregates only (never prompt, reply, thinking, finding, diff or tool-input text): per
 * start its provider, role kind, model, effort and whether it had denyRead, fullAuto, sandbox,
 * followUp or rework, whether it started, its usage event counts, its lead tool calls by name and
 * its end; the SDK option shapes of Claude starts; `usage_records` per provider with null counts;
 * the outbox's latest state per entry as kind:state counts; changes and review rounds; the ticket
 * branch; booleans for "no plan or comment text in the server log; no diff text in the database".
 * The summary goes to stdout (and `<data dir>/real-run-summary.json` when the root is kept).
 *
 * Stop: Ctrl-C or the time limit (ACP_REAL_RUN_LIMIT_MS, default 20 minutes) stops the run
 * (`POST /api/runs/:id/stop`) and closes the server. The temp root is deleted at the end unless
 * ACP_REAL_RUN_KEEP=1.
 */

if (process.env['ACP_REAL_RUN'] !== '1') {
  console.error(
    'Refusing: this starts real Claude Code and Codex agents. Set ACP_REAL_RUN=1 after consent.',
  );
  process.exit(2);
}
if (process.env['CI'] !== undefined) {
  console.error('Refusing: never in CI.');
  process.exit(2);
}
const SCENARIO = parseScenario(process.env['ACP_REAL_RUN_SCENARIO']);
if (SCENARIO === null) {
  console.error('Refusing: ACP_REAL_RUN_SCENARIO must be one of reviewer, lead.');
  process.exit(2);
}
const LIMIT_MS = Number(process.env['ACP_REAL_RUN_LIMIT_MS'] ?? String(20 * 60_000));
if (!Number.isFinite(LIMIT_MS) || LIMIT_MS <= 0) {
  console.error('Refusing: ACP_REAL_RUN_LIMIT_MS must be a positive number.');
  process.exit(2);
}
const KEEP = process.env['ACP_REAL_RUN_KEEP'] === '1';
const claudeModelEnv = process.env['ACP_REAL_RUN_CLAUDE_MODEL'];
const CLAUDE_MODEL =
  claudeModelEnv === undefined || claudeModelEnv.trim() === '' ? null : claudeModelEnv.trim();
const MODE = 'auto-edits';
const BUDGET = 80_000;
const ENDED = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

// ------------------------------------------------------------------ the temp root (under home)

const root = realpathSync(mkdtempSync(join(homedir(), '.acp-cx-real-run-')));
const dataDir = join(root, 'data');
const claudeDir = join(root, 'claude'); // empty: observation never sees the real ~/.claude
const parentDir = join(root, 'parent');
for (const d of [dataDir, claudeDir, parentDir]) mkdirSync(d, { recursive: true });
const logFile = join(dataDir, 'server.log');
writeFileSync(logFile, '');
console.error(`CX real run (${SCENARIO}): temp root ${root}`);

// ------------------------------------------------------------------ observing the Claude SDK

interface ClaudeOptionShape {
  kind: AgentRoleKind;
  model: string | null;
  permissionMode: string | null;
  sandbox: boolean;
  resume: boolean;
  init: { tools: number; model: string | null; permissionMode: string | null }[];
  results: { subtype: string; isError: boolean; reportedCostUsd: number | null }[];
  gate: Record<string, number>;
}
const claudeShapes: ClaudeOptionShape[] = [];
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// The SDK is a dependency of the adapter package, not of the server: resolve it from there.
const adapterEntry = fileURLToPath(import.meta.resolve('@acp/adapter-claude-code'));
const sdkPath = createRequire(adapterEntry).resolve('@anthropic-ai/claude-agent-sdk');
const sdk = (await import(pathToFileURL(sdkPath).href)) as { query: ManagedQueryFn };

let current: ManagedAgentSpec | undefined;
const observingQuery: ManagedQueryFn = (params) => {
  const o = params.options;
  const shape: ClaudeOptionShape = {
    kind: current?.kind ?? 'lead',
    model: o.model ?? null,
    permissionMode: o.permissionMode ?? null,
    sandbox: o.sandbox !== undefined,
    resume: o.resume !== undefined,
    init: [],
    results: [],
    gate: {},
  };
  claudeShapes.push(shape);
  // The real gate, counted by tool name and outcome only (never its input).
  const gate = o.canUseTool;
  if (gate !== undefined) {
    o.canUseTool = async (toolName, input, opts) => {
      const decision = await gate(toolName, input, opts);
      count(shape.gate, `${toolName}:${decision?.behavior ?? 'none'}`);
      return decision;
    };
  }
  const q = sdk.query(params);
  return {
    interrupt: () => q.interrupt(),
    close: () => q.close?.(),
    async *[Symbol.asyncIterator]() {
      for await (const m of q) {
        const msg = m as Record<string, unknown>;
        if (msg['type'] === 'system' && msg['subtype'] === 'init') {
          shape.init.push({
            tools: Array.isArray(msg['tools']) ? msg['tools'].length : 0,
            model: str(msg['model']),
            permissionMode: str(msg['permissionMode']),
          });
        }
        if (msg['type'] === 'result') {
          const cost = msg['total_cost_usd'];
          shape.results.push({
            subtype: str(msg['subtype']) ?? '',
            isError: msg['is_error'] === true,
            reportedCostUsd: typeof cost === 'number' ? cost : null,
          });
        }
        yield m;
      }
    },
  };
};
const realClaude = createManagedClaudeCode({
  query: observingQuery,
  env: managedAgentEnv(process.env),
});
const claudeAdapter: ManagedExecutionAdapter = {
  provider: 'claude-code',
  capabilities: realClaude.capabilities,
  start(spec, callbacks) {
    current = spec;
    try {
      return realClaude.start(spec, callbacks);
    } finally {
      current = undefined;
    }
  },
};

const starts: StartRecord[] = [];
const adapters = [
  observeManaged(claudeAdapter, starts),
  observeManaged(createManagedCodex({ env: process.env }), starts),
];

// ------------------------------------------------------------------ the server

const config = loadConfig({
  ACP_MODE: 'live',
  ACP_MANAGED: 'on',
  ACP_DATA_DIR: dataDir,
  ACP_CLAUDE_DIR: claudeDir,
  // Only for the config; the server listens on an ephemeral port below.
  ACP_PORT: '7793',
  ACP_POLL_INTERVAL_MS: '2000',
});
const server = await startServer({
  config,
  port: 0,
  logger: createLogger((line) => appendFileSync(logFile, `${line}\n`)),
  managedAdapters: adapters,
});
const base = `http://127.0.0.1:${server.port}`;
console.error(`CX real run: server on ${base} (open it to watch)`);

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let csrf = '';
async function call(method: string, path: string, body?: unknown): Promise<unknown> {
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
    // Only the method, status and code: an error message may quote agent text, a path an id.
    throw new HttpFailure(res.status, code, `${method} → ${res.status} ${code}`);
  }
  return text === '' ? null : (JSON.parse(text) as unknown);
}
const get = (path: string) => call('GET', path);
const post = (path: string, body: unknown = {}) => call('POST', path, body);
const put = (path: string, body: unknown) => call('PUT', path, body);
csrf = CsrfTokenDtoSchema.parse(await get('/api/control/token')).token;

const deadline = Date.now() + LIMIT_MS;
let interrupted = false;

let runId: string | null = null;
let stopping = false;
let serverClosed = false;
async function closeServer(): Promise<void> {
  if (serverClosed) return;
  serverClosed = true;
  await server.close();
}
async function stopAll(reason: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.error(`Stopping (${reason}).`);
  if (runId !== null && !serverClosed) {
    try {
      await post(`/api/runs/${runId}/stop`);
    } catch {
      // Already ended.
    }
  }
  await closeServer();
  if (KEEP) console.error(`Kept for inspection: ${root}`);
  else rmSync(root, { recursive: true, force: true });
}
process.once('SIGINT', () => {
  interrupted = true;
  void stopAll('Ctrl-C').finally(() => process.exit(130));
});

// ------------------------------------------------------------------ the flow

const flow = async (): Promise<Record<string, unknown>> => {
  const project = ProjectDtoSchema.parse(
    await post('/api/projects/new', {
      parentDir,
      name: `cx-${SCENARIO}`,
      readme: `# cx-${SCENARIO}\n\nA throwaway repository for one CX real run (synthetic).\n`,
    }),
  );
  const repo = project.rootPath;
  // The owner commits the harness on main (test-side git: argument arrays, isolated config).
  for (const [path, content] of Object.entries(HARNESS)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', 'Add the harness');
  const baseCommit = git(repo, 'rev-parse', 'main').trim();

  const p = `/api/projects/${project.id}`;
  await put(`${p}/setup`, {
    projectKey: 'CX',
    maxConcurrentHelpers: 1,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: BUDGET,
    model: null,
    approvals: { mode: MODE, commands: [] },
    contextFiles: [],
  });
  const saved = WorkflowGraphDtoSchema.parse(
    await put(`${p}/workflow-graph`, { graph: scenarioGraph(SCENARIO, CLAUDE_MODEL) }),
  );
  const graphIssues: Record<string, number> = {};
  for (const issue of saved.issues) count(graphIssues, `${issue.severity}:${issue.code}`);

  const ticket = TicketDtoSchema.parse(
    await post(`${p}/tickets`, { ...TICKET, type: 'feature', priority: 'medium', labels: [] }),
  );
  await post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
  const started = TicketDetailDtoSchema.parse(
    await post(`/api/tickets/${ticket.id}/start`, { approvalMode: MODE }),
  );
  const rid = started.currentRun?.id;
  if (rid === undefined) throw new Error('the ticket has no run');
  runId = rid;
  console.error('CX real run: run started');
  const detail = async (): Promise<RunDetailDto> =>
    RunDetailDtoSchema.parse(await get(`/api/runs/${rid}`));

  const denied: Record<string, number> = {};
  const ownerDecisions: Record<string, number> = {};
  const decided = new Set<string>();
  const tips = new Set<string>();
  const branchStates = new Set<string>();
  const outbox = new Map<string, AgentMessageMetaDto>();
  let outboxSeen = false;
  let planDecidedByDriver = false;
  let finalMerge: { status: 'merged' | 'refused'; code?: string } | null = null;
  let timedOut = false;

  for (;;) {
    if (Date.now() > deadline || interrupted) {
      timedOut = true;
      break;
    }
    const r = await detail();
    const kindOf = (id: string) => r.agents.find((a) => a.id === id)?.kind ?? 'unknown';
    if (r.outbox !== undefined) {
      outboxSeen = true;
      for (const m of r.outbox) outbox.set(m.id, m);
    }
    if (r.ticketBranch) {
      tips.add(r.ticketBranch.headCommit);
      branchStates.add(r.ticketBranch.state);
    }
    if (ENDED.has(r.status)) break;

    // The plan: the owner approves it.
    const t = TicketDetailDtoSchema.parse(await get(`/api/tickets/${ticket.id}`));
    const proposed = t.plans.find((x) => x.runId === rid && x.status === 'proposed');
    if (t.ticket.stage === 'PLAN_REVIEW' && proposed !== undefined) {
      try {
        await post(`/api/tickets/${ticket.id}/plans/${proposed.id}/decision`, {
          decision: 'approve',
        });
        planDecidedByDriver = true;
      } catch (error) {
        if (!(error instanceof HttpFailure) || error.status !== 409) throw error;
      }
    }

    // No human clicks: whatever still asks is denied (counted by provider-free role and tool).
    for (const a of r.approvals.filter((x) => x.status === 'pending')) {
      try {
        await post(`/api/approvals/${a.id}`, { decision: 'deny', message: 'Not in this run.' });
        count(denied, `${kindOf(a.agentRunId)}:${a.toolName ?? a.kind}`);
      } catch (error) {
        if (!(error instanceof HttpFailure) || error.status !== 409) throw error;
      }
    }

    // A change the lead handed to the owner: merge it when its checks passed, else discard.
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
        count(ownerDecisions, passed ? 'merge' : 'discard');
      } catch (error) {
        if (!(error instanceof HttpFailure) || error.code !== 'checks_running') throw error;
      }
    }

    // The owner's one merge of the ticket branch, once the run is in REVIEW. The server refuses
    // with `checks_running` until the required checks passed on the tip.
    if (r.status === 'REVIEW' && finalMerge === null) {
      try {
        await post(`/api/runs/${rid}/ticket-branch`, { action: 'merge' });
        finalMerge = { status: 'merged' };
        console.error('CX real run: the owner merged the ticket branch');
      } catch (error) {
        if (!(error instanceof HttpFailure)) throw error;
        if (error.code !== 'checks_running') {
          finalMerge = { status: 'refused', code: error.code };
          break; // a check failed or the base moved: the owner would decide by hand
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (timedOut) {
    console.error('CX real run: time limit or Ctrl-C; stopping the run');
    await post(`/api/runs/${rid}/stop`).catch(() => undefined);
  }

  // ---- the end state, aggregated
  const end = await detail();
  if (end.outbox !== undefined) for (const m of end.outbox) outbox.set(m.id, m);
  const tEnd = TicketDetailDtoSchema.parse(await get(`/api/tickets/${ticket.id}`));
  const plan = tEnd.plans.filter((x) => x.runId === rid).at(-1);
  const branch = end.ticketBranch ?? null;
  const mainNow = git(repo, 'rev-parse', 'main').trim();
  const branchLeft = branch === null ? '' : git(repo, 'branch', '--list', branch.branch).trim();
  const filesOnMain = TICKET_FILES.every((f) => {
    try {
      git(repo, 'cat-file', '-e', `main:${f}`);
      return true;
    } catch {
      return false;
    }
  });

  const reviews = (end.changes ?? []).flatMap((c) =>
    c.reviews.map((x) => ({ reviewer: x.reviewer, verdict: x.verdict })),
  );
  const changes = (end.changes ?? []).map((c) => ({
    state: c.state,
    reworkRounds: c.reworkRounds,
    changedFiles: c.changedFiles,
    checks: c.checks.map((k) => k.status),
    rounds: c.reviews.map((x) => ({
      round: x.round,
      reviewer: x.reviewer,
      verdict: x.verdict,
      decision: x.decision,
      decidedBy: x.decidedBy,
    })),
  }));

  // Texts that must never reach the log (or, for the diff, the database).
  const logs = readFileSync(logFile, 'utf8');
  const comments = tEnd.comments.map((c) => c.body).filter((b) => b.length >= 12);
  const diffLines = (branch?.state === 'merged' ? git(repo, 'diff', `${baseCommit}..main`) : '')
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++') && l.trim().length >= 16)
    .map((l) => l.slice(1));
  // Every agent has ended; the database is read once the server is closed.
  await closeServer();
  const db = openDatabase(config.databasePath);
  let usageRows: UsageRow[];
  try {
    usageRows = db.connection
      .prepare(
        'SELECT provider, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens ' +
          'FROM usage_records',
      )
      .all() as UsageRow[];
  } finally {
    db.close();
  }
  const dump = dumpDatabase(config.databasePath);
  const plannedText = [
    ...(plan?.steps ?? []).flatMap((s) => [s.title, s.detail]),
    ...end.agents.map((a) => a.task ?? ''),
  ];

  const codex = codexChecks(starts, { reviews, filesOnMain });
  const agentsCouldNotStart = end.agents.filter((a) =>
    (a.latestActivity ?? '').startsWith('Could not start:'),
  ).length;
  const assertions: Record<string, boolean> = {
    everyCodexAgentStarted: codex.allStarted,
    noAgentCouldNotStart: agentsCouldNotStart === 0,
    codexWorktreeReadable: codex.worktree.readable === true,
    planDecided: planDecidedByDriver || plan?.decidedBy === 'auto',
    reachedOwnerMerge:
      !timedOut &&
      (finalMerge as { status: string } | null)?.status === 'merged' &&
      end.status === 'COMPLETED' &&
      typeof branch?.mergedCommit === 'string' &&
      mainNow === branch.mergedCommit,
    ticketFilesOnMain: filesOnMain,
    codexUsageRecorded: (summarizeUsage(usageRows)['codex']?.records ?? 0) > 0,
    noPlanOrCommentTextInLog:
      !(plan !== undefined && logs.includes(plan.summary)) &&
      !comments.some((b) => logs.includes(b)),
    // A tiny ticket's plan may quote a line of code (CX real run 1: the test's import line).
    // Plan steps and agent tasks are stored by design (ADR-0016), so a diff line that the
    // owner-facing plan or a task already holds is not a stored diff.
    noDiffTextInDatabase: !diffLines.some(
      (l) => dump.includes(l) && !plannedText.some((t) => t.includes(l)),
    ),
  };
  if (SCENARIO === 'lead') {
    assertions['codexLeadUsedLeadTools'] = Object.keys(codex.leadTools).length > 0;
  }

  return {
    scenario: SCENARIO,
    ok: Object.values(assertions).every(Boolean),
    assertions,
    graphIssues,
    run: {
      status: end.status,
      ticketStatus: tEnd.ticket.status,
      timedOut,
      approvalMode: end.approvalMode ?? null,
      plan: { steps: plan?.steps.length ?? 0, decidedBy: plan?.decidedBy ?? null },
    },
    codex,
    usageRecordsByProvider: summarizeUsage(usageRows),
    outbox: { seenDuringRun: outboxSeen, ...outboxCounts(outbox) },
    changes,
    decisions: { owner: ownerDecisions, deniedRequests: denied },
    ticketBranch: {
      statesSeen: [...branchStates],
      tipMoves: Math.max(0, tips.size - 1),
      finalState: branch?.state ?? null,
      finalMerge,
      mainAtMergedCommit:
        typeof branch?.mergedCommit === 'string' && mainNow === branch.mergedCommit,
      branchDeleted: branchLeft === '',
    },
    agents: end.agents.map((a) => ({
      kind: a.kind,
      status: a.status,
      budgetUsed: a.budget.used,
      budgetLimit: a.budget.limit,
    })),
    startsByProvider: startsByProvider(starts),
    starts,
    claudeOptionShapes: claudeShapes,
    content: { logLines: logs.split('\n').length - 1, diffLinesChecked: diffLines.length },
  };
};

try {
  const summary = await flow();
  const text = JSON.stringify(summary, null, 2);
  if (KEEP) writeFileSync(join(dataDir, 'real-run-summary.json'), `${text}\n`);
  process.stdout.write(`${text}\n`);
  await stopAll('done');
  const failed = Object.entries(summary['assertions'] as Record<string, boolean>).filter(
    ([, ok]) => !ok,
  );
  if (failed.length > 0) {
    console.error(`Assertions failed: ${failed.map(([k]) => k).join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  // The driver's own errors and fetch failures carry no agent text; for anything else (a schema
  // error may quote a received value) only the name is printed.
  const plain =
    error instanceof HttpFailure ||
    (error instanceof Error && (error.name === 'Error' || error.name === 'TypeError'));
  console.error(plain ? error.message : error instanceof Error ? error.name : 'failed');
  process.stdout.write(`${JSON.stringify({ scenario: SCENARIO, error: true, starts }, null, 2)}\n`);
  await stopAll('error');
  process.exit(1);
}
