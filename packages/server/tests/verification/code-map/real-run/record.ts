import {
  workflowTemplate,
  type AgentEffort,
  type ManagedAgentEvent,
  type ManagedExecutionAdapter,
  type ManagedProviderId,
  type TokenCounts,
  type WorkflowGraph,
  type WorkflowNode,
} from '@acp/core';

/*
 * The CM-5 measurement driver's pure parts (`drive.ts` is the command line that spends tokens):
 * the env parsing, the arm schedule, the tickets and harness, the graph, a usage recorder around
 * any managed adapter, and the medians and deltas of the summary. Nothing here starts a process or
 * reads a file, so `drive.test.ts` covers it with fakes only.
 *
 * Every record is content-free: roles, providers, models, counts, durations and token sums. Never
 * a prompt, reply, finding, diff, path list or tool input.
 */

export const ARMS = ['on', 'off'] as const;
export type Arm = (typeof ARMS)[number];
export const TICKET_IDS = ['A', 'B'] as const;
export type TicketId = (typeof TICKET_IDS)[number];
export const PROVIDERS = ['claude-code', 'codex'] as const;
/** Only cheap efforts: a measurement must not burn high-effort tokens (owner, CM-5). */
export const EFFORTS = ['low', 'medium'] as const satisfies readonly AgentEffort[];
export type DriveEffort = (typeof EFFORTS)[number];

export const DEFAULT_MODELS: Readonly<Record<ManagedProviderId, string>> = {
  'claude-code': 'haiku',
  codex: 'gpt-6-luna',
};
export const DEFAULT_LIMIT_MS = 15 * 60_000;
export const MAX_REPEATS = 10;

export interface Ticket {
  title: string;
  description: string;
  /** A repository file the ticket must change on `main` for the run to count as a success. */
  expectedFile: string;
}

/**
 * Two small tickets that need discovery in an unfamiliar codebase (ACP itself) but stay cheap.
 * Fixed texts, so every arm and repeat gets exactly the same work.
 */
export const TICKETS: Readonly<Record<TicketId, Ticket>> = {
  A: {
    title: 'Add isManagedProvider',
    description:
      'Add an exported function `isManagedProvider(id: string): boolean` next to the managed ' +
      'provider schema in the core package, returning true for the managed providers, with a ' +
      'unit test in the same style as the neighbouring tests.',
    expectedFile: 'packages/core/src/domain/provider.ts',
  },
  B: {
    title: 'Explain the missing cost text',
    description:
      "The Tokens page shows 'Not reported' for a missing cost. Find where that text is defined " +
      'and add a short comment above it explaining that cost is unavailable for providers that ' +
      'do not report it (ADR-0032).',
    expectedFile: 'packages/web/src/lib/copy.ts',
  },
};

/**
 * The harness the owner commits on `main` of the copy: one cheap, real check that needs no
 * `pnpm install`. It runs `git diff --check` from the merge base with `main` (whitespace errors
 * and conflict markers in what the ticket changed); on `main` itself it checks the working tree.
 */
export const HARNESS_FILES: Readonly<Record<string, string>> = {
  '.acp/harness.json': `${JSON.stringify(
    {
      version: 1,
      description: 'CM-5 measurement harness (synthetic)',
      checks: [
        {
          id: 'diff-check',
          name: 'git diff --check',
          argv: ['node', '.acp/cm5-check.mjs'],
          timeoutSec: 60,
          required: true,
        },
      ],
    },
    null,
    2,
  )}\n`,
  '.acp/cm5-check.mjs': [
    "import { spawnSync } from 'node:child_process';",
    "const base = spawnSync('git', ['merge-base', 'HEAD', 'main'], { encoding: 'utf8' });",
    "const from = base.status === 0 ? base.stdout.trim() : 'HEAD';",
    "const r = spawnSync('git', ['diff', '--check', from], { stdio: 'inherit' });",
    'process.exit(r.status ?? 1);',
    '',
  ].join('\n'),
};

// ------------------------------------------------------------------ env

export interface DriveSettings {
  provider: ManagedProviderId;
  model: string;
  effort: DriveEffort;
  arms: Arm[];
  repeats: number;
  tickets: TicketId[];
  limitMs: number;
  keep: boolean;
  /** The commit of this repository the copy is cloned at (a commit id). */
  commit: string;
}

export type ParsedSettings = { ok: true; settings: DriveSettings } | { ok: false; error: string };

function list<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): T[] | string {
  if (value === undefined || value.trim() === '') return [...allowed];
  const items = value.split(',').map((s) => s.trim());
  const bad = items.filter((s) => !(allowed as readonly string[]).includes(s));
  if (bad.length > 0 || items.length === 0) return `${name} must be a list of ${allowed.join(',')}`;
  if (new Set(items).size !== items.length) return `${name} must not repeat an item`;
  return items as T[];
}

/**
 * The driver's settings from its environment. Refuses (never clamps) a value outside the
 * measurement's limits: an unknown provider, effort `high`, a bad list, repeats or time limit.
 * `headCommit` is the worktree's HEAD, the default for ACP_REAL_RUN_COMMIT.
 */
export function parseSettings(
  env: Readonly<Record<string, string | undefined>>,
  headCommit: string,
): ParsedSettings {
  const fail = (error: string): ParsedSettings => ({ ok: false, error });
  const provider = env['ACP_REAL_RUN_PROVIDER']?.trim() || 'claude-code';
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    return fail(`ACP_REAL_RUN_PROVIDER must be one of ${PROVIDERS.join(', ')}`);
  }
  const p = provider as ManagedProviderId;
  const model = env['ACP_REAL_RUN_MODEL']?.trim() || DEFAULT_MODELS[p];
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model)) {
    return fail('ACP_REAL_RUN_MODEL must be one model id');
  }
  const effort = env['ACP_REAL_RUN_EFFORT']?.trim() || 'low';
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    return fail(`ACP_REAL_RUN_EFFORT must be one of ${EFFORTS.join(', ')} (never higher)`);
  }
  const arms = list(env['ACP_REAL_RUN_ARMS'], ARMS, 'ACP_REAL_RUN_ARMS');
  if (typeof arms === 'string') return fail(arms);
  const tickets = list(env['ACP_REAL_RUN_TICKETS'], TICKET_IDS, 'ACP_REAL_RUN_TICKETS');
  if (typeof tickets === 'string') return fail(tickets);
  const repeatsText = env['ACP_REAL_RUN_REPEATS']?.trim() || '1';
  const repeats = Number(repeatsText);
  if (!/^\d+$/.test(repeatsText) || repeats < 1 || repeats > MAX_REPEATS) {
    return fail(`ACP_REAL_RUN_REPEATS must be a whole number from 1 to ${MAX_REPEATS}`);
  }
  const limitText = env['ACP_REAL_RUN_LIMIT_MS']?.trim() || String(DEFAULT_LIMIT_MS);
  const limitMs = Number(limitText);
  if (!/^\d+$/.test(limitText) || limitMs <= 0) {
    return fail('ACP_REAL_RUN_LIMIT_MS must be a positive whole number');
  }
  const commit = env['ACP_REAL_RUN_COMMIT']?.trim() || headCommit;
  if (!/^[0-9a-f]{7,64}$/.test(commit)) {
    return fail('ACP_REAL_RUN_COMMIT must be a commit id (hex)');
  }
  return {
    ok: true,
    settings: {
      provider: p,
      model,
      effort: effort as DriveEffort,
      arms,
      repeats,
      tickets,
      limitMs,
      keep: env['ACP_REAL_RUN_KEEP'] === '1',
      commit,
    },
  };
}

// ------------------------------------------------------------------ the schedule

export interface Slot {
  repeat: number;
  ticket: TicketId;
  arm: Arm;
}

/**
 * Every run in order: per repeat, per ticket, each arm. The arm order alternates per repeat
 * (repeat 0 as given, repeat 1 reversed, ...) so neither arm always runs first.
 */
export function schedule(settings: Pick<DriveSettings, 'repeats' | 'tickets' | 'arms'>): Slot[] {
  const out: Slot[] = [];
  for (let repeat = 0; repeat < settings.repeats; repeat++) {
    const arms = repeat % 2 === 0 ? settings.arms : [...settings.arms].reverse();
    for (const ticket of settings.tickets) {
      for (const arm of arms) out.push({ repeat, ticket, arm });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the graph

/**
 * The `lead-only` template (lead plus helpers; the lead reviews changes itself: no change review,
 * no final review) with every agent node on the chosen provider, model and effort.
 */
export function measureGraph(
  settings: Pick<DriveSettings, 'provider' | 'model' | 'effort'>,
): WorkflowGraph {
  const base = workflowTemplate('lead-only');
  const nodes = base.nodes.map((n): WorkflowNode => {
    if (n.type !== 'lead' && n.type !== 'helper-pool') return n;
    return { ...n, provider: settings.provider, model: settings.model, effort: settings.effort };
  });
  return { ...base, template: 'custom', nodes };
}

// ------------------------------------------------------------------ usage per agent

export interface TokenSums {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  /** Per category, the responses that did not report it (`unavailable`, never counted as 0). */
  unavailable: { input: number; output: number; cacheCreation: number; cacheRead: number };
}

export function emptySums(): TokenSums {
  return {
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
    unavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
  };
}

const CATEGORIES = ['input', 'output', 'cacheCreation', 'cacheRead'] as const;

export function addTokens(into: TokenSums, t: TokenCounts): void {
  for (const k of CATEGORIES) {
    const v = t[k];
    if (v === null) into.unavailable[k]++;
    else into[k] += v;
  }
}

/** Adds `from` (sums and unavailable counts) into `into`. */
export function mergeSums(into: TokenSums, from: TokenSums): void {
  for (const k of CATEGORIES) {
    into[k] += from[k];
    into.unavailable[k] += from.unavailable[k];
  }
}

export interface AgentUsage {
  provider: ManagedProviderId;
  /** Distinct model responses (usage message ids): a content-free stand-in for turns. */
  responses: number;
  tokens: TokenSums;
}

/**
 * Usage per agent run from the adapter's `usage` events, deduplicated by message id with the
 * observation of the most output kept (usage-accounting §4: never sum snapshots).
 */
export class UsageRecorder {
  private readonly seen = new Map<string, Map<string, TokenCounts>>();
  private readonly providers = new Map<string, ManagedProviderId>();

  observe(agentRunId: string, provider: ManagedProviderId, e: ManagedAgentEvent): void {
    if (e.type !== 'usage') return;
    this.providers.set(agentRunId, provider);
    let byMessage = this.seen.get(agentRunId);
    if (byMessage === undefined)
      this.seen.set(agentRunId, (byMessage = new Map<string, TokenCounts>()));
    const prior = byMessage.get(e.messageId);
    if (prior === undefined || (e.tokens.output ?? -1) > (prior.output ?? -1)) {
      byMessage.set(e.messageId, e.tokens);
    }
  }

  of(agentRunId: string): AgentUsage | null {
    const byMessage = this.seen.get(agentRunId);
    const provider = this.providers.get(agentRunId);
    if (byMessage === undefined || provider === undefined) return null;
    const tokens = emptySums();
    for (const t of byMessage.values()) addTokens(tokens, t);
    return { provider, responses: byMessage.size, tokens };
  }

  clear(): void {
    this.seen.clear();
    this.providers.clear();
  }
}

/** `inner` with every agent's usage events recorded; behaviour unchanged. */
export function recordUsage(
  inner: ManagedExecutionAdapter,
  recorder: UsageRecorder,
): ManagedExecutionAdapter {
  const check = inner.checkAvailable?.bind(inner);
  return {
    provider: inner.provider,
    capabilities: inner.capabilities,
    ...(check !== undefined && { checkAvailable: check }),
    start(spec, callbacks) {
      const handle = inner.start(spec, callbacks);
      return {
        send: (text) => handle.send(text),
        interrupt: () => handle.interrupt(),
        abort: () => handle.abort(),
        events: {
          async *[Symbol.asyncIterator]() {
            for await (const e of handle.events) {
              recorder.observe(spec.agentRunId, inner.provider, e);
              yield e;
            }
          },
        },
      };
    },
  };
}

export interface UsageRecordRow {
  provider: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
}

/** `usage_records` of one provider summed per category, with null counts (ADR-0032 Codex usage). */
export function sumUsageRecords(
  rows: readonly UsageRecordRow[],
  provider: string,
): TokenSums & { records: number } {
  const sums = emptySums();
  let records = 0;
  for (const r of rows) {
    if (r.provider !== provider) continue;
    records++;
    addTokens(sums, {
      input: r.input_tokens,
      output: r.output_tokens,
      cacheCreation: r.cache_creation_tokens,
      cacheRead: r.cache_read_tokens,
    });
  }
  return { ...sums, records };
}

// ------------------------------------------------------------------ one run's record

export interface ToolCounts {
  read: number;
  search: number;
  edit: number;
  shell: number;
  code_map: number;
  other: number;
}

export interface AgentRecord {
  role: string;
  provider: string;
  model: string;
  status: string;
  toolCounts: ToolCounts | null;
  budgetUsed: number;
  durationMs: number | null;
  /** Distinct model responses; null when the adapter reported no usage. */
  responses: number | null;
  tokens: TokenSums | null;
}

export interface IndexCost {
  buildMs: number;
  files: number;
  indexed: number;
  symbols: number;
  dbBytes: number;
}

export interface RunRecord extends Slot {
  provider: string;
  model: string;
  effort: string;
  wallMs: number;
  outcome: {
    runStatus: string;
    timedOut: boolean;
    /** The ticket's expected file changed on `main` after the owner's merge. */
    ticketFileChanged: boolean;
    changedFilesOnMain: number;
    checksPassed: boolean | null;
    finalMerge: string | null;
  };
  /** The `on` arm's map build before the ticket; null for `off`. */
  index: IndexCost | null;
  startingPoints: {
    steps: number;
    stepsWithFiles: number;
    files: number;
    /** Step files with no entry in the run's map; null without a map (the `off` arm). */
    notFoundInMap: number | null;
  };
  agents: AgentRecord[];
  /** Usage from the adapters' events, all agents. */
  tokens: TokenSums;
  /** Codex `usage_records` summed (ADR-0032); null for Claude runs (observed from its files). */
  codexUsageRecords: (TokenSums & { records: number }) | null;
  error?: string;
}

export function isSuccess(r: RunRecord): boolean {
  return (
    r.error === undefined &&
    r.outcome.runStatus === 'COMPLETED' &&
    r.outcome.finalMerge === 'merged' &&
    r.outcome.ticketFileChanged
  );
}

// ------------------------------------------------------------------ the summary

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  // `mid` is inside the array: length >= 1.
  const at = (i: number) => s[i] as number;
  return s.length % 2 === 1 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
}

const sumOf = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function toolsOf(r: RunRecord, roles: readonly string[], key: keyof ToolCounts): number {
  return sumOf(r.agents.filter((a) => roles.includes(a.role)).map((a) => a.toolCounts?.[key] ?? 0));
}

const HELPER_ROLES = ['worker', 'tester'];

/** The per-run figures whose medians the summary compares. */
export function runMetrics(r: RunRecord) {
  return {
    leadRead: toolsOf(r, ['lead'], 'read'),
    leadSearch: toolsOf(r, ['lead'], 'search'),
    helperRead: toolsOf(r, HELPER_ROLES, 'read'),
    helperSearch: toolsOf(r, HELPER_ROLES, 'search'),
    codeMapCalls: sumOf(r.agents.map((a) => a.toolCounts?.code_map ?? 0)),
    budgetTokens: sumOf(r.agents.map((a) => a.budgetUsed)),
    wallMs: r.wallMs,
  };
}
export type MetricName = keyof ReturnType<typeof runMetrics>;
const METRICS: readonly MetricName[] = [
  'leadRead',
  'leadSearch',
  'helperRead',
  'helperSearch',
  'codeMapCalls',
  'budgetTokens',
  'wallMs',
];

export interface ArmSummary {
  runs: number;
  /** Runs the driver could not carry through (left out of the medians, counted as failures). */
  errors: number;
  successes: number;
  successRate: number | null;
  medians: Record<MetricName, number | null>;
}

export function armSummary(runs: readonly RunRecord[]): ArmSummary {
  const metrics = runs.filter((r) => r.error === undefined).map(runMetrics);
  const medians = {} as Record<MetricName, number | null>;
  for (const m of METRICS) medians[m] = median(metrics.map((x) => x[m]));
  const successes = runs.filter(isSuccess).length;
  return {
    runs: runs.length,
    errors: runs.filter((r) => r.error !== undefined).length,
    successes,
    successRate: runs.length === 0 ? null : successes / runs.length,
    medians,
  };
}

export interface IndexSummary {
  builds: number;
  medianBuildMs: number | null;
  medianFiles: number | null;
  medianSymbols: number | null;
  medianDbBytes: number | null;
}

export function indexSummary(runs: readonly RunRecord[]): IndexSummary {
  const idx = runs.flatMap((r) => (r.index === null ? [] : [r.index]));
  return {
    builds: idx.length,
    medianBuildMs: median(idx.map((i) => i.buildMs)),
    medianFiles: median(idx.map((i) => i.files)),
    medianSymbols: median(idx.map((i) => i.symbols)),
    medianDbBytes: median(idx.map((i) => i.dbBytes)),
  };
}

/** `off − on` per median and for the success rate; null when either side has no value. */
export function deltas(on: ArmSummary, off: ArmSummary) {
  const d = (a: number | null, b: number | null) => (a === null || b === null ? null : b - a);
  const medians = {} as Record<MetricName, number | null>;
  for (const m of METRICS) medians[m] = d(on.medians[m], off.medians[m]);
  return { medians, successRate: d(on.successRate, off.successRate) };
}

export function summarize(runs: readonly RunRecord[], settings: DriveSettings) {
  const on = armSummary(runs.filter((r) => r.arm === 'on'));
  const off = armSummary(runs.filter((r) => r.arm === 'off'));
  const byTicket: Record<string, { on: ArmSummary; off: ArmSummary }> = {};
  for (const t of settings.tickets) {
    byTicket[t] = {
      on: armSummary(runs.filter((r) => r.ticket === t && r.arm === 'on')),
      off: armSummary(runs.filter((r) => r.ticket === t && r.arm === 'off')),
    };
  }
  return {
    settings: {
      provider: settings.provider,
      model: settings.model,
      effort: settings.effort,
      arms: settings.arms,
      repeats: settings.repeats,
      tickets: settings.tickets,
      limitMs: settings.limitMs,
      commit: settings.commit,
    },
    note:
      `Small sample (${runs.length} runs, ${settings.repeats} repeat(s) per ticket and arm): ` +
      'the medians and deltas are descriptive only, not statistically significant.',
    arms: { on, off },
    byTicket,
    index: indexSummary(runs),
    deltaOffMinusOn: deltas(on, off),
    runs,
  };
}
