import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  validateWorkflowGraph,
  withoutCheckBlocks,
  workflowTemplate,
  type AgentEffort,
  type WorkflowGraph,
  type WorkflowNode,
} from '@acp/core';
import { CheckRunDtoSchema } from '@acp/core/api';
import { git } from '../workspace/helpers.js';
import { putGraph } from './graph-helpers.js';
import { setupBoard } from './helpers.js';
import { approved, run, type Board } from './loop-helpers.js';

/*
 * ADR-0028 (v0.3.1 P-A), server half:
 * - §2: checks run and gate only where the workflow places them. Without a block before the lead's
 *   merge, merge_change merges a reviewed change with no checks; without a block on the ticket
 *   branch, the owner's final merge needs no checks (no "Merge anyway"); with a branch block (and
 *   no merge block) its own selection runs on the tip and gates the owner's merge. Graphs with a
 *   block before the merge (every graph from before ADR-0028) keep 0.3.0's gates exactly
 *   (harness-blocks.test.ts, review-loop tests).
 * - §1: a block's effort reaches `ManagedAgentSpec.effort`; absent without one.
 * The fake managed adapter plays every agent; the checks are tiny node scripts in a throwaway
 * repository, and `fast` (required) fails unless `fixed.txt` exists, so any gate on it would
 * refuse. Synthetic data only.
 */

function files(): Record<string, string> {
  return {
    'README.md': 'x\n',
    'src/app.ts': 'export {};\n',
    '.acp/harness.json': JSON.stringify({
      version: 1,
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
    'fast.mjs':
      "import { existsSync } from 'node:fs'; if (!existsSync('fixed.txt')) { console.error('fixed.txt is missing'); process.exit(1); }",
    'full.mjs': 'process.exit(0);',
  };
}

const BRANCH_BLOCK = 'tip-checks';

/** Lead only, with no Checks block at all. */
function noChecks(): WorkflowGraph {
  return { ...withoutCheckBlocks(workflowTemplate('lead-only')), template: 'custom' };
}

/** No block before the merge; a block on the ticket branch running `select`'s checks. */
function branchOnly(labels: string[]): WorkflowGraph {
  const g = noChecks();
  return {
    ...g,
    nodes: [
      ...g.nodes,
      {
        type: 'checks',
        id: BRANCH_BLOCK,
        label: 'Tip checks',
        place: 'branch',
        select: { kind: 'labels', labels },
      },
    ],
    edges: [
      ...g.edges.filter((e) => !(e.type === 'flow' && e.from === 'ticket-merge')),
      { type: 'flow', id: 'flow-tm-tip', from: 'ticket-merge', to: BRANCH_BLOCK },
      { type: 'flow', id: 'flow-tip-owner', from: BRANCH_BLOCK, to: 'owner-merge' },
    ],
  };
}

function withEffort(graph: WorkflowGraph, efforts: Record<string, AgentEffort>): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      efforts[n.id] === undefined ? n : ({ ...n, effort: efforts[n.id] } as WorkflowNode),
    ),
  };
}

async function checksOf(s: Board, runId: string) {
  return CheckRunDtoSchema.array().parse((await s.get(`/api/runs/${runId}/checks`)).body);
}

async function until(s: Board, done: () => Promise<boolean> | boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await s.settle();
    if (await done()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting');
}

/** A helper writes `feature.txt` (never `fixed.txt`), the lead merges it, then hands over. */
async function mergedAndHandedOver(s: Board) {
  const { ticket, runId, lead } = await approved(s);
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
      (await run(s, runId)).changes?.find((c) => c.agentRunId === worker.id)?.state === 'reviewing',
  );
  // No checks ran on the change, and none hold its merge back.
  expect(await checksOf(s, runId)).toEqual([]);
  expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain(
    'Merged Builder into',
  );
  await s.settle();
  expect(await lead.callLead('request_review', {})).toBeTruthy();
  await until(s, async () => (await run(s, runId)).status === 'REVIEW');
  return { ticket, runId, lead, worker };
}

describe('optional Checks blocks (ADR-0028 §2)', () => {
  it('saves a workflow with no Checks block (the warning is the editor’s, never a refusal)', async () => {
    const s = await setupBoard({ files: files() });
    const graph = noChecks();
    expect(validateWorkflowGraph(graph).map((i) => [i.code, i.severity])).toEqual([
      ['no-checks', 'warning'],
    ]);
    await putGraph(s, graph);
  });

  it('without any block: the lead merges after review, and the owner merges with no checks', async () => {
    const s = await setupBoard({ files: files() });
    await putGraph(s, noChecks());
    const { runId } = await mergedAndHandedOver(s);
    await s.settle();
    // Nothing ran on the tip either: no checkout, no checks.
    expect(await checksOf(s, runId)).toEqual([]);
    // "Merge anyway" has nothing to override; the plain merge goes through.
    const anyway = await s.post(`/api/runs/${runId}/ticket-branch`, {
      action: 'merge-anyway',
      reason: 'not needed',
    });
    expect(anyway.status).toBe(409);
    const done = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
    expect(done.status).toBe(200);
    expect(git(s.repo, 'ls-tree', '-r', '--name-only', 'HEAD')).toContain('feature.txt');
    expect(await checksOf(s, runId)).toEqual([]);
    expect((await run(s, runId)).status).toBe('COMPLETED');
  }, 90_000);

  it('a branch block alone: its selection runs on the tip and gates the owner’s merge', async () => {
    const s = await setupBoard({ files: files() });
    await putGraph(s, branchOnly(['fast']));
    const { runId } = await mergedAndHandedOver(s);
    await until(s, async () => (await checksOf(s, runId)).some((c) => c.agentRunId === null));
    await s.settle();
    const tip = (await checksOf(s, runId)).filter((c) => c.agentRunId === null);
    // Only the block's selection (fast), not every check, on the tip.
    expect(tip.map((c) => [c.checkId, c.status, c.place, c.blockNodeId])).toEqual([
      ['fast', 'failed', 'branch', BRANCH_BLOCK],
    ]);
    const refused = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('checks_failed');
    const anyway = await s.post(`/api/runs/${runId}/ticket-branch`, {
      action: 'merge-anyway',
      reason: 'Synthetic: accepted',
    });
    expect(anyway.status).toBe(200);
  }, 90_000);

  it('a branch block selecting only passing checks: the owner merges without the required ones', async () => {
    const s = await setupBoard({ files: files() });
    await putGraph(s, branchOnly(['full']));
    const { runId } = await mergedAndHandedOver(s);
    await until(s, async () => (await checksOf(s, runId)).some((c) => c.agentRunId === null));
    await s.settle();
    expect((await checksOf(s, runId)).map((c) => [c.checkId, c.status, c.place])).toEqual([
      ['full', 'passed', 'branch'],
    ]);
    const done = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
    expect(done.status).toBe(200);
    expect(existsSync(join(s.repo, 'feature.txt'))).toBe(true);
  }, 90_000);
});

describe('effort per agent block (ADR-0028 §1)', () => {
  it('reaches ManagedAgentSpec.effort for the lead and a helper; absent without one', async () => {
    const s = await setupBoard({ files: files() });
    await putGraph(s, withEffort(noChecks(), { orchestrate: 'high', helpers: 'low' }));
    const { lead } = await approved(s);
    expect(lead.spec.effort).toBe('high');
    await lead.callLead('start_agent', { role: 'Builder', task: 'Do the Builder part' });
    await s.settle();
    expect(s.fake.workers().at(-1)?.spec.effort).toBe('low');

    const plain = await setupBoard({ files: files() });
    await putGraph(plain, noChecks());
    const second = await approved(plain);
    expect(second.lead.spec).not.toHaveProperty('effort');
  }, 60_000);
});
