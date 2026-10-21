import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  migrateWorkflowV1,
  workflowTemplate,
  type LegacyWorkflowV1,
  type WorkflowGraph,
} from '@acp/core';
import { projectGraph, projectWorkflow } from '../../e2e/ticket-fixtures';
import { BoardPage } from '../../src/features/board/BoardPage';
import {
  optionsBadge,
  projectRunDefaults,
  runOptionsPatch,
} from '../../src/features/review-loop/logic';
import { StartDialog } from '../../src/features/review-loop/StartDialog';
import { TicketInfo } from '../../src/features/ticket/TicketInfo';
import { ProjectWorkflowDtoSchema, WorkflowGraphDtoSchema } from '@acp/core/api';
import {
  CSRF,
  PROJECT_ID,
  apiProject,
  board,
  card,
  ticketDetail,
  ticketDto,
  webProject,
} from '../fixtures/board';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/* RL-H: a ticket's own run options in the New ticket dialog, on the board, the ticket page and the
 * Start dialog. The project fixture's settings: Auto edits, a review agent, 2 rework rounds.
 * WG-F: they come from the project's graph (`GET /workflow-graph`), never from the version 1
 * `GET /workflow`, which answers 409 `workflow_is_graph` once the project stores a graph. */

const BOARD = `/api/board?projectId=${PROJECT_ID}`;
const WORKFLOW = `/api/projects/${PROJECT_ID}/workflow`;
const GRAPH = `/api/projects/${PROJECT_ID}/workflow-graph`;
const PROJECT = { approvalMode: 'auto-edits', reviewer: 'agent', maxReworkRounds: 2 } as const;

/** What the server answers for the version 1 route once the project stores a graph. */
const workflowIsGraph = () =>
  jsonResponse(409, {
    error: { code: 'workflow_is_graph', message: 'a graph now', requestId: 'req-t' },
  });

/**
 * A project saved in the editor (`stored: 'v2'`) as "Lead only" with 4 rework rounds, in a Manual
 * project: every value differs from the version 1 fixture, so a screen that showed the old
 * defaults (or none) fails.
 */
function savedGraphDto() {
  const graph: WorkflowGraph = workflowTemplate('lead-only');
  const dto = projectGraph({ stored: 'v2' });
  return {
    ...dto,
    graph: {
      ...graph,
      edges: graph.edges.map((e) => (e.type === 'rework' ? { ...e, maxRounds: 4 } : e)),
    },
    setup: {
      ...(dto['setup'] as Record<string, unknown>),
      approvals: { mode: 'manual', commands: [] },
    },
  };
}
const SAVED = { approvalMode: 'manual', reviewer: 'lead', maxReworkRounds: 4 } as const;

const manual = card({
  id: 't-21',
  key: 'WEB-21',
  stage: 'READY',
  runOptions: { approvalMode: 'manual' },
});
const sameAsProject = card({
  id: 't-22',
  key: 'WEB-22',
  stage: 'READY',
  runOptions: { approvalMode: 'auto-edits' },
});
const plain = card({ id: 't-23', key: 'WEB-23', stage: 'BACKLOG' });

function server(routes: RouteTable = {}) {
  return fakeServer({
    '/api/projects': [webProject, apiProject],
    '/api/control/token': { token: CSRF },
    [BOARD]: board({}, [manual, sameAsProject, plain]),
    [GRAPH]: projectGraph(),
    [WORKFLOW]: workflowIsGraph,
    ...routes,
  });
}

const posts = (s: ReturnType<typeof server>) => s.calls.filter((c) => c.method !== 'GET');
const askedV1 = (s: ReturnType<typeof server>) => s.calls.some((c) => c.path === WORKFLOW);

afterEach(() => window.localStorage.clear());

describe('ticket run options logic (RL-H)', () => {
  it('reads the project defaults from the graph DTO, for every way it is stored', () => {
    expect(projectRunDefaults(WorkflowGraphDtoSchema.parse(projectGraph()))).toEqual(PROJECT);
    expect(
      projectRunDefaults(WorkflowGraphDtoSchema.parse(projectGraph({ stored: 'v2' }))),
    ).toEqual(PROJECT);
    expect(projectRunDefaults(WorkflowGraphDtoSchema.parse(savedGraphDto()))).toEqual(SAVED);
  });

  it('the graph fixture is the version 1 fixture as the server migrates it', () => {
    for (const o of [{}, { separate: true }, { separate: true, postMerge: true }]) {
      const v1 = ProjectWorkflowDtoSchema.parse(projectWorkflow(o)).workflow;
      const legacy: LegacyWorkflowV1 = { plannerMode: v1.plannerMode, stages: v1.stages };
      const dto = WorkflowGraphDtoSchema.parse(projectGraph(o));
      expect(dto.graph).toEqual(migrateWorkflowV1(legacy, { projectMode: 'auto-edits' }));
    }
  });

  it('the badge names the options that differ from the project', () => {
    expect(optionsBadge(undefined, PROJECT)).toBeNull();
    expect(optionsBadge({ approvalMode: 'auto-edits' }, PROJECT)).toBeNull();
    expect(optionsBadge({ approvalMode: 'manual' }, PROJECT)).toBe('Manual');
    expect(
      optionsBadge({ approvalMode: 'full-auto', reviewer: 'lead', maxReworkRounds: 0 }, PROJECT),
    ).toBe('Full auto · Lead reviews · No rework');
    // Unknown project settings: every set option shows.
    expect(optionsBadge({ approvalMode: 'auto-edits' }, null)).toBe('Auto edits');
  });

  it('the ticket page sends every option, null for the project default', () => {
    expect(runOptionsPatch({})).toEqual({
      approvalMode: null,
      reviewer: null,
      maxReworkRounds: null,
    });
    expect(runOptionsPatch({ approvalMode: 'manual', maxReworkRounds: 0 })).toEqual({
      approvalMode: 'manual',
      reviewer: null,
      maxReworkRounds: 0,
    });
  });
});

describe('New ticket dialog: run options (RL-H)', () => {
  async function open(s: ReturnType<typeof server>) {
    renderWithApi(<BoardPage projectId={PROJECT_ID} />, s);
    await screen.findAllByTestId('ticket-card');
    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
    const dialog = screen.getByRole('dialog', { name: 'New ticket' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Careful' } });
    return dialog;
  }

  it('starts at "No limit" and sends no options when left there', async () => {
    const s = server({
      [`POST /api/projects/${PROJECT_ID}/tickets`]: ticketDto({ id: 't-30', key: 'WEB-30' }),
    });
    const dialog = await open(s);
    const mode = within(dialog).getByLabelText<HTMLSelectElement>('Approval mode: at most');
    await waitFor(() =>
      expect(mode.selectedOptions[0]?.textContent).toBe('No limit: each block’s own mode'),
    );
    // Reviewer and rounds wait under "More options".
    const more = within(dialog).getByTestId('run-options-more');
    expect(more.hasAttribute('open')).toBe(false);
    expect(
      within(more).getByLabelText<HTMLSelectElement>('Who reviews each change').selectedOptions[0]
        ?.textContent,
    ).toBe('Project default (Review agent)');
    expect(
      within(more).getByLabelText<HTMLSelectElement>('Rework rounds').selectedOptions[0]
        ?.textContent,
    ).toBe('Project default (2 rework rounds)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]?.body).not.toHaveProperty('runOptions');
  });

  it('sends the chosen options; Full auto, looser than every block, says it changes nothing', async () => {
    const s = server({
      [`POST /api/projects/${PROJECT_ID}/tickets`]: ticketDto({ id: 't-30', key: 'WEB-30' }),
    });
    const dialog = await open(s);
    const mode = within(dialog).getByLabelText('Approval mode: at most');
    fireEvent.change(mode, { target: { value: 'full-auto' } });
    // The blocks are known from the graph (Auto edits): a ticket limit only tightens them.
    expect(within(dialog).getByTestId('mode-no-effect')).toBeTruthy();
    expect(within(dialog).queryByTestId('full-auto-warning')).toBeNull();
    fireEvent.change(mode, { target: { value: 'manual' } });
    expect(within(dialog).queryByTestId('mode-no-effect')).toBeNull();
    expect(within(dialog).queryByTestId('approvals-warning')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Who reviews each change'), {
      target: { value: 'lead' },
    });
    fireEvent.change(within(dialog).getByLabelText('Rework rounds'), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]?.body).toMatchObject({
      title: 'Careful',
      runOptions: { approvalMode: 'manual', reviewer: 'lead', maxReworkRounds: 0 },
    });
  });

  it('a choice back on the project default is not sent', async () => {
    const s = server({
      [`POST /api/projects/${PROJECT_ID}/tickets`]: ticketDto({ id: 't-30', key: 'WEB-30' }),
    });
    const dialog = await open(s);
    const mode = within(dialog).getByLabelText('Approval mode: at most');
    fireEvent.change(mode, { target: { value: 'auto' } });
    // Looser than every block (they run at the project's Auto edits): it changes nothing.
    expect(within(dialog).getByTestId('mode-no-effect')).toBeTruthy();
    fireEvent.change(mode, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]?.body).not.toHaveProperty('runOptions');
  });
});

describe('board card badge (RL-H)', () => {
  it('shows only for options that differ from the project', async () => {
    renderWithApi(<BoardPage projectId={PROJECT_ID} />, server());
    const cards = await screen.findAllByTestId('ticket-card');
    const byKey = (key: string) => {
      const c = cards.find((x) => x.textContent?.includes(key));
      if (!c) throw new Error(`no card ${key}`);
      return c;
    };
    const badge = await within(byKey('WEB-21')).findByTestId('card-run-options');
    expect(badge.textContent).toContain('Manual');
    expect(badge.getAttribute('title')).toBe('This ticket’s own run options: Manual');
    expect(within(byKey('WEB-22')).queryByTestId('card-run-options')).toBeNull();
    expect(within(byKey('WEB-23')).queryByTestId('card-run-options')).toBeNull();
  });

  it('a board whose tickets follow the project asks nothing more', async () => {
    const s = server({ [BOARD]: board({}, [plain]) });
    renderWithApi(<BoardPage projectId={PROJECT_ID} />, s);
    await screen.findAllByTestId('ticket-card');
    expect(s.calls.some((c) => c.path === GRAPH)).toBe(false);
    expect(askedV1(s)).toBe(false);
  });
});

describe('ticket page: Run options (RL-H)', () => {
  const ticket = ticketDto({
    id: 't-21',
    key: 'WEB-21',
    runOptions: { approvalMode: 'manual' },
  });

  it('shows each option, the ticket’s own or the project default', async () => {
    renderWithApi(
      <TicketInfo detail={ticketDetail(ticket)} shownRunId={null} onShowRun={() => {}} />,
      server(),
    );
    const section = screen.getByTestId('ticket-run-options');
    expect(within(section).getByTestId('run-option-mode').textContent).toBe('Manual · This ticket');
    await waitFor(() =>
      expect(within(section).getByTestId('run-option-reviewer').textContent).toBe(
        'Project default (Review agent)',
      ),
    );
    expect(within(section).getByTestId('run-option-rounds').textContent).toBe(
      'Project default (2 rework rounds)',
    );
  });

  it('changes them with PATCH: back to the project default is null', async () => {
    const s = server({
      [`PATCH /api/tickets/${ticket.id}`]: ticketDetail({ ...ticket, runOptions: undefined }),
    });
    renderWithApi(
      <TicketInfo detail={ticketDetail(ticket)} shownRunId={null} onShowRun={() => {}} />,
      s,
    );
    const section = screen.getByTestId('ticket-run-options');
    fireEvent.click(within(section).getByRole('button', { name: 'Change run options' }));
    const mode = within(section).getByLabelText<HTMLSelectElement>('Approval mode: at most');
    expect(mode.value).toBe('manual');
    fireEvent.change(mode, { target: { value: '' } });
    fireEvent.change(within(section).getByLabelText('Rework rounds'), { target: { value: '3' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(posts(s)).toHaveLength(1));
    expect(posts(s)[0]).toMatchObject({
      method: 'PATCH',
      path: `/api/tickets/${ticket.id}`,
      body: { runOptions: { approvalMode: null, reviewer: null, maxReworkRounds: 3 } },
    });
    await waitFor(() => expect(within(section).queryByRole('button', { name: 'Save' })).toBeNull());
  });

  it('Cancel sends nothing', () => {
    const s = server();
    renderWithApi(
      <TicketInfo detail={ticketDetail(ticket)} shownRunId={null} onShowRun={() => {}} />,
      s,
    );
    const section = screen.getByTestId('ticket-run-options');
    fireEvent.click(within(section).getByRole('button', { name: 'Change run options' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Cancel' }));
    expect(within(section).getByTestId('run-option-mode').textContent).toBe('Manual · This ticket');
    expect(posts(s)).toHaveLength(0);
  });
});

describe('Start dialog: pre-filled from the ticket (RL-H)', () => {
  it('starts at the ticket’s own option and sends nothing when unchanged', async () => {
    const started: unknown[] = [];
    renderWithApi(
      <StartDialog
        projectId={PROJECT_ID}
        ticketKey="WEB-21"
        kind="start"
        pending={false}
        error={null}
        ticketOptions={{ approvalMode: 'manual' }}
        onStart={(r) => started.push(r)}
        onClose={() => {}}
      />,
      server(),
    );
    const dialog = await screen.findByTestId('start-dialog');
    const manualRadio =
      await within(dialog).findByLabelText<HTMLInputElement>(/^Manual · This ticket/);
    expect(manualRadio.checked).toBe(true);
    expect(
      within(dialog).getByLabelText<HTMLInputElement>(/^Auto edits \(recommended\)/).checked,
    ).toBe(false);
    // The ticket has its own limit, so this run can't go without one.
    expect(within(dialog).queryByLabelText(/^No limit/)).toBeNull();
    expect(within(dialog).getByTestId('mode-limit-summary').textContent).toBe(
      'Approval mode: at most Manual — blocks set to a stricter mode keep it; this can’t loosen any block.',
    );
    expect(within(dialog).getByTestId('start-dialog-summary').textContent).toBe(
      'Same as this ticket’s settings.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    expect(started).toEqual([{}]);
  });

  it('sends what differs from the ticket’s settings', async () => {
    const started: unknown[] = [];
    renderWithApi(
      <StartDialog
        projectId={PROJECT_ID}
        ticketKey="WEB-21"
        kind="start"
        pending={false}
        error={null}
        ticketOptions={{ approvalMode: 'manual' }}
        onStart={(r) => started.push(r)}
        onClose={() => {}}
      />,
      server(),
    );
    const dialog = await screen.findByTestId('start-dialog');
    fireEvent.click(await within(dialog).findByLabelText(/^Auto edits/));
    expect(within(dialog).getByTestId('start-dialog-summary').textContent).toBe(
      '1 choice differs from this ticket’s settings, for this run only.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    expect(started).toEqual([{ approvalMode: 'auto-edits' }]);
  });
});

describe('a project saved as a graph (stored v2, WG-F)', () => {
  // The version 1 route answers 409 for this project: every screen reads the graph instead.
  const saved = () => server({ [GRAPH]: savedGraphDto() });

  it('the Start dialog starts at the project’s values', async () => {
    const s = saved();
    renderWithApi(
      <StartDialog
        projectId={PROJECT_ID}
        ticketKey="WEB-23"
        kind="start"
        pending={false}
        error={null}
        onStart={() => {}}
        onClose={() => {}}
      />,
      s,
    );
    const dialog = await screen.findByTestId('start-dialog');
    const lead = await within(dialog).findByLabelText<HTMLInputElement>(
      /^The lead · Project setting/,
    );
    expect(lead.checked).toBe(true);
    expect(within(dialog).getByLabelText<HTMLInputElement>(/^Review agent/).checked).toBe(false);
    expect(dialog.textContent).toContain('Project setting: 4.');
    expect(within(dialog).getByText(/^No limit/)).toBeTruthy();
    expect(within(dialog).getByTestId('start-dialog-summary').textContent).toBe(
      'Same as the project’s settings.',
    );
    expect(askedV1(s)).toBe(false);
  });

  it('the ticket page’s run options show the project’s values', async () => {
    const s = saved();
    const ticket = ticketDto({ id: 't-23', key: 'WEB-23' });
    renderWithApi(
      <TicketInfo detail={ticketDetail(ticket)} shownRunId={null} onShowRun={() => {}} />,
      s,
    );
    const section = screen.getByTestId('ticket-run-options');
    await waitFor(() =>
      expect(within(section).getByTestId('run-option-reviewer').textContent).toBe(
        'Project default (Lead)',
      ),
    );
    expect(within(section).getByTestId('run-option-rounds').textContent).toBe(
      'Project default (4 rework rounds)',
    );
    expect(askedV1(s)).toBe(false);
  });

  it('the New ticket dialog shows the project’s values', async () => {
    const s = saved();
    renderWithApi(<BoardPage projectId={PROJECT_ID} />, s);
    await screen.findAllByTestId('ticket-card');
    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
    const dialog = screen.getByRole('dialog', { name: 'New ticket' });
    const reviewer = within(dialog).getByLabelText<HTMLSelectElement>('Who reviews each change');
    await waitFor(() =>
      expect(reviewer.selectedOptions[0]?.textContent).toBe('Project default (Lead)'),
    );
    expect(
      within(dialog).getByLabelText<HTMLSelectElement>('Rework rounds').selectedOptions[0]
        ?.textContent,
    ).toBe('Project default (4 rework rounds)');
    expect(askedV1(s)).toBe(false);
  });

  it('the board badge compares with the project’s values', async () => {
    const s = saved();
    renderWithApi(<BoardPage projectId={PROJECT_ID} />, s);
    const cards = await screen.findAllByTestId('ticket-card');
    const byKey = (key: string) => {
      const c = cards.find((x) => x.textContent?.includes(key));
      if (!c) throw new Error(`no card ${key}`);
      return c;
    };
    // The project is Manual now: WEB-21 (Manual) follows it, WEB-22 (Auto edits) differs.
    const badge = await within(byKey('WEB-22')).findByTestId('card-run-options');
    expect(badge.textContent).toContain('Auto edits');
    await waitFor(() =>
      expect(within(byKey('WEB-21')).queryByTestId('card-run-options')).toBeNull(),
    );
    expect(askedV1(s)).toBe(false);
  });
});
