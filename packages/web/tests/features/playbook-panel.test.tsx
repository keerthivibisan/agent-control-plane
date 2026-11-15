import { WorkflowGraphV3Schema, workflowTemplateV3 } from '@acp/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toFlowNodes } from '../../src/features/workflow/editor/flow';
import { Playbook, type StepFocus } from '../../src/features/workflow/editor/Playbook';

/*
 * ADR-0040, the web side: the lead's playbook beside the canvas (numbered stages in run order, a
 * step lighting its blocks' links), and the "When to use" line on every Agent block.
 */

const ctx = {
  skills: [],
  agents: [],
  agentModels: undefined,
  projectModel: null,
  projectMode: 'auto-edits' as const,
  helperLimit: 3,
};

describe('the lead’s playbook panel', () => {
  it('lists the stages in run order and lights a step, then clears it', () => {
    const picked: (StepFocus | null)[] = [];
    const { rerender } = render(
      <Playbook graph={workflowTemplateV3('bdd')} focus={null} onFocus={(f) => picked.push(f)} />,
    );
    expect(
      ['start', 'plan', 'build', 'review', 'merge', 'final', 'finish'].map(
        (k) => screen.getByTestId(`playbook-${k}`).querySelector('h3')?.textContent,
      ),
    ).toEqual([
      '1Ticket and research',
      '2Plan',
      '3Build',
      '4Review each change',
      '5Merge',
      '6Final checks',
      '7Finish',
    ]);
    const build = screen.getByTestId('playbook-build');
    const dev = within(build)
      .getAllByTestId('playbook-step')
      .find((s) => s.textContent?.startsWith('"Developer"'));
    expect(dev?.textContent).toContain('use for "Builds the behaviour or the fix"');
    fireEvent.click(within(dev as HTMLElement).getByRole('button'));
    expect(picked.at(-1)).toEqual({
      nodes: ['developer'],
      edges: ['implement-orchestrate-developer'],
    });
    rerender(
      <Playbook
        graph={workflowTemplateV3('bdd')}
        focus={picked.at(-1) ?? null}
        onFocus={(f) => picked.push(f)}
      />,
    );
    const again = within(screen.getByTestId('playbook-build'))
      .getAllByTestId('playbook-step')
      .find((s) => s.dataset.selected === 'true');
    expect(again?.textContent).toContain('"Developer"');
    fireEvent.click(within(again as HTMLElement).getByRole('button'));
    expect(picked.at(-1)).toBeNull();
    // An unrouted failure keeps its mark.
    const merge = within(screen.getByTestId('playbook-merge')).getAllByTestId('playbook-step');
    expect(merge.some((s) => s.dataset.routing === 'default')).toBe(true);
  });
});

describe('"When to use" on the blocks', () => {
  it('shows the owner’s text, else what starts the block, else that it is not set', () => {
    const base = workflowTemplateV3('bdd');
    const g = WorkflowGraphV3Schema.parse({
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === 'scenario-tests' && n.type === 'agent' ? { ...n, description: '' } : n,
      ),
    });
    const nodes = new Map(toFlowNodes(g, [], null, ctx).map((n) => [n.id, n.data.useWhen]));
    expect(nodes.get('developer')).toEqual({ text: 'Builds the behaviour or the fix', own: true });
    expect(nodes.get('behaviour')).toEqual({
      text: 'Runs before the plan, for "Lead"',
      own: false,
    });
    expect(nodes.get('unit-tests')).toEqual({
      text: 'Tests the ticket branch after the merge',
      own: false,
    });
    expect(nodes.get('scenario-tests')).toEqual({ text: 'When to use: not set yet', own: false });
    expect(nodes.get('orchestrate')).toBeNull();
    const pool = new Map(
      toFlowNodes(workflowTemplateV3('lead-only'), [], null, ctx).map((n) => [
        n.id,
        n.data.useWhen,
      ]),
    );
    expect(pool.get('helpers')).toEqual({
      text: 'Takes any step no named helper takes',
      own: false,
    });
  });
});
