import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PermissionDecision } from '@acp/core';
import {
  RunDetailDtoSchema,
  TicketDetailDtoSchema,
  type ChangeReviewDto,
  type RunDetailDto,
} from '@acp/core/api';
import type { FakeAgent } from '../../control/fake-adapter.js';
import { ok, type GraphServer } from './harness.js';

/*
 * A scripted autopilot for one ticket run's fake agents (WG-V). Vitest-free: the upgrade fixture
 * and the real-run driver's `--dry-run` share it. It only plays the AGENTS, through the same
 * channels a real agent has (the fake adapter's events, lead tools and permission requests); the
 * owner's part (plan decisions, approvals, owner decisions, the final merge) stays with the
 * caller, over HTTP. Every text it sends is synthetic.
 *
 * To keep review order deterministic, a helper finishes only while no other change of the run is
 * being sealed, reviewed or decided, so at most one change reviewer works at a time.
 */

export interface PlanStepScript {
  title: string;
  role: string;
  detail: string;
  /** A named helper node (ADR-0023 §7); absent: by label, else the pool. */
  helper?: string;
}

/** A permission request a helper or tester makes before writing its files. */
export interface ScriptedAsk {
  toolName: string;
  summary: string;
  /** `{cwd}` in a string value is replaced with the agent's own worktree. */
  input: Record<string, unknown>;
}

export interface AutopilotScript {
  plan: readonly PlanStepScript[];
  /** Files a helper writes into its worktree in `round` (0 first, then one per rework). */
  helperFiles(role: string, round: number): Readonly<Record<string, string>>;
  /** A change reviewer's verdict on a change in `round`. Default: approve. */
  verdict?(role: string, round: number): 'approve' | 'rework';
  /** The lead's decision on a change waiting for it. Default: merge. */
  leadDecision?(role: string, round: number): 'merge' | 'rework';
  /** Files the tester writes into its worktree. */
  testerFiles?: Readonly<Record<string, string>>;
  /** Requests a helper (by role) or the tester (role `tester`) makes before writing. */
  asks?(role: string, round: number): readonly ScriptedAsk[];
}

/** What the agents did, aggregated (no text). */
export interface AutopilotLog {
  plansSubmitted: number;
  helpersStarted: number;
  workerTurns: number;
  testerTurns: number;
  reviews: Record<string, number>;
  finalReviews: number;
  leadDecisions: Record<string, number>;
  handedOver: boolean;
  /** Permission requests, by `<role>:<tool>:<allow|deny>`. */
  asks: Record<string, number>;
  /** Lead tool calls the engine refused (message kept for tests on synthetic data only). */
  errors: string[];
}

export interface Autopilot {
  log: AutopilotLog;
  stop(): Promise<void>;
}

const FINAL = new Set(['merged', 'discarded', 'no-changes']);
const BUSY = new Set(['sealing', 'ready', 'reviewing', 'decision']);
const ENDED_RUN = new Set(['COMPLETED', 'CANCELLED', 'FAILED']);

function count(into: Record<string, number>, key: string): void {
  into[key] = (into[key] ?? 0) + 1;
}

function writeAll(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function withCwd(input: Record<string, unknown>, cwd: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, typeof v === 'string' ? v.replace('{cwd}', cwd) : v]),
  );
}

export function startAutopilot(
  b: GraphServer,
  ticketId: string,
  runId: string,
  script: AutopilotScript,
): Autopilot {
  const log: AutopilotLog = {
    plansSubmitted: 0,
    helpersStarted: 0,
    workerTurns: 0,
    testerTurns: 0,
    reviews: {},
    finalReviews: 0,
    leadDecisions: {},
    handedOver: false,
    asks: {},
    errors: [],
  };
  const reported = new Set<FakeAgent>();
  const acted = new Set<FakeAgent>();
  const stepsStarted = new Set<number>();
  const decided = new Set<string>();
  const startRefusals: Record<number, number> = {};
  const tasks: Promise<void>[] = [];
  let stopped = false;
  let leadBusy = false;
  /** Helper and tester turns still asking or writing. */
  let inFlight = 0;

  const verdict = (role: string, round: number) => script.verdict?.(role, round) ?? 'approve';
  const leadDecision = (role: string, round: number) =>
    script.leadDecision?.(role, round) ?? 'merge';

  /** One lead tool call at a time; a refusal is logged, never thrown. */
  async function lead(
    agent: FakeAgent,
    name: Parameters<FakeAgent['callLead']>[0],
    input: unknown,
  ) {
    leadBusy = true;
    try {
      return await agent.callLead(name, input);
    } catch (error) {
      log.errors.push(`${name}: ${error instanceof Error ? error.message : 'refused'}`);
      return null;
    } finally {
      leadBusy = false;
    }
  }

  async function asksThen(
    agent: FakeAgent,
    role: string,
    round: number,
    files: Readonly<Record<string, string>>,
  ) {
    inFlight++;
    try {
      await turn(agent, role, round, files);
    } finally {
      inFlight--;
    }
  }

  async function turn(
    agent: FakeAgent,
    role: string,
    round: number,
    files: Readonly<Record<string, string>>,
  ) {
    for (const ask of script.asks?.(role, round) ?? []) {
      const decision: PermissionDecision = await agent.ask(
        ask.toolName,
        ask.summary,
        withCwd(ask.input, agent.spec.cwd),
      );
      count(log.asks, `${role}:${ask.toolName}:${decision.allow ? 'allow' : 'deny'}`);
    }
    writeAll(agent.spec.cwd, files);
    agent.finish('success');
  }

  async function tick(): Promise<void> {
    const r: RunDetailDto = RunDetailDtoSchema.parse(ok(await b.get(`/api/runs/${runId}`)));
    if (ENDED_RUN.has(r.status)) {
      stopped = true;
      return;
    }
    const t = TicketDetailDtoSchema.parse(ok(await b.get(`/api/tickets/${ticketId}`)));
    const byId = new Map(r.agents.map((a) => [a.id, a]));
    const mine = b.fake.agents.filter((a) => byId.has(a.id));
    // Each start reports its session once (the real adapter's `started` event).
    for (const a of mine) {
      if (!reported.has(a) && !a.ended) {
        a.started();
        reported.add(a);
      }
    }
    const live = mine.filter((a) => !a.ended && b.fake.byId(a.id) === a);
    const running = (a: FakeAgent) => byId.get(a.id)?.status === 'RUNNING';
    const changes: ChangeReviewDto[] = r.changes ?? [];
    const roleOf = (id: string) => byId.get(id)?.role ?? '';
    const leadAgent = live.find((a) => a.spec.kind === 'lead' && a.spec.followUp === undefined);
    const plannerAgent = live.find((a) => a.spec.kind === 'planner');
    const plans = t.plans.filter((p) => p.runId === runId);
    const approved = plans.some((p) => p.status === 'approved');

    // The plan: the planner writes it when the run has one, else the lead.
    const hasPlanner = r.agents.some((a) => a.kind === 'planner');
    const author = hasPlanner ? plannerAgent : leadAgent;
    const open = plans.some((p) => p.status === 'proposed' || p.status === 'approved');
    if (!open && author !== undefined && running(author) && plans.length === log.plansSubmitted) {
      log.plansSubmitted++;
      const reply = await lead(author, 'submit_plan', {
        summary: 'Synthetic plan.',
        steps: script.plan.map((s) => ({ ...s })),
      });
      if (reply === null) log.plansSubmitted--;
      return;
    }

    if (leadAgent === undefined || !running(leadAgent) || leadBusy) return;

    /** Route a: the lead reviews the change itself, once the engine tells it the change is ready. */
    const toldToReview = (c: ChangeReviewDto): boolean => {
      if (c.state !== 'reviewing') return false;
      const ready = `(agentId ${c.agentRunId}) is ready for your review`;
      const round = c.reworkRounds > 0 ? ` after rework round ${c.reworkRounds}.` : null;
      return mine
        .filter((a) => a.spec.kind === 'lead')
        .some((a) =>
          a.sent.some(
            (m) =>
              m.includes(ready) &&
              (round === null
                ? !m.includes(`${ready} after rework`)
                : m.includes(`${ready}${round}`)),
          ),
        );
    };

    // The lead decides a change waiting for it.
    for (const c of changes) {
      const key = `${c.agentRunId}:${c.reworkRounds}`;
      if (decided.has(key) || !(c.state === 'decision' || toldToReview(c))) continue;
      const role = roleOf(c.agentRunId);
      const choice = leadDecision(role, c.reworkRounds);
      if (choice === 'rework') {
        const reply = await lead(leadAgent, 'request_rework', {
          agentId: c.agentRunId,
          comments: 'Synthetic rework note.',
        });
        if (reply !== null) {
          decided.add(key);
          count(log.leadDecisions, 'rework');
        }
      } else {
        const reply = await lead(leadAgent, 'merge_change', { agentId: c.agentRunId });
        if (reply?.startsWith('Merged') === true) {
          decided.add(key);
          count(log.leadDecisions, 'merge');
        }
      }
      return;
    }

    // The lead starts the plan's helpers, one per tick.
    // (A loop run makes its ticket branch at plan approval; helpers start from it.)
    if (approved && r.status === 'RUNNING' && r.ticketBranch !== null) {
      const next = script.plan.findIndex((_, i) => !stepsStarted.has(i));
      const step = script.plan[next];
      if (step !== undefined) {
        const reply = await lead(leadAgent, 'start_agent', {
          role: step.role,
          task: `Synthetic task: ${step.title}`,
          ...(step.helper !== undefined && { helper: step.helper }),
        });
        if (reply !== null) {
          stepsStarted.add(next);
          log.helpersStarted++;
        } else if ((startRefusals[next] = (startRefusals[next] ?? 0) + 1) >= 20) {
          stepsStarted.add(next); // refused again and again (logged): given up
        }
        return;
      }
    }

    // Helpers and testers: one at a time, while no other change is in review.
    const busy = changes.some((c) => BUSY.has(c.state));
    for (const a of live) {
      if (acted.has(a) || !running(a)) continue;
      if (a.spec.kind === 'worker' && !busy) {
        acted.add(a);
        log.workerTurns++;
        const role = roleOf(a.id);
        const round = b.fake.agents.filter((x) => x.id === a.id).length - 1;
        tasks.push(asksThen(a, role, round, script.helperFiles(role, round)));
        return;
      }
      if (a.spec.kind === 'tester' && !busy) {
        acted.add(a);
        log.testerTurns++;
        const round = b.fake.agents.filter((x) => x.id === a.id).length - 1;
        const files = script.testerFiles ?? { 'tests/synthetic.test.txt': 'synthetic test\n' };
        tasks.push(asksThen(a, 'tester', round, files));
        return;
      }
      if (a.spec.kind === 'reviewer' && a.spec.reviewScope === 'change') {
        const reviewing = changes.filter((c) => c.state === 'reviewing');
        const target = reviewing[0];
        if (reviewing.length !== 1 || target === undefined) continue;
        acted.add(a);
        const v = verdict(roleOf(target.agentRunId), target.reworkRounds);
        count(log.reviews, v);
        await a.callLead('submit_review', { verdict: v, findings: 'Synthetic findings.' });
        a.finish('success');
        return;
      }
      if (a.spec.kind === 'reviewer') {
        acted.add(a);
        log.finalReviews++;
        await a.callLead('post_review', { text: 'Synthetic final review.' });
        a.finish('success');
        return;
      }
    }

    // Hand over once every step started, every helper ended and every change is final.
    const editingLive = live.some((a) => a.spec.kind === 'worker' || a.spec.kind === 'tester');
    if (
      approved &&
      r.status === 'RUNNING' &&
      !log.handedOver &&
      stepsStarted.size === script.plan.length &&
      !editingLive &&
      inFlight === 0 &&
      changes.length > 0 &&
      changes.every((c) => FINAL.has(c.state))
    ) {
      const reply = await lead(leadAgent, 'request_review', {});
      if (reply !== null) log.handedOver = true;
    }
  }

  const loop = (async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (error) {
        // A transient read while the server closes, or a lost race: logged, the loop goes on.
        log.errors.push(`tick: ${error instanceof Error ? error.message : 'failed'}`);
        if (log.errors.length > 200) stopped = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  })();

  return {
    log,
    async stop() {
      stopped = true;
      await loop;
      await Promise.allSettled(tasks);
    },
  };
}
