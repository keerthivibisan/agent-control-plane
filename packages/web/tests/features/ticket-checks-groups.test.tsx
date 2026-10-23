import { TicketDetailDtoSchema, type CheckRunDto, type SetupRunDto } from '@acp/core/api';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PROJECT_ID,
  RUN_ID,
  STORE,
  TICKET_ID,
  UI,
  inReviewScenario,
} from '../../e2e/ticket-fixtures';
import { groupSetupRuns } from '../../src/features/ticket/ChecksPanel';
import { checkPlace } from '../../src/features/ticket/ChecksTab';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { fakeServer, renderWithApi } from '../helpers';

/*
 * H-D (ADR-0027 §5): the ticket's Checks tab groups results by where they ran. Setup runs first
 * (per agent copy, then the checks' copies, each with status and its output in a disclosure),
 * then on each change (per helper), before the lead's merge (per helper; rows from before
 * ADR-0027 have no place and show here, as they always did), on the ticket branch, and run now
 * on main. The setup runs come from the ticket detail (`setupRuns`, the current run's).
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
  Object.assign(SVGElement.prototype, { getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }) });
});

const TICKET = `/api/tickets/${TICKET_ID}`;
const T = (min: number) => new Date(Date.UTC(2026, 9, 23, 9, min)).toISOString();

function setupRun(over: Partial<SetupRunDto> & { id: string; stepId: string }): SetupRunDto {
  return {
    projectId: PROJECT_ID,
    runId: RUN_ID,
    agentRunId: UI,
    name: 'Install dependencies',
    status: 'passed',
    exitCode: 0,
    durationMs: 3_000,
    outputTail: 'installed 312 packages',
    startedAt: T(1),
    commit: null,
    ...over,
  };
}

/** The in-review scenario with a change block's results, a branch run, setup runs. */
function scenario() {
  const sc = inReviewScenario();
  const detail = TicketDetailDtoSchema.parse(sc.routes[TICKET]);
  const ui = detail.checks.find((c) => c.agentRunId === UI && c.checkId === 'lint');
  if (ui === undefined) throw new Error('fixture changed');
  const changeRow: CheckRunDto = {
    ...ui,
    id: 'c-change-lint',
    place: 'change',
    blockNodeId: 'change-checks',
    status: 'failed',
    exitCode: 1,
    outputTail: 'lint: 2 problems',
  };
  const branchRow: CheckRunDto = {
    ...ui,
    id: 'c-branch-e2e',
    agentRunId: null,
    checkId: 'e2e',
    name: 'End-to-end',
    place: 'branch',
    blockNodeId: 'branch-checks',
  };
  const mainRow: CheckRunDto = { ...branchRow, id: 'c-main-e2e', place: 'main', blockNodeId: null };
  const setupRuns: SetupRunDto[] = [
    setupRun({ id: 's1', stepId: 'install' }),
    setupRun({ id: 's2', stepId: 'codegen', name: 'Generate code', startedAt: T(2) }),
    setupRun({
      id: 's3',
      stepId: 'install',
      agentRunId: null,
      status: 'refused',
      exitCode: null,
      outputTail: '',
      startedAt: T(5),
    }),
    // Another run's setup is not shown.
    setupRun({ id: 's4', stepId: 'install', runId: 'run-1', agentRunId: STORE }),
  ];
  return {
    ...sc.routes,
    [TICKET]: { ...detail, checks: [...detail.checks, changeRow, branchRow, mainRow], setupRuns },
  };
}

function renderChecks() {
  window.location.hash = `#/p/${PROJECT_ID}/tickets/${TICKET_ID}?tab=checks`;
  return renderWithApi(<TicketPage id={TICKET_ID} />, fakeServer(scenario()));
}

describe('ticket Checks tab: grouped by block', () => {
  it('rows without a place are the checks before the lead’s merge', () => {
    expect(checkPlace({})).toBe('merge');
    expect(checkPlace({ place: 'change' })).toBe('change');
  });

  it('groups setup runs by agent copy in the order they ran', () => {
    const groups = groupSetupRuns([
      setupRun({ id: 'b', stepId: 'codegen', startedAt: T(2) }),
      setupRun({ id: 'c', stepId: 'install', agentRunId: null, startedAt: T(3) }),
      setupRun({ id: 'a', stepId: 'install', startedAt: T(1) }),
    ]);
    expect(groups.map((g) => [g.agentRunId, g.runs.map((r) => r.id)])).toEqual([
      [UI, ['a', 'b']],
      [null, ['c']],
    ]);
  });

  it('shows setup first, then on each change, before the lead’s merge, the branch and main', async () => {
    renderChecks();
    const tab = await screen.findByTestId('checks-tab');
    const order = [...tab.children].map((e) => e.getAttribute('data-testid'));
    expect(order).toEqual([
      'setup-runs',
      'change-checks',
      'merge-checks',
      'tip-checks',
      'main-checks',
    ]);

    // Setup: per agent copy (the other run's is left out), the refused one with why.
    const setup = within(tab).getByTestId('setup-runs');
    const ui = within(setup).getByTestId(`setup-runs-${UI}`);
    expect(within(ui).getByRole('heading', { name: 'For Settings UI' })).toBeTruthy();
    expect(
      within(ui)
        .getAllByRole('listitem')
        .map((li) => li.dataset['testid']),
    ).toEqual(['setup-install', 'setup-codegen']);
    const checksCopy = within(setup).getByTestId('setup-runs-checks');
    const refused = within(checksCopy).getByTestId('setup-install');
    expect(refused.textContent).toContain('Not run: needs the network');
    // Output in a disclosure, open for a step that did not pass, closed for one that did.
    expect(refused.querySelector('details')?.open).toBe(true);
    const passed = within(ui).getByTestId('setup-install').querySelector('details');
    expect(passed?.open).toBe(false);
    fireEvent.click(passed?.querySelector('summary') as HTMLElement);
    expect(passed?.open).toBe(true);
    expect(passed?.querySelector('pre')?.textContent).toBe('installed 312 packages');
    expect(within(setup).queryByTestId(`setup-runs-${STORE}`)).toBeNull();

    // On each change: only the helper with a change block's results.
    const change = within(tab).getByTestId('change-checks');
    expect(within(change).getByTestId(`change-checks-${UI}`)).toBeTruthy();
    expect(within(change).queryByTestId(`change-checks-${STORE}`)).toBeNull();
    expect(within(change).getByTestId('check-lint').textContent).toContain('Failed');
    expect(within(change).queryByRole('button', { name: 'Run checks again' })).toBeNull();

    // Before the lead's merge: the rows with no place, as before (lint passed there).
    const merge = within(tab).getByTestId('merge-checks');
    const uiMerge = within(merge).getByTestId(`agent-checks-${UI}`);
    expect(within(uiMerge).getByTestId('check-lint').textContent).toContain('Passed');
    expect(within(uiMerge).queryByTestId('check-e2e')).toBeNull();

    // The branch and main.
    expect(within(within(tab).getByTestId('tip-checks')).getByTestId('check-e2e')).toBeTruthy();
    expect(within(within(tab).getByTestId('main-checks')).getByTestId('check-e2e')).toBeTruthy();
  });
});
