import { WorkflowGraphSchema } from '@acp/core';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_GRAPH_PATH,
  directLoopGraph,
  projectGraphDto,
} from '../../e2e/live-graph-fixtures';
import { SkillsPage } from '../../src/features/skills/SkillsPage';
import { nodesUsingAgent } from '../../src/features/skills/used-by';
import { CSRF } from '../fixtures/control';
import { SKILLS_PROJECT_ID, agentDetail, skillDetail, skillSummary } from '../fixtures/skills';
import { fakeServer, renderWithApi, type RouteTable } from '../helpers';

/*
 * WG-E (ADR-0023): Skills & Agents "Used by" names the workflow's blocks when the server sends
 * them (`usedByNodes` for skills, the project's graph for agent files), and the version 1 stages
 * otherwise.
 */

const P = `/api/projects/${SKILLS_PROJECT_ID}`;

function server(routes: RouteTable) {
  return fakeServer({ '/api/control/token': { token: CSRF }, ...routes });
}

const blocks = [
  { nodeId: 'review', label: 'Change reviewer' },
  { nodeId: 'code-review', label: 'Code reviewer' },
];

describe('Used by: blocks or stages', () => {
  it('a skill card names the blocks when the server sends them', async () => {
    renderWithApi(
      <SkillsPage projectId={SKILLS_PROJECT_ID} />,
      server({
        [`${P}/skills`]: [
          skillSummary({ name: 'code-review', usedBy: ['code-review'], usedByNodes: blocks }),
          skillSummary({ name: 'docs', usedBy: ['plan'] }),
        ],
      }),
    );
    const card = await screen.findByTestId('skill-card-code-review');
    const chips = within(card).getByTestId('used-by');
    expect(chips.dataset.by).toBe('blocks');
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Change reviewer', 'Code reviewer']);
    // Without `usedByNodes` (a server before graphs): the version 1 stage names.
    const old = within(screen.getByTestId('skill-card-docs')).getByTestId('used-by');
    expect(old.dataset.by).toBe('stages');
    expect(old.textContent).toBe('Plan');
  });

  it('a skill used by blocks can’t be deleted, and says which blocks', async () => {
    renderWithApi(
      <SkillsPage projectId={SKILLS_PROJECT_ID} item="code-review" />,
      server({
        [`${P}/skills`]: [skillSummary({ name: 'code-review' })],
        [`${P}/skills/code-review`]: skillDetail({
          name: 'code-review',
          usedBy: ['code-review'],
          usedByNodes: blocks,
        }),
      }),
    );
    const del = await screen.findByTestId('skill-delete');
    expect(
      within(del).getByRole<HTMLButtonElement>('button', { name: 'Delete skill' }).disabled,
    ).toBe(true);
    expect(del.textContent).toContain(
      'Used by Change reviewer and Code reviewer. Remove it from those blocks on the Workflow page',
    );
    expect(within(screen.getByTestId('skill-status')).getByTestId('used-by').textContent).toBe(
      'Change reviewerCode reviewer',
    );
  });

  it('agent files: the blocks from the project’s graph', async () => {
    const graph = directLoopGraph();
    const nodes = (graph['nodes'] as Record<string, unknown>[]).map((n) =>
      n['id'] === 'api-helper' ? { ...n, agent: 'api-writer' } : n,
    );
    const { instructions: _i, ...summary } = agentDetail({ name: 'api-writer' });
    renderWithApi(
      <SkillsPage projectId={SKILLS_PROJECT_ID} tab="agents" />,
      server({
        [`${P}/skills`]: [],
        [`${P}/agents`]: [summary],
        [PROJECT_GRAPH_PATH.replace('p-web', SKILLS_PROJECT_ID)]: projectGraphDto({
          ...graph,
          nodes,
        }),
      }),
    );
    const used = await screen.findByTestId('agent-used-by');
    await waitFor(() => expect(within(used).getByTestId('used-by').dataset.by).toBe('blocks'));
    const link = within(used).getByRole('link', { name: 'Open API helper on the Workflow page' });
    expect(link.textContent).toBe('API helper');
  });

  it('finds the blocks that use an agent file', () => {
    const graph = WorkflowGraphSchema.parse(directLoopGraph());
    expect(nodesUsingAgent(graph, 'nobody')).toEqual([]);
    const withFile = {
      nodes: graph.nodes.map((n) => (n.id === 'review' ? { ...n, agent: 'strict' } : n)),
    };
    expect(nodesUsingAgent(withFile, 'strict')).toEqual([
      { nodeId: 'review', label: 'Change reviewer' },
    ]);
  });
});
