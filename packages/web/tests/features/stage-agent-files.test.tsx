import { defaultProjectWorkflow, migrateWorkflowV1, type ProjectWorkflow } from '@acp/core';
import {
  AgentDefinitionSummaryDtoSchema,
  ProjectWorkflowDtoSchema,
  type ProjectWorkflowDto,
} from '@acp/core/api';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PROJECT_WORKFLOW_PATH,
  TICKET_ID,
  projectWorkflow,
  stagesScenario,
} from '../../e2e/ticket-fixtures';
import {
  WF_PROJECT_ID,
  agentFilesFixture,
  agentWorkflowDto,
  defaultWorkflowDto,
  graphDto,
} from '../../e2e/workflow-fixtures';
import { SkillsPage } from '../../src/features/skills/SkillsPage';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import {
  buildWorkflowGraph,
  type AgentNode,
  type HelpersNode,
  type SetupShape,
} from '../../src/features/workflow/graph';
import { modelText } from '../../src/features/workflow/WorkflowNodes';
import { fakeServer, renderWithApi } from '../helpers';

/*
 * Redesign R-I (web): a workflow stage uses one project agent file (docs/redesign §6a, ADR-0019
 * §6). The picker in the stage panel, the agent chip on graph nodes (also on the ticket page's
 * live graph), the missing-file warning, the model that applies, and "Used by" on Skills & Agents.
 */

// React Flow measures the DOM; jsdom has no layout (as in workflow.test.tsx).
beforeAll(() => {
  if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
    class Matrix {
      m22: number;
      constructor(transform?: string) {
        const scale = /scale\(([\d.]+)\)/.exec(transform ?? '')?.[1];
        this.m22 = scale === undefined ? 1 : Number(scale);
      }
    }
    Object.assign(globalThis, { DOMMatrixReadOnly: Matrix });
  }
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 });
  }
  Object.assign(SVGElement.prototype, {
    getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
});

const BASE = `/api/projects/${WF_PROJECT_ID}`;
const WORKFLOW = `${BASE}/workflow`;
const AGENTS = `${BASE}/agents`;
const files = () => AgentDefinitionSummaryDtoSchema.array().parse(agentFilesFixture());
const parse = (dto: unknown): ProjectWorkflowDto => ProjectWorkflowDtoSchema.parse(dto);
const GRAPH = `${BASE}/workflow-graph`;
/** `GET …/workflow-graph` for a version 1 project: its workflow migrated, as the server serves it. */
const migrated = (dto: unknown) =>
  graphDto({ graph: migrateWorkflowV1(parse(dto).workflow, { projectMode: 'auto-edits' }) });

const setup: SetupShape = {
  maxConcurrentHelpers: 2,
  maxDepth: 1,
  defaultBudgetTokensPerAgent: 500_000,
  model: 'claude-sonnet-4',
  allowlist: { editInOwnWorktree: true, runHarnessChecks: false },
};

function workflow(mutate: (w: ProjectWorkflow) => void = () => {}): ProjectWorkflow {
  const w = defaultProjectWorkflow('p-1', '2026-10-16T09:00:00.000Z');
  mutate(w);
  return w;
}

describe('agent files in the graph model', () => {
  const refs = [
    { name: 'db-migrator', model: null },
    { name: 'docs-writer', model: 'claude-haiku-4' },
  ];
  const data = (g: ReturnType<typeof buildWorkflowGraph>, id: string) =>
    (g.nodes.find((n) => n.id === id) as AgentNode | HelpersNode | undefined)?.data;

  it('carries each stage’s agent file, its model, and flags one that is gone', () => {
    const g = buildWorkflowGraph(
      workflow((w) => {
        w.stages.helpers.agent = 'db-migrator';
        w.stages['unit-tests'].agent = 'docs-writer';
        w.stages['code-review'].agent = 'test-writer';
      }),
      setup,
      [],
      undefined,
      refs,
    );
    expect(data(g, 'plan')).toMatchObject({ agent: null, agentMissing: false, agentModel: null });
    expect(data(g, 'helpers')).toMatchObject({
      agent: 'db-migrator',
      agentMissing: false,
      agentModel: null,
    });
    expect(data(g, 'unit-tests')).toMatchObject({
      agent: 'docs-writer',
      agentMissing: false,
      agentModel: 'claude-haiku-4',
    });
    expect(data(g, 'code-review')).toMatchObject({
      agent: 'test-writer',
      agentMissing: true,
      agentModel: null,
    });
  });

  it('without the agent file list nothing is flagged and the file’s model is unknown', () => {
    const g = buildWorkflowGraph(
      workflow((w) => {
        w.stages.plan.agent = 'test-writer';
      }),
      setup,
    );
    expect(data(g, 'plan')).toMatchObject({
      agent: 'test-writer',
      agentMissing: false,
      agentModel: undefined,
    });
  });

  it('names the model that applies: stage, then agent file, then project (ADR-0019 §6)', () => {
    const base = { model: null, projectModel: 'claude-sonnet-4', agent: null, agentModel: null };
    expect(modelText({ ...base, model: 'claude-opus-4', agent: 'a', agentModel: 'x' })).toEqual({
      text: 'claude-opus-4',
      own: true,
    });
    expect(modelText({ ...base, agent: 'a', agentModel: 'claude-haiku-4' })).toEqual({
      text: 'claude-haiku-4 (agent file)',
      own: true,
      fileModel: 'claude-haiku-4',
    });
    expect(modelText({ ...base, agent: 'a' })).toEqual({
      text: 'claude-sonnet-4 (default)',
      own: false,
    });
    // The live graph doesn't know the file's model: it doesn't guess.
    expect(modelText({ ...base, agent: 'a', agentModel: undefined }).text).toBe(
      'Agent file or default',
    );
    expect(modelText({ ...base, projectModel: null }).text).toBe('Project default');
  });
});

// --- Skills & Agents page ----------------------------------------------------------------------

describe('Skills & Agents: Used by on agent cards (R-I)', () => {
  it('shows which blocks use each file, linking to the Workflow page', async () => {
    // WG-F: from the project's graph; the version 1 workflow (409 for a graph) is never asked.
    const s = fakeServer({
      [`${BASE}/skills`]: [],
      [AGENTS]: files(),
      [GRAPH]: migrated(agentWorkflowDto()),
    });
    renderWithApi(<SkillsPage projectId={WF_PROJECT_ID} tab="agents" />, s);
    const card = await screen.findByTestId('agent-card-docs-writer');
    const used = await within(card).findByTestId('agent-used-by');
    const link = within(used).getByRole('link', { name: 'Open Tester on the Workflow page' });
    expect(link.getAttribute('href')).toBe(`#/p/${WF_PROJECT_ID}/workflow`);
    expect(
      within(
        within(screen.getByTestId('agent-card-db-migrator')).getByTestId('agent-used-by'),
      ).getByRole('link').textContent,
    ).toBe('Helpers');
    expect(s.calls.some((c) => c.path === WORKFLOW)).toBe(false);
  });

  it('a file no block uses says so; without the graph the row is left out', async () => {
    const s = fakeServer({
      [`${BASE}/skills`]: [],
      [AGENTS]: files(),
      [GRAPH]: migrated(defaultWorkflowDto()),
    });
    const { unmount } = renderWithApi(<SkillsPage projectId={WF_PROJECT_ID} tab="agents" />, s);
    const card = await screen.findByTestId('agent-card-docs-writer');
    expect((await within(card).findByTestId('agent-used-by')).textContent).toBe(
      'Not used by any stage',
    );
    unmount();

    const without = fakeServer({ [`${BASE}/skills`]: [], [AGENTS]: files() });
    renderWithApi(<SkillsPage projectId={WF_PROJECT_ID} tab="agents" />, without);
    const again = await screen.findByTestId('agent-card-docs-writer');
    await waitFor(() => expect(without.calls.some((c) => c.path === GRAPH)).toBe(true));
    expect(without.calls.some((c) => c.path === WORKFLOW)).toBe(false);
    expect(within(again).queryByTestId('agent-used-by')).toBeNull();
  });
});

// --- Ticket page's live graph ------------------------------------------------------------------

describe('ticket page: the live graph shows agent files (R-I)', () => {
  it('reuses the node views, so a stage’s agent file shows as a chip there too', async () => {
    const sc = stagesScenario();
    const pw = projectWorkflow({ separate: true, postMerge: true }) as {
      workflow: { stages: Record<string, Record<string, unknown>> };
    };
    pw.workflow.stages['helpers'] = { ...pw.workflow.stages['helpers'], agent: 'db-migrator' };
    const s = fakeServer({ ...sc.routes, [PROJECT_WORKFLOW_PATH]: pw });
    renderWithApi(<TicketPage id={TICKET_ID} />, s);
    await screen.findByTestId('live-workflow');
    const helpers = screen.getByTestId('live-helpers');
    expect(within(helpers).getByTestId('node-agent').textContent).toBe('db-migrator');
    // The live graph doesn't load the agent files: it never flags one as missing, nor guesses
    // which model applies.
    expect(within(helpers).getByTestId('node-agent').dataset.agent).toBe('set');
    expect(within(helpers).getByTestId('node-model').textContent).toContain(
      'Agent file or default',
    );
    expect(within(screen.getByTestId('live-plan')).queryByTestId('node-agent')).toBeNull();
  });
});
