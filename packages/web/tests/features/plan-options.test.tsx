// ADR-0037 §4 (AR-5b): several planners' plans side by side on the ticket page. Synthetic data.
import { TicketDetailDtoSchema } from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  OPTION_A,
  OPTION_B,
  PLAN_V2,
  PROJECT_ID,
  TICKET_ID,
  planOptionsScenario,
  planReviewScenario,
  workingScenario,
  type TicketScenario,
} from '../../e2e/ticket-fixtures';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

const TICKET = `/api/tickets/${TICKET_ID}`;
const DECIDE = `POST ${TICKET}/plan-options/decision`;

// The live workflow is React Flow, which measures the DOM; jsdom has no layout.
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
  Object.assign(SVGElement.prototype, {
    getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
});

function render(sc: TicketScenario, routes: RouteTable = {}) {
  const server = fakeServer({ ...sc.routes, ...routes });
  window.location.hash = `#/p/${PROJECT_ID}/tickets/${TICKET_ID}`;
  renderWithApi(<TicketPage id={TICKET_ID} />, server);
  return server;
}

const mutations = (s: ReturnType<typeof fakeServer>) => s.calls.filter((c) => c.method !== 'GET');

describe('ticket page: several planners’ plans (ADR-0037 §4)', () => {
  it('the fixture matches the API contract', () => {
    expect(() => TicketDetailDtoSchema.parse(planOptionsScenario().routes[TICKET])).not.toThrow();
  });

  it('shows both plans side by side with their planner, summary and steps', async () => {
    render(planOptionsScenario());
    const card = await screen.findByTestId('plan-options-card');
    expect(screen.queryByTestId('plan-card')).toBeNull();
    expect(card.textContent).toContain('2 planners each wrote a plan');
    const options = within(card).getAllByTestId('plan-option');
    expect(options.map((o) => o.dataset['option'])).toEqual([OPTION_A, OPTION_B]);
    expect(within(options[0] as HTMLElement).getByText('By Claude planner')).toBeTruthy();
    expect(within(options[1] as HTMLElement).getByText('By Codex planner')).toBeTruthy();
    // Each with its steps and the helper that does each one.
    const steps = within(options[1] as HTMLElement).getByRole('list', { name: 'Plan' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    expect(within(steps).getByText('Settings toggle')).toBeTruthy();
    expect(within(options[1] as HTMLElement).getByText('3 helper agents planned')).toBeTruthy();
    expect(within(card).getAllByRole('button', { name: /^Approve the plan by/ })).toHaveLength(2);
  });

  it('approving the second plan sends its option id', async () => {
    const s = render(planOptionsScenario(), {
      [DECIDE]: () => jsonResponse(200, workingScenario().routes[TICKET]),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Approve the plan by Codex planner' }),
    );
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      method: 'POST',
      path: `${TICKET}/plan-options/decision`,
      body: { decision: 'approve', planOptionId: OPTION_B },
    });
  });

  it('request changes needs a comment and goes to every planner', async () => {
    const s = render(planOptionsScenario(), {
      [DECIDE]: () => jsonResponse(200, planOptionsScenario().routes[TICKET]),
    });
    const card = await screen.findByTestId('plan-options-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Request changes' }));
    expect(within(card).getByText('Say what should change.')).toBeTruthy();
    expect(mutations(s)).toEqual([]);
    fireEvent.change(within(card).getByLabelText('What should change?'), {
      target: { value: '  Both plans need tests.  ' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Request changes' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      path: `${TICKET}/plan-options/decision`,
      body: { decision: 'request-changes', comment: 'Both plans need tests.' },
    });
  });

  it('a single planner’s plan is unchanged: one plan card, decided on the plan', async () => {
    const s = render(planReviewScenario(), {
      [`POST ${TICKET}/plans/${PLAN_V2}/decision`]: () =>
        jsonResponse(200, workingScenario().routes[TICKET]),
    });
    await screen.findByTestId('plan-card');
    expect(screen.queryByTestId('plan-options-card')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));
    await waitFor(() => expect(mutations(s)).toHaveLength(1));
    expect(mutations(s)[0]).toMatchObject({
      path: `${TICKET}/plans/${PLAN_V2}/decision`,
      body: { decision: 'approve' },
    });
  });
});
