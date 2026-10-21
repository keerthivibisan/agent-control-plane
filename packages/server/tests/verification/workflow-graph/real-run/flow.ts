import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  isModeWithin,
  type AgentRoleKind,
  type ApprovalMode,
  type ManagedAgentSpec,
  type ManagedExecutionAdapter,
} from '@acp/core';
import {
  ProjectDtoSchema,
  RunDetailDtoSchema,
  RunWorkflowGraphDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  WorkflowGraphDtoSchema,
  type ApprovalDto,
  type RunDetailDto,
  type RunWorkflowGraphDto,
} from '@acp/core/api';
import { createManagedClaudeCode, type ManagedQueryFn } from '@acp/adapter-claude-code';
import { managedAgentEnv } from '../../../../src/control/env.js';
import { git } from '../../control/harness.js';
import { startAutopilot, type Autopilot } from '../autopilot.js';
import { bootGraphServer, commitFiles, errorCode, ok, type GraphServer } from '../harness.js';
import { scenario as scenarioOf, type Scenario, type ScenarioId } from './scenarios.js';

/*
 * One WG-V real-run scenario, end to end (docs/workflow-graph/wp/WG-V.md, task 3). `drive.ts` is
 * the command line around it; the dry-run test calls it directly.
 *
 * - Real (`dryRun: false`): every agent is a real `claude` process through the Agent SDK. Only
 *   `drive.ts` calls it that way, and only with ACP_REAL_RUN=1 after the owner's consent.
 * - Dry run: the scripted FAKE adapter plays every agent (the autopilot), and each start is also
 *   handed to the real Claude Code adapter with a stub SDK `query` that records the options and
 *   ends at once, so the permission mode and sandbox a real run would ask for are the adapter's
 *   own answer. Nothing is spawned.
 *
 * Setup: a throwaway git repo (README, a one-check harness running the repo's `node:test` files),
 * a temp data dir, an EMPTY temp Claude dir, git isolated from the owner's config, the server on
 * an ephemeral 127.0.0.1 port (never 7420 or 5173). The home folder the server sees is a temp one
 * in a dry run; a real run keeps the real one only for Full auto's deny-read list (so the sandbox
 * covers the owner's real secret folders); nothing under it is read.
 *
 * The owner's side goes through the HTTP routes the UI uses: project, setup, skills, the graph,
 * the ticket, Start with the scenario's own options, the plan (approved unless the gate approves
 * it), approvals by the asking agent's mode (a Manual block's own edits are allowed, everything
 * else is denied), changes the lead hands to the owner, and the one merge of the ticket branch.
 *
 * The summary is aggregate only: no ids, paths, names, plan, finding, comment or diff text.
 */

export interface DriveOptions {
  scenario: ScenarioId;
  dryRun: boolean;
  /** Overall time limit. */
  limitMs: number;
  /** Keep the temp folders (their paths go to `onKept`, never into the summary). */
  keep?: boolean;
  onKept?: (dirs: string[]) => void;
  /** Progress lines for a person watching (no content). */
  progress?: (line: string) => void;
  /** Ctrl-C: stops the run like the time limit does, then closes the server. */
  signal?: AbortSignal;
}

export interface DriveResult {
  ok: boolean;
  summary: Record<string, unknown>;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const ENDED = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const editing = (k: AgentRoleKind) => k === 'worker' || k === 'tester';

/** The synthetic harness: one required check that runs the repo's own `node:test` files. */
export const HARNESS: Readonly<Record<string, string>> = {
  '.acp/harness.json': `${JSON.stringify(
    {
      version: 1,
      description: 'WG-V real run harness (synthetic)',
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

// ------------------------------------------------------------------ observing each start

interface SandboxShape {
  enabled: boolean;
  failIfUnavailable: boolean;
  allowUnsandboxedCommands: boolean | null;
  autoAllowBashIfSandboxed: boolean | null;
  network: boolean;
  allowWrite: number;
  denyRead: number;
}

interface StartRecord {
  /** Internal only (maps the start to its node); never printed. */
  agentRunId: string;
  kind: AgentRoleKind;
  reviewScope: 'change' | 'final' | null;
  rework: boolean;
  followUp: boolean;
  /** The SDK permission mode the adapter asked for. */
  permissionMode: string | null;
  sandbox: SandboxShape | null;
  /** Each `system/init`'s reported permission mode (real runs only). */
  init: (string | null)[];
  results: { subtype: string; isError: boolean; reportedCostUsd: number | null }[];
  /** The real gate's decisions as `<tool>:<behavior>` counts (real runs only; never input). */
  gate: Record<string, number>;
  /** `system/permission_denied` by decision reason type (real runs only). */
  denials: Record<string, number>;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function count(into: Record<string, number>, key: string, by = 1): void {
  into[key] = (into[key] ?? 0) + by;
}

/** The SDK's `query`, resolved from the adapter package (the server does not depend on it). */
async function realSdkQuery(): Promise<ManagedQueryFn> {
  const adapterEntry = fileURLToPath(import.meta.resolve('@acp/adapter-claude-code'));
  const sdkPath = createRequire(adapterEntry).resolve('@anthropic-ai/claude-agent-sdk');
  return ((await import(pathToFileURL(sdkPath).href)) as { query: ManagedQueryFn }).query;
}

/** A stub SDK `query` for the dry run: no process, no messages; it ends at once. */
const stubQuery: ManagedQueryFn = () => ({
  interrupt: () => Promise.resolve(),
  close: () => undefined,
  async *[Symbol.asyncIterator]() {
    // Nothing: the fake adapter plays the agent.
  },
});

/** The real Claude Code adapter over `inner`, recording what each start asked for and saw. */
function observingAdapter(inner: ManagedQueryFn, starts: StartRecord[]): ManagedExecutionAdapter {
  let current: ManagedAgentSpec | undefined;
  const query: ManagedQueryFn = (params) => {
    const spec = current;
    if (spec === undefined) throw new Error('a start outside the adapter');
    const o = params.options;
    const record: StartRecord = {
      agentRunId: spec.agentRunId,
      kind: spec.kind,
      reviewScope: spec.reviewScope ?? null,
      rework: spec.rework !== undefined,
      followUp: spec.followUp !== undefined,
      permissionMode: o.permissionMode ?? null,
      sandbox:
        o.sandbox === undefined
          ? null
          : {
              enabled: o.sandbox.enabled === true,
              failIfUnavailable: o.sandbox.failIfUnavailable === true,
              allowUnsandboxedCommands: o.sandbox.allowUnsandboxedCommands ?? null,
              autoAllowBashIfSandboxed: o.sandbox.autoAllowBashIfSandboxed ?? null,
              network: o.sandbox.network !== undefined,
              allowWrite: o.sandbox.filesystem?.allowWrite?.length ?? 0,
              denyRead: o.sandbox.filesystem?.denyRead?.length ?? 0,
            },
      init: [],
      results: [],
      gate: {},
      denials: {},
    };
    starts.push(record);
    const gate = o.canUseTool;
    if (gate !== undefined) {
      o.canUseTool = async (toolName, input, opts) => {
        const decision = await gate(toolName, input, opts);
        count(record.gate, `${toolName}:${decision?.behavior ?? 'none'}`);
        return decision;
      };
    }
    const q = inner(params);
    return {
      interrupt: () => q.interrupt(),
      close: () => q.close?.(),
      async *[Symbol.asyncIterator]() {
        for await (const m of q) {
          const msg = m as Record<string, unknown>;
          if (msg['type'] === 'system' && msg['subtype'] === 'init') {
            record.init.push(str(msg['permissionMode']));
          }
          if (msg['type'] === 'system' && msg['subtype'] === 'permission_denied') {
            count(record.denials, str(msg['decision_reason_type']) ?? 'unknown');
          }
          if (msg['type'] === 'result') {
            const cost = msg['total_cost_usd'];
            record.results.push({
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
  const real = createManagedClaudeCode({ query, env: managedAgentEnv(process.env) });
  return {
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
}

// ------------------------------------------------------------------ the flow

export async function driveScenario(options: DriveOptions): Promise<DriveResult> {
  const sc: Scenario = scenarioOf(options.scenario);
  const say = options.progress ?? (() => undefined);
  const made: string[] = [];
  const temp = (prefix: string): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    made.push(dir);
    return dir;
  };
  const dataDir = temp(`acp-wgv-real-${sc.id}-data-`);
  const claudeDir = temp(`acp-wgv-real-${sc.id}-claude-`); // empty: observation sees nothing
  const parentDir = temp(`acp-wgv-real-${sc.id}-parent-`);
  const homeDir = options.dryRun ? temp(`acp-wgv-real-${sc.id}-home-`) : homedir();

  const starts: StartRecord[] = [];
  const observing = observingAdapter(options.dryRun ? stubQuery : await realSdkQuery(), starts);
  const logs: string[] = [];
  const b: GraphServer = await bootGraphServer({
    dataDir,
    claudeDir,
    homeDir,
    logs,
    adapter: options.dryRun
      ? (fake) => ({
          provider: 'claude-code',
          start(spec, callbacks) {
            // The adapter's own options for this spec, then the fake plays the agent.
            observing.start(spec, callbacks).abort();
            return fake.adapter.start(spec, callbacks);
          },
        })
      : () => observing,
  });
  say(`server on ${b.base} (open it to watch)`);

  const deadline = Date.now() + options.limitMs;
  const pollMs = options.dryRun ? 50 : 2000;
  let runId: string | null = null;
  let autopilot: Autopilot | null = null;
  try {
    // ---- the owner sets up the project
    const project = ProjectDtoSchema.parse(
      ok(
        await b.post('/api/projects/new', {
          parentDir,
          name: `wgv-${sc.id}`,
          readme: `# wgv-${sc.id}\n\nA throwaway repository for one WG-V run (synthetic).\n`,
        }),
        201,
        'new project',
      ),
    );
    const repo = project.rootPath;
    commitFiles(repo, HARNESS, 'Add the harness');
    const p = `/api/projects/${project.id}`;
    ok(
      await b.put(`${p}/setup`, {
        projectKey: sc.projectKey,
        maxConcurrentHelpers: 2,
        maxDepth: 1,
        defaultBudgetTokensPerAgent: 80_000,
        model: null,
        approvals: { mode: sc.projectMode, commands: [] },
        contextFiles: [],
      }),
      200,
      'setup',
    );
    for (const skill of sc.skills) {
      ok(await b.post(`${p}/skills`, skill), 201, 'skill');
      ok(await b.post(`${p}/skills/${skill.name}/commit`), 200, 'skill commit');
    }
    const saved = WorkflowGraphDtoSchema.parse(
      ok(await b.put(`${p}/workflow-graph`, { graph: sc.graph }), 200, 'graph'),
    );
    const graphIssues: Record<string, number> = {};
    for (const issue of saved.issues) count(graphIssues, `${issue.severity}:${issue.code}`);

    // The base as the run finds it: committing a skill above is the owner's own commit to main.
    const baseCommit = git(repo, 'rev-parse', 'main').trim();

    // ---- the ticket
    const ticket = TicketDtoSchema.parse(
      ok(await b.post(`${p}/tickets`, { ...sc.ticket, type: 'feature' }), 201, 'ticket'),
    );
    ok(await b.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' }), 200, 'ready');
    const startedTicket = TicketDetailDtoSchema.parse(
      ok(await b.post(`/api/tickets/${ticket.id}/start`, sc.start), 200, 'start'),
    );
    const rid = startedTicket.currentRun?.id;
    if (rid === undefined) throw new Error('the ticket has no run');
    runId = rid;
    say(`scenario ${sc.id}: run started`);
    if (options.dryRun) autopilot = startAutopilot(b, ticket.id, rid, sc.dryRun);

    // ---- the owner's part, polled
    const configured = new Map<string, ApprovalMode>();
    for (const n of sc.graph.nodes) {
      if (n.type === 'helper-pool' || n.type === 'helper' || n.type === 'tester') {
        configured.set(n.id, n.approvalMode ?? sc.projectMode);
      }
    }
    const prompts: Record<string, number> = {};
    let fullAutoAskedOwner = 0;
    const ownerDecisions: Record<string, number> = {};
    const decided = new Set<string>();
    const tips = new Set<string>();
    const branchStates = new Set<string>();
    let planWaitedForOwner = false;
    let planDecidedByDriver = false;
    let baseMovedBeforeOwnerMerge = 0;
    let mergeAttempted = false;
    let finalMerge: { status: 'merged' | 'refused'; code?: string } | null = null;
    let timedOut = false;

    const nodeOf = (g: RunWorkflowGraphDto, agentRunId: string) =>
      g.nodes.find((n) => n.agentRunIds.includes(agentRunId));

    const decideApproval = async (a: ApprovalDto, r: RunDetailDto, g: RunWorkflowGraphDto) => {
      const kind = r.agents.find((x) => x.id === a.agentRunId)?.kind ?? 'unknown';
      const mode = nodeOf(g, a.agentRunId)?.approvalMode ?? 'read-only';
      // A Manual block asks even for its own edits: the owner allows those (never a path that
      // climbs out); everything else that still asks is denied.
      const allow =
        mode === 'manual' &&
        a.toolName !== null &&
        EDIT_TOOLS.has(a.toolName) &&
        !a.summary.includes('..');
      const res = await b.post(
        `/api/approvals/${a.id}`,
        allow ? { decision: 'approve' } : { decision: 'deny', message: 'Not in this run.' },
      );
      // Decided meanwhile (a timeout or a lost race) is not an error.
      if (res.status !== 200 && res.status !== 409) ok(res, 200, 'approval');
      count(prompts, `${mode}:${kind}:${a.toolName ?? a.kind}:${allow ? 'allow' : 'deny'}`);
      if (mode === 'full-auto') fullAutoAskedOwner++;
    };

    for (;;) {
      if (Date.now() > deadline || options.signal?.aborted === true) {
        timedOut = true;
        break;
      }
      const r = RunDetailDtoSchema.parse(ok(await b.get(`/api/runs/${rid}`), 200, 'run'));
      const g = RunWorkflowGraphDtoSchema.parse(
        ok(await b.get(`/api/runs/${rid}/workflow-graph`), 200, 'run graph'),
      );
      if (!mergeAttempted && git(repo, 'rev-parse', 'main').trim() !== baseCommit) {
        baseMovedBeforeOwnerMerge++;
      }
      if (r.ticketBranch) {
        tips.add(r.ticketBranch.headCommit);
        branchStates.add(r.ticketBranch.state);
      }
      if (ENDED.has(r.status)) break;

      // The plan: approved by the owner unless the gate approves it.
      const t = TicketDetailDtoSchema.parse(ok(await b.get(`/api/tickets/${ticket.id}`)));
      const proposed = t.plans.find((x) => x.runId === rid && x.status === 'proposed');
      if (t.ticket.stage === 'PLAN_REVIEW' && proposed !== undefined) {
        if (sc.expect.planAuto) planWaitedForOwner = true;
        const res = await b.post(`/api/tickets/${ticket.id}/plans/${proposed.id}/decision`, {
          decision: 'approve',
        });
        if (res.status !== 409) ok(res, 200, 'plan decision');
        planDecidedByDriver = true;
      }

      for (const a of r.approvals.filter((x) => x.status === 'pending')) {
        await decideApproval(a, r, g);
      }

      // A change the lead handed to the owner: merge it when its checks passed, else discard.
      for (const c of r.changes ?? []) {
        const key = `${c.agentRunId}:${c.reworkRounds}`;
        if (c.state !== 'needs-owner' || decided.has(key)) continue;
        const passed = c.checks.length > 0 && c.checks.every((k) => k.status === 'passed');
        const res = await b.post(`/api/runs/${rid}/review`, {
          agentRunId: c.agentRunId,
          action: passed ? 'merge' : 'discard',
        });
        if (res.status === 409 && errorCode(res) === 'checks_running') continue;
        ok(res, 200, 'owner decision');
        decided.add(key);
        count(ownerDecisions, passed ? 'merge' : 'discard');
      }

      // The owner's one merge of the ticket branch, once the run is in REVIEW.
      if (r.status === 'REVIEW' && finalMerge === null) {
        mergeAttempted = true;
        const res = await b.post(`/api/runs/${rid}/ticket-branch`, { action: 'merge' });
        if (res.status === 200) {
          finalMerge = { status: 'merged' };
          say(`scenario ${sc.id}: the owner merged the ticket branch`);
        } else if (!(res.status === 409 && errorCode(res) === 'checks_running')) {
          finalMerge = { status: 'refused', code: errorCode(res) ?? String(res.status) };
          break; // a check failed or the base moved: the owner would decide by hand
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    if (timedOut) {
      say(`scenario ${sc.id}: time limit or Ctrl-C; stopping the run`);
      await b.post(`/api/runs/${rid}/stop`);
    }
    await autopilot?.stop();

    // ---- the end state, aggregated
    const end = RunDetailDtoSchema.parse(ok(await b.get(`/api/runs/${rid}`)));
    const g = RunWorkflowGraphDtoSchema.parse(ok(await b.get(`/api/runs/${rid}/workflow-graph`)));
    const tEnd = TicketDetailDtoSchema.parse(ok(await b.get(`/api/tickets/${ticket.id}`)));
    const plan = tEnd.plans.filter((x) => x.runId === rid).at(-1);
    const branch = end.ticketBranch ?? null;
    const mainNow = git(repo, 'rev-parse', 'main').trim();
    const branchLeft = branch === null ? '' : git(repo, 'branch', '--list', branch.branch).trim();

    const runNode = (id: string | undefined) => g.nodes.find((n) => n.nodeId === id);
    const agents = starts.map((s) => {
      const nodeId = nodeOf(g, s.agentRunId)?.nodeId ?? null;
      return { s, nodeId, run: runNode(nodeId ?? undefined) };
    });

    const decidedBy: Record<string, number> = {};
    const verdicts: Record<string, number> = {};
    let rounds = 0;
    let maxRound = 0;
    const changes = (end.changes ?? []).map((c) => {
      for (const x of c.reviews) {
        count(decidedBy, x.decidedBy ?? 'none');
        if (x.verdict !== null) count(verdicts, x.verdict);
      }
      rounds += c.reworkRounds;
      maxRound = Math.max(maxRound, c.reworkRounds);
      return {
        nodeId: nodeOf(g, c.agentRunId)?.nodeId ?? null,
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
      };
    });

    const budgetByKind: Record<string, number> = {};
    for (const a of end.agents) count(budgetByKind, a.kind, a.budget.used);

    // ---- the invariants
    const others = agents.filter(({ s }) => !editing(s.kind));
    const editors = agents.filter(({ s }) => editing(s.kind) && !s.followUp);
    const initAgrees = (s: StartRecord) => s.init.every((m) => m === s.permissionMode);
    const sandboxSafe = (x: SandboxShape) =>
      x.enabled && x.failIfUnavailable && x.allowUnsandboxedCommands === false && !x.network;
    const assertions: Record<string, boolean> = {
      leadAndReviewersAlwaysDefault: others.every(
        ({ s }) => s.permissionMode === 'default' && s.sandbox === null && initAgrees(s),
      ),
      editingModesWithinTheirNode: editors.every(({ s, nodeId, run }) => {
        const limit = nodeId === null ? undefined : configured.get(nodeId);
        const mode = run?.approvalMode;
        if (limit === undefined || mode === undefined) return false;
        const sdk = mode === 'full-auto' ? 'auto' : 'default';
        return isModeWithin(mode, limit) && s.permissionMode === sdk && initAgrees(s);
      }),
      sandboxExactlyForFullAutoBlocks: editors.every(({ s, nodeId, run }) => {
        const fullAutoBlock = nodeId !== null && configured.get(nodeId) === 'full-auto';
        if (run?.sandbox !== fullAutoBlock) return false;
        return fullAutoBlock ? s.sandbox !== null && sandboxSafe(s.sandbox) : s.sandbox === null;
      }),
      fullAutoNeverAskedTheOwner: fullAutoAskedOwner === 0,
      baseUntouchedBeforeOwnerMerge: baseMovedBeforeOwnerMerge === 0,
      reachedOwnerMerge:
        !timedOut &&
        (finalMerge as { status: string } | null)?.status === 'merged' &&
        end.status === 'COMPLETED' &&
        typeof branch?.mergedCommit === 'string' &&
        mainNow === branch.mergedCommit,
      planGateFollowed: sc.expect.planAuto
        ? !planWaitedForOwner && plan?.decidedBy === 'auto'
        : planDecidedByDriver && plan?.decidedBy !== 'auto',
      expectedNodesRan: sc.expect.nodes.every((id) => agents.some((a) => a.nodeId === id)),
      reviewRouteFollowed:
        changes.length > 0 &&
        changes.every((c) => {
          const first = c.rounds[0];
          // The tester's change always goes to the lead (its review edge).
          const want = c.nodeId === 'unit-tests' ? 'lead' : sc.expect.reviewer;
          return first !== undefined && first.reviewer === want;
        }) &&
        (sc.expect.direct || (decidedBy['reviewer'] ?? 0) === 0),
      noProtectionFailure: end.agents.every(
        (a) => !(a.latestActivity ?? '').startsWith('Could not start:'),
      ),
    };
    if (sc.expect.tightenedFullAuto) {
      assertions['tightenedFullAutoKeptSandbox'] = editors.some(
        ({ s, nodeId, run }) =>
          nodeId !== null &&
          configured.get(nodeId) === 'full-auto' &&
          run?.approvalMode !== 'full-auto' &&
          s.permissionMode === 'default' &&
          s.sandbox !== null &&
          sandboxSafe(s.sandbox),
      );
    }
    // Route (c) is scripted in the dry run; a real reviewer may approve at once.
    if (options.dryRun && sc.expect.direct) {
      assertions['reviewerReworkedDirectly'] = (decidedBy['reviewer'] ?? 0) > 0;
    }

    const logText = logs.join('\n');
    const comments = tEnd.comments.map((c) => c.body).filter((x) => x.length >= 12);
    const summary: Record<string, unknown> = {
      scenario: sc.id,
      about: sc.about,
      dryRun: options.dryRun,
      ok: Object.values(assertions).every(Boolean),
      assertions,
      run: {
        status: end.status,
        ticketStatus: tEnd.ticket.status,
        timedOut,
        approvalMode: end.approvalMode ?? null,
        plan: {
          steps: plan?.steps.length ?? 0,
          stepsByNode: plan?.steps.reduce<Record<string, number>>((acc, st) => {
            count(acc, st.helper ?? 'none');
            return acc;
          }, {}),
          decidedBy: plan?.decidedBy ?? null,
          waitedForOwner: planWaitedForOwner,
        },
      },
      graphIssues,
      nodes: [...configured.entries()].map(([nodeId, mode]) => ({
        nodeId,
        configuredMode: mode,
        runMode: runNode(nodeId)?.approvalMode ?? null,
        sandbox: runNode(nodeId)?.sandbox ?? null,
        agents: runNode(nodeId)?.agentRunIds.length ?? 0,
      })),
      agents: agents.map(({ s, nodeId }) => ({
        kind: s.kind,
        nodeId,
        reviewScope: s.reviewScope,
        rework: s.rework,
        followUp: s.followUp,
        permissionMode: s.permissionMode,
        sandbox: s.sandbox,
        initPermissionModes: s.init,
        results: s.results,
        gate: s.gate,
        denials: s.denials,
      })),
      prompts: {
        byModeKindTool: prompts,
        total: Object.values(prompts).reduce((n, x) => n + x, 0),
        fullAutoAskedOwner,
      },
      approvals: end.approvals.reduce<Record<string, number>>((acc, a) => {
        const kind = end.agents.find((x) => x.id === a.agentRunId)?.kind ?? 'unknown';
        count(acc, `${kind}:${a.decidedBy ?? 'none'}:${a.allowRule ?? '-'}:${a.status}`);
        return acc;
      }, {}),
      reviewRoutes: { decidedBy, verdicts, reworkRoundsTotal: rounds, reworkRoundsMax: maxRound },
      changes,
      ownerDecisions,
      ticketBranch: {
        statesSeen: [...branchStates],
        tipMoves: Math.max(0, tips.size - 1),
        finalState: branch?.state ?? null,
        finalMerge,
        mainAtMergedCommit:
          typeof branch?.mergedCommit === 'string' && mainNow === branch.mergedCommit,
        branchDeleted: branchLeft === '',
        baseMovedBeforeOwnerMerge,
      },
      tokens: {
        budgetUsedByKind: budgetByKind,
        budgetUsedTotal: end.agents.reduce((n, a) => n + a.budget.used, 0),
        perAgent: end.agents.map((a) => ({
          kind: a.kind,
          nodeId: nodeOf(g, a.id)?.nodeId ?? null,
          used: a.budget.used,
          limit: a.budget.limit,
        })),
      },
      content: {
        logLines: logs.length,
        logHasPlanSummary: plan !== undefined && logText.includes(plan.summary),
        logHasCommentText: comments.some((x) => logText.includes(x)),
      },
      ...(autopilot !== null && {
        autopilot: {
          plansSubmitted: autopilot.log.plansSubmitted,
          helpersStarted: autopilot.log.helpersStarted,
          workerTurns: autopilot.log.workerTurns,
          testerTurns: autopilot.log.testerTurns,
          reviews: autopilot.log.reviews,
          leadDecisions: autopilot.log.leadDecisions,
          asks: autopilot.log.asks,
          refusedLeadCalls: autopilot.log.errors.length,
        },
      }),
    };
    if (!options.dryRun) {
      // Kept with the temp folders for inspection; aggregates only, as printed.
      writeFileSync(join(dataDir, 'server.log'), `${logText}\n`);
      writeFileSync(
        join(dataDir, 'real-run-summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
    }
    return { ok: summary['ok'] === true, summary };
  } catch (error) {
    if (runId !== null) await b.post(`/api/runs/${runId}/stop`).catch(() => undefined);
    await autopilot?.stop();
    throw error;
  } finally {
    await b.close();
    if (options.keep === true) options.onKept?.(made);
    else for (const dir of made) rmSync(dir, { recursive: true, force: true });
  }
}
