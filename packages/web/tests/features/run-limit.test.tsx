import { WorkflowGraphSchema } from '@acp/core';
import { WorkflowGraphDtoSchema, type ChangeReviewRoundDto } from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PROJECT_GRAPH_PATH,
  carefulGraph,
  directLoopGraph,
  directLoopScenario,
  projectGraphDto,
} from '../../e2e/live-graph-fixtures';
import { LOOP_TICKET_ID } from '../../e2e/review-loop-fixtures';
import { projectGraph } from '../../e2e/ticket-fixtures';
import { roundSentence } from '../../src/features/review-loop/ChangeCard';
import {
  blockModesOf,
  limitHasNoEffect,
  loosestBlockMode,
  reworkRoundsBy,
  runLimitNoEffect,
} from '../../src/features/review-loop/logic';
import { StartDialog } from '../../src/features/review-loop/StartDialog';
import { TicketInfo } from '../../src/features/ticket/TicketInfo';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { CSRF, PROJECT_ID, ticketDetail, ticketDto } from '../fixtures/board';
import { fakeServer, renderWithApi, type RouteTable } from '../helpers';

/*
 * WG-E (ADR-0023): run options read as a limit ("at most") in the Start dialog and the ticket's
 * Run options, with the note when a limit is looser than every block; the change cards' direct
 * rework by the review agent (route c). The project's mode is Auto edits (fixtures).
 */

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

afterEach(() => window.localStorage.clear());

function server(routes: RouteTable = {}, { graph = true } = {}) {
  return fakeServer({
    '/api/control/token': { token: CSRF },
    // WG-F: the run options read the project's graph; the version 1 workflow is never asked.
    ...(graph ? { [PROJECT_GRAPH_PATH]: projectGraph() } : {}),
    ...routes,
  });
}

function startDialog(
  routes: RouteTable = {},
  ticketOptions?: { approvalMode: 'manual' },
  opts: { graph?: boolean } = {},
) {
  const started: unknown[] = [];
  renderWithApi(
    <StartDialog
      projectId={PROJECT_ID}
      ticketKey="WEB-21"
      kind="start"
      pending={false}
      error={null}
      ticketOptions={ticketOptions}
      onStart={(r) => started.push(r)}
      onClose={() => {}}
    />,
    server(routes, opts),
  );
  return started;
}

const careful = { [PROJECT_GRAPH_PATH]: projectGraphDto(carefulGraph()) };

describe('the blocks’ modes (logic)', () => {
  it('finds the loosest editing block, using the project’s mode for Project default', () => {
    const graph = WorkflowGraphSchema.parse(directLoopGraph());
    expect(loosestBlockMode(graph, 'manual')).toBe('full-auto');
    expect(loosestBlockMode(WorkflowGraphSchema.parse(carefulGraph()), 'auto-edits')).toBe(
      'auto-edits',
    );
    expect(loosestBlockMode(WorkflowGraphSchema.parse(carefulGraph()), 'manual')).toBe('manual');
    expect(loosestBlockMode({ nodes: [] }, 'auto')).toBeNull();
    const blocks = blockModesOf(WorkflowGraphDtoSchema.parse(projectGraphDto(carefulGraph())));
    expect(blocks).toEqual({ projectMode: 'auto-edits', loosest: 'auto-edits' });
  });

  it('a limit changes nothing only when it is looser than every block', () => {
    const blocks = { projectMode: 'auto-edits' as const, loosest: 'auto-edits' as const };
    expect(limitHasNoEffect('full-auto', blocks)).toBe(true);
    expect(limitHasNoEffect('auto', blocks)).toBe(true);
    expect(limitHasNoEffect('auto-edits', blocks)).toBe(false);
    expect(limitHasNoEffect('manual', blocks)).toBe(false);
    // Unknown blocks or none that edit: never said.
    expect(limitHasNoEffect('full-auto', undefined)).toBe(false);
    expect(limitHasNoEffect('full-auto', { projectMode: 'manual', loosest: null })).toBe(false);
  });
});

describe('a run limit and the ticket’s limit (both apply)', () => {
  const blocks = { projectMode: 'auto-edits' as const, loosest: 'full-auto' as const };

  it('names the stricter of the ticket’s limit and the loosest block', () => {
    // The ticket's Manual is stricter than every block: a looser run limit changes nothing.
    expect(runLimitNoEffect('auto', blocks, 'manual')).toEqual({ by: 'ticket', limit: 'manual' });
    expect(runLimitNoEffect('manual', blocks, 'manual')).toBeNull();
    // Without blocks known, the ticket's limit still decides.
    expect(runLimitNoEffect('full-auto', undefined, 'auto-edits')).toEqual({
      by: 'ticket',
      limit: 'auto-edits',
    });
    // A ticket limit looser than every block: the blocks decide.
    const careful = { projectMode: 'manual' as const, loosest: 'manual' as const };
    expect(runLimitNoEffect('auto', careful, 'full-auto')).toEqual({
      by: 'blocks',
      loosest: 'manual',
    });
    expect(runLimitNoEffect('auto', undefined, undefined)).toBeNull();
  });

  it('the Start dialog says a run limit looser than the ticket’s changes nothing', async () => {
    startDialog(
      { [PROJECT_GRAPH_PATH]: projectGraphDto(directLoopGraph()) },
      {
        approvalMode: 'manual',
      },
    );
    const dialog = await screen.findByTestId('start-dialog');
    // The API helper is set to Full auto, so the blocks alone would allow Auto.
    await within(dialog).findByLabelText(/^Manual · This ticket/);
    fireEvent.click(within(dialog).getByLabelText(/^AutoLike/));
    const note = within(dialog).getByTestId('mode-no-effect');
    expect(note.dataset.by).toBe('ticket');
    expect(note.textContent).toBe(
      'This ticket is limited to at most Manual, so “at most Auto” changes nothing for this run.',
    );
    expect(within(dialog).queryByTestId('approvals-warning')).toBeNull();
    fireEvent.click(within(dialog).getByLabelText(/^Manual · This ticket/));
    expect(within(dialog).queryByTestId('mode-no-effect')).toBeNull();
  });
});

describe('Start dialog: the mode is a limit', () => {
  it('starts at No limit and says each block keeps its own mode', async () => {
    const started = startDialog(careful);
    const dialog = await screen.findByTestId('start-dialog');
    expect(within(dialog).getByText('Approval mode: at most')).toBeTruthy();
    const none = await within(dialog).findByLabelText<HTMLInputElement>(/^No limit/);
    expect(none.checked).toBe(true);
    await waitFor(() =>
      expect(
        within(dialog).getByText(/Blocks set to Project default use Auto edits\./),
      ).toBeTruthy(),
    );
    expect(within(dialog).getByTestId('mode-limit-summary').textContent).toBe(
      'Approval mode: no limit — each block keeps the mode set on the Workflow page.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    expect(started).toEqual([{}]);
  });

  it('a limit looser than every block says it changes nothing, with no warning', async () => {
    const started = startDialog(careful);
    const dialog = await screen.findByTestId('start-dialog');
    // Wait for the blocks: the note needs the project's graph.
    await within(dialog).findByText(/Blocks set to Project default use Auto edits\./);
    fireEvent.click(within(dialog).getByLabelText(/^Full auto/));
    expect(within(dialog).getByTestId('mode-no-effect').textContent).toBe(
      'No block in this workflow is set looser than Auto edits, so “at most Full auto” changes nothing.',
    );
    expect(within(dialog).queryByTestId('full-auto-warning')).toBeNull();
    expect(within(dialog).getByTestId('mode-limit-summary').textContent).toBe(
      'Approval mode: at most Full auto — blocks set to a stricter mode keep it; this can’t loosen any block.',
    );
    // The project's own mode is a real limit too, so it is sent.
    fireEvent.click(within(dialog).getByLabelText(/^Auto edits/));
    expect(within(dialog).queryByTestId('mode-no-effect')).toBeNull();
    expect(within(dialog).queryByTestId('approvals-warning')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    expect(started).toEqual([{ approvalMode: 'auto-edits' }]);
  });

  it('a block set looser than the limit: no note', async () => {
    startDialog({ [PROJECT_GRAPH_PATH]: projectGraphDto(directLoopGraph()) });
    const dialog = await screen.findByTestId('start-dialog');
    await within(dialog).findByText(/Blocks set to Project default use Auto edits\./);
    fireEvent.click(within(dialog).getByLabelText(/^AutoLike/));
    expect(within(dialog).queryByTestId('mode-no-effect')).toBeNull();
  });

  it('without the project’s graph it says the settings couldn’t be loaded; Start sends nothing', async () => {
    const started = startDialog({}, undefined, { graph: false });
    const dialog = await screen.findByTestId('start-dialog');
    await within(dialog).findByText(/^The project’s settings couldn’t be loaded/);
    expect(within(dialog).queryByLabelText(/^Full auto/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    expect(started).toEqual([{}]);
  });

  it('explains Lead reviews and the rework rounds as overrides of the workflow', async () => {
    startDialog(careful);
    const dialog = await screen.findByTestId('start-dialog');
    await within(dialog).findByLabelText(/^The lead/);
    expect(
      within(dialog).getByText(
        'Lead reviews: every change goes to the lead for this run, whatever the workflow’s review links say.',
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText('Each change follows the workflow’s review links.'),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/Replaces every rework limit in the workflow for this run\./),
    ).toBeTruthy();
  });
});

describe('the ticket’s Run options: a limit', () => {
  const ticket = ticketDto({ id: 't-21', key: 'WEB-21', runOptions: {} });

  it('shows No limit, and the note for a limit looser than every block', async () => {
    renderWithApi(
      <TicketInfo detail={ticketDetail(ticket)} shownRunId={null} onShowRun={() => {}} />,
      server(careful),
    );
    const section = screen.getByTestId('ticket-run-options');
    expect(within(section).getByText('Approvals, at most')).toBeTruthy();
    expect(within(section).getByTestId('run-option-mode').textContent).toBe(
      'No limit: each block’s own mode',
    );
    fireEvent.click(within(section).getByRole('button', { name: 'Change run options' }));
    const mode = within(section).getByLabelText('Approval mode: at most');
    expect(
      within(section).getByText(
        'A limit for this ticket’s runs: blocks set to a stricter mode keep it, and it can’t loosen any block.',
      ),
    ).toBeTruthy();
    // The note needs the project's graph.
    await waitFor(() => {
      fireEvent.change(mode, { target: { value: 'auto' } });
      expect(within(section).getByTestId('mode-no-effect').textContent).toBe(
        'No block in this workflow is set looser than Auto edits, so “at most Auto” changes nothing.',
      );
    });
    expect(within(section).queryByTestId('approvals-warning')).toBeNull();
    fireEvent.change(mode, { target: { value: 'manual' } });
    expect(within(section).queryByTestId('mode-no-effect')).toBeNull();
    expect(within(section).getByText(/Lead reviews sends every change to the lead/)).toBeTruthy();
    expect(within(section).getByText(/Replaces every rework limit in the workflow/)).toBeTruthy();
  });
});

describe('change cards: the review agent’s direct rework (route c)', () => {
  const round = (over: Partial<ChangeReviewRoundDto>): ChangeReviewRoundDto => ({
    id: 'r',
    round: 0,
    reviewer: 'agent',
    reviewerAgentRunId: 'ag-rev',
    verdict: 'rework',
    decision: 'rework',
    decidedBy: 'reviewer',
    commentId: null,
    createdAt: '2026-10-17T09:00:00.000Z',
    decidedAt: '2026-10-17T09:01:00.000Z',
    ...over,
  });

  it('names the review agent as the decider, in one sentence', () => {
    expect(roundSentence(round({}))).toBe('Review agent sent it back to the helper for rework');
    // The lead's decision after a review agent's verdict reads as before.
    expect(roundSentence(round({ decidedBy: 'lead' }))).toBe(
      'Review agent asked for rework · Lead sent it back for rework',
    );
    expect(
      reworkRoundsBy(
        {
          reviews: [
            round({}),
            round({ id: 'r2' }),
            round({ id: 'r3', round: 1, decidedBy: 'lead' }),
          ],
        },
        'reviewer',
      ),
    ).toBe(1);
  });

  it('shows the direct rounds on the change and its row', async () => {
    const sc = directLoopScenario();
    renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, fakeServer(sc.routes));
    const overview = await screen.findByTestId('changes-overview');
    const row = within(overview)
      .getAllByTestId('change-row')
      .find((r) => r.textContent?.includes('API helper'));
    if (row === undefined) throw new Error('no row');
    expect(within(row).getByTestId('change-direct-badge').textContent).toBe('Direct rework ×1');
    // The lead sent nothing back, so there is no lead rework badge.
    expect(within(row).queryByText(/^Rework ×/)).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
    const card = await within(screen.getByTestId('side-panel')).findByTestId('change-card');
    expect(within(card).getByTestId('change-direct-rounds').textContent).toContain(
      'Review agent: 1 direct rework round',
    );
    expect(within(card).getByTestId('change-history').textContent).toContain(
      'Review agent sent it back to the helper for rework',
    );
  });
});
