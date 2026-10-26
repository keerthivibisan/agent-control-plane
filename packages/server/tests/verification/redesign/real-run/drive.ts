import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AgentRoleKind, ManagedAgentSpec, ManagedExecutionAdapter } from '@acp/core';
import {
  CSRF_HEADER,
  CsrfTokenDtoSchema,
  ReviewDtoSchema,
  RunDetailDtoSchema,
  RunWorkflowDtoSchema,
  TicketDetailDtoSchema,
  type RunDetailDto,
} from '@acp/core/api';
import { createManagedClaudeCode, type ManagedQueryFn } from '@acp/adapter-claude-code';
import { startServer } from '../../../../src/bootstrap.js';
import { loadConfig } from '../../../../src/config.js';
import { managedAgentEnv } from '../../../../src/control/env.js';
import { createLogger } from '../../../../src/logger.js';

/*
 * R-V REAL smoke-run driver (docs/redesign/wp/R-V.md at tag v0.3.0, "Real run plan for owner
 * consent").
 *
 * THIS STARTS REAL `claude` PROCESSES THROUGH THE AGENT SDK AND SPENDS TOKENS. It runs only when
 * the owner has consented in chat AND sets ACP_REAL_RUN=1; never in CI; never from `pnpm test`
 * (the file is not `*.test.ts`, so vitest does not collect it). Run it from packages/server:
 *
 *   ACP_REAL_RUN=1 node --conditions=development --import tsx \
 *     tests/verification/redesign/real-run/drive.ts
 *
 * What it does: a throwaway git repo in a temp folder, a separate in-process server on an
 * ephemeral 127.0.0.1 port (never 7420/5173), live mode with managed agents on, a temp data dir and
 * an EMPTY temp Claude dir for observation (the real ~/.claude is never read). It drives one tiny
 * ticket through the same HTTP routes the UI uses (CSRF token included): a separate planner with a
 * stage skill, a lead, one helper, merge, a final code review whose agent file lists `Read, Bash`,
 * the unit-tests stage, merge, Done, then one follow-up question to the ended lead.
 *
 * What it records, aggregates only (never prompt, reply, thinking or tool input text): per agent
 * start, the SDK options' tool lists, plugin/skill names, `resume`/`forkSession`, the model, and
 * whether the stage agent-file heading is in the system prompt append (a boolean and a byte count);
 * from each SDK `system/init` message, the session id, the tool names and the skill names; from
 * each result, its subtype, error flag and the reported cost (estimated, never summed); the real
 * permission gate's decisions as (role, tool, allow/deny) counts. Boolean "markers" check that the
 * skill and the agent file reached the agents (their text asks for a marker word), without
 * printing what the agents wrote. The summary goes to stdout and `<data dir>/real-run-summary.json`.
 *
 * Stop: Ctrl-C (or the overall time limit) stops every agent (`POST /api/runs/:id/stop`) and
 * closes the server. Temp folders are kept for inspection unless ACP_REAL_RUN_CLEANUP=1.
 */

if (process.env['ACP_REAL_RUN'] !== '1') {
  console.error('Refusing: this starts real Claude Code agents. Set ACP_REAL_RUN=1 after consent.');
  process.exit(2);
}
if (process.env['CI'] !== undefined) {
  console.error('Refusing: never in CI.');
  process.exit(2);
}

const LIMIT_MS = Number(process.env['ACP_REAL_RUN_LIMIT_MS'] ?? String(20 * 60_000));
const BUDGET = 60_000;
const MARK = { skill: 'RV-SKILL-OK', profile: 'RV-PROFILE-OK' } as const;
const FOLLOW_UP = 'In one sentence: which file did the helper add?';

// ------------------------------------------------------------------ temp folders and git

const made: string[] = [];
const temp = (prefix: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
const dataDir = temp('acp-rv-real-data-');
const claudeDir = temp('acp-rv-real-claude-'); // empty: observation never sees the real ~/.claude
const parentDir = temp('acp-rv-real-parent-');
const logFile = join(dataDir, 'server.log');
writeFileSync(logFile, '');

// ------------------------------------------------------------------ observing the SDK

interface Start {
  kind: AgentRoleKind;
  followUp: boolean;
  options: {
    tools: unknown;
    disallowedTools: string[] | null;
    allowedToolsSet: boolean;
    mcpServers: string[];
    plugins: number;
    skills: string[] | null;
    resume: string | null;
    forkSession: boolean | null;
    model: string | null;
    settingSources: unknown;
    agentFileHeading: boolean;
    appendBytes: number;
  };
  init: { sessionId: string; tools: string[]; skills: string[]; model: string | null }[];
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
  const sp = o.systemPrompt;
  const append =
    sp !== undefined && typeof sp === 'object' && !Array.isArray(sp) && 'append' in sp
      ? (str(sp.append) ?? '')
      : '';
  const start: Start = {
    kind: spec?.kind ?? 'lead',
    followUp: spec?.followUp !== undefined,
    options: {
      tools: o.tools ?? null,
      disallowedTools: o.disallowedTools ?? null,
      allowedToolsSet: o.allowedTools !== undefined,
      mcpServers: Object.keys(o.mcpServers ?? {}),
      plugins: (o.plugins ?? []).length,
      skills: o.skills === undefined ? null : strings(o.skills),
      resume: o.resume ?? null,
      forkSession: o.forkSession ?? null,
      model: o.model ?? null,
      settingSources: o.settingSources ?? null,
      agentFileHeading: append.includes('=== Stage agent file'),
      appendBytes: Buffer.byteLength(append, 'utf8'),
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
            sessionId: str(msg['session_id']) ?? '',
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
  ACP_PORT: '7791',
  ACP_POLL_INTERVAL_MS: '2000',
});
const server = await startServer({
  config,
  port: 0,
  logger: createLogger((line) => appendFileSync(logFile, `${line}\n`)),
  managedAdapter: adapter,
});
const base = `http://127.0.0.1:${server.port}`;
console.error(`R-V real run: server on ${base} (open it to watch); data ${dataDir}`);

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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
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
async function stopAll(reason: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.error(`Stopping (${reason}).`);
  if (runId !== null) {
    try {
      await post(`/api/runs/${runId}/stop`);
    } catch {
      // Already ended.
    }
  }
  await server.close();
  if (process.env['ACP_REAL_RUN_CLEANUP'] === '1') {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  } else console.error(`Kept for inspection: ${made.join(', ')}`);
}
process.once('SIGINT', () => void stopAll('Ctrl-C').finally(() => process.exit(130)));

// ------------------------------------------------------------------ the flow

const run = async (): Promise<Record<string, unknown>> => {
  const project = (await post('/api/projects/new', {
    parentDir,
    name: 'rv-smoke',
    readme: '# rv-smoke\n\nA throwaway repository for one R-V smoke run.\n',
  })) as { id: string; rootPath: string };
  const p = `/api/projects/${project.id}`;
  await put(`${p}/setup`, {
    projectKey: 'RV',
    maxConcurrentHelpers: 1,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: BUDGET,
    model: null,
    // Writes in an agent's own worktree need no click; anything else is denied below.
    allowlist: { editInOwnWorktree: true, runHarnessChecks: false },
    contextFiles: [],
  });
  await post(`${p}/skills`, {
    name: 'plan-small',
    description: 'How to plan a tiny ticket.',
    instructions: `Keep the plan to one step for one helper. End the plan summary with the word ${MARK.skill}.\n`,
  });
  await post(`${p}/skills/plan-small/commit`);
  await post(`${p}/agents`, {
    name: 'strict-reviewer',
    description: 'Reviews the merged change.',
    tools: ['Read', 'Bash'],
    model: null,
    instructions: `Review only by reading files. Begin your finding with the word ${MARK.profile}.\n`,
  });
  await post(`${p}/agents/strict-reviewer/commit`);
  await put(`${p}/workflow`, {
    plannerMode: 'separate',
    stages: {
      plan: { model: null, skill: 'plan-small' },
      orchestrate: { model: null, skill: null },
      helpers: { model: null, skill: null },
      review: { requireChecks: true },
      'code-review': { enabled: true, model: null, skill: null, agent: 'strict-reviewer' },
      'unit-tests': { enabled: true, model: null, skill: null },
    },
  });

  const ticket = (await post(`${p}/tickets`, {
    title: 'Add a greet function',
    description:
      'Create greet.mjs that exports greet(name) returning "Hello, <name>!". One helper is enough.',
    type: 'feature',
    priority: 'medium',
    labels: [],
  })) as { id: string };
  await post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
  const started = TicketDetailDtoSchema.parse(await post(`/api/tickets/${ticket.id}/start`));
  runId = started.currentRun?.id ?? null;
  if (runId === null) throw new Error('no run');
  const rid = runId;
  const detail = async (): Promise<RunDetailDto> =>
    RunDetailDtoSchema.parse(await get(`/api/runs/${rid}`));
  const stages = async () =>
    Object.fromEntries(
      RunWorkflowDtoSchema.parse(await get(`/api/runs/${rid}/workflow`)).stages.map((s) => [
        s.stage,
        s.state,
      ]),
    );

  // Anything not settled by the gate or the allowlist is denied (no human clicks in this run).
  const denyPending = async (r: RunDetailDto) => {
    for (const a of r.approvals.filter((x) => x.status === 'pending')) {
      await post(`/api/approvals/${a.id}`, { decision: 'deny', message: 'Not in this smoke run.' });
    }
  };

  const plan = await until('the plan', async () => {
    const d = TicketDetailDtoSchema.parse(await get(`/api/tickets/${ticket.id}`));
    return d.ticket.stage === 'PLAN_REVIEW' ? d.plans.at(-1) : undefined;
  });
  const skillMarkerInPlan = plan.summary.includes(MARK.skill);
  await post(`/api/tickets/${ticket.id}/plans/${plan.id}/decision`, { decision: 'approve' });

  let nudged = false;
  const reviewStarted = Date.now();
  const merged = new Set<string>();
  await until('the run to complete', async () => {
    const r = await detail();
    await denyPending(r);
    if (r.status === 'COMPLETED' || r.status === 'FAILED' || r.status === 'CANCELLED') return true;
    // P3-F: the lead may need a nudge to request review once its helper is done.
    const helperDone = r.agents.some((a) => a.kind === 'worker' && a.status === 'SUCCEEDED');
    if (r.status === 'RUNNING' && helperDone && !nudged && Date.now() - reviewStarted > 60_000) {
      nudged = true;
      await post(`/api/runs/${rid}/chat`, {
        text: 'The helper is done. Please request review now.',
      });
    }
    if (r.status === 'REVIEW') {
      const review = ReviewDtoSchema.parse(await get(`/api/runs/${rid}/review`));
      for (const a of review.agents.filter(
        (x) => x.state === 'pending' && !merged.has(x.agentRunId),
      )) {
        try {
          await post(`/api/runs/${rid}/review`, { agentRunId: a.agentRunId, action: 'merge' });
          merged.add(a.agentRunId);
        } catch (error) {
          // checks_running right after entering review: try again on the next poll.
          if (!String(error).includes('checks_running')) throw error;
        }
      }
    }
    return undefined;
  });
  const completed = await detail();
  const stagesAtEnd = await stages();
  const ticketAtEnd = TicketDetailDtoSchema.parse(await get(`/api/tickets/${ticket.id}`));
  const reviewerComments = ticketAtEnd.comments.filter((c) => c.author === 'reviewer');

  // ---- One follow-up question to the ended lead.
  const leadBefore = completed.agents.find((a) => a.kind === 'lead');
  await post(`/api/runs/${rid}/chat`, { text: FOLLOW_UP });
  await until('the follow-up turn to end', async () => {
    const r = await detail();
    return r.followUp?.state !== 'running' ? r : undefined;
  });
  const after = await detail();
  const leadAfter = after.agents.find((a) => a.kind === 'lead');
  const leadFirst = starts.find((s) => s.kind === 'lead' && !s.followUp);
  const turn = starts.find((s) => s.followUp);
  const logs = (await import('node:fs')).readFileSync(logFile, 'utf8');

  return {
    run: {
      status: completed.status,
      ticketStatus: ticketAtEnd.ticket.status,
      stages: stagesAtEnd,
      nudgedForReview: nudged,
      merged: merged.size,
    },
    agents: completed.agents.map((a) => ({
      kind: a.kind,
      status: a.status,
      budgetUsed: a.budget.used,
    })),
    starts,
    markers: {
      skillMarkerInPlanSummary: skillMarkerInPlan,
      profileMarkerInReviewerComment: reviewerComments.some((c) => c.body.includes(MARK.profile)),
      reviewerComments: reviewerComments.length,
    },
    followUp: {
      state: after.followUp?.state ?? null,
      reason: after.followUp?.reason ?? null,
      replyStored: after.messages.some((m) => m.role === 'lead' && m.followUp === true),
      resumeEqualsLeadSession:
        turn?.options.resume !== undefined &&
        turn.options.resume === (leadFirst?.init[0]?.sessionId ?? null),
      initSessionEqualsLeadSession:
        (turn?.init[0]?.sessionId ?? null) === (leadFirst?.init[0]?.sessionId ?? null),
      runStatusUnchanged: after.status === completed.status,
      leadRecordUnchanged:
        JSON.stringify([leadBefore?.status, leadBefore?.endedAt, leadBefore?.budget.used]) ===
        JSON.stringify([leadAfter?.status, leadAfter?.endedAt, leadAfter?.budget.used]),
    },
    logs: {
      lines: logs.split('\n').length - 1,
      containFollowUpQuestion: logs.includes(FOLLOW_UP),
      containPlanSummary: logs.includes(plan.summary),
    },
  };
};

try {
  const summary = await run();
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
