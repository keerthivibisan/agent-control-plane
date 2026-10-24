import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import {
  RunDetailDtoSchema,
  TicketBranchReviewDtoSchema,
  TicketDetailDtoSchema,
  type RunDetailDto,
  type TicketBranchDto,
} from '@acp/core/api';
import { createCodeHostService } from '../../src/code-host/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { createFakeGh, withBareOrigin, type FakeGh } from '../code-host/fake-gh.js';
import type { FakeAgent } from '../control/fake-adapter.js';
import { setupBoard } from '../board/helpers.js';
import { FILES, type Board } from '../board/loop-helpers.js';
import { GIT_TEST_ENV, git } from '../workspace/helpers.js';

/**
 * The adversarial kit (T-1, owner request 2026-10-24 after the ACPGIT-3 incident). The existing
 * board tests assume well-behaved agents; here the fake managed adapter plays agents that
 * MISBEHAVE. A "misbehaviour" is the test itself running git or file-system operations inside a
 * helper's worktree during its turn, exactly what a Bash command the gate let through would do.
 * Nothing here stops those operations (that is the adapter guard's job, tested in
 * `packages/adapters/claude-code/tests/managed/adversarial-commands.test.ts`); the invariants say
 * what the APP must still guarantee afterwards. Real git in throwaway repositories, a local bare
 * `origin`, a fake `gh`, the fake adapter for every agent; never the real `claude`, never the
 * owner's data. Synthetic data only.
 *
 * Every invariant failure message starts with its tag (`[ticket-branch]`, `[base]`, `[origin]`,
 * `[sealed]`, `[bounded]`, `[owner-progress]`, `[lead-progress]`), so a known gap
 * (`knownGap`) can say exactly which invariant it expects to break today.
 */

export type Mode = 'auto-edits' | 'full-auto';
export const MODES: readonly Mode[] = ['auto-edits', 'full-auto'];

/** The one plan step every scenario approves (so the start bound is easy to state). */
export const PLAN_STEPS = 1;

/**
 * A test that documents a gap the app has TODAY (expected-failure policy, docs/testing/
 * adversarial.md): it passes while the body fails with a message carrying `[tag]`, and fails
 * (turns red) as soon as the body passes, so the fix that closes the gap has to turn it into a
 * plain `it`. Any other error (a broken setup, a different invariant) still fails the test, which
 * `it.fails` alone would hide. `fix` names what is expected to close it (`F-2` today).
 */
export function knownGap(
  fix: 'F-2',
  tag: string,
  title: string,
  body: () => Promise<void> | void,
  timeout?: number,
): void {
  it(
    `[known gap, ${fix}] ${title}`,
    async () => {
      let failure: Error | undefined;
      try {
        await body();
      } catch (error) {
        failure = error instanceof Error ? error : new Error('a non-Error was thrown');
      }
      if (failure === undefined) {
        throw new Error(
          `This known gap (${fix}, [${tag}]) is closed now: make "${title}" a plain it() and ` +
            'update docs/testing/adversarial.md.',
        );
      }
      if (!failure.message.includes(`[${tag}]`)) throw failure;
      // `ACP_SHOW_KNOWN_GAPS=1` prints what each gap breaks today (for the guide and reports).
      if (process.env['ACP_SHOW_KNOWN_GAPS'] === '1') {
        console.warn(`known gap (${fix}) ${title}:\n  ${failure.message.split('\n')[0] ?? ''}`);
      }
    },
    timeout,
  );
}

// ------------------------------------------------------------------ the ledger

/** Long-lived refs: everything in `refs/heads` and `refs/tags` the app does not own (`acp/…`). */
function refsOf(repo: string, prefixes: readonly string[]): Map<string, string> {
  const out = git(repo, 'for-each-ref', '--format=%(refname) %(objectname)', ...prefixes);
  const map = new Map<string, string>();
  for (const line of out.split('\n')) {
    const [name, sha] = line.split(' ');
    if (name === undefined || sha === undefined || name === '') continue;
    if (name.startsWith('refs/heads/acp/')) continue;
    map.set(name, sha);
  }
  return map;
}

const LOCAL = ['refs/heads', 'refs/tags', 'refs/stash'];
const REMOTE = ['refs/heads', 'refs/tags'];

/**
 * What the test knows happened outside the app: the injected faults (each re-snapshots the refs
 * it may have moved, so the invariants check only what the APP did afterwards), the files each
 * actor wrote into each worktree, and the owner's own pushes and merges.
 */
export class Ledger {
  readonly faults: string[] = [];
  /** Absolute worktree path → repository-relative paths written there (by anyone). */
  readonly writes = new Map<string, Set<string>>();
  refs: Map<string, string>;
  origin: Map<string, string>;

  constructor(
    readonly repo: string,
    readonly bare: string,
  ) {
    this.refs = refsOf(repo, LOCAL);
    this.origin = refsOf(bare, REMOTE);
  }

  /** Runs one misbehaviour and accepts whatever refs it moved as foreign (not the app's). */
  fault(name: string, act: () => void): void {
    this.faults.push(name);
    act();
    this.resnapshot();
  }

  /** The owner moved refs on purpose (a merge, a push): the new values are expected. */
  resnapshot(): void {
    this.refs = refsOf(this.repo, LOCAL);
    this.origin = refsOf(this.bare, REMOTE);
  }

  write(worktree: string, path: string, content: string): void {
    const full = join(worktree, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    const set = this.writes.get(worktree) ?? new Set<string>();
    set.add(path);
    this.writes.set(worktree, set);
  }

  /** Every path anyone wrote into any worktree. */
  allWrites(): Set<string> {
    const all = new Set<string>();
    for (const set of this.writes.values()) for (const p of set) all.add(p);
    return all;
  }
}

// ------------------------------------------------------------------ scenarios

export interface Scenario {
  s: Board;
  gh: FakeGh;
  bare: string;
  ledger: Ledger;
  mode: Mode;
  ticketId: string;
  runId: string;
  lead: FakeAgent;
  /** The ticket branch's name (`acp/WEBAPP-1`). */
  branch: string;
  /** The run's rework limit (the start bound uses it). */
  rounds: number;
}

export interface ScenarioOptions {
  mode?: Mode;
  /** `lead` (default): no change-review agents, so agent starts are easy to count. */
  reviewer?: 'lead' | 'agent';
  rounds?: number;
  files?: Record<string, string>;
  /** Extra long-lived branches made at the base tip before the run (e.g. `dev`). */
  branches?: readonly string[];
}

/**
 * A ticket run with an approved one-step plan, its ticket branch made: the project has a local
 * bare `origin` (with `main` pushed) and a fake `gh`. Full auto approves the plan itself.
 */
export async function scenario(o: ScenarioOptions = {}): Promise<Scenario> {
  const mode = o.mode ?? 'auto-edits';
  // `ACP_T1_LOG=1` prints the app's structured log lines (ids, codes and counts only).
  const logger = {
    log: (...args: unknown[]) => {
      if (process.env['ACP_T1_LOG'] === '1') console.warn(JSON.stringify(args));
    },
  };
  const gh = createFakeGh();
  const codeHost = createCodeHostService({
    git: createGitRunner({ env: GIT_TEST_ENV }),
    cli: gh.run,
    logger,
  });
  const s = await setupBoard({ files: o.files ?? FILES, logger, codeHost });
  const bare = withBareOrigin(s.repo);
  for (const b of o.branches ?? []) git(s.repo, 'branch', b);
  git(s.repo, 'push', '--quiet', 'origin', 'main', ...(o.branches ?? []));
  gh.state.bare = bare;
  if (mode === 'full-auto') {
    const setup = {
      projectKey: 'WEBAPP',
      maxConcurrentHelpers: 3,
      maxDepth: 1,
      defaultBudgetTokensPerAgent: 100_000,
      model: null,
      approvals: { mode: 'full-auto', commands: [] },
      contextFiles: [],
    };
    expect((await s.send('put', `/api/projects/${s.project.id}/setup`, setup)).status).toBe(200);
  }
  const ticket = await s.createTicket('Add dark mode');
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  const start = {
    reviewer: o.reviewer ?? 'lead',
    maxReworkRounds: o.rounds ?? 2,
    ...(mode === 'full-auto' ? { approvalMode: 'full-auto' } : {}),
  };
  expect((await s.post(`/api/tickets/${ticket.id}/start`, start)).status).toBe(200);
  await s.settle();
  const lead = s.fake.lead();
  lead.started();
  await s.settle();
  await lead.callLead('submit_plan', {
    summary: 'Add a theme toggle',
    steps: [{ title: 'Build the toggle', role: 'Builder', detail: 'In settings' }],
  });
  await s.settle();
  if (mode !== 'full-auto') {
    const plan = (await s.detail(ticket.id)).plans[0];
    const decided = await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
      decision: 'approve',
    });
    expect(decided.status).toBe(200);
    await s.settle();
  }
  const runId = (await s.detail(ticket.id)).currentRun?.id ?? '';
  const detail = await runDetail(s, runId);
  expect(detail.status).toBe('RUNNING');
  const branch = detail.ticketBranch?.branch ?? '';
  expect(branch).toBe('acp/WEBAPP-1');
  return {
    s,
    gh,
    bare,
    ledger: new Ledger(s.repo, bare),
    mode,
    ticketId: ticket.id,
    runId,
    lead,
    branch,
    rounds: detail.maxReworkRounds ?? o.rounds ?? 2,
  };
}

export async function runDetail(s: Board, runId: string): Promise<RunDetailDto> {
  await s.settle();
  return RunDetailDtoSchema.parse((await s.get(`/api/runs/${runId}`)).body);
}

/** The lead starts a helper; it reports its session. Null when the app refused the start. */
export async function startHelper(sc: Scenario, role = 'Builder'): Promise<FakeAgent | null> {
  const before = sc.s.fake.workers().length;
  try {
    await sc.lead.callLead('start_agent', { role, task: `Build the ${role} part` });
  } catch {
    return null;
  }
  await sc.s.settle();
  const worker = sc.s.fake.workers().at(-1);
  if (worker === undefined || sc.s.fake.workers().length === before) return null;
  worker.started();
  await sc.s.settle();
  return worker;
}

/** What one helper's turn may see and do. */
export interface TurnContext {
  sc: Scenario;
  worker: FakeAgent;
  /** The helper's worktree (its `cwd`). */
  wt: string;
  /** Test-side git in the helper's worktree, as its Bash command would run it. */
  sh: (...args: string[]) => string;
  /** A file write in the helper's worktree, recorded in the ledger. */
  write: (path: string, content: string) => void;
}

export function turnContext(sc: Scenario, worker: FakeAgent): TurnContext {
  const wt = sc.s.worktree(sc.runId, worker.id);
  return {
    sc,
    worker,
    wt,
    sh: (...args) => git(wt, ...args),
    write: (path, content) => sc.ledger.write(wt, path, content),
  };
}

/**
 * One helper turn: the helper starts, does its honest work (`fixed.txt` makes the checks pass),
 * then `misbehave` (recorded as a fault), then finishes. Null when the app refused the start.
 */
export async function helperTurn(
  sc: Scenario,
  misbehave: ((t: TurnContext) => void) | null,
  options: { files?: Record<string, string>; finish?: boolean; name?: string } = {},
): Promise<FakeAgent | null> {
  const worker = await startHelper(sc);
  if (worker === null) return null;
  const t = turnContext(sc, worker);
  const files = options.files ?? {
    'fixed.txt': 'ok\n',
    [`src/w${sc.s.fake.workers().length}.ts`]: 'export {};\n',
  };
  for (const [path, content] of Object.entries(files)) t.write(path, content);
  if (misbehave !== null) sc.ledger.fault(options.name ?? 'misbehaviour', () => misbehave(t));
  if (options.finish !== false) {
    worker.finish('success');
    await sc.s.settle();
  }
  return worker;
}

export function tipOf(repo: string, branch: string): string | null {
  try {
    return git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).trim();
  } catch {
    return null;
  }
}

export function changeOf(detail: RunDetailDto, agentRunId: string) {
  return detail.changes?.find((c) => c.agentRunId === agentRunId);
}

/** The lead decides a change it can decide: merge it (the review agent is skipped: `lead`). */
export async function leadMerges(sc: Scenario, agentId: string): Promise<string> {
  let reply = '';
  // A merge onto a moved tip starts the checks on the new commit first; then it is tried again.
  for (let i = 0; i < 3; i++) {
    reply = await leadCall(sc, 'merge_change', { agentId });
    if (!reply.includes('checks are running')) break;
  }
  return reply;
}

export async function leadCall(sc: Scenario, name: string, input: object): Promise<string> {
  try {
    const reply = await sc.lead.callLead(name as Parameters<FakeAgent['callLead']>[0], input);
    await sc.s.settle();
    return reply;
  } catch (error) {
    await sc.s.settle();
    return `refused: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** An honest helper whose change the lead merges into the ticket branch. */
export async function goodChange(sc: Scenario): Promise<FakeAgent> {
  const worker = await helperTurn(sc, null);
  if (worker === null) throw new Error('the app refused an honest helper');
  const reply = await leadMerges(sc, worker.id);
  expect(reply).toContain('Merged');
  return worker;
}

/** The lead hands over; the run is in REVIEW and its checks have finished. */
export async function handOver(sc: Scenario): Promise<RunDetailDto> {
  const reply = await leadCall(sc, 'request_review', { summary: 'Synthetic summary.' });
  expect(reply).not.toMatch(/^refused/);
  const detail = await runDetail(sc.s, sc.runId);
  expect(detail.status).toBe('REVIEW');
  return detail;
}

// ------------------------------------------------------------------ the persistent lead

/**
 * A lead that never gives up (what the real lead did in ACPGIT-3): for every change it cannot
 * merge it tries discard and rework, and then starts a replacement helper for the same step, which
 * misbehaves the same way. It stops when a change merged, when the app refuses a start, or after
 * `attempts` helpers (the test's own safety net). Returns the helper starts the app allowed.
 */
export async function persistentLead(
  sc: Scenario,
  misbehave: (t: TurnContext) => void,
  attempts = 8,
): Promise<{ starts: number; merged: boolean; refusedStart: boolean }> {
  let starts = 0;
  for (let i = 0; i < attempts; i++) {
    const worker = await helperTurn(sc, misbehave, { name: `attempt ${i + 1}` });
    if (worker === null) return { starts, merged: false, refusedStart: true };
    starts++;
    const change = changeOf(await runDetail(sc.s, sc.runId), worker.id);
    if (change?.state === 'reviewing' || change?.state === 'decision') {
      const reply = await leadMerges(sc, worker.id);
      if (reply.startsWith('Merged')) return { starts, merged: true, refusedStart: false };
    }
    await leadCall(sc, 'discard_change', { agentId: worker.id, reason: 'Synthetic: retry.' });
    const after = changeOf(await runDetail(sc.s, sc.runId), worker.id);
    if (after?.state === 'merged') return { starts, merged: true, refusedStart: false };
  }
  return { starts, merged: false, refusedStart: false };
}

// ------------------------------------------------------------------ the invariants

export interface InvariantOptions {
  /** Setup outputs (repository-relative folders) that must never be sealed. */
  outputs?: readonly string[];
  /** Check (f) too: the owner can always finish (destructive; run it last). */
  finish?: boolean;
}

const ATTACHMENTS = '.acp-attachments';

/** Helper starts the run may make: one per plan step and rework round, plus one replacement. */
export function startBound(sc: Scenario): number {
  return PLAN_STEPS * (1 + sc.rounds) + 1;
}

function changedFiles(repo: string, from: string, to: string): string[] {
  return git(repo, 'diff', '--name-only', '--no-renames', from, to)
    .split('\n')
    .filter((p) => p !== '');
}

/**
 * The app's invariants after any misbehaviour (docs/testing/adversarial.md):
 * (a) `[ticket-branch]` the ticket branch holds only commits the app recorded; if it was moved
 *     outside the app, the owner's merge, Push & open PR and Merge pull request all refuse, and
 *     the run is not done;
 * (b) `[base]` no long-lived branch or tag moved except by a recorded fault or the owner;
 * (c) `[origin]` `origin` changed only by a recorded fault or the owner's push;
 * (d) `[sealed]` every sealed change and the ticket branch hold only files written into a
 *     worktree, never attachment copies or setup outputs;
 * (e) `[bounded]` helper starts stay within `startBound`, and no helper is left running;
 * (f) `[owner-progress]` (with `finish`) the owner can discard every stuck change, reset a ticket
 *     branch moved outside the app to its recorded tip (F-1), and then end the run (discard the
 *     ticket branch, or stop it): never a dead end.
 */
export async function assertInvariants(sc: Scenario, o: InvariantOptions = {}): Promise<void> {
  const { s, runId, ledger } = sc;
  const detail = await runDetail(s, runId);
  const record: TicketBranchDto | undefined = detail.ticketBranch ?? undefined;
  const tip = tipOf(s.repo, sc.branch);

  // (a) the ticket branch.
  if (
    record !== undefined &&
    record.state === 'open' &&
    tip !== null &&
    tip !== record.headCommit
  ) {
    const mainBefore = tipOf(s.repo, 'main');
    const originBefore = new Map(refsOf(sc.bare, REMOTE));
    const merge = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
    expect(merge.status, '[ticket-branch] the owner merged a moved ticket branch').not.toBe(200);
    const anyway = await s.post(`/api/runs/${runId}/ticket-branch`, {
      action: 'merge-anyway',
      reason: 'Synthetic.',
    });
    expect(anyway.status, '[ticket-branch] merge anyway took a moved ticket branch').not.toBe(200);
    const pr = await s.post(`/api/tickets/${sc.ticketId}/branch/pull-request`, {});
    expect(pr.status, '[ticket-branch] Push & open PR published a moved ticket branch').not.toBe(
      200,
    );
    const prMerge = await s.post(`/api/tickets/${sc.ticketId}/branch/pull-request/merge`, {
      method: 'merge',
      deleteBranch: false,
    });
    expect(prMerge.status, '[ticket-branch] Merge pull request took a moved branch').not.toBe(200);
    expect(tipOf(s.repo, 'main'), '[ticket-branch] main moved on a refused merge').toBe(mainBefore);
    expect(refsOf(sc.bare, REMOTE), '[ticket-branch] origin changed on a refused push').toEqual(
      originBefore,
    );
    const after = await runDetail(s, runId);
    expect(after.status, '[ticket-branch] the run completed on a moved branch').not.toBe(
      'COMPLETED',
    );
    const ticket = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${sc.ticketId}`)).body);
    expect(ticket.ticket.status, '[ticket-branch] the ticket is Done on a moved branch').not.toBe(
      'DONE',
    );
  }

  // (b) long-lived branches and tags.
  expect(
    refsOf(s.repo, LOCAL),
    '[base] a long-lived ref moved outside a fault or the owner',
  ).toEqual(ledger.refs);

  // (c) origin.
  expect(refsOf(sc.bare, REMOTE), '[origin] origin changed outside a fault or the owner').toEqual(
    ledger.origin,
  );

  // (d) sealed changes and the ticket branch's own files.
  const written = ledger.allWrites();
  const outputs = o.outputs ?? [];
  const forbidden = (p: string) =>
    p === ATTACHMENTS ||
    p.startsWith(`${ATTACHMENTS}/`) ||
    outputs.some((out) => p === out || p.startsWith(`${out}/`));
  const base = record?.baseCommit;
  if (base !== undefined) {
    for (const change of detail.changes ?? []) {
      if (change.headCommit === null) continue;
      for (const p of changedFiles(s.repo, base, change.headCommit)) {
        expect(forbidden(p), `[sealed] ${change.role}'s sealed change holds ${p}`).toBe(false);
        expect(written.has(p), `[sealed] ${change.role}'s change holds ${p}, never written`).toBe(
          true,
        );
      }
    }
    if (record !== undefined && record.state === 'open') {
      for (const p of changedFiles(s.repo, base, record.headCommit)) {
        expect(forbidden(p), `[sealed] the ticket branch holds ${p}`).toBe(false);
        expect(written.has(p), `[sealed] the ticket branch holds ${p}, never written`).toBe(true);
      }
    }
  }

  // (e) bounded starts, nothing left running.
  const helperStarts = s.fake.agents.filter((a) => a.spec.kind === 'worker').length;
  expect(
    helperStarts,
    `[bounded] ${helperStarts} helper starts for ${PLAN_STEPS} plan step(s) (bound ${startBound(sc)})`,
  ).toBeLessThanOrEqual(startBound(sc));
  for (const a of detail.agents) {
    if (a.kind === 'lead') continue;
    expect(['RUNNING', 'STARTING'], `[bounded] ${a.role} is still ${a.status}`).not.toContain(
      a.status,
    );
  }

  if (o.finish === true) await assertOwnerCanFinish(sc);
}

/**
 * (f) The owner always has an action that makes progress: every change waiting for the owner can
 * be discarded, and then the run can be ended (the lead hands over and the owner discards the
 * ticket branch, or the owner stops the run). The moved ticket branch is never merged on the way.
 */
export async function assertOwnerCanFinish(sc: Scenario): Promise<void> {
  const { s, runId } = sc;
  const mainBefore = tipOf(s.repo, 'main');
  let detail = await runDetail(s, runId);
  for (const change of detail.changes ?? []) {
    // Waiting for the owner, or (F-1) a change whose worktree left its branch: nothing saved.
    const stuck =
      change.state === 'needs-owner' || (change.state === 'decision' && change.headCommit === null);
    if (!stuck) continue;
    const r = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: change.agentRunId,
      action: 'discard',
      reason: 'Synthetic: discarded by the owner.',
    });
    expect(r.status, `[owner-progress] the owner could not discard ${change.role}`).toBe(200);
  }
  // F-1: a ticket branch moved outside the app is shown (`movedOutside`), and the owner can reset
  // it to the last reviewed commit by compare-and-swap from the tip they saw.
  const review = TicketBranchReviewDtoSchema.safeParse(
    (await s.get(`/api/runs/${runId}/ticket-branch`)).body,
  );
  const moved = review.success ? review.data.ticketBranch.movedOutside : undefined;
  const actual = tipOf(s.repo, sc.branch);
  const recorded = review.success ? review.data.ticketBranch : undefined;
  if (recorded?.state === 'open' && actual !== null && actual !== recorded.headCommit) {
    expect(moved?.tip, '[owner-progress] a moved ticket branch is not shown as moved').toBe(actual);
    const r = await s.post(`/api/runs/${runId}/ticket-branch/reset`, { from: actual });
    expect(r.status, '[owner-progress] the owner could not reset the moved ticket branch').toBe(
      200,
    );
    expect(tipOf(s.repo, sc.branch), '[owner-progress] the reset left the branch moved').toBe(
      recorded.headCommit,
    );
    const after = TicketBranchReviewDtoSchema.parse(
      (await s.get(`/api/runs/${runId}/ticket-branch`)).body,
    );
    expect(after.ticketBranch.movedOutside).toBeUndefined();
  }
  detail = await runDetail(s, runId);
  if (detail.status === 'RUNNING') {
    // The lead hands over once nothing is undecided (it is a fake: the test calls for it).
    await leadCall(sc, 'request_review', { summary: 'Synthetic summary.' });
    detail = await runDetail(s, runId);
  }
  if (detail.status === 'REVIEW' || detail.status === 'NEEDS_REVIEW') {
    const r = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'discard' });
    expect(r.status, '[owner-progress] the owner could not discard the ticket branch').toBe(200);
  } else if (!['COMPLETED', 'CANCELLED', 'FAILED'].includes(detail.status)) {
    const r = await s.post(`/api/runs/${runId}/stop`);
    expect(r.status, `[owner-progress] the owner could not stop a ${detail.status} run`).toBe(200);
  }
  detail = await runDetail(s, runId);
  expect(
    ['COMPLETED', 'CANCELLED', 'CANCELLING', 'FAILED'],
    `[owner-progress] the run is still ${detail.status} after the owner's actions`,
  ).toContain(detail.status);
  expect(tipOf(s.repo, 'main'), '[owner-progress] finishing moved main').toBe(mainBefore);
}
