import { WORKFLOW_EDGE_TYPES_V3, workflowTemplateV3, validateWorkflowGraphV3 } from '@acp/core';
import { WorkflowGraphDtoSchema } from '@acp/core/api';
import { act, render as rtl, screen, within } from '@testing-library/react';
import { Position, ReactFlowProvider, type EdgeProps } from '@xyflow/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { WF_CSRF, WF_PROJECT_ID, agentFilesFixture, graphDto } from '../../e2e/workflow-fixtures';
import {
  EDGE_LOOK,
  LINK_FAMILIES,
  LINK_FAMILY,
  LinkEdgeView,
} from '../../src/features/workflow/editor/edges';
import type { LinkEdge } from '../../src/features/workflow/editor/flow';
import { LinkStoreContext, createLinkStore } from '../../src/features/workflow/editor/link-store';
import { WorkflowPage } from '../../src/features/workflow/WorkflowPage';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/*
 * ADR-0040: link families with their own colour, the legend grouped by family, and a link under the
 * pointer (or one of the block under it) lit with a moving dash that shows its direction.
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

describe('link families', () => {
  it('puts every kind in one family, listed once in the legend order', () => {
    const listed = LINK_FAMILIES.flatMap((f) => f.types);
    expect([...listed].sort()).toEqual([...WORKFLOW_EDGE_TYPES_V3].sort());
    for (const { family, types } of LINK_FAMILIES) {
      for (const t of types) expect(LINK_FAMILY[t]).toBe(family);
    }
  });

  it('gives review, fixes and checks their own colours, never the accent, and dashes apart within a family', () => {
    const strokes = new Set(Object.values(EDGE_LOOK).map((l) => l.stroke));
    expect(strokes.has('var(--color-accent)')).toBe(false);
    expect(EDGE_LOOK.review.stroke).toBe(EDGE_LOOK.findings.stroke);
    expect(EDGE_LOOK.review.stroke).not.toBe(EDGE_LOOK.implement.stroke);
    expect(EDGE_LOOK.rework.stroke).not.toBe(EDGE_LOOK.review.stroke);
    expect(EDGE_LOOK.research.stroke).toBe(EDGE_LOOK.test.stroke);
    for (const { types } of LINK_FAMILIES) {
      const dashes = types.map(
        (t) => `${EDGE_LOOK[t].stroke}/${EDGE_LOOK[t].dash ?? 'solid'}/${EDGE_LOOK[t].width}`,
      );
      expect(new Set(dashes).size).toBe(types.length);
    }
  });
});

describe('the legend', () => {
  function render() {
    const bdd = workflowTemplateV3('bdd');
    const dto = WorkflowGraphDtoSchema.parse(
      graphDto({ graph: bdd, stored: 'v3', issues: validateWorkflowGraphV3(bdd) }),
    );
    const BASE = `/api/projects/${WF_PROJECT_ID}`;
    const s = fakeServer({
      '/api/control/token': { token: WF_CSRF },
      [`${BASE}/agents`]: agentFilesFixture(),
      [`${BASE}/workflow-graph`]: () => jsonResponse(200, dto),
    });
    return renderWithApi(<WorkflowPage projectId={WF_PROJECT_ID} />, s);
  }

  it('groups the legend by family', async () => {
    render();
    const legend = await screen.findByTestId('workflow-legend');
    expect(within(legend).getByTestId('legend-review').textContent).toBe('Review:ReviewFindings');
    expect(within(legend).getByTestId('legend-fix').textContent).toBe('Fixes:ReworkWhen');
  });
});

describe('a lit link', () => {
  function link(store: ReturnType<typeof createLinkStore>, id = 'review-dev') {
    const props = {
      id,
      source: 'developer',
      target: 'orchestrate',
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 100,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        type: 'review' as const,
        refused: false,
        route: { kind: 'corridor' as const, lane: 0 },
        dim: false,
      },
      selected: false,
    } as unknown as EdgeProps<LinkEdge>;
    return rtl(
      <ReactFlowProvider>
        <LinkStoreContext.Provider value={store}>
          <svg>
            <LinkEdgeView {...props} />
          </svg>
        </LinkStoreContext.Provider>
      </ReactFlowProvider>,
    );
  }

  it('shows its direction while the pointer is on its block or on it, and fades when another is', () => {
    const store = createLinkStore();
    const { container } = link(store);
    const flow = () => container.querySelectorAll('[data-testid="link-flow"]').length;
    const opacity = () => container.querySelector('g[data-link]')?.getAttribute('opacity');
    expect(flow()).toBe(0);
    act(() => store.set({ hover: 'developer' }));
    expect(flow()).toBe(1);
    act(() => store.set({ hover: 'edge:review-dev' }));
    expect(flow()).toBe(1);
    act(() => store.set({ hover: 'scenario-tests' }));
    expect(flow()).toBe(0);
    expect(opacity()).toBe('0.3');
    act(() => store.set({ hover: null }));
    expect(opacity()).toBe('1');
  });
});
