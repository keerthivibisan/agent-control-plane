import {
  AgentDefinitionSummaryDtoSchema,
  ProjectWorkflowDtoSchema,
  type ProjectWorkflowDto,
} from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  agentFilesFixture,
  defaultWorkflowDto,
  fullWorkflowDto,
} from '../../e2e/workflow-fixtures';
import { refusalMessage } from '../../src/features/workflow/draft';
import { WorkflowPage } from '../../src/features/workflow/WorkflowPage';
import { ApiError } from '../../src/lib/api';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

// React Flow measures the DOM; jsdom has no layout, so give it the pieces it reads.
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
const SETUP = `${BASE}/setup`;

// The fixtures are plain JSON shared with the Playwright spec; parse them, so a fixture that drifts
// from the contract fails here first.
const parse = (dto: unknown): ProjectWorkflowDto => ProjectWorkflowDtoSchema.parse(dto);

function server(initial: unknown, extra: RouteTable = {}) {
  let current = parse(initial);
  const routes: RouteTable = {
    '/api/control/token': { token: WF_CSRF },
    [WORKFLOW]: () => jsonResponse(200, current),
    [`PUT ${WORKFLOW}`]: (body: unknown) => {
      const b = body as Pick<ProjectWorkflowDto['workflow'], 'plannerMode' | 'stages'>;
      current = { ...current, workflow: { ...current.workflow, ...b } };
      return jsonResponse(200, current);
    },
    [`PUT ${SETUP}`]: (body: unknown) => {
      current = { ...current, setup: { ...current.setup, ...(body as object) } };
      return jsonResponse(200, current.setup);
    },
    ...extra,
  };
  return fakeServer(routes);
}

function render(initial: unknown = defaultWorkflowDto(), extra: RouteTable = {}) {
  const s = server(initial, extra);
  return { server: s, ...renderWithApi(<WorkflowPage projectId={WF_PROJECT_ID} />, s) };
}

const node = (id: string) => screen.getByTestId(`wf-node-${id}`);
const panel = () => screen.getByRole('complementary', { name: 'Stage settings' });
const open = async (stage: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `Change ${stage}`, hidden: true }));
};
const puts = (s: ReturnType<typeof server>, path: string) =>
  s.calls.filter((c) => c.method === 'PUT' && c.path === path);

describe('Workflow page', () => {
  it('shows the default flow: one lead for Plan and Orchestrate, optional stages off', async () => {
    render();
    expect(await screen.findByRole('heading', { level: 1, name: /Workflow/ })).toBeTruthy();
    await screen.findByTestId('wf-node-plan');
    expect(node('plan').getAttribute('data-role')).toBe('lead');
    expect(node('orchestrate').getAttribute('data-role')).toBe('lead');
    expect(within(node('plan')).getByTestId('same-agent').textContent).toBe('Same agent');
    expect(within(node('orchestrate')).getByTestId('same-agent')).toBeTruthy();
    expect(node('code-review').getAttribute('data-enabled')).toBe('false');
    expect(within(node('unit-tests')).getByTestId('stage-state').textContent).toBe('Off');
    expect(within(node('plan')).getByTestId('node-model').textContent).toContain('Project default');
    expect(within(node('plan')).getByTestId('node-skill').textContent).toBe('No skill');
    expect(within(node('helpers')).getByTestId('helpers-facts').textContent).toBe(
      'Up to 3 · depth 1 · 500K each',
    );
    expect(screen.getAllByTestId(/^wf-helper-/)).toHaveLength(3);
    expect(screen.queryByTestId('helper-nested')).toBeNull();
    expect(screen.getByTestId('workflow-legend')).toBeTruthy();
    expect(within(panel()).getByText('Select a stage in the graph to change it.')).toBeTruthy();
  });

  it('separate planner, depth 2 and a missing skill render as such', async () => {
    render(fullWorkflowDto());
    await screen.findByTestId('wf-node-plan');
    expect(node('plan').getAttribute('data-role')).toBe('planner');
    expect(node('orchestrate').getAttribute('data-role')).toBe('lead');
    expect(within(node('plan')).queryByTestId('same-agent')).toBeNull();
    expect(within(node('plan')).getByTestId('node-model').textContent).toContain('claude-opus-4');
    expect(within(node('orchestrate')).getByTestId('node-model').textContent).toContain(
      'claude-sonnet-4 (default)',
    );
    expect(within(node('plan')).getByTestId('node-skill').textContent).toBe('✦ plan-tickets');
    const helperSkill = within(node('helpers')).getByTestId('node-skill');
    expect(helperSkill.getAttribute('data-skill')).toBe('missing');
    expect(helperSkill.textContent).toContain('release-notes');
    expect(helperSkill.textContent).toContain('(missing)');
    expect(screen.getAllByTestId(/^wf-helper-/)).toHaveLength(4);
    expect(screen.getAllByTestId('helper-nested')).toHaveLength(4);
    expect(node('code-review').getAttribute('data-enabled')).toBe('true');

    await open('Helpers');
    expect(panel().getAttribute('data-stage')).toBe('helpers');
    expect(within(panel()).getByTestId('skill-missing').textContent).toContain('release-notes');
    const skill = within(panel()).getByRole('combobox', { name: 'Skill' });
    expect((skill as HTMLSelectElement).value).toBe('release-notes');
  });

  it('turning a stage on shows at once and saves through PUT …/workflow', async () => {
    const { server: s } = render();
    await open('Final code review');
    expect(within(panel()).getByRole('heading', { name: 'Final code review' })).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Run this stage' }));
    expect(node('code-review').getAttribute('data-enabled')).toBe('true');
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Skill' }), {
      target: { value: 'code-review' },
    });
    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Model' }), {
      target: { value: '  claude-opus-4 ' },
    });
    expect(within(panel()).getByTestId('unsaved')).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }));
    expect(await within(panel()).findByRole('status')).toHaveProperty('textContent', 'Saved');

    const [put] = puts(s, WORKFLOW);
    expect(put?.body).toMatchObject({
      plannerMode: 'lead',
      stages: {
        'code-review': { enabled: true, skill: 'code-review', model: 'claude-opus-4' },
        'unit-tests': { enabled: false, skill: null, model: null },
        review: { requireChecks: true },
      },
    });
    expect(puts(s, SETUP)).toHaveLength(0);
    // The CSRF token was fetched for the PUT (ADR-0013).
    const csrfCall = s.calls.find((c) => c.path === '/api/control/token');
    expect(csrfCall).toBeTruthy();
  });

  it('"Separate planner agent" splits Plan and Orchestrate in the graph', async () => {
    const { server: s } = render();
    await open('Plan');
    fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Separate planner agent' }));
    expect(node('plan').getAttribute('data-role')).toBe('planner');
    expect(within(node('plan')).queryByTestId('same-agent')).toBeNull();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }));
    await within(panel()).findByRole('status');
    expect(puts(s, WORKFLOW)[0]?.body).toMatchObject({ plannerMode: 'separate' });
  });

  it('helper limits save through PUT …/setup with the rest of the setup unchanged', async () => {
    const { server: s } = render();
    await open('Helpers');
    fireEvent.click(within(panel()).getByRole('radio', { name: '2 helpers' }));
    fireEvent.click(
      within(panel()).getByRole('radio', { name: 'Helpers may start their own helpers' }),
    );
    fireEvent.change(within(panel()).getByRole('textbox', { name: /Budget per agent/ }), {
      target: { value: '250,000' },
    });
    fireEvent.click(within(panel()).getByRole('checkbox', { name: /run this project’s checks/ }));
    // The graph follows the draft.
    expect(screen.getAllByTestId(/^wf-helper-/)).toHaveLength(2);
    expect(screen.getAllByTestId('helper-nested')).toHaveLength(2);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }));
    await within(panel()).findByRole('status');
    expect(puts(s, WORKFLOW)).toHaveLength(0);
    expect(puts(s, SETUP)[0]?.body).toEqual({
      projectKey: 'WEB',
      maxConcurrentHelpers: 2,
      maxDepth: 2,
      defaultBudgetTokensPerAgent: 250_000,
      model: null,
      allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
      contextFiles: ['CLAUDE.md'],
    });
  });

  it('a budget that is not a number is explained and nothing is sent', async () => {
    const { server: s } = render();
    await open('Helpers');
    fireEvent.change(within(panel()).getByRole('textbox', { name: /Budget per agent/ }), {
      target: { value: 'lots' },
    });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }));
    expect((await within(panel()).findByRole('alert')).textContent).toContain('whole number');
    expect(s.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('Discard changes puts the saved settings back', async () => {
    render();
    await open('Unit tests');
    fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Run this stage' }));
    expect(node('unit-tests').getAttribute('data-enabled')).toBe('true');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Discard changes' }));
    expect(node('unit-tests').getAttribute('data-enabled')).toBe('false');
    expect(within(panel()).queryByTestId('unsaved')).toBeNull();
  });

  it('shows a refused stage save in plain words', async () => {
    render(defaultWorkflowDto(), {
      [`PUT ${WORKFLOW}`]: jsonResponse(400, {
        error: { code: 'invalid_request', message: 'stages.plan.skill: invalid', requestId: 'r-1' },
      }),
    });
    await open('Plan');
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Skill' }), {
      target: { value: 'plan-tickets' },
    });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }));
    const alert = (await within(panel()).findAllByRole('alert'))[0];
    expect(alert?.textContent).toContain('Stage settings weren’t saved.');
    expect(alert?.textContent).toContain('The server didn’t accept these settings.');
    expect(alert?.textContent).toContain('stages.plan.skill: invalid');
    // Still unsaved: nothing was lost.
    expect(within(panel()).getByTestId('unsaved')).toBeTruthy();
  });

  it('a refused limits save after a stored stage save says only the limits are left', async () => {
    render(defaultWorkflowDto(), {
      [`PUT ${SETUP}`]: jsonResponse(409, {
        error: {
          code: 'conflict',
          message: 'Another project already uses this project key',
          requestId: 'r-2',
        },
      }),
    });
    await open('Helpers');
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Skill' }), {
      target: { value: 'unit-tests' },
    });
    fireEvent.click(within(panel()).getByRole('radio', { name: '4 helpers' }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }));
    const alert = (await within(panel()).findAllByRole('alert'))[0];
    expect(alert?.textContent).toContain('Helper limits weren’t saved.');
    expect(alert?.textContent).toContain('Another project already uses this ticket prefix.');
    expect(alert?.textContent).toContain('only the helper limits are left');
  });

  it('the review stage explains why required checks are always on and links to Harness', async () => {
    render();
    await open('Review & merge');
    const box = within(panel()).getByRole('checkbox', { name: 'Required checks must pass' });
    expect((box as HTMLInputElement).checked).toBe(true);
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(within(panel()).getByText(/Always on/)).toBeTruthy();
    expect(
      within(panel()).getByRole('link', { name: 'Open the Harness page' }).getAttribute('href'),
    ).toBe(`#/p/${WF_PROJECT_ID}/harness`);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close stage settings' }));
    expect(panel().getAttribute('data-stage')).toBeNull();
  });

  it('lists agent files as available, not mapped', async () => {
    const files = AgentDefinitionSummaryDtoSchema.array().parse(agentFilesFixture());
    render(defaultWorkflowDto(), { [`${BASE}/agents`]: files });
    const card = await screen.findByTestId('agent-files');
    expect(within(card).getByTestId('agent-file-db-migrator').textContent).toContain('3 tools');
    expect(within(card).getByTestId('agent-file-docs-writer').textContent).toContain('All tools');
    expect(within(card).getAllByText('Not mapped')).toHaveLength(2);
  });

  it('hides the agent files list while the route answers 404', async () => {
    const { server: s } = render();
    await screen.findByTestId('wf-node-plan');
    await waitFor(() => expect(s.calls.some((c) => c.path === `${BASE}/agents`)).toBe(true));
    expect(screen.queryByTestId('agent-files')).toBeNull();
    expect(screen.queryByText(/no route/)).toBeNull();
  });
});

describe('refusalMessage', () => {
  const http = (status: number, code: string, message = 'm') =>
    new ApiError({ kind: 'http', path: '/x', status, code, message });
  it('says what happened in plain words', () => {
    expect(refusalMessage(http(403, 'csrf_invalid'))).toContain('security check');
    expect(refusalMessage(http(404, 'not_found'))).toContain('no longer exists');
    expect(refusalMessage(http(409, 'conflict'))).toContain('ticket prefix');
    expect(refusalMessage(http(400, 'invalid_request', 'bad model'))).toContain('bad model');
    expect(
      refusalMessage(new ApiError({ kind: 'unreachable', path: '/x', message: 'x' })),
    ).toContain('isn’t reachable');
    expect(refusalMessage(http(500, 'internal'))).toBe('The changes couldn’t be saved.');
  });
});
