import {
  workflowTemplate,
  workflowTemplateV3,
  type AgentNode,
  type AgentRoleKind,
  type ManagedAgentEvent,
  type ManagedAgentSpec,
  type ManagedExecutionAdapter,
  type ManagedFailureCode,
  type ManagedProviderId,
  type WorkflowEdgeV3,
  type WorkflowGraph,
  type WorkflowGraphV3,
  type WorkflowNode,
  type WorkflowNodeV3,
} from '@acp/core';
import type { AgentMessageMetaDto } from '@acp/core/api';
import { YOUR_WORKFLOW_HEADING } from '@acp/orchestrator';

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
/**
 * AR-6's one real run (ADR-0037): a version 3 graph with two researchers (Claude, Codex) into one
 * planner, the lead, one helper and a review fan-out to two change reviewers (Claude, Codex).
 */
export const ARROWS_SCENARIO = 'arrows';
/**
 * FR-7's one real run (ADR-0038): the lead-only graph with one tester after the ticket merge and
 * a When arrow from the tester (`tests-failed`) to an Author block.
 */
export const FAILURE_ROUTING_SCENARIO = 'failure-routing';
export type AnyScenarioId = ScenarioId | typeof ARROWS_SCENARIO | typeof FAILURE_ROUTING_SCENARIO;

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

export function parseScenario(value: string | undefined): AnyScenarioId | null {
  if (value === ARROWS_SCENARIO) return ARROWS_SCENARIO;
  if (value === FAILURE_ROUTING_SCENARIO) return FAILURE_ROUTING_SCENARIO;
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

/** The arrows scenario's node ids. */
export const ARROWS_NODES = {
  researcherClaude: 'research-claude',
  researcherCodex: 'research-codex',
  planner: 'plan',
  lead: LEAD,
  pool: POOL,
  reviewerClaude: CHANGE_REVIEWER,
  reviewerCodex: 'review-codex',
} as const;

/**
 * The arrows scenario (version 3): `reviewer-helper-loop` with a planner, plus
 * - two researchers, Claude and Codex, each with a labelled `research` arrow into the planner;
 * - a second change reviewer on Codex: the helper's `review` arrows fan out to both, both send
 *   `findings` to the lead and both may rework the helper directly (one round, to keep it cheap).
 * Every Claude node runs `claudeModel` at low effort; Codex nodes `CODEX_MODEL` at low effort.
 */
export function arrowsGraph(claudeModel: string): WorkflowGraphV3 {
  const ids = ARROWS_NODES;
  const base = workflowTemplateV3('reviewer-helper-loop', { planner: true });
  const claude = { provider: 'claude-code', model: claudeModel, effort: 'low' } as const;
  const codex = { provider: 'codex', model: CODEX_MODEL, effort: 'low' } as const;
  const agent = (id: string, label: string, over: Partial<AgentNode>): AgentNode => ({
    type: 'agent',
    id,
    label,
    model: null,
    skills: [],
    agent: null,
    ...over,
  });
  const nodes = base.nodes.map((n): WorkflowNodeV3 => {
    if (n.type === 'lead') return { ...n, ...claude };
    if (n.type !== 'agent') return n;
    return { ...n, ...claude };
  });
  nodes.push(
    agent(ids.researcherClaude, 'Researcher (Claude)', claude),
    agent(ids.researcherCodex, 'Researcher (Codex)', codex),
    agent(ids.reviewerCodex, 'Change reviewer (Codex)', codex),
  );
  const research = (from: string): WorkflowEdgeV3 => ({
    type: 'research',
    id: `research-${from}`,
    from,
    to: ids.planner,
    label: 'Repo layout',
    purpose: 'Tell the planner where math code and tests live',
  });
  const edges: WorkflowEdgeV3[] = base.edges.map((e) =>
    e.type === 'rework' ? { ...e, maxRounds: 1 } : e,
  );
  edges.push(
    research(ids.researcherClaude),
    research(ids.researcherCodex),
    { type: 'review', id: 'review-helpers-codex', from: ids.pool, to: ids.reviewerCodex },
    {
      type: 'rework',
      id: 'rework-codex-helpers',
      from: ids.reviewerCodex,
      to: ids.pool,
      maxRounds: 1,
    },
    { type: 'findings', id: 'findings-codex-lead', from: ids.reviewerCodex, to: ids.lead },
  );
  return { version: 3, template: 'custom', nodes, edges };
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
  /** The first prompt's length in characters (never its text). */
  promptChars: number;
  /** The first prompt holds the lead's "Your workflow" section (ADR-0038 §5). */
  workflowSection: boolean;
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
    promptChars: spec.prompt.length,
    workflowSection: spec.prompt.includes(YOUR_WORKFLOW_HEADING),
    started: false,
    startedModel: null,
    usageEvents: 0,
    usageWithNull: 0,
    leadTextEvents: 0,
    leadTools: {},
    finished: null,
  };
}

/**
 * One start or finish, in the order the adapters saw them (the shared array's order is the order
 * across providers). `start` indexes the start records. Content-free.
 */
export interface TimelineEntry {
  event: 'start' | 'finish';
  start: number;
  provider: ManagedProviderId;
  kind: AgentRoleKind;
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
  timeline?: TimelineEntry[],
): ManagedExecutionAdapter {
  const check = inner.checkAvailable?.bind(inner);
  return {
    provider: inner.provider,
    capabilities: inner.capabilities,
    ...(check !== undefined && { checkAvailable: check }),
    start(spec, callbacks) {
      const record = recordOf(inner.provider, spec);
      starts.push(record);
      const index = starts.length - 1;
      timeline?.push({ event: 'start', start: index, provider: inner.provider, kind: spec.kind });
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
              if (e.type === 'finished') {
                timeline?.push({
                  event: 'finish',
                  start: index,
                  provider: inner.provider,
                  kind: spec.kind,
                });
              }
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

// ------------------------------------------------------------------ the arrows scenario's facts

/** A change review round as the driver reads it: the reviewer's provider, never its text. */
export interface FanOutReview {
  change: string;
  round: number;
  reviewer: string;
  reviewerProvider: string | null;
  verdict: string | null;
  decision: string | null;
}

/** Sum of each token category over `usage_records` (already deduplicated rows), nulls counted. */
export function tokensByProvider(
  rows: readonly UsageRow[],
): Record<string, { input: number; output: number; cacheCreation: number; cacheRead: number }> {
  const out: Record<
    string,
    { input: number; output: number; cacheCreation: number; cacheRead: number }
  > = {};
  for (const r of rows) {
    const p = (out[r.provider] ??= { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
    p.input += r.input_tokens ?? 0;
    p.output += r.output_tokens ?? 0;
    p.cacheCreation += r.cache_creation_tokens ?? 0;
    p.cacheRead += r.cache_read_tokens ?? 0;
  }
  return out;
}

/**
 * What the arrows scenario must show (AR-6), from the timeline, the review rounds and the research
 * comments' lengths alone:
 * - both researchers (one per provider) started, and finished, before the planner started;
 * - at least two research notes;
 * - one round of the helper's change was reviewed by two agents on different providers, and was
 *   decided.
 */
export function arrowsChecks(
  timeline: readonly TimelineEntry[],
  reviews: readonly FanOutReview[],
  researchLengths: readonly number[],
) {
  const order = timeline.filter((t) => t.event === 'start').map((t) => `${t.provider}:${t.kind}`);
  const pos = (event: 'start' | 'finish', kind: AgentRoleKind) =>
    timeline.flatMap((t, i) => (t.event === event && t.kind === kind ? [i] : []));
  const researcherStarts = pos('start', 'researcher');
  const researcherEnds = pos('finish', 'researcher');
  const plannerStart = pos('start', 'planner')[0];
  const researcherProviders = new Set(
    timeline.filter((t) => t.event === 'start' && t.kind === 'researcher').map((t) => t.provider),
  );
  const rounds = new Map<string, FanOutReview[]>();
  for (const r of reviews.filter((x) => x.reviewer === 'agent')) {
    const key = `${r.change}#${r.round}`;
    rounds.set(key, [...(rounds.get(key) ?? []), r]);
  }
  const fanOut = [...rounds.values()].filter(
    (rs) => rs.length >= 2 && new Set(rs.map((r) => r.reviewerProvider)).size >= 2,
  );
  return {
    startOrder: order,
    researchersBothProviders: researcherProviders.size === 2 && researcherStarts.length >= 2,
    researchersBeforePlanner:
      plannerStart !== undefined &&
      researcherStarts.length >= 2 &&
      researcherStarts.every((i) => i < plannerStart),
    researchersFinishedBeforePlanner:
      plannerStart !== undefined &&
      researcherEnds.length >= 2 &&
      researcherEnds.every((i) => i < plannerStart),
    researchComments: researchLengths.length,
    researchLengths: [...researchLengths],
    reviewRounds: [...rounds.values()].map((rs) =>
      rs.map((r) => ({
        round: r.round,
        provider: r.reviewerProvider,
        verdict: r.verdict,
        decision: r.decision,
      })),
    ),
    fanOutRounds: fanOut.length,
    // The round's decision is on a row of its own (the lead's or owner's), or on a reviewer's row
    // when the reviewers send the change back themselves (ADR-0037 §5).
    fanOutDecided:
      fanOut.length > 0 &&
      fanOut.every((rs) =>
        reviews.some(
          (r) => r.change === rs[0]?.change && r.round === rs[0]?.round && r.decision !== null,
        ),
      ),
  };
}

// ------------------------------------------------------------------ the failure-routing scenario

/** The failure-routing scenario's node ids (the lead-only template's, plus two). */
export const FR_NODES = {
  lead: LEAD,
  pool: POOL,
  tester: 'tester',
  author: 'author',
} as const;

export const FR_WHEN = {
  label: 'Fix failing tests',
  purpose: "Fix the code the failing tests point at; don't change the tests",
  maxRounds: 2,
} as const;

/** The file the ticket asks for; checked on `main` after the owner's merge. */
export const FR_TICKET_FILES = ['src/clamp.mjs'] as const;

/** The seeded acceptance test the tester runs (owner-written, synthetic). */
export const FR_TEST_FILE = 'test/clamp.test.mjs';
/** The tester's one command: also a harness check, so Auto edits runs it without asking. */
export const FR_TEST_COMMAND = ['node', '--test', FR_TEST_FILE] as const;

/**
 * The ticket (owner text, synthetic). The helper's first version is wrong on purpose (min and max
 * swapped), so the tester finds failing tests deterministically and the When arrow routes them.
 */
export const FR_TICKET = {
  title: 'Add a clamp function',
  description: [
    'Add an exported function `clamp(x, min, max)` in `src/clamp.mjs`. The test file ' +
      `\`${FR_TEST_FILE}\` already exists and expects correct behaviour; never change it.`,
    '',
    'This is a synthetic test run of failure routing, so on purpose:',
    '- Helper, first version: swap min and max, exactly this one line: ' +
      '`export function clamp(x, min, max) { return Math.min(Math.max(x, max), min); }`. ' +
      'Correct it only when a later fix request tells you to.',
    '- Lead: merge that first version as it is (do not send it back), then ask for the tests. ' +
      'The tester finds the bug and the workflow routes the fix.',
    `- Tester: run exactly \`${FR_TEST_COMMAND.join(' ')}\` (no other command) and report ` +
      'the result with report_test_results.',
  ].join('\n'),
};

/**
 * The failure-routing harness (synthetic): the required check `node check.mjs` runs the repo's
 * `test/*.test.mjs` with `node --test` EXCEPT the seeded clamp test, so the helper's deliberately
 * wrong first version passes the change and merge checks and only the tester finds the bug (with
 * the clamp test in the required check, the lead would see a failed check and rework the helper
 * itself, and the When arrow would never fire). A seeded smoke test checks that `clamp` exists.
 * The clamp test is a second, optional check (not run by the default Checks block, which runs the
 * required ones), so the tester's exact command runs without asking under Auto edits.
 */
export const FR_HARNESS: Readonly<Record<string, string>> = {
  '.acp/harness.json': `${JSON.stringify(
    {
      version: 1,
      description: 'Failure-routing real run harness (synthetic)',
      checks: [
        {
          id: 'test',
          name: 'Unit tests',
          argv: ['node', 'check.mjs'],
          timeoutSec: 60,
          required: true,
        },
        {
          id: 'clamp',
          name: 'Clamp acceptance (tester)',
          argv: [...FR_TEST_COMMAND],
          timeoutSec: 60,
          required: false,
          labels: ['acceptance'],
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
    "// The clamp test is the tester's (FR real run): not part of the required check.",
    'const files = existsSync(dir)',
    '  ? readdirSync(dir)',
    "      .filter((f) => f.endsWith('.test.mjs') && f !== 'clamp.test.mjs')",
    '      .map((f) => `${dir}/${f}`)',
    '  : [];',
    'if (files.length === 0) process.exit(0);',
    "const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });",
    'process.exit(r.status ?? 1);',
    '',
  ].join('\n'),
  'test/smoke.test.mjs': [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { existsSync } from 'node:fs';",
    '',
    "test('src/clamp.mjs exports clamp', { skip: !existsSync('src/clamp.mjs') }, async () => {",
    "  const m = await import('../src/clamp.mjs');",
    "  assert.equal(typeof m.clamp, 'function');",
    '});',
    '',
  ].join('\n'),
  [FR_TEST_FILE]: [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { clamp } from '../src/clamp.mjs';",
    '',
    "test('keeps a value inside the range', () => {",
    '  assert.equal(clamp(5, 0, 10), 5);',
    '});',
    "test('raises a low value to min', () => {",
    '  assert.equal(clamp(-3, 0, 10), 0);',
    '});',
    "test('lowers a high value to max', () => {",
    '  assert.equal(clamp(42, 0, 10), 10);',
    '});',
    '',
  ].join('\n'),
};

/**
 * The failure-routing scenario (version 3): `lead-only` (the lead reviews and merges the pool's
 * changes), then one tester after the ticket merge whose results go to the lead, and a When arrow
 * from the tester on `tests-failed` to an Author block (2 rounds). Every agent runs `claudeModel`
 * on Claude Code at low effort; no Codex agent.
 */
export function failureRoutingGraph(claudeModel: string): WorkflowGraphV3 {
  const ids = FR_NODES;
  const base = workflowTemplateV3('lead-only');
  const claude = { provider: 'claude-code', model: claudeModel, effort: 'low' } as const;
  const nodes: WorkflowNodeV3[] = base.nodes.map((n): WorkflowNodeV3 => {
    if (n.type === 'lead' || n.type === 'agent') return { ...n, ...claude };
    return n;
  });
  nodes.push(
    {
      type: 'agent',
      id: ids.tester,
      label: 'Tester',
      skills: [],
      agent: null,
      ...claude,
    },
    { type: 'author', id: ids.author, label: 'Author' },
  );
  const edges: WorkflowEdgeV3[] = base.edges.filter(
    (e) => !(e.type === 'flow' && e.from === 'ticket-merge'),
  );
  edges.push(
    { type: 'test', id: 'test-tester', from: 'ticket-merge', to: ids.tester },
    { type: 'flow', id: 'flow-tester-owner', from: ids.tester, to: 'owner-merge' },
    { type: 'review', id: 'review-tester-lead', from: ids.tester, to: ids.lead },
    {
      type: 'when',
      id: 'when-tester-author',
      from: ids.tester,
      to: ids.author,
      on: ['tests-failed'],
      maxRounds: FR_WHEN.maxRounds,
      label: FR_WHEN.label,
      purpose: FR_WHEN.purpose,
    },
  );
  return { version: 3, template: 'custom', nodes, edges };
}

/** One step of the failure-routing run, in the order the driver saw it (content-free). */
export type FrStep =
  | { step: 'start' | 'finish'; kind: AgentRoleKind; rework: boolean }
  | { step: 'test-results'; head: string; failedInTestFile: number }
  | { step: 'app-comment'; body: string }
  | { step: 'change'; index: number; state: string };

/** The head line of a `test-results` comment (the app's own words, e.g. "Tests failed: 2 …"). */
export function testResultsHead(body: string): string {
  return (body.split('\n')[0] ?? '').slice(0, 80);
}

/** Lines of a `test-results` comment that name `file` as the failing test's file. */
export function failedInFile(body: string, file: string): number {
  return body.split('\n').filter((l) => l.startsWith('- ') && l.includes(`(${file})`)).length;
}

/**
 * What the failure-routing scenario must show (FR-7), from the steps alone:
 * - a helper change merged before the tester started;
 * - the tester's first results failed with at least one failed test in the seeded test file;
 * - a "fix started" app comment for round 1 of 2 (the When arrow, not the lead, routed it), and
 *   the lead was told (the comment says so);
 * - exactly one fixer (one more helper start after the failing results);
 * - a change merged after the fix started.
 */
export function failureRoutingChecks(steps: readonly FrStep[]) {
  const idx = (pred: (s: FrStep) => boolean) => steps.findIndex(pred);
  const testerStarts = steps.flatMap((s, i) =>
    s.step === 'start' && s.kind === 'tester' ? [i] : [],
  );
  const firstTester = testerStarts[0] ?? -1;
  const firstMerge = idx((s) => s.step === 'change' && s.state === 'merged');
  const results = steps.flatMap((s, i) => (s.step === 'test-results' ? [{ i, s }] : []));
  const firstResults = results[0];
  const firstFailed =
    firstResults !== undefined &&
    firstResults.s.head.startsWith('Tests failed') &&
    firstResults.s.failedInTestFile >= 1;
  const appLines = steps.flatMap((s, i) => (s.step === 'app-comment' ? [{ i, body: s.body }] : []));
  const fixStarts = appLines.filter((l) => / is fixing it \(round \d+ of \d+\)/.test(l.body));
  const toLead = appLines.filter((l) => /: the lead (decides|took|moved)/.test(l.body));
  const firstFix = fixStarts[0];
  const workerStartsAfterResults =
    firstResults === undefined
      ? 0
      : steps.filter(
          (s, i) => i > firstResults.i && s.step === 'start' && s.kind === 'worker' && !s.rework,
        ).length;
  const workerReworks = steps.filter(
    (s) => s.step === 'start' && s.kind === 'worker' && s.rework,
  ).length;
  const mergedAfterFix =
    firstFix !== undefined &&
    steps.some((s, i) => i > firstFix.i && s.step === 'change' && s.state === 'merged');
  return {
    helperMergedBeforeTester: firstMerge !== -1 && firstTester !== -1 && firstMerge < firstTester,
    testerFailedInTestFile: firstFailed,
    testResults: results.map((r) => r.s),
    fixStartedRound1Of2:
      firstFix !== undefined && firstFix.body.includes('(round 1 of 2)') && toLead.length === 0,
    leadTold: firstFix?.body.endsWith('The lead was told.') ?? false,
    fixRoundsUsed: fixStarts.length,
    routedToLead: toLead.length,
    fixerStarts: workerStartsAfterResults,
    workerReworks,
    mergedAfterFix,
    testerStarts: testerStarts.length,
    testerRanAfterFix: firstFix !== undefined && testerStarts.some((i) => i > firstFix.i),
  };
}

/** `budget.used` summed per role kind (the app's own counter, comparable across providers). */
export function tokensByRole(
  agents: readonly { kind: string; budgetUsed: number }[],
): Record<string, { agents: number; used: number }> {
  const out: Record<string, { agents: number; used: number }> = {};
  for (const a of agents) {
    const r = (out[a.kind] ??= { agents: 0, used: 0 });
    r.agents++;
    r.used += a.budgetUsed;
  }
  return out;
}
