import {
  WorkflowGraphV3Schema,
  validateWorkflowGraphV3,
  workflowTemplateV3,
  type WorkflowNodeV3,
} from '@acp/core';
import { WorkflowGraphDtoSchema, type WorkflowGraphDto } from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { WF_CSRF, WF_PROJECT_ID, agentFilesFixture, graphDto } from '../../e2e/workflow-fixtures';
import { patchNode } from '../../src/features/workflow/editor/state';
import { WorkflowPage } from '../../src/features/workflow/WorkflowPage';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/*
 * ADR-0039, the web side: an agent block's "Runs for" ticket types, the chip on the block, and
 * the problem when a ticket type would be left with a workflow that cannot run. Core is never
 * mocked: the problem is core's validation.
 */

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
const GRAPH = `${BASE}/workflow-graph`;

function render() {
  const bdd = workflowTemplateV3('bdd');
  let current: WorkflowGraphDto = WorkflowGraphDtoSchema.parse(
    graphDto({ graph: bdd, stored: 'v3', issues: validateWorkflowGraphV3(bdd) }),
  );
  const s = fakeServer({
    '/api/control/token': { token: WF_CSRF },
    [`${BASE}/agents`]: agentFilesFixture(),
    [GRAPH]: () => jsonResponse(200, current),
    [`PUT ${GRAPH}`]: (body: unknown) => {
      const graph = WorkflowGraphV3Schema.parse((body as { graph: unknown }).graph);
      current = { ...current, graph, stored: 'v3', issues: validateWorkflowGraphV3(graph) };
      return jsonResponse(200, current);
    },
  });
  return { server: s, ...renderWithApi(<WorkflowPage projectId={WF_PROJECT_ID} />, s) };
}

const panel = () => screen.getByRole('complementary', { name: 'Block settings' });

async function select(id: string) {
  fireEvent.click(await screen.findByTestId(`block-${id}`));
  await waitFor(() => expect(panel().querySelector(`[data-node="${id}"]`)).not.toBeNull());
}

const chip = (id: string) =>
  within(screen.getByTestId(`block-${id}`)).queryByTestId('block-ticket-types')?.textContent;
const ticked = () =>
  (['feature', 'bug', 'chore', 'harness'] as const).filter(
    (t) => within(panel()).getByTestId<HTMLInputElement>(`ticket-type-${t}`).checked,
  );

describe('"Runs for" ticket types on an agent block', () => {
  it('stores the types in their own order, and every type or none drops the field', () => {
    const node = workflowTemplateV3('bdd').nodes.find(
      (n) => n.id === 'developer',
    ) as WorkflowNodeV3;
    expect(patchNode(node, { ticketTypes: ['chore', 'feature'] })).toMatchObject({
      ticketTypes: ['feature', 'chore'],
    });
    expect(
      'ticketTypes' in patchNode(node, { ticketTypes: ['harness', 'bug', 'chore', 'feature'] }),
    ).toBe(false);
    expect('ticketTypes' in patchNode(node, { ticketTypes: null })).toBe(false);
  });

  it('shows the BDD template’s feature-only blocks, keeps the last type ticked, and saves', async () => {
    const { server: s } = render();
    expect(await screen.findByTestId('block-behaviour')).toBeTruthy();
    expect(chip('behaviour')).toBe('Feature only');
    expect(chip('scenario-tests')).toBe('Feature only');
    expect(chip('developer')).toBeUndefined();

    await select('scenario-tests');
    expect(ticked()).toEqual(['feature']);
    expect(within(panel()).getByTestId<HTMLInputElement>('ticket-type-feature').disabled).toBe(
      true,
    );
    expect(within(panel()).getByTestId('ticket-types-field').textContent).toContain(
      'A block runs for at least one ticket type.',
    );
    fireEvent.click(within(panel()).getByTestId('ticket-type-chore'));
    expect(chip('scenario-tests')).toBe('Feature, Chore only');

    fireEvent.click(screen.getByTestId('save-workflow'));
    await screen.findByTestId('saved');
    const put = s.calls.filter((c) => c.method === 'PUT' && c.path === GRAPH);
    const saved = WorkflowGraphV3Schema.parse((put.at(-1)?.body as { graph: unknown }).graph);
    expect(saved.nodes.find((n) => n.id === 'scenario-tests')).toMatchObject({
      ticketTypes: ['feature', 'chore'],
    });
  });

  it('flags a ticket type left without a helper', async () => {
    render();
    await select('developer');
    expect(ticked()).toEqual(['feature', 'bug', 'chore', 'harness']);
    fireEvent.click(within(panel()).getByTestId('ticket-type-bug'));
    expect(chip('developer')).toBe('Feature, Chore, Harness only');
    // The problems list shows once the block panel closes.
    fireEvent.click(screen.getByTestId('problems-button'));
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('issue')
          .some((i) => i.getAttribute('data-code') === 'ticket-type-breaks-workflow'),
      ).toBe(true),
    );
    const issue = screen
      .getAllByTestId('issue')
      .find((i) => i.getAttribute('data-code') === 'ticket-type-breaks-workflow');
    expect(issue?.textContent).toContain('For bug tickets, without');
  });
});
