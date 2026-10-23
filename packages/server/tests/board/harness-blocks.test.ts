import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workflowTemplate, type WorkflowEdge, type WorkflowGraph } from '@acp/core';
import { CheckRunDtoSchema, TicketDetailDtoSchema } from '@acp/core/api';
import { git } from '../workspace/helpers.js';
import { LEAD, POOL, putGraph } from './graph-helpers.js';
import { setupBoard } from './helpers.js';
import { approved, run, type Board } from './loop-helpers.js';

/*
 * The harness in the workflow, server half (ADR-0027, H-B): the setup runs in each new editing
 * agent's worktree before it starts and in each fresh check checkout; a failed or refused setup
 * never starts the agent; Checks blocks run at their places (a helper's change, before the lead's
 * merge, the ticket branch) and store where each check ran. The fake managed adapter plays every
 * agent; setup and checks are tiny node scripts in a throwaway repository. Synthetic data only.
 */

interface HarnessOptions {
  network?: boolean;
  /** The setup step's exit code (0 passes). */
  setupExit?: number;
}

/**
 * A harness with one setup step (it makes `prepared/`, declared as an output) and two checks:
 * `fast` (required, label fast: passes once `fixed.txt` exists and the setup ran) and `full`
 * (not required, label full: passes once the setup ran).
 */
function files(options: HarnessOptions = {}): Record<string, string> {
  return {
    'README.md': 'x\n',
    'src/app.ts': 'export {};\n',
    '.acp/harness.json': JSON.stringify({
      version: 1,
      setup: [
        {
          id: 'prepare',
          name: 'Prepare',
          argv: ['node', 'prepare.mjs'],
          timeoutSec: 30,
          ...(options.network === true && { network: true }),
          outputs: ['prepared'],
        },
      ],
      checks: [
        {
          id: 'fast',
          name: 'Fast',
          argv: ['node', 'fast.mjs'],
          timeoutSec: 30,
          required: true,
          labels: ['fast'],
        },
        {
          id: 'full',
          name: 'Full',
          argv: ['node', 'full.mjs'],
          timeoutSec: 30,
          required: false,
          labels: ['full'],
        },
      ],
    }),
    'prepare.mjs': [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "mkdirSync('prepared', { recursive: true });",
      "writeFileSync('prepared/ok', 'y');",
      "console.log('prepared the copy');",
      `process.exit(${options.setupExit ?? 0});`,
    ].join('\n'),
    'fast.mjs': [
      "import { existsSync } from 'node:fs';",
      "if (!existsSync('prepared/ok')) { console.error('setup did not run'); process.exit(5); }",
      "if (!existsSync('fixed.txt')) { console.error('fixed.txt is missing'); process.exit(1); }",
    ].join('\n'),
    'full.mjs':
      "import { existsSync } from 'node:fs'; process.exit(existsSync('prepared/ok') ? 0 : 5);",
  };
}

const flow = (from: string, to: string): WorkflowEdge => ({
  type: 'flow',
  id: `flow-${from}-${to}`.slice(0, 40),
  from,
  to,
});

const CHANGE_BLOCK = 'fast-checks';
const BRANCH_BLOCK = 'full-checks';

/**
 * Lead only (the lead reviews each change), plus a fast block on the pool's change (back to the
 * helper, `rounds`) and, optionally, a full block on the ticket branch before the owner's merge.
 */
function blocksGraph(rounds: number, branch: boolean): WorkflowGraph {
  const g = workflowTemplate('lead-only');
  const edges: WorkflowEdge[] = [
    ...g.edges.filter((e) => !(branch && e.type === 'flow' && e.from === 'ticket-merge')),
    flow(POOL, CHANGE_BLOCK),
    { type: 'rework', id: 'rework-fast-pool', from: CHANGE_BLOCK, to: POOL, maxRounds: rounds },
  ];
  if (branch) edges.push(flow('ticket-merge', BRANCH_BLOCK), flow(BRANCH_BLOCK, 'owner-merge'));
  return {
    ...g,
    template: 'custom',
    nodes: [
      ...g.nodes,
      {
        type: 'checks',
        id: CHANGE_BLOCK,
        label: 'Fast checks',
        place: 'change',
        select: { kind: 'labels', labels: ['fast'] },
        onFailure: 'helper',
      },
      ...(branch
        ? [
            {
              type: 'checks' as const,
              id: BRANCH_BLOCK,
              label: 'Full checks',
              place: 'branch' as const,
              select: { kind: 'labels' as const, labels: ['full'] },
            },
          ]
        : []),
    ],
    edges,
  };
}

/** Settles until `done` holds (background checks chain: seal → change block → merge block). */
async function until(s: Board, done: () => Promise<boolean> | boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await s.settle();
    if (await done()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting');
}

async function checksOf(s: Board, runId: string) {
  return CheckRunDtoSchema.array().parse((await s.get(`/api/runs/${runId}/checks`)).body);
}

async function ticketDetail(s: Board, ticketId: string) {
  return TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticketId}`)).body);
}

describe('setup in an editing agent’s new worktree (ADR-0027 §1)', () => {
  it('runs before the helper starts, briefs it, and keeps the outputs out of its change', async () => {
    const s = await setupBoard({ files: files() });
    const { ticket, runId, lead } = await approved(s);
    await lead.callLead('start_agent', { role: 'Builder', task: 'Do the Builder part' });
    await s.settle();
    const worker = s.fake.workers().at(-1);
    if (worker === undefined) throw new Error('no worker');
    const wt = s.worktree(runId, worker.id);
    // The setup ran in the helper's worktree before its start, never in the owner's checkout.
    expect(existsSync(join(wt, 'prepared', 'ok'))).toBe(true);
    expect(existsSync(join(s.repo, 'prepared'))).toBe(false);
    // The brief lists the setup that ran and the checks the helper may run (exact commands).
    expect(worker.spec.prompt).toContain("The project's setup already ran in your copy: Prepare.");
    expect(worker.spec.prompt).toContain('Fast (`node fast.mjs`)');
    expect(worker.spec.prompt).toContain('Full (`node full.mjs`)');
    const setupRuns = (await ticketDetail(s, ticket.id)).setupRuns ?? [];
    expect(setupRuns.map((r) => [r.stepId, r.status, r.agentRunId, r.runId])).toEqual([
      ['prepare', 'passed', worker.id, runId],
    ]);
    expect(setupRuns[0]?.outputTail).toContain('prepared the copy');

    worker.started();
    await s.settle();
    writeFileSync(join(wt, 'fixed.txt'), 'ok\n');
    worker.finish('success');
    await until(s, async () => (await checksOf(s, runId)).length > 0);
    const change = (await run(s, runId)).changes?.find((c) => c.agentRunId === worker.id);
    const sealed = change?.headCommit ?? '';
    expect(sealed).toMatch(/^[0-9a-f]{40}$/);
    // The setup's output never reaches the change, but stays for the helper's own checks.
    const tree = git(wt, 'ls-tree', '-r', '--name-only', sealed);
    expect(tree).toContain('fixed.txt');
    expect(tree).not.toContain('prepared');
    expect(existsSync(join(wt, 'prepared', 'ok'))).toBe(true);
    // Without blocks in the graph the merge block (old default: every check) ran on the seal.
    expect((await checksOf(s, runId)).map((c) => [c.checkId, c.status, c.place])).toEqual([
      ['fast', 'passed', 'merge'],
      ['full', 'passed', 'merge'],
    ]);
    // The lead and the reviewer never get a setup: one setup run in the whole run.
    expect((await ticketDetail(s, ticket.id)).setupRuns).toHaveLength(1);
  }, 60_000);

  it('does not start the helper when a network step is refused, and says why', async () => {
    const s = await setupBoard({ files: files({ network: true }) });
    const { ticket, runId, lead } = await approved(s);
    await lead.callLead('start_agent', { role: 'Builder', task: 'Do the Builder part' });
    await s.settle();
    // Never launched.
    expect(s.fake.workers()).toEqual([]);
    const detail = await run(s, runId);
    const helper = detail.agents.find((a) => a.kind === 'worker');
    expect(helper?.latestActivity).toContain("Setup step 'Prepare' was not run");
    expect(lead.sent.join('\n')).toContain('Builder (agentId');
    expect(lead.sent.join('\n')).toContain('did not start');
    const t = await ticketDetail(s, ticket.id);
    expect(t.setupRuns?.map((r) => [r.stepId, r.status])).toEqual([['prepare', 'refused']]);
    expect(t.comments.map((c) => c.body).join('\n')).toContain(
      'Builder did not start: Setup step \'Prepare\' was not run: it uses the network, and "Setup may use the network" is off.',
    );
  }, 60_000);

  it('does not start the helper when a step fails; the lead gets the end of its output', async () => {
    const s = await setupBoard({ files: files({ setupExit: 3 }) });
    const { runId, lead } = await approved(s);
    await lead.callLead('start_agent', { role: 'Builder', task: 'Do the Builder part' });
    await s.settle();
    expect(s.fake.workers()).toEqual([]);
    const said = lead.sent.join('\n');
    expect(said).toContain("did not start: Setup step 'Prepare' failed (exit 3).");
    expect(said).toContain('prepared the copy');
    expect((await run(s, runId)).agents.find((a) => a.kind === 'worker')?.status).not.toBe(
      'RUNNING',
    );
  }, 60_000);
});

describe('Checks blocks at their places (ADR-0027 §5)', () => {
  it('a change block sends a failing change back to the helper, then the lead reviews it', async () => {
    const s = await setupBoard({ files: files() });
    await putGraph(s, blocksGraph(1, false));
    const { ticket, runId, lead } = await approved(s);
    await lead.callLead('start_agent', { role: 'Builder', task: 'Do the Builder part' });
    await s.settle();
    const first = s.fake.workers().at(-1);
    if (first === undefined) throw new Error('no worker');
    const wt = s.worktree(runId, first.id);
    first.started();
    await s.settle();
    writeFileSync(join(wt, 'feature.txt'), 'on\n');
    first.finish('success');

    // The change block ran on the sealed commit (only the fast check, in the helper's worktree)
    // and failed: the same helper got a rework turn with the failure, the lead was told.
    await until(s, () => s.fake.agents.filter((a) => a.id === first.id).length === 2);
    const rework = s.fake.byId(first.id);
    expect(rework.spec.prompt).toContain('check round 1 of 1');
    expect(rework.spec.prompt).toContain('Fast (exit 1)');
    expect(rework.spec.prompt).toContain('fixed.txt is missing');
    expect(lead.sent.join('\n')).toContain('went back to Builder for rework (check round 1 of 1)');
    const afterFirst = await checksOf(s, runId);
    expect(afterFirst.map((c) => [c.checkId, c.status, c.place, c.blockNodeId])).toEqual([
      ['fast', 'failed', 'change', CHANGE_BLOCK],
    ]);
    // A rework turn reuses the worktree: no second setup.
    expect((await ticketDetail(s, ticket.id)).setupRuns).toHaveLength(1);

    rework.started();
    await s.settle();
    writeFileSync(join(wt, 'fixed.txt'), 'ok\n');
    rework.finish('success');
    await until(s, async () => (await checksOf(s, runId)).length >= 3);
    const all = await checksOf(s, runId);
    // The block passed on the new commit; the merge block's early run then ran what had not
    // passed there yet (the old default: every check), with place `merge`.
    expect(all.slice(1).map((c) => [c.checkId, c.status, c.place])).toEqual([
      ['fast', 'passed', 'change'],
      ['full', 'passed', 'merge'],
    ]);
    const change = (await run(s, runId)).changes?.find((c) => c.agentRunId === first.id);
    expect(change?.state).toBe('reviewing');
    expect(change?.reworkRounds).toBe(0);
    // The lead merges: the merge block's gate reads the results on the integrated commit.
    const merged = await lead.callLead('merge_change', { agentId: first.id });
    expect(merged).toContain('Merged Builder into');
  }, 90_000);

  it('the merge block runs only its selection, and "ask me" sends a failure to the owner', async () => {
    const s = await setupBoard({ files: files() });
    const g = workflowTemplate('lead-only');
    await putGraph(s, {
      ...g,
      template: 'custom',
      nodes: g.nodes.map((n) =>
        n.type === 'checks'
          ? { ...n, select: { kind: 'ids', ids: ['fast'] }, onFailure: 'owner' }
          : n,
      ),
    });
    const { runId, lead } = await approved(s);
    await lead.callLead('start_agent', { role: 'Builder', task: 'Do the Builder part' });
    await s.settle();
    const worker = s.fake.workers().at(-1);
    if (worker === undefined) throw new Error('no worker');
    worker.started();
    await s.settle();
    writeFileSync(join(s.worktree(runId, worker.id), 'feature.txt'), 'on\n');
    worker.finish('success');
    await until(
      s,
      async () =>
        (await run(s, runId)).changes?.find((c) => c.agentRunId === worker.id)?.state ===
        'needs-owner',
    );
    expect(
      (await checksOf(s, runId)).map((c) => [c.checkId, c.status, c.place, c.blockNodeId]),
    ).toEqual([['fast', 'failed', 'merge', 'checks']]);
  }, 60_000);

  it('the branch block runs its checks on the tip in a fresh, set-up checkout', async () => {
    const s = await setupBoard({ files: files() });
    await putGraph(s, blocksGraph(1, true));
    const { ticket, runId, lead } = await approved(s);
    await lead.callLead('start_agent', { role: 'Builder', task: 'Do the Builder part' });
    await s.settle();
    const worker = s.fake.workers().at(-1);
    if (worker === undefined) throw new Error('no worker');
    worker.started();
    await s.settle();
    writeFileSync(join(s.worktree(runId, worker.id), 'fixed.txt'), 'ok\n');
    worker.finish('success');
    await until(
      s,
      async () =>
        (await run(s, runId)).changes?.find((c) => c.agentRunId === worker.id)?.state ===
        'reviewing',
    );
    expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged');
    await s.settle();
    expect(await lead.callLead('request_review', {})).toBeTruthy();
    await until(s, async () =>
      (await checksOf(s, runId)).some((c) => c.agentRunId === null && c.place === 'branch'),
    );
    await s.settle();
    const tip = (await checksOf(s, runId)).filter((c) => c.agentRunId === null);
    // Required ∪ the block's selection (full), on the tip, with the branch block's id.
    expect(tip.map((c) => [c.checkId, c.status, c.place, c.blockNodeId]).sort()).toEqual([
      ['fast', 'passed', 'branch', BRANCH_BLOCK],
      ['full', 'passed', 'branch', BRANCH_BLOCK],
    ]);
    // The tip checkout was set up first (its own setup run: the run's, no agent).
    const setupRuns = (await ticketDetail(s, ticket.id)).setupRuns ?? [];
    expect(setupRuns.map((r) => [r.agentRunId === null ? 'tip' : 'agent', r.status])).toEqual([
      ['agent', 'passed'],
      ['tip', 'passed'],
    ]);
    // The owner's merge gate is unchanged: the required checks on the tip.
    const done = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
    expect(done.status).toBe(200);
    expect(existsSync(join(s.repo, 'prepared'))).toBe(false);
    expect(git(s.repo, 'ls-tree', '-r', '--name-only', 'HEAD')).not.toContain('prepared');
    void LEAD;
  }, 90_000);
});
