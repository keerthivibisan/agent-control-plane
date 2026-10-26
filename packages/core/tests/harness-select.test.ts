// Which checks a Checks block runs, and the warnings about a block's selection against the
// harness file (ADR-0027 §4, §5; v0.3.0 H-A). Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  HarnessManifestSchema,
  checkSelectionIssues,
  checksForBlock,
  isGraphRunnable,
  validateWorkflowGraph,
  workflowTemplate,
  type HarnessManifest,
  type WorkflowGraph,
  type WorkflowNode,
} from '../src/index.js';

const manifest: HarnessManifest = HarnessManifestSchema.parse({
  version: 1,
  checks: [
    {
      id: 'lint',
      name: 'Lint',
      argv: ['pnpm', 'lint'],
      timeoutSec: 60,
      required: true,
      labels: ['fast'],
    },
    {
      id: 'unit',
      name: 'Unit',
      argv: ['pnpm', 'test'],
      timeoutSec: 60,
      required: true,
      labels: ['fast', 'full'],
    },
    {
      id: 'docs',
      name: 'Docs',
      argv: ['pnpm', 'docs'],
      timeoutSec: 60,
      required: false,
      labels: ['fast'],
    },
    {
      id: 'e2e',
      name: 'End-to-end',
      argv: ['pnpm', 'e2e'],
      timeoutSec: 600,
      required: true,
      labels: ['full'],
    },
  ],
});

const ids = (checks: readonly { id: string }[]) => checks.map((c) => c.id);

describe('checksForBlock', () => {
  it('required: every required check, in the file’s order', () => {
    expect(ids(checksForBlock(manifest, { kind: 'required' }))).toEqual(['lint', 'unit', 'e2e']);
  });

  it('ids: in the file’s order, once each, unknown ids skipped, required or not', () => {
    expect(
      ids(checksForBlock(manifest, { kind: 'ids', ids: ['e2e', 'docs', 'ghost', 'e2e'] })),
    ).toEqual(['docs', 'e2e']);
  });

  it('labels: any check carrying one of them, once each', () => {
    expect(ids(checksForBlock(manifest, { kind: 'labels', labels: ['fast'] }))).toEqual([
      'lint',
      'unit',
      'docs',
    ]);
    expect(ids(checksForBlock(manifest, { kind: 'labels', labels: ['full', 'fast'] }))).toEqual([
      'lint',
      'unit',
      'docs',
      'e2e',
    ]);
    expect(checksForBlock(manifest, { kind: 'labels', labels: ['slow'] })).toEqual([]);
  });

  it('a file without labels: label selections pick nothing', () => {
    const plain = { checks: manifest.checks.map(({ labels: _labels, ...c }) => c) };
    expect(checksForBlock(plain, { kind: 'labels', labels: ['fast'] })).toEqual([]);
    expect(ids(checksForBlock(plain, { kind: 'required' }))).toEqual(['lint', 'unit', 'e2e']);
  });
});

function withBlocks(...blocks: WorkflowNode[]): WorkflowGraph {
  const graph = workflowTemplate('lead-only');
  const merge = blocks.find((b) => b.id === 'checks');
  return {
    ...graph,
    nodes: [
      ...graph.nodes.map((n) => (n.id === 'checks' && merge !== undefined ? merge : n)),
      ...blocks.filter((b) => b.id !== 'checks'),
    ],
  };
}

describe('checkSelectionIssues', () => {
  it('nothing for today’s block, with or without a harness file', () => {
    const graph = workflowTemplate('todays-setup');
    expect(checkSelectionIssues(graph, manifest)).toEqual([]);
    expect(checkSelectionIssues(graph, null)).toEqual([]);
  });

  it('unknown-check and unknown-check-label: names the block and the missing name', () => {
    const graph = withBlocks(
      {
        type: 'checks',
        id: 'fast',
        label: 'Fast',
        place: 'change',
        select: { kind: 'ids', ids: ['lint', 'ghost'] },
      },
      {
        type: 'checks',
        id: 'full',
        label: 'Full',
        place: 'branch',
        select: { kind: 'labels', labels: ['full', 'slow'] },
      },
    );
    expect(checkSelectionIssues(graph, manifest)).toEqual([
      {
        code: 'unknown-check',
        severity: 'warning',
        nodeId: 'fast',
        message:
          '"Fast" runs the check "ghost", which the harness file does not have. It is skipped.',
      },
      {
        code: 'unknown-check-label',
        severity: 'warning',
        nodeId: 'full',
        message:
          '"Full" runs the checks labelled "slow", but no check in the harness file has that label.',
      },
    ]);
  });

  it('no-checks-selected: a selection that picks nothing, or required with none required', () => {
    const graph = withBlocks({
      type: 'checks',
      id: 'fast',
      label: 'Fast',
      place: 'change',
      select: { kind: 'labels', labels: ['slow'] },
    });
    expect(checkSelectionIssues(graph, manifest).map((i) => i.code)).toEqual([
      'unknown-check-label',
      'no-checks-selected',
    ]);
    const noneRequired = { checks: manifest.checks.map((c) => ({ ...c, required: false })) };
    expect(checkSelectionIssues(workflowTemplate('lead-only'), noneRequired)).toMatchObject([
      { code: 'no-checks-selected', nodeId: 'checks' },
    ]);
  });

  it('no-checks-selected: every configured block when the project has no harness file', () => {
    const graph = withBlocks(
      { type: 'checks', id: 'checks', label: 'Checks', onFailure: 'owner' },
      { type: 'checks', id: 'fast', label: 'Fast', place: 'change' },
    );
    expect(checkSelectionIssues(graph, null)).toMatchObject([
      {
        code: 'no-checks-selected',
        nodeId: 'fast',
        message: expect.stringContaining('no harness file') as string,
      },
    ]);
  });

  it('merge-skips-required: the block before the merge leaves required checks out', () => {
    const graph = withBlocks({
      type: 'checks',
      id: 'checks',
      label: 'Checks',
      select: { kind: 'labels', labels: ['fast'] },
    });
    expect(checkSelectionIssues(graph, manifest)).toEqual([
      {
        code: 'merge-skips-required',
        severity: 'warning',
        nodeId: 'checks',
        message:
          '"Checks" does not run the required check "End-to-end", so a change can reach the ticket branch without it. Your merge still needs every required check on the ticket branch.',
      },
    ]);
    // a change block or a branch block may run fewer: no warning
    const change = withBlocks({
      type: 'checks',
      id: 'fast',
      label: 'Fast',
      place: 'branch',
      select: { kind: 'ids', ids: ['lint'] },
    });
    expect(checkSelectionIssues(change, manifest)).toEqual([]);
  });

  it('validateWorkflowGraph adds them as warnings when given the harness file; they never block', () => {
    const graph: WorkflowGraph = {
      ...workflowTemplate('lead-only'),
      nodes: workflowTemplate('lead-only').nodes.map((n) =>
        n.type === 'checks' ? { ...n, select: { kind: 'ids', ids: ['ghost'] } } : n,
      ),
    };
    expect(validateWorkflowGraph(graph)).toEqual([]);
    const issues = validateWorkflowGraph(graph, { harness: manifest });
    expect(issues.map((i) => i.code)).toEqual([
      'unknown-check',
      'no-checks-selected',
      'merge-skips-required',
    ]);
    expect(isGraphRunnable(issues)).toBe(true);
    expect(validateWorkflowGraph(workflowTemplate('lead-only'), { harness: null })).toEqual([]);
  });
});
