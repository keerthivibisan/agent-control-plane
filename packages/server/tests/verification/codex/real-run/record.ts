import {
  workflowTemplate,
  type AgentRoleKind,
  type ManagedAgentEvent,
  type ManagedAgentSpec,
  type ManagedExecutionAdapter,
  type ManagedFailureCode,
  type ManagedProviderId,
  type WorkflowGraph,
  type WorkflowNode,
} from '@acp/core';
import type { AgentMessageMetaDto } from '@acp/core/api';

/*
 * The CX real-run driver's pure parts (`drive.ts` is the command line that spends tokens): the two
 * scenarios' graphs, the synthetic harness and ticket, a recording wrapper around any managed
 * adapter, and the aggregate summaries. Nothing here starts a process or reads a file, so
 * `drive.test.ts` covers it with fake adapters only.
 *
 * Every record is content-free: role kinds, providers, models, flags, tool names and counts. Never
 * a prompt, reply, finding, diff or tool input.
 */

export const SCENARIO_IDS = ['reviewer', 'lead'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const CODEX_MODEL = 'gpt-6.1-sol';
export const LEAD = 'orchestrate';
export const POOL = 'helpers';
export const CHANGE_REVIEWER = 'review';

/** The files the ticket asks for; checked on `main` after the owner's merge. */
export const TICKET_FILES = ['src/math.mjs', 'test/math.test.mjs'] as const;

export const TICKET = {
  title: 'Add an add function',
  description:
    'One helper: add a function `add(a, b)` in `src/math.mjs` (exported, returns a + b) and a ' +
    'test in `test/math.test.mjs` that checks it with node:test. Keep it tiny.',
};

/** The synthetic harness: one required check that runs the repo's own `node:test` files. */
export const HARNESS: Readonly<Record<string, string>> = {
  '.acp/harness.json': `${JSON.stringify(
    {
      version: 1,
      description: 'CX real run harness (synthetic)',
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

export function parseScenario(value: string | undefined): ScenarioId | null {
  return (SCENARIO_IDS as readonly string[]).includes(value ?? '') ? (value as ScenarioId) : null;
}

/**
 * Today's setup (lead, helper pool, change reviewer whose findings go to the lead, checks, ticket
 * branch, owner's merge) with one node moved to Codex at low effort:
 * - `reviewer`: the change reviewer;
 * - `lead`: the lead (the pool and the reviewer stay on Claude).
 * Claude nodes take `claudeModel` (null: the provider default, as the reference driver).
 */
export function scenarioGraph(id: ScenarioId, claudeModel: string | null): WorkflowGraph {
  const onCodex = id === 'reviewer' ? CHANGE_REVIEWER : LEAD;
  const base = workflowTemplate('todays-setup');
  const nodes = base.nodes.map((n): WorkflowNode => {
    if (n.type !== 'lead' && n.type !== 'helper-pool' && n.type !== 'reviewer') return n;
    if (n.id === onCodex) return { ...n, provider: 'codex', model: CODEX_MODEL, effort: 'low' };
    return { ...n, model: claudeModel };
  });
  return { ...base, template: 'custom', nodes };
}

// ------------------------------------------------------------------ recording each start

const BAD_START_FAILURES: readonly ManagedFailureCode[] = [
  'provider-unavailable',
  'sandbox-unavailable',
  'unsafe-git-location',
];

export interface StartRecord {
  provider: ManagedProviderId;
  kind: AgentRoleKind;
  reviewScope: 'change' | 'final' | null;
  model: string | null;
  effort: string | null;
  denyRead: boolean;
  fullAuto: boolean;
  sandbox: boolean;
  followUp: boolean;
  rework: boolean;
  approvalMode: string | null;
  /** A `started` event arrived (the provider's session began). */
  started: boolean;
  /** The model the provider reported at start (a model id, never text). */
  startedModel: string | null;
  usageEvents: number;
  /** Usage events with at least one null token count (`unavailable`, never 0). */
  usageWithNull: number;
  leadTextEvents: number;
  /** Lead tool calls as `<tool>:<ok|error>` counts (never their input or reply). */
  leadTools: Record<string, number>;
  finished: { outcome: string; failure: ManagedFailureCode | null } | null;
}

export function count(into: Record<string, number>, key: string, by = 1): void {
  into[key] = (into[key] ?? 0) + by;
}

/** The spec's shape at start, before any event. */
export function recordOf(provider: ManagedProviderId, spec: ManagedAgentSpec): StartRecord {
  return {
    provider,
    kind: spec.kind,
    reviewScope: spec.reviewScope ?? null,
    model: spec.model,
    effort: spec.effort ?? null,
    denyRead: (spec.denyRead?.length ?? 0) > 0,
    fullAuto: spec.fullAuto !== undefined,
    sandbox: spec.sandbox !== undefined,
    followUp: spec.followUp !== undefined,
    rework: spec.rework !== undefined,
    approvalMode: spec.approvalMode ?? null,
    started: false,
    startedModel: null,
    usageEvents: 0,
    usageWithNull: 0,
    leadTextEvents: 0,
    leadTools: {},
    finished: null,
  };
}

/** Folds one event into the record (counts and flags only). */
export function observeEvent(record: StartRecord, e: ManagedAgentEvent): void {
  switch (e.type) {
    case 'started':
      record.started = true;
      record.startedModel = e.model;
      break;
    case 'usage':
      record.usageEvents++;
      if (Object.values(e.tokens).some((v) => v === null)) record.usageWithNull++;
      break;
    case 'lead-text':
      record.leadTextEvents++;
      break;
    case 'finished':
      record.finished = { outcome: e.outcome, failure: e.failure ?? null };
      break;
    case 'activity':
      break;
  }
}

/**
 * `inner` with every start recorded into `starts`: the spec's flags, its lead tool calls by name,
 * and its events as counts. Behaviour is unchanged; `checkAvailable` is forwarded.
 */
export function observeManaged(
  inner: ManagedExecutionAdapter,
  starts: StartRecord[],
): ManagedExecutionAdapter {
  const check = inner.checkAvailable?.bind(inner);
  return {
    provider: inner.provider,
    capabilities: inner.capabilities,
    ...(check !== undefined && { checkAvailable: check }),
    start(spec, callbacks) {
      const record = recordOf(inner.provider, spec);
      starts.push(record);
      const tools = spec.leadTools;
      const observed: ManagedAgentSpec =
        tools === undefined
          ? spec
          : {
              ...spec,
              leadTools: async (name, input) => {
                try {
                  const reply = await tools(name, input);
                  count(record.leadTools, `${name}:ok`);
                  return reply;
                } catch (error) {
                  count(record.leadTools, `${name}:error`);
                  throw error;
                }
              },
            };
      const handle = inner.start(observed, callbacks);
      return {
        send: (text) => handle.send(text),
        interrupt: () => handle.interrupt(),
        abort: () => handle.abort(),
        events: {
          async *[Symbol.asyncIterator]() {
            for await (const e of handle.events) {
              observeEvent(record, e);
              yield e;
            }
          },
        },
      };
    },
  };
}

// ------------------------------------------------------------------ aggregates

export interface UsageRow {
  provider: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
}

export interface UsageByProvider {
  records: number;
  /** Records with at least one null category. */
  withAnyNull: number;
  /** Records with every category null. */
  allNull: number;
  nullByField: { input: number; output: number; cacheCreation: number; cacheRead: number };
}

/** `usage_records` grouped by provider: counts and null counts, never a sum. */
export function summarizeUsage(rows: readonly UsageRow[]): Record<string, UsageByProvider> {
  const out: Record<string, UsageByProvider> = {};
  for (const r of rows) {
    const p = (out[r.provider] ??= {
      records: 0,
      withAnyNull: 0,
      allNull: 0,
      nullByField: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    });
    const fields = {
      input: r.input_tokens,
      output: r.output_tokens,
      cacheCreation: r.cache_creation_tokens,
      cacheRead: r.cache_read_tokens,
    };
    p.records++;
    const nulls = Object.entries(fields).filter(([, v]) => v === null);
    if (nulls.length > 0) p.withAnyNull++;
    if (nulls.length === 4) p.allNull++;
    for (const [k] of nulls) p.nullByField[k as keyof UsageByProvider['nullByField']]++;
  }
  return out;
}

/** The outbox entries seen during the run, latest state per id, as `<kind>:<state>` counts. */
export function outboxCounts(seen: ReadonlyMap<string, AgentMessageMetaDto>): {
  entries: number;
  byKindState: Record<string, number>;
  fromEngine: number;
} {
  const byKindState: Record<string, number> = {};
  let fromEngine = 0;
  for (const m of seen.values()) {
    count(byKindState, `${m.kind}:${m.state}`);
    if (m.from === 'engine') fromEngine++;
  }
  return { entries: seen.size, byKindState, fromEngine };
}

export interface CodexFacts {
  /** The change reviews: who reviewed, and whether a verdict came back. */
  reviews: { reviewer: string; verdict: string | null }[];
  /** Every ticket file exists on `main` after the merge. */
  filesOnMain: boolean;
}

/** What the summary says about the Codex agents, from the start records alone plus `facts`. */
export function codexChecks(starts: readonly StartRecord[], facts: CodexFacts) {
  const codex = starts.filter((s) => s.provider === 'codex');
  const failures: Record<string, number> = {};
  for (const s of codex) if (s.finished?.failure) count(failures, s.finished.failure);
  const succeeded = (s: StartRecord) => s.finished?.outcome === 'success';
  const reviewers = codex.filter((s) => s.kind === 'reviewer');
  const leads = codex.filter((s) => s.kind === 'lead' && !s.followUp);
  const editors = codex.filter((s) => s.kind === 'worker' || s.kind === 'tester');
  const turns = codex.filter((s) => s.rework || s.followUp);
  const leadTools: Record<string, number> = {};
  for (const s of codex.filter((x) => x.kind === 'lead')) {
    for (const [k, v] of Object.entries(s.leadTools)) count(leadTools, k, v);
  }
  // Readable: a Codex reviewer finished and a verdict came back, or a Codex lead got a plan
  // through (it read the repository). Writable: only when a Codex agent edits.
  const reviewerRead =
    reviewers.length > 0 &&
    reviewers.every(succeeded) &&
    facts.reviews.some((r) => r.reviewer === 'agent' && r.verdict !== null);
  const leadRead = leads.length > 0 && (leadTools['submit_plan:ok'] ?? 0) > 0;
  return {
    starts: codex.length,
    allStarted:
      codex.length > 0 &&
      codex.every((s) => s.started) &&
      !codex.some((s) => s.finished?.failure && BAD_START_FAILURES.includes(s.finished.failure)),
    failures,
    allHadDenyRead: codex.length > 0 && codex.every((s) => s.denyRead),
    worktree: {
      readable: reviewers.length > 0 || leads.length > 0 ? reviewerRead || leadRead : null,
      writable: editors.length > 0 ? editors.some(succeeded) && facts.filesOnMain : null,
    },
    reworkOrFollowUp: {
      happened: turns.length,
      started: turns.filter((s) => s.started).length,
      byKind: turns.reduce<Record<string, number>>((acc, s) => {
        count(acc, `${s.kind}:${s.rework ? 'rework' : 'follow-up'}`);
        return acc;
      }, {}),
    },
    leadTools,
  };
}

/** The start records as printed: no ids or paths exist in them, only shapes and counts. */
export function startsByProvider(starts: readonly StartRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of starts) count(out, `${s.provider}:${s.kind}${s.followUp ? ':follow-up' : ''}`);
  return out;
}
