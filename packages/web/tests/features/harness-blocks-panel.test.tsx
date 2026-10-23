import { WorkflowGraphSchema, type HarnessStatus } from '@acp/core';
import { WorkflowGraphDtoSchema } from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  agentFilesFixture,
  customGraphDto,
} from '../../e2e/workflow-fixtures';
import { WorkflowPage } from '../../src/features/workflow/WorkflowPage';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/*
 * H-D (ADR-0027 §5): the Workflow editor's Checks block panel against a fake server: the place
 * (the block before the lead's merge is fixed), which checks (required, a checklist of the
 * harness's checks with labels, label chips), the failure routes each place allows and the rounds
 * back to the helper, the Add block menu's Checks items and the problems for missing picks. Core's
 * link rules for the new places are mocked with ADR-0027's (H-A adds them to core in parallel).
 */

vi.mock('@acp/core', async (importOriginal) =>
  (await import('../fixtures/planned-check-rules')).withPlannedCheckRules(importOriginal),
);

beforeAll(() => {
  if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
    class Matrix {
      m22 = 1;
    }
    Object.assign(globalThis, { DOMMatrixReadOnly: Matrix });
  }
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 });
  }
  Object.assign(SVGElement.prototype, { getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }) });
});

afterEach(() => vi.restoreAllMocks());

const BASE = `/api/projects/${WF_PROJECT_ID}`;
const GRAPH = `${BASE}/workflow-graph`;

const HARNESS: HarnessStatus = {
  state: 'ready',
  checkedAt: '2026-10-23T09:00:00.000Z',
  problems: [],
  checks: [
    {
      id: 'lint',
      name: 'Lint',
      argv: ['pnpm', 'lint'],
      timeoutSec: 300,
      required: true,
      labels: ['fast'],
    },
    {
      id: 'unit',
      name: 'Unit tests',
      argv: ['pnpm', 'test'],
      timeoutSec: 600,
      required: true,
      labels: ['fast', 'full'],
    },
    {
      id: 'e2e',
      name: 'End-to-end',
      argv: ['pnpm', 'e2e'],
      timeoutSec: 1800,
      required: false,
      labels: ['full'],
    },
  ],
  setup: [],
};

function render(graphOver?: (g: Record<string, unknown>) => Record<string, unknown>) {
  const dto = customGraphDto();
  const graph = graphOver ? graphOver(dto['graph'] as Record<string, unknown>) : dto['graph'];
  let current = WorkflowGraphDtoSchema.parse({ ...dto, graph });
  const s = fakeServer({
    '/api/control/token': { token: WF_CSRF },
    [`${BASE}/agents`]: agentFilesFixture(),
    [`${BASE}/harness`]: HARNESS,
    [GRAPH]: () => jsonResponse(200, current),
    [`PUT ${GRAPH}`]: (body: unknown) => {
      const g = WorkflowGraphSchema.parse((body as { graph: unknown }).graph);
      current = { ...current, graph: g, stored: 'v2' };
      return jsonResponse(200, current);
    },
  });
  return { server: s, ...renderWithApi(<WorkflowPage projectId={WF_PROJECT_ID} />, s) };
}

const panel = () => screen.getByRole('complementary', { name: 'Block settings' });
const issuesList = () => screen.getByTestId('issues');

async function select(id: string) {
  fireEvent.click(await screen.findByTestId(`block-${id}`));
  await waitFor(() => expect(panel().querySelector(`[data-node="${id}"]`)).not.toBeNull());
}

function addBlock(name: RegExp) {
  fireEvent.click(screen.getByTestId('add-block'));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

const radios = (legend: string) =>
  within(within(panel()).getByRole('group', { name: legend }))
    .getAllByRole('radio')
    .map((r) => r.closest('label')?.textContent ?? '');

describe('Workflow editor: the Checks block panel', () => {
  it('the block before the lead’s merge: fixed place, no Remove, lead or you decide', async () => {
    render();
    await select('checks');
    const place = within(panel()).getByTestId('check-place');
    expect(place.dataset['place']).toBe('merge');
    expect(within(place).getByTestId('check-place-mandatory').textContent).toContain(
      'can’t be moved or removed',
    );
    expect(within(panel()).queryByRole('button', { name: 'Remove block' })).toBeNull();
    const routes = radios('When a check fails');
    expect(routes).toHaveLength(2);
    expect(routes[0]).toContain('The lead decides');
    expect(routes[1]).toContain('Ask me');
    // Which checks: the three kinds; required runs the required checks by name.
    expect(radios('Which checks').map((t) => t.split(/(?<=checks|label)/)[0])).toEqual([
      'All required checks',
      'Pick checks',
      'By label',
    ]);
    expect(within(panel()).getByTestId('check-runs').textContent).toBe('Runs: Lint, Unit tests.');
  });

  it('picks checks from the harness’s list and labels as chips; the canvas follows', async () => {
    render();
    await select('checks');
    fireEvent.click(within(panel()).getByRole('radio', { name: /Pick checks/ }));
    const ids = within(panel()).getByTestId('check-ids');
    // Starts from the required checks; each check shows its labels.
    const lint = within(ids).getByRole<HTMLInputElement>('checkbox', { name: /Lint/ });
    const e2e = within(ids).getByRole<HTMLInputElement>('checkbox', { name: /End-to-end/ });
    expect(lint.checked).toBe(true);
    expect(e2e.checked).toBe(false);
    expect(ids.querySelector('[data-check="e2e"]')?.textContent).toContain('full');
    fireEvent.click(lint);
    fireEvent.click(within(ids).getByRole('checkbox', { name: /Unit tests/ }));
    // None picked: a problem on the block, in words.
    await waitFor(() => expect(screen.getByTestId('save-blocked')).toBeTruthy());
    fireEvent.click(e2e);
    expect(within(panel()).getByTestId('check-runs').textContent).toBe('Runs: End-to-end.');
    expect(
      within(screen.getByTestId('block-checks')).getByTestId('checks-select').textContent,
    ).toBe('Runs: 1 check');

    fireEvent.click(within(panel()).getByRole('radio', { name: /By label/ }));
    const labels = within(panel()).getByTestId('check-labels');
    const fast = within(labels).getByRole('button', { name: /fast/ });
    const full = within(labels).getByRole('button', { name: /full/ });
    expect(fast.getAttribute('aria-pressed')).toBe('true');
    expect(full.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(full);
    expect(full.getAttribute('aria-pressed')).toBe('true');
    expect(within(panel()).getByTestId('check-runs').textContent).toBe(
      'Runs: Lint, Unit tests, End-to-end.',
    );
  });

  it('warns about a check the harness file does not have, with a way to drop it', async () => {
    render((g) => ({
      ...g,
      nodes: (g['nodes'] as Record<string, unknown>[]).map((n) =>
        n['type'] === 'checks' ? { ...n, select: { kind: 'ids', ids: ['lint', 'gone'] } } : n,
      ),
    }));
    await screen.findByTestId('graph-editor');
    await waitFor(() =>
      expect(
        within(issuesList())
          .getAllByTestId('issue')
          .map((i) => i.dataset['code']),
      ).toContain('check-missing'),
    );
    await select('checks');
    const issues = within(panel()).getAllByTestId('issue');
    expect(issues.map((i) => i.dataset['code'])).toContain('check-missing');
    const missing = within(panel()).getByTestId('check-pick-missing');
    fireEvent.click(within(missing).getByRole('button', { name: 'Remove gone' }));
    await waitFor(() =>
      expect(
        within(panel())
          .queryAllByTestId('issue')
          .map((i) => i.dataset['code']),
      ).not.toContain('check-missing'),
    );
  });

  it('Add block › Checks on a change: linked from the selected helper; back to the helper with rounds', async () => {
    render();
    await select('helper-1');
    addBlock(/Checks on a change/);
    await waitFor(() =>
      expect(panel().querySelector('[data-node="change-checks"]')).not.toBeNull(),
    );
    expect(within(panel()).getByTestId('check-target').textContent).toBe(
      'Checks the changes of “Frontend helper”.',
    );
    const routes = radios('When a check fails');
    expect(routes.map((r) => r.split(/(?<=decides|me|helper)/)[0])).toEqual([
      'The lead decides',
      'Ask me',
      'Back to the helper',
    ]);
    fireEvent.click(within(panel()).getByRole('radio', { name: /Back to the helper/ }));
    const rounds = within(panel()).getByRole('group', { name: 'Rounds back to the helper' });
    const three = within(rounds).getByRole('radio', { name: '3 rounds' });
    fireEvent.click(three);
    expect((three as HTMLInputElement).checked).toBe(true);
    // Its links: the rework link back to the helper. Remove is offered for a change block.
    const links = within(panel()).getByTestId('node-links');
    expect(links.textContent).toContain('Sends the change back for rework');
    expect(links.textContent).toContain('Frontend helper');
    expect(within(panel()).getByRole('button', { name: 'Remove block' })).toBeTruthy();
    // Away from the helper: the rework link goes, and so do the rounds.
    fireEvent.click(within(panel()).getByRole('radio', { name: /Ask me/ }));
    expect(within(panel()).queryByRole('group', { name: 'Rounds back to the helper' })).toBeNull();
    expect(within(panel()).queryByTestId('node-links')).toBeNull();
  });

  it('Add block › Checks on the branch: only “Ask me”; the menu then says it has one', async () => {
    render();
    await screen.findByTestId('graph-editor');
    addBlock(/Checks on the branch/);
    await waitFor(() =>
      expect(panel().querySelector('[data-node="branch-checks"]')).not.toBeNull(),
    );
    const routes = radios('When a check fails');
    expect(routes).toHaveLength(1);
    expect(routes[0]).toContain('Ask me');
    expect(within(panel()).getByTestId('check-place').dataset['place']).toBe('branch');
    fireEvent.click(screen.getByTestId('add-block'));
    const item = screen.getByTestId('palette-checks-branch');
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('it can have only one');
  });
});
