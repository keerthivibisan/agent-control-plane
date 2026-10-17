import { WorkflowGraphSchema, validateWorkflowGraph, type GraphIssue } from '@acp/core';
import { WorkflowGraphDtoSchema, type WorkflowGraphDto } from '@acp/core/api';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  agentFilesFixture,
  customGraphDto,
  graphDto,
  workflowInvalidError,
} from '../../e2e/workflow-fixtures';
import { refusalMessage } from '../../src/features/workflow/draft';
import { WorkflowPage } from '../../src/features/workflow/WorkflowPage';
import { ApiError } from '../../src/lib/api';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * WG-D: the Workflow page on the graph editor (ADR-0023), against a fake server answering the new
 * routes with the shared synthetic fixtures. React Flow draws the blocks; the editing goes through
 * the palette, the block panel's fields and "Add a link" (the keyboard way to link two blocks), so
 * no drag is needed here. Dragging and a refused drop are covered in e2e (workflow.spec.ts).
 */

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

afterEach(() => {
  vi.restoreAllMocks();
});

const BASE = `/api/projects/${WF_PROJECT_ID}`;
const GRAPH = `${BASE}/workflow-graph`;
const VALIDATE = `${GRAPH}/validate`;
const parse = (dto: unknown): WorkflowGraphDto => WorkflowGraphDtoSchema.parse(dto);

function server(initial: unknown, extra: RouteTable = {}) {
  let current = parse(initial);
  return fakeServer({
    '/api/control/token': { token: WF_CSRF },
    [`${BASE}/agents`]: agentFilesFixture(),
    [GRAPH]: () => jsonResponse(200, current),
    [`PUT ${GRAPH}`]: (body: unknown) => {
      const graph = WorkflowGraphSchema.parse((body as { graph: unknown }).graph);
      current = { ...current, graph, stored: 'v2', issues: validateWorkflowGraph(graph) };
      return jsonResponse(200, current);
    },
    ...extra,
  });
}

function render(initial: unknown = graphDto(), extra: RouteTable = {}) {
  const s = server(initial, extra);
  return { server: s, ...renderWithApi(<WorkflowPage projectId={WF_PROJECT_ID} />, s) };
}

const block = (id: string) => screen.getByTestId(`block-${id}`);
const panel = () => screen.getByRole('complementary', { name: 'Block settings' });
const issues = () => screen.getByTestId('issues');
const saveButton = () => screen.getByTestId('save-workflow');
const puts = (s: ReturnType<typeof server>) =>
  s.calls.filter((c) => c.method === 'PUT' && c.path === GRAPH);

/** Selects a block the way the problems list or a click does: React Flow's node click. */
async function select(id: string) {
  const el = await screen.findByTestId(`block-${id}`);
  fireEvent.click(el);
  await waitFor(() => expect(panel().querySelector(`[data-node="${id}"]`)).not.toBeNull());
}

/** Adds a link from the selected block with the panel's "Add a link" form. */
function addLink(to: string, kind: string) {
  const form = within(panel()).getByTestId('add-link');
  fireEvent.change(within(form).getByRole('combobox', { name: 'To' }), {
    target: { value: to },
  });
  fireEvent.change(within(form).getByRole('combobox', { name: 'Kind of link' }), {
    target: { value: kind },
  });
  fireEvent.click(within(form).getByRole('button', { name: 'Add link' }));
}

describe('Workflow page: the graph editor', () => {
  it('loads the graph from …/workflow-graph and draws every block, with no problems', async () => {
    const { server: s } = render();
    await screen.findByTestId('graph-editor');
    expect(s.calls.some((c) => c.path === GRAPH)).toBe(true);
    for (const id of ['ticket', 'orchestrate', 'helpers', 'review', 'checks', 'owner-merge']) {
      expect(block(id)).toBeTruthy();
    }
    expect(block('orchestrate').dataset.kind).toBe('lead');
    expect(within(block('helpers')).getByTestId('block-mode').textContent).toBe(
      'Mode: Auto edits (default)',
    );
    expect(within(issues()).getByTestId('issues-none')).toBeTruthy();
    // Nothing changed yet: Save is off and nothing says "unsaved".
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    expect(screen.queryByTestId('unsaved')).toBeNull();
    expect(screen.getByTestId('project-defaults')).toBeTruthy();
  });

  it('read-only blocks have no approval mode; helpers and the tester do', async () => {
    render(customGraphDto());
    await select('orchestrate');
    expect(within(panel()).getByTestId('no-mode')).toBeTruthy();
    expect(within(panel()).queryByTestId('mode-field')).toBeNull();
    expect(within(panel()).getByTestId('block-fixed')).toBeTruthy();
    await select('review');
    expect(within(panel()).queryByTestId('mode-field')).toBeNull();
    await select('unit-tests');
    const mode = within(panel()).getByTestId('mode-field');
    expect(within(mode).getAllByRole('radio')).toHaveLength(5);
    expect(within(mode).getByLabelText<HTMLInputElement>(/^Auto edits/).checked).toBe(true);
    expect(within(panel()).getByTestId('mode-careful').textContent).toContain(
      'can only make this block more careful',
    );
    expect(within(panel()).getByRole('button', { name: 'Remove block' })).toBeTruthy();
  });

  it('the mode choice: project default, Full auto with its warning, shown on the block', async () => {
    render();
    await select('helpers');
    const mode = within(panel()).getByTestId('mode-field');
    expect(
      within(mode).getByLabelText<HTMLInputElement>('Project default (Auto edits)', {
        exact: false,
      }).checked,
    ).toBe(true);
    fireEvent.click(within(mode).getByLabelText(/^Full auto/));
    expect(within(panel()).getByTestId('full-auto-warning')).toBeTruthy();
    expect(within(block('helpers')).getByTestId('block-mode').textContent).toBe('Mode: Full auto');
    // The plan step still asks: a warning, not a problem, so Save stays possible.
    expect(issues().dataset.warnings).toBe('1');
    expect(issues().dataset.errors).toBe('0');
    expect(saveButton().hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('unsaved')).toBeTruthy();
  });

  it('flags a block’s missing skill and agent file, and edits skills (at most three)', async () => {
    render(customGraphDto());
    await select('helper-1');
    expect(within(panel()).getByTestId('skill-missing').textContent).toContain('release-notes');
    expect(within(panel()).getByTestId('agent-missing')).toBeTruthy();
    expect(within(block('helper-1')).getByTestId('block-skill').dataset.skill).toBe('missing');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Remove release-notes' }));
    const skills = within(panel()).getByTestId('skills-field');
    for (const name of ['code-review', 'plan-tickets', 'unit-tests']) {
      fireEvent.click(within(skills).getByLabelText(name));
    }
    expect(within(skills).getByText(/3 skills chosen/)).toBeTruthy();
    expect(within(block('helper-1')).getAllByTestId('block-skill')).toHaveLength(3);
  });

  it('palette: a named helper, linked from the lead and to a review; problems update; saves', async () => {
    const { server: s } = render();
    await screen.findByTestId('graph-editor');
    fireEvent.click(screen.getByRole('button', { name: 'Add Named helper' }));
    await waitFor(() => expect(panel().querySelector('[data-node="helper-1"]')).not.toBeNull());
    const codes = () =>
      within(issues())
        .queryAllByTestId('issue')
        .map((i) => i.dataset.code);
    expect(codes()).toEqual(expect.arrayContaining(['no-review-route', 'not-assigned']));
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('save-blocked').textContent).toBe('Fix the problems to save.');

    // Name it, then link it: its review goes to the change reviewer…
    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Frontend helper' },
    });
    addLink('review', 'review');
    await waitFor(() => expect(codes()).not.toContain('no-review-route'));
    // …and the lead assigns it work.
    await select('orchestrate');
    addLink('helper-1', 'assigns');
    await waitFor(() => expect(within(issues()).getByTestId('issues-none')).toBeTruthy());

    fireEvent.click(saveButton());
    await screen.findByTestId('saved');
    const body = puts(s)[0]?.body as { graph: unknown };
    const graph = WorkflowGraphSchema.parse(body.graph);
    expect(validateWorkflowGraph(graph).filter((i) => i.severity === 'error')).toEqual([]);
    expect(graph.template).toBe('custom');
    expect(graph.nodes.find((n) => n.id === 'helper-1')).toMatchObject({
      type: 'helper',
      label: 'Frontend helper',
    });
    // The earlier setup travels with the graph, so it can still be restored.
    expect(graph.legacyV1).toBeDefined();
    expect(screen.queryByTestId('unsaved')).toBeNull();
  });

  it('a palette item at its limit stays focusable, says why, and adds nothing', async () => {
    render(customGraphDto());
    await screen.findByTestId('graph-editor');
    const planner = screen.getByRole('button', { name: 'Add Planner' });
    expect(planner.getAttribute('aria-disabled')).toBe('true');
    fireEvent.focus(planner);
    expect(screen.getByRole('tooltip').textContent).toContain('it can have only one');
    fireEvent.click(planner);
    expect(screen.getAllByTestId('block-plan')).toHaveLength(1);
    expect(screen.queryByTestId('unsaved')).toBeNull();
  });

  it('a click on a problem selects its block and opens its settings', async () => {
    render();
    await screen.findByTestId('graph-editor');
    fireEvent.click(screen.getByRole('button', { name: 'Add Tester' }));
    const issue = await within(issues()).findByText(/"Tester" has no review link/);
    fireEvent.click(issue.closest('button') as HTMLElement);
    await waitFor(() => expect(panel().querySelector('[data-node="unit-tests"]')).not.toBeNull());
    expect(block('unit-tests').dataset.selected).toBe('true');
  });

  it('templates: replaces the editor’s graph; with unsaved work it asks first; restore', async () => {
    render();
    await screen.findByTestId('graph-editor');
    fireEvent.click(screen.getByTestId('open-templates'));
    const picker = await screen.findByRole('dialog', { name: 'Start from a template' });
    expect(within(picker).getByText(/The lead reviews and merges/)).toBeTruthy();
    expect(within(picker).getByText(/A reviewer checks, the lead decides/)).toBeTruthy();
    expect(
      within(picker).getByText(
        /The reviewer sends changes back to the helper, then the lead merges/,
      ),
    ).toBeTruthy();
    fireEvent.click(within(picker).getByLabelText(/^Lead only/));
    fireEvent.click(within(picker).getByRole('button', { name: 'Use this template' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('block-review')).toBeNull();
    expect(screen.getByTestId('unsaved')).toBeTruthy();

    // Unsaved work now: the next template asks before replacing it.
    fireEvent.click(screen.getByTestId('open-templates'));
    const again = await screen.findByRole('dialog', { name: 'Start from a template' });
    fireEvent.click(within(again).getByLabelText(/^Reviewer ↔ helper loop/));
    fireEvent.click(within(again).getByLabelText('Add a planner'));
    fireEvent.click(within(again).getByRole('button', { name: 'Use this template' }));
    expect(within(again).getByTestId('template-confirm').textContent).toContain(
      'replaces your unsaved changes',
    );
    fireEvent.click(within(again).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(block('plan')).toBeTruthy();
    // Edges need a laid-out canvas to draw, so check the reviewer's links in its panel instead.
    await select('review');
    expect(within(panel()).getByTestId('node-links').textContent).toContain(
      'Sends the change back for rework → Helpers',
    );

    // Restore my earlier setup: the migrated graph again, so nothing is unsaved.
    fireEvent.click(screen.getByTestId('open-templates'));
    const third = await screen.findByRole('dialog', { name: 'Start from a template' });
    fireEvent.click(within(third).getByRole('button', { name: 'Restore my earlier setup' }));
    fireEvent.click(within(third).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('block-plan')).toBeNull();
    expect(block('review')).toBeTruthy();
    expect(screen.queryByTestId('unsaved')).toBeNull();
  });

  it('without an earlier setup there is nothing to restore', async () => {
    render(customGraphDto());
    await screen.findByTestId('graph-editor');
    fireEvent.click(screen.getByTestId('open-templates'));
    const picker = await screen.findByRole('dialog', { name: 'Start from a template' });
    expect(within(picker).queryByTestId('restore-earlier')).toBeNull();
  });

  it('a 422 shows the server’s own issues from …/validate', async () => {
    const serverIssue: GraphIssue = {
      code: 'no-review-route',
      severity: 'error',
      message: '"Helpers" has no review link (the server says).',
      nodeId: 'helpers',
    };
    const { server: s } = render(graphDto(), {
      [`PUT ${GRAPH}`]: () => jsonResponse(422, workflowInvalidError()),
      [`POST ${VALIDATE}`]: () => jsonResponse(200, { ok: false, issues: [serverIssue] }),
    });
    await select('helpers');
    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Workers' },
    });
    fireEvent.click(saveButton());
    const box = await screen.findByTestId('server-issues');
    expect(box.textContent).toContain('the server says');
    expect(screen.getByTestId('save-refusal').textContent).toContain('The workflow wasn’t saved.');
    expect(s.calls.some((c) => c.method === 'POST' && c.path === VALIDATE)).toBe(true);
    // A click on the server's issue selects its block too.
    fireEvent.click(within(box).getByRole('button'));
    expect(panel().querySelector('[data-node="helpers"]')).not.toBeNull();
    // Any change may fix it: the server's list goes away.
    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Workers 2' },
    });
    expect(screen.queryByTestId('server-issues')).toBeNull();
  });

  it('another refusal is explained in plain words, without a list', async () => {
    render(graphDto(), {
      [`PUT ${GRAPH}`]: () =>
        jsonResponse(404, { error: { code: 'not_found', message: 'gone', requestId: 'r' } }),
    });
    await select('helpers');
    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Workers' },
    });
    fireEvent.click(saveButton());
    expect((await screen.findByTestId('save-refusal')).textContent).toContain(
      'This project no longer exists in the app.',
    );
    expect(screen.queryByTestId('server-issues')).toBeNull();
  });

  it('an empty name is a problem; Discard puts the saved graph back', async () => {
    render();
    await select('review');
    const name = within(panel()).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: '  ' } });
    expect(within(panel()).getByText('Give the block a name.')).toBeTruthy();
    expect(within(issues()).getAllByTestId('issue')[0]?.dataset.code).toBe('shape');
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(within(block('review')).getByTestId('block-label').textContent).toBe('Change reviewer');
    expect(screen.queryByTestId('unsaved')).toBeNull();
  });

  it('removes a block from its panel, and a rework link’s rounds from the link panel', async () => {
    render();
    await select('review');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Remove block' }));
    expect(screen.queryByTestId('block-review')).toBeNull();
    expect(
      within(issues())
        .getAllByTestId('issue')
        .map((i) => i.dataset.code),
    ).toContain('no-review-route');
    // The lead's links list the rework link; the panel's remove button drops it.
    await select('orchestrate');
    const links = within(panel()).getByTestId('node-links');
    expect(links.textContent).toContain('Sends the change back for rework');
    fireEvent.click(
      within(links).getByRole('button', {
        name: 'Remove link Sends the change back for rework: from Lead to Helpers',
      }),
    );
    expect(within(panel()).getByTestId('node-links').textContent).not.toContain('rework');
  });

  it('the plan approval’s switch says a ticket or run can still make it ask', async () => {
    render();
    await select('plan-approval');
    const box = within(panel()).getByLabelText<HTMLInputElement>('Approve plans automatically');
    expect(box.checked).toBe(false);
    expect(within(panel()).getByText(/a more careful ticket or run still asks you/)).toBeTruthy();
    fireEvent.click(box);
    expect(within(block('plan-approval')).getByTestId('plan-auto').dataset.auto).toBe('true');
    // No helper runs in Full auto: a warning says the plan is still sent.
    expect(
      within(issues())
        .getAllByTestId('issue')
        .map((i) => i.dataset.code),
    ).toEqual(['plan-auto-without-full-auto']);
  });

  it('asks before an in-app link leaves the page with unsaved changes', async () => {
    render();
    await select('review');
    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Checker' },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const link = within(panel()).getByRole('link', { name: 'Open Skills & Agents' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      link.dispatchEvent(event);
    });
    expect(confirm).toHaveBeenCalledWith(
      'You have unsaved changes to the workflow. Leave without saving them?',
    );
    expect(event.defaultPrevented).toBe(true);
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
