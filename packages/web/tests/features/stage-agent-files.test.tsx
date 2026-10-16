import { defaultProjectWorkflow, type ProjectWorkflow } from '@acp/core';
import {
  AgentDefinitionSummaryDtoSchema,
  ProjectWorkflowDtoSchema,
  type ProjectWorkflowDto,
} from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PROJECT_WORKFLOW_PATH,
  TICKET_ID,
  projectWorkflow,
  stagesScenario,
} from '../../e2e/ticket-fixtures';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  agentFilesFixture,
  agentWorkflowDto,
  defaultWorkflowDto,
} from '../../e2e/workflow-fixtures';
import { SkillsPage } from '../../src/features/skills/SkillsPage';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import {
  sameWorkflow,
  workflowDraft,
  workflowRequest,
  workflowView,
} from '../../src/features/workflow/draft';
import {
  buildWorkflowGraph,
  type AgentNode,
  type HelpersNode,
  type SetupShape,
} from '../../src/features/workflow/graph';
import { modelPlaceholder } from '../../src/features/workflow/StagePanel';
import { modelText } from '../../src/features/workflow/WorkflowNodes';
import { WorkflowPage } from '../../src/features/workflow/WorkflowPage';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

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

  it('the model placeholder shows the agent file’s model only when it has one', () => {
    expect(modelPlaceholder('docs-writer', files(), 'claude-sonnet-4')).toBe(
      'From agent file: claude-haiku-4',
    );
    expect(modelPlaceholder('db-migrator', files(), 'claude-sonnet-4')).toBe('claude-sonnet-4');
    expect(modelPlaceholder('docs-writer', undefined, null)).toBe('Claude Code’s default');
    expect(modelPlaceholder(null, files(), null)).toBe('Claude Code’s default');
  });
});

describe('agent files in the draft', () => {
  it('round-trips a stage’s agent file and leaves it out for None', () => {
    const saved = workflow((w) => {
      w.stages['unit-tests'].agent = 'docs-writer';
      w.stages.plan.agent = null;
    });
    const draft = workflowDraft(saved);
    expect(draft.stages['unit-tests'].agent).toBe('docs-writer');
    expect(draft.stages.plan.agent).toBeNull();
    expect(draft.stages.helpers.agent).toBeNull(); // absent in the stored workflow
    const view = workflowView(draft);
    expect(view.stages['unit-tests']).toMatchObject({ agent: 'docs-writer' });
    expect('agent' in view.stages.plan).toBe(false);
    const checked = workflowRequest(draft);
    expect(checked.ok && checked.request.stages['unit-tests'].agent).toBe('docs-writer');
  });

  it('a changed agent file is an unsaved change', () => {
    const draft = workflowDraft(workflow());
    const next = {
      ...draft,
      stages: { ...draft.stages, helpers: { ...draft.stages.helpers, agent: 'db-migrator' } },
    };
    expect(sameWorkflow(draft, draft)).toBe(true);
    expect(sameWorkflow(draft, next)).toBe(false);
  });
});

// --- Workflow page -----------------------------------------------------------------------------

function server(initial: unknown, extra: RouteTable = {}) {
  let current = parse(initial);
  return fakeServer({
    '/api/control/token': { token: WF_CSRF },
    [AGENTS]: files(),
    [WORKFLOW]: () => jsonResponse(200, current),
    [`PUT ${WORKFLOW}`]: (body: unknown) => {
      const b = body as Pick<ProjectWorkflowDto['workflow'], 'plannerMode' | 'stages'>;
      current = { ...current, workflow: { ...current.workflow, ...b } };
      return jsonResponse(200, current);
    },
    ...extra,
  });
}

function renderPage(initial: unknown = defaultWorkflowDto(), extra: RouteTable = {}) {
  const s = server(initial, extra);
  return { server: s, ...renderWithApi(<WorkflowPage projectId={WF_PROJECT_ID} />, s) };
}

const node = (id: string) => screen.getByTestId(`wf-node-${id}`);
const panel = () => screen.getByRole('complementary', { name: 'Stage settings' });
const open = async (stage: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `Change ${stage}`, hidden: true }));
};
const picker = () =>
  within(panel()).getByRole<HTMLSelectElement>('combobox', { name: 'Agent file' });
const lastPut = (s: ReturnType<typeof server>) =>
  s.calls.filter((c) => c.method === 'PUT' && c.path === WORKFLOW).at(-1)?.body as
    ProjectWorkflowDto['workflow'] | undefined;

describe('Workflow page: agent files (R-I)', () => {
  it('the picker offers None and the project’s agent files, on every agent stage', async () => {
    renderPage();
    await screen.findByTestId('agent-files');
    for (const stage of ['Plan', 'Orchestrate', 'Helpers', 'Final code review', 'Unit tests']) {
      await open(stage);
      const options = [...picker().options].map((o) => o.textContent);
      expect(options).toEqual(['None', 'db-migrator', 'docs-writer']);
      expect(picker().value).toBe('');
      expect(within(panel()).getByText(/can only narrow what this role may do/)).toBeTruthy();
    }
    await open('Review & merge');
    expect(within(panel()).queryByRole('combobox', { name: 'Agent file' })).toBeNull();
  });

  it('in lead mode, Plan and Orchestrate say which file the one lead uses', async () => {
    renderPage();
    await screen.findByTestId('agent-files');
    const note = /It uses Orchestrate’s agent file, or Plan’s when Orchestrate has none/;
    await open('Plan');
    expect(within(panel()).getByText(note)).toBeTruthy();
    await open('Orchestrate');
    expect(within(panel()).getByText(note)).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Separate planner agent' }));
    expect(within(panel()).queryByText(note)).toBeNull();
    await open('Helpers');
    expect(within(panel()).queryByText(note)).toBeNull();
  });

  it('read-only roles say they stay read-only; helpers and the tester don’t', async () => {
    renderPage();
    await screen.findByTestId('agent-files');
    await open('Final code review');
    expect(within(panel()).getByText(/stays read-only/)).toBeTruthy();
    await open('Plan');
    expect(within(panel()).getByText(/stays read-only/)).toBeTruthy();
    await open('Unit tests');
    expect(within(panel()).queryByText(/stays read-only/)).toBeNull();
    await open('Helpers');
    expect(within(panel()).queryByText(/stays read-only/)).toBeNull();
    expect(
      within(panel()).getByRole('link', { name: 'Open Skills & Agents' }).getAttribute('href'),
    ).toBe(`#/p/${WF_PROJECT_ID}/skills?tab=agents`);
  });

  it('choosing a file shows the chip at once and saves it; None removes it', async () => {
    const { server: s } = renderPage();
    await screen.findByTestId('agent-files');
    await open('Helpers');
    expect(within(node('helpers')).queryByTestId('node-agent')).toBeNull();
    fireEvent.change(picker(), { target: { value: 'docs-writer' } });
    const chip = within(node('helpers')).getByTestId('node-agent');
    expect(chip.dataset.agent).toBe('set');
    expect(chip.textContent).toBe('docs-writer');
    // The file's model applies while the stage has none of its own.
    expect(within(node('helpers')).getByTestId('node-model').textContent).toContain(
      'claude-haiku-4 (agent file)',
    );
    const model = within(panel()).getByRole<HTMLInputElement>('textbox', { name: 'Model' });
    expect(model.placeholder).toBe('From agent file: claude-haiku-4');
    expect(within(panel()).getByText(/agent file’s model, else the project default/)).toBeTruthy();
    // "Used by" follows the draft.
    expect(screen.getByTestId('agent-file-docs-writer').textContent).toContain('Helpers');

    fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }));
    expect(await within(panel()).findByTestId('saved')).toBeTruthy();
    expect(lastPut(s)?.stages.helpers).toEqual({ model: null, skill: null, agent: 'docs-writer' });

    fireEvent.change(picker(), { target: { value: '' } });
    expect(within(node('helpers')).queryByTestId('node-agent')).toBeNull();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lastPut(s)?.stages.helpers).toEqual({ model: null, skill: null }));
  });

  it('a stage whose file is gone says so on the node and in the panel', async () => {
    renderPage(agentWorkflowDto());
    await screen.findByTestId('agent-files');
    const chip = within(node('code-review')).getByTestId('node-agent');
    expect(chip.dataset.agent).toBe('missing');
    expect(chip.textContent).toContain('test-writer');
    expect(chip.textContent).toContain('(not found)');
    // Both chips on one node: the agent file and the skill.
    expect(within(node('code-review')).getByTestId('node-skill').textContent).toBe('✦ code-review');
    expect(within(node('unit-tests')).getByTestId('node-agent').dataset.agent).toBe('set');
    await open('Final code review');
    expect(within(panel()).getByTestId('agent-missing').textContent).toContain(
      'Agent file not found — the agent starts without it.',
    );
    expect(picker().value).toBe('test-writer');
    expect([...picker().options].map((o) => o.textContent)).toContain('test-writer (not found)');
    // Picking an existing file clears the warning.
    fireEvent.change(picker(), { target: { value: 'db-migrator' } });
    expect(within(panel()).queryByTestId('agent-missing')).toBeNull();
    expect(within(node('code-review')).getByTestId('node-agent').dataset.agent).toBe('set');
  });

  it('shows a chosen file’s problems in the panel', async () => {
    const withProblem = files().map((f) =>
      f.name === 'db-migrator' ? { ...f, problems: ['The front matter has no name.'] } : f,
    );
    renderPage(agentWorkflowDto(), { [AGENTS]: withProblem });
    await screen.findByTestId('agent-files');
    await open('Helpers');
    expect(within(panel()).getByTestId('agent-problems').textContent).toContain(
      'The front matter has no name.',
    );
  });

  it('the agent files card lists the stages using each file; a chip opens that stage', async () => {
    renderPage(agentWorkflowDto());
    const card = await screen.findByTestId('agent-files');
    const used = (name: string) =>
      within(within(card).getByTestId(`agent-file-${name}`)).getByTestId('agent-used-by');
    expect(used('db-migrator').dataset.used).toBe('helpers');
    expect(used('docs-writer').dataset.used).toBe('unit-tests');
    fireEvent.click(
      within(used('docs-writer')).getByRole('button', { name: 'Open the Unit tests settings' }),
    );
    expect(panel().getAttribute('data-stage')).toBe('unit-tests');
  });

  it('while the agent files route answers 404, a named file is kept and not flagged', async () => {
    const { server: s } = renderPage(agentWorkflowDto(), {
      [AGENTS]: jsonResponse(404, {
        error: { code: 'not_found', message: 'no route', requestId: 'r' },
      }),
    });
    await screen.findByTestId('wf-node-plan');
    await waitFor(() => expect(s.calls.some((c) => c.path === AGENTS)).toBe(true));
    expect(within(node('code-review')).getByTestId('node-agent').dataset.agent).toBe('set');
    await open('Final code review');
    expect(picker().value).toBe('test-writer');
    expect(within(panel()).queryByTestId('agent-missing')).toBeNull();
  });
});

// --- Skills & Agents page ----------------------------------------------------------------------

describe('Skills & Agents: Used by on agent cards (R-I)', () => {
  it('shows which stages use each file, linking to the Workflow page', async () => {
    const s = fakeServer({
      [`${BASE}/skills`]: [],
      [AGENTS]: files(),
      [WORKFLOW]: parse(agentWorkflowDto()),
    });
    renderWithApi(<SkillsPage projectId={WF_PROJECT_ID} tab="agents" />, s);
    const card = await screen.findByTestId('agent-card-docs-writer');
    const used = await within(card).findByTestId('agent-used-by');
    const link = within(used).getByRole('link', { name: 'Open Unit tests on the Workflow page' });
    expect(link.getAttribute('href')).toBe(`#/p/${WF_PROJECT_ID}/workflow`);
    expect(
      within(
        within(screen.getByTestId('agent-card-db-migrator')).getByTestId('agent-used-by'),
      ).getByRole('link').textContent,
    ).toBe('Helpers');
  });

  it('a file no stage uses says so; without the workflow the row is left out', async () => {
    const s = fakeServer({
      [`${BASE}/skills`]: [],
      [AGENTS]: files(),
      [WORKFLOW]: parse(defaultWorkflowDto()),
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
    await waitFor(() => expect(without.calls.some((c) => c.path === WORKFLOW)).toBe(true));
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
