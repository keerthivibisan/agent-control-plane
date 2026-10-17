import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AgentRoleKind, ManagedAgentSpec, ManagedExecutionAdapter } from '@acp/core';
import {
  CSRF_HEADER,
  CsrfTokenDtoSchema,
  RunDetailDtoSchema,
  RunWorkflowDtoSchema,
  TicketBranchReviewDtoSchema,
  TicketDetailDtoSchema,
  type RunDetailDto,
} from '@acp/core/api';
import { createManagedClaudeCode, type ManagedQueryFn } from '@acp/adapter-claude-code';
import { startServer } from '../../../../src/bootstrap.js';
import { loadConfig } from '../../../../src/config.js';
import { managedAgentEnv } from '../../../../src/control/env.js';
import { createLogger } from '../../../../src/logger.js';
import { dumpDatabase, git } from '../../control/harness.js';

/*
 * RL-V REAL run driver for the review loop (docs/review-loop/wp/RL-V.md, "Real run plan").
 *
 * THIS STARTS REAL `claude` PROCESSES THROUGH THE AGENT SDK AND SPENDS TOKENS. It runs only when
 * the owner has consented in chat AND sets ACP_REAL_RUN=1; never in CI; never from `pnpm test`
 * (the file is not `*.test.ts`, so vitest does not collect it). Run it from packages/server:
 *
 *   ACP_REAL_RUN=1 node --conditions=development --import tsx \
 *     tests/verification/review-loop/real-run/drive.ts
 *
 * What it does: a throwaway git repo in a temp folder (with a tiny harness: one required check,
 * `node check.mjs`, which runs the repo's `test/*.test.mjs` with `node --test`), a separate
 * in-process server on an ephemeral 127.0.0.1 port (never 7420/5173), live mode with managed agents
 * on, a temp data dir and an EMPTY temp Claude dir for observation (the real ~/.claude is never
 * read). Through the same HTTP routes the UI uses (CSRF token included) it sets the project to
 * Auto edits, the review stage to a review agent with at most 2 rework rounds and a review skill
 * that asks for a test with each new module, turns the final code review on, and starts one ticket
 * designed for two helpers (a module and a command-line script that uses it). The ticket does not
 * mention tests, so a first-round rework is likely (not forced). The lead plans; the driver
 * approves the plan, denies every request that still asks (no human clicks), decides a change
 * the lead hands to the owner (merge when its checks passed, else discard), and, once the run is
 * in REVIEW and the tip's checks passed, performs the owner's final merge of the ticket branch.
 * It never nudges the lead unless ACP_REAL_RUN_NUDGE=1 (then at most once, after 4 idle minutes).
 *
 * What it records, aggregates only (never prompt, reply, thinking, finding, diff or tool input
 * text): per agent start, its role kind, review scope, rework flag, the SDK options' tool lists,
 * skills, `resume` and model; from each SDK `system/init` message, the tool and skill names; from
 * each result, its subtype, error flag and reported cost (estimated, never summed); the real
 * permission gate's decisions as (role, tool, outcome) counts; the approvals as (role, decided by,
 * rule, status) counts; each change's final state, rework rounds and its rounds as (reviewer,
 * verdict, decision, decided by); the ticket branch's states, how often its tip moved, and whether
 * main ends at the merged commit with the branch deleted; budgets per agent; and booleans for
 * "no plan, finding, note or diff text in the server log; no diff text in the database". The
 * summary goes to stdout and `<data dir>/real-run-summary.json`.
 *
 * Stop: Ctrl-C (or the overall time limit, ACP_REAL_RUN_LIMIT_MS, default 30 minutes) stops every
 * agent (`POST /api/runs/:id/stop`) and closes the server. Temp folders are kept for inspection
 * unless ACP_REAL_RUN_CLEANUP=1.
 */

if (process.env['ACP_REAL_RUN'] !== '1') {
  console.error('Refusing: this starts real Claude Code agents. Set ACP_REAL_RUN=1 after consent.');
  process.exit(2);
}
if (process.env['CI'] !== undefined) {
  console.error('Refusing: never in CI.');
  process.exit(2);
}

const LIMIT_MS = Number(process.env['ACP_REAL_RUN_LIMIT_MS'] ?? String(30 * 60_000));
const NUDGE = process.env['ACP_REAL_RUN_NUDGE'] === '1';
const BUDGET = 80_000;
const MAX_REWORK_ROUNDS = 2;

/** The synthetic harness: one required check that runs the repo's own `node:test` files. */
const HARNESS: Readonly<Record<string, string>> = {
  '.acp/harness.json': `${JSON.stringify(
    {
      version: 1,
      description: 'RL-V real run harness (synthetic)',
      checks: [
        {
          id: 'test',
          name: 'Unit tests',
          argv: ['node', 'check.mjs'],
          timeoutSec: 60,
          required: true,
        },
      ],
    },
    null,
    2,
  )}\n`,
  'check.mjs': [
    "import { existsSync, readdirSync } from 'node:fs';",
    "import { spawnSync } from 'node:child_process';",
    "const dir = 'test';",
    'const files = existsSync(dir)',
    "  ? readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => `${dir}/${f}`)",
    '  : [];',
    'if (files.length === 0) process.exit(0);',
    "const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });",
    'process.exit(r.status ?? 1);',
    '',
  ].join('\n'),
};

// ------------------------------------------------------------------ temp folders

const made: string[] = [];
const temp = (prefix: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
const dataDir = temp('acp-rlv-real-data-');
const claudeDir = temp('acp-rlv-real-claude-'); // empty: observation never sees the real ~/.claude
const parentDir = temp('acp-rlv-real-parent-');
const logFile = join(dataDir, 'server.log');
writeFileSync(logFile, '');

// ------------------------------------------------------------------ observing the SDK

interface Start {
  kind: AgentRoleKind;
  reviewScope: 'change' | 'final' | null;
  rework: boolean;
  followUp: boolean;
  options: {
    tools: unknown;
    disallowedTools: string[] | null;
    mcpServers: string[];
    skills: string[] | null;
    resume: string | null;
    model: string | null;
  };
  init: { tools: string[]; skills: string[]; model: string | null }[];
  results: { subtype: string; isError: boolean; reportedCostUsd: number | null }[];
  gate: Record<string, number>;
}
const starts: Start[] = [];

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap((x) => (typeof x === 'string' ? [x] : [])) : [];
/** Skill entries in `system/init` may be names or objects with a name. */
const names = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap((x) => {
        if (typeof x === 'string') return [x];
        const n = typeof x === 'object' && x !== null ? (x as { name?: unknown }).name : undefined;
        return typeof n === 'string' ? [n] : [];
      })
    : [];

// The SDK is a dependency of the adapter package, not of the server: resolve it from there.
const adapterEntry = fileURLToPath(import.meta.resolve('@acp/adapter-claude-code'));
const sdkPath = createRequire(adapterEntry).resolve('@anthropic-ai/claude-agent-sdk');
const sdk = (await import(pathToFileURL(sdkPath).href)) as { query: ManagedQueryFn };

let current: ManagedAgentSpec | undefined;
const observingQuery: ManagedQueryFn = (params) => {
  const spec = current;
  const o = params.options;
  const start: Start = {
    kind: spec?.kind ?? 'lead',
    reviewScope: spec?.reviewScope ?? null,
    rework: spec?.rework !== undefined,
    followUp: spec?.followUp !== undefined,
    options: {
      tools: o.tools ?? null,
      disallowedTools: o.disallowedTools ?? null,
      mcpServers: Object.keys(o.mcpServers ?? {}),
      skills: o.skills === undefined ? null : strings(o.skills),
      resume: o.resume === undefined ? null : 'set',
      model: o.model ?? null,
    },
    init: [],
    results: [],
    gate: {},
  };
  starts.push(start);
  // The real gate, counted by tool name and outcome only (never its input).
  const gate = o.canUseTool;
  if (gate !== undefined) {
    o.canUseTool = async (toolName, input, opts) => {
      const decision = await gate(toolName, input, opts);
      const key = `${toolName}:${decision?.behavior ?? 'none'}`;
      start.gate[key] = (start.gate[key] ?? 0) + 1;
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
          start.init.push({
            tools: strings(msg['tools']),
            skills: names(msg['skills']),
            model: str(msg['model']),
          });
        }
        if (msg['type'] === 'result') {
          const cost = msg['total_cost_usd'];
          start.results.push({
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
const real = createManagedClaudeCode({ query: observingQuery, env: managedAgentEnv(process.env) });
const adapter: ManagedExecutionAdapter = {
  provider: 'claude-code',
  start(spec, callbacks) {
    current = spec;
    try {
      return real.start(spec, callbacks);
    } finally {
      current = undefined;
    }
  },
};

// ------------------------------------------------------------------ the server

const config = loadConfig({
  ACP_MODE: 'live',
  ACP_MANAGED: 'on',
  ACP_DATA_DIR: dataDir,
  ACP_CLAUDE_DIR: claudeDir,
  // Only for the config; the server listens on an ephemeral port below.
  ACP_PORT: '7792',
  ACP_POLL_INTERVAL_MS: '2000',
});
const server = await startServer({
  config,
  port: 0,
  logger: createLogger((line) => appendFileSync(logFile, `${line}\n`)),
  managedAdapter: adapter,
});
const base = `http://127.0.0.1:${server.port}`;
console.error(`RL-V real run: server on ${base} (open it to watch); data ${dataDir}`);

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
    // Only the method, path, status and code: an error message may quote agent text.
    throw new HttpFailure(res.status, code, `${method} ${path} → ${res.status} ${code}`);
  }
  return text === '' ? null : (JSON.parse(text) as unknown);
}
const get = (path: string) => call('GET', path);
const post = (path: string, body: unknown = {}) => call('POST', path, body);
const put = (path: string, body: unknown) => call('PUT', path, body);
csrf = CsrfTokenDtoSchema.parse(await get('/api/control/token')).token;

const deadline = Date.now() + LIMIT_MS;
async function until<T>(what: string, check: () => Promise<T | undefined>): Promise<T> {
  for (;;) {
    const v = await check();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`time limit waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

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
  if (process.env['ACP_REAL_RUN_CLEANUP'] === '1') {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  } else console.error(`Kept for inspection: ${made.join(', ')}`);
}
process.once('SIGINT', () => void stopAll('Ctrl-C').finally(() => process.exit(130)));

const count = (into: Record<string, number>, key: string) => {
  into[key] = (into[key] ?? 0) + 1;
};

// ------------------------------------------------------------------ the flow

const flow = async (): Promise<Record<string, unknown>> => {
  const project = (await post('/api/projects/new', {
    parentDir,
    name: 'rlv-loop',
    readme: '# rlv-loop\n\nA throwaway repository for one RL-V review-loop run.\n',
  })) as { id: string; rootPath: string };
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
  // RL-V contract: approvals without the legacy allowlist.
  await put(`${p}/setup`, {
    projectKey: 'RLV',
    maxConcurrentHelpers: 2,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: BUDGET,
    model: null,
    approvals: { mode: 'auto-edits', commands: [] },
    contextFiles: [],
  });
  await post(`${p}/skills`, {
    name: 'review-tests',
    description: 'How to review one helper change.',
    instructions:
      'Approve a change only if every new .mjs module it adds has a matching test file ' +
      'test/<name>.test.mjs that uses node:test. Otherwise ask for rework and name the missing ' +
      'test files. Keep the findings to three short sentences.\n',
  });
  await post(`${p}/skills/review-tests/commit`);
  await put(`${p}/workflow`, {
    plannerMode: 'lead',
    stages: {
      plan: { model: null, skill: null },
      orchestrate: { model: null, skill: null },
      helpers: { model: null, skill: null },
      review: {
        requireChecks: true,
        reviewer: 'agent',
        maxReworkRounds: MAX_REWORK_ROUNDS,
        model: null,
        skill: 'review-tests',
        agent: null,
      },
      'code-review': { enabled: true, model: null, skill: null, agent: null },
      'unit-tests': { enabled: false, model: null, skill: null },
    },
  });

  const ticket = (await post(`${p}/tickets`, {
    title: 'Add a slugify module and a slug command',
    description:
      'Two independent parts, one helper each: (1) src/slug.mjs exporting slugify(text) that ' +
      'lowercases, trims and joins words with "-"; (2) bin/slug.mjs, a script that prints ' +
      'slugify(process.argv[2]). Keep both tiny.',
    type: 'feature',
    priority: 'medium',
    labels: [],
  })) as { id: string };
  await post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
  const started = TicketDetailDtoSchema.parse(
    await post(`/api/tickets/${ticket.id}/start`, {
      approvalMode: 'auto-edits',
      reviewer: 'agent',
      maxReworkRounds: MAX_REWORK_ROUNDS,
    }),
  );
  runId = started.currentRun?.id ?? null;
  if (runId === null) throw new Error('no run');
  const rid = runId;
  const detail = async (): Promise<RunDetailDto> =>
    RunDetailDtoSchema.parse(await get(`/api/runs/${rid}`));

  const plan = await until('the plan', async () => {
    const d = TicketDetailDtoSchema.parse(await get(`/api/tickets/${ticket.id}`));
    return d.ticket.stage === 'PLAN_REVIEW' ? d.plans.at(-1) : undefined;
  });
  const planShape = { steps: plan.steps.length, roles: plan.steps.map((s) => s.role) };
  await post(`/api/tickets/${ticket.id}/plans/${plan.id}/decision`, { decision: 'approve' });

  const denied: Record<string, number> = {};
  const ownerDecisions: Record<string, number> = {};
  const tips = new Set<string>();
  const branchStates = new Set<string>();
  const decided = new Set<string>();
  let nudged = false;
  let lastChange = Date.now();
  let lastShape = '';
  let finalMerge: { status: 'merged' | 'refused'; code?: string } | null = null;
  let tipFiles: number | null = null;

  await until('the run to complete', async () => {
    const r = await detail();
    const kindOf = (id: string) => r.agents.find((a) => a.id === id)?.kind ?? 'unknown';
    if (r.ticketBranch) {
      tips.add(r.ticketBranch.headCommit);
      branchStates.add(r.ticketBranch.state);
    }
    // No human clicks: whatever still asks is denied (counted by role and tool).
    for (const a of r.approvals.filter((x) => x.status === 'pending')) {
      await post(`/api/approvals/${a.id}`, { decision: 'deny', message: 'Not in this run.' });
      count(denied, `${kindOf(a.agentRunId)}:${a.toolName ?? a.kind}`);
    }
    if (r.status === 'COMPLETED' || r.status === 'FAILED' || r.status === 'CANCELLED') return true;
    // A change the lead handed to the owner: merge it when its checks passed, else discard.
    for (const c of r.changes ?? []) {
      if (c.state !== 'needs-owner' || decided.has(`${c.agentRunId}:${c.reworkRounds}`)) continue;
      const passed = c.checks.length > 0 && c.checks.every((k) => k.status === 'passed');
      try {
        await post(`/api/runs/${rid}/review`, {
          agentRunId: c.agentRunId,
          action: passed ? 'merge' : 'discard',
        });
        decided.add(`${c.agentRunId}:${c.reworkRounds}`);
        count(ownerDecisions, passed ? 'merge' : 'discard');
      } catch (error) {
        if (!(error instanceof HttpFailure) || error.code !== 'checks_running') throw error;
      }
    }
    // The owner's single merge once the run is in REVIEW. The server refuses with
    // `checks_running` until the required checks passed on the tip (it starts them if needed).
    if (r.status === 'REVIEW' && finalMerge === null) {
      const tb = TicketBranchReviewDtoSchema.parse(await get(`/api/runs/${rid}/ticket-branch`));
      tipFiles = tb.files.length;
      try {
        await post(`/api/runs/${rid}/ticket-branch`, { action: 'merge' });
        finalMerge = { status: 'merged' };
      } catch (error) {
        if (!(error instanceof HttpFailure)) throw error;
        if (error.code === 'checks_running') return undefined; // next poll
        finalMerge = { status: 'refused', code: error.code };
        return true; // a check failed or the base moved: the owner decides by hand
      }
    }
    // Nudge-free by default; record a stall instead.
    const shape = JSON.stringify([r.status, r.changes?.map((c) => c.state), r.agents.length]);
    if (shape !== lastShape) {
      lastShape = shape;
      lastChange = Date.now();
    }
    if (NUDGE && !nudged && r.status === 'RUNNING' && Date.now() - lastChange > 4 * 60_000) {
      nudged = true;
      await post(`/api/runs/${rid}/chat`, {
        text: 'Every helper has stopped. Decide the open changes, then request review.',
      });
    }
    return undefined;
  });

  const end = await detail();
  const roles = new Map(end.agents.map((a) => [a.id, a.kind]));
  const stagesAtEnd = Object.fromEntries(
    RunWorkflowDtoSchema.parse(await get(`/api/runs/${rid}/workflow`)).stages.map((s) => [
      s.stage,
      s.state,
    ]),
  );
  const ticketAtEnd = TicketDetailDtoSchema.parse(await get(`/api/tickets/${ticket.id}`));
  const approvals: Record<string, number> = {};
  for (const a of end.approvals) {
    count(
      approvals,
      `${roles.get(a.agentRunId) ?? 'unknown'}:${a.decidedBy ?? 'none'}:${a.allowRule ?? '-'}:${a.status}`,
    );
  }
  const branch = end.ticketBranch ?? null;
  const mainNow = git(repo, 'rev-parse', 'main').trim();
  const branchLeft = branch === null ? '' : git(repo, 'branch', '--list', branch.branch).trim();

  // Texts that must never reach the log (or, for the diff, the database). Findings and notes
  // are ticket comments by design (ADR-0021 §6), so they are only checked against the log.
  const logs = readFileSync(logFile, 'utf8');
  const commentBodies = ticketAtEnd.comments.map((c) => c.body).filter((b) => b.length >= 12);
  const diffLines = (branch?.state === 'merged' ? git(repo, 'diff', `${baseCommit}..main`) : '')
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++') && l.trim().length >= 16)
    .map((l) => l.slice(1));
  // Every agent has ended (the run completed); the database is read once the server is closed.
  await closeServer();
  const db = dumpDatabase(config.databasePath);

  return {
    run: {
      status: end.status,
      ticketStatus: ticketAtEnd.ticket.status,
      approvalMode: end.approvalMode ?? null,
      reviewer: end.reviewer ?? null,
      maxReworkRounds: end.maxReworkRounds ?? null,
      stages: stagesAtEnd,
      plan: planShape,
      nudged,
    },
    changes: (end.changes ?? []).map((c) => ({
      role: c.role,
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
        hasComment: x.commentId !== null,
      })),
    })),
    decisions: { owner: ownerDecisions, deniedRequests: denied },
    approvals,
    ticketBranch: {
      name: branch?.branch ?? null,
      statesSeen: [...branchStates],
      tipMoves: Math.max(0, tips.size - 1),
      finalState: branch?.state ?? null,
      finalMerge,
      filesOnTip: tipFiles,
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
    starts,
    content: {
      logLines: logs.split('\n').length - 1,
      logHasPlanSummary: logs.includes(plan.summary),
      logHasCommentText: commentBodies.some((b) => logs.includes(b)),
      logHasDiffLine: diffLines.some((l) => logs.includes(l)),
      dbHasDiffLine: diffLines.some((l) => db.includes(l)),
      diffLinesChecked: diffLines.length,
    },
  };
};

try {
  const summary = await flow();
  const text = JSON.stringify(summary, null, 2);
  writeFileSync(join(dataDir, 'real-run-summary.json'), `${text}\n`);
  console.error(text);
  await stopAll('done');
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'failed');
  writeFileSync(join(dataDir, 'real-run-summary.json'), `${JSON.stringify({ starts }, null, 2)}\n`);
  await stopAll('error');
  process.exit(1);
}
