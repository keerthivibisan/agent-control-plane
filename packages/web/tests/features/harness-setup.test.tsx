import type { CheckRunDto, SetupRunDto } from '@acp/core/api';
import { SetupRunDtoSchema, UpdateProjectSetupRequestSchema } from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { customGraph, graphDto } from '../../e2e/workflow-fixtures';
import { HarnessPage } from '../../src/features/harness/HarnessPage';
import { networkRequest } from '../../src/features/harness/logic';
import { CSRF } from '../fixtures/board';
import { checkRun, harness, PROJECT_ID, setup } from '../fixtures/project-setup';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * H-D (ADR-0027): the Harness page's setup steps, the switch "Setup may use the network" (the
 * setup PUT's `setupNetwork`), "Run setup and checks now", the latest setup runs on main
 * (GET …/harness/setup-runs; 404 from an older server reads as none) and where each check runs
 * in the workflow (the graph's Checks blocks that pick it).
 */

const BASE = `/api/projects/${PROJECT_ID}`;
const now = () => new Date('2026-10-23T09:05:00.000Z');

const READY = harness('ready', {
  checks: [
    {
      id: 'test',
      name: 'Unit tests',
      argv: ['pnpm', 'test'],
      timeoutSec: 600,
      required: true,
      labels: ['fast'],
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
  setup: [
    {
      id: 'install',
      name: 'Install dependencies',
      argv: ['pnpm', 'install', '--frozen-lockfile'],
      timeoutSec: 600,
      network: true,
      outputs: ['node_modules'],
    },
    { id: 'codegen', name: 'Generate code', argv: ['pnpm', 'codegen'], timeoutSec: 120 },
  ],
});

function setupRun(over: Partial<SetupRunDto> & { stepId: string; name: string }): SetupRunDto {
  return SetupRunDtoSchema.parse({
    id: `s-${over.stepId}`,
    projectId: PROJECT_ID,
    runId: null,
    agentRunId: null,
    status: 'passed',
    exitCode: 0,
    durationMs: 4_200,
    outputTail: 'done',
    startedAt: '2026-10-23T09:00:00.000Z',
    commit: null,
    ...over,
  });
}

/** A graph whose merge block runs the required checks and a branch block the `full` label. */
function graph() {
  const g = customGraph();
  const nodes = g['nodes'] as Record<string, unknown>[];
  return graphDto({
    graph: {
      ...g,
      nodes: [
        ...nodes,
        {
          type: 'checks',
          id: 'branch-checks',
          label: 'Full checks',
          place: 'branch',
          select: { kind: 'labels', labels: ['full'] },
          onFailure: 'owner',
        },
      ],
    },
    stored: 'v2',
  });
}

function renderPage(routes: RouteTable = {}) {
  let saved = setup();
  const s = fakeServer({
    '/api/control/token': { token: CSRF },
    [`${BASE}/tickets`]: [],
    [`${BASE}/harness`]: READY,
    [`${BASE}/harness/checks`]: [],
    [`${BASE}/setup`]: () => jsonResponse(200, saved),
    [`PUT ${BASE}/setup`]: (body: unknown) => {
      const b = UpdateProjectSetupRequestSchema.parse(body);
      saved = { ...saved, setupNetwork: b.setupNetwork ?? false };
      return jsonResponse(200, saved);
    },
    [`${BASE}/workflow-graph`]: graph(),
    [`${BASE}/harness/setup-runs`]: [
      setupRun({
        stepId: 'install',
        name: 'Install dependencies',
        status: 'refused',
        exitCode: null,
        outputTail: '',
      }),
    ],
    ...routes,
  });
  return { s, ...renderWithApi(<HarnessPage projectId={PROJECT_ID} now={now} />, s) };
}

afterEach(() => window.localStorage.clear());

describe('Harness page: setup and the workflow (ADR-0027)', () => {
  it('lists the setup steps with command, time limit, “Uses the network” and what they create', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Setup steps' });
    const install = table.querySelector<HTMLElement>('[data-step="install"]');
    const codegen = table.querySelector<HTMLElement>('[data-step="codegen"]');
    if (install === null || codegen === null) throw new Error('setup rows missing');
    expect(within(install).getByText('pnpm install --frozen-lockfile').tagName).toBe('CODE');
    expect(within(install).getByTestId('uses-network').textContent).toBe('Uses the network');
    expect(within(install).getByText('node_modules').tagName).toBe('CODE');
    expect(within(install).getByText('10 min')).toBeTruthy();
    expect(within(codegen).queryByTestId('uses-network')).toBeNull();
    // The latest setup on main: the refused network step, with why in words.
    const latest = await screen.findByTestId('latest-setup');
    const row = within(latest).getByTestId('setup-install');
    expect(row.dataset['status']).toBe('refused');
    expect(row.textContent).toContain('Not run: needs the network');
  });

  it('the network switch is off by default; turning it on PUTs setupNetwork and keeps the rest', async () => {
    const { s } = renderPage();
    const sw = await screen.findByRole('switch', { name: 'Setup may use the network' });
    await waitFor(() => expect(sw.hasAttribute('disabled')).toBe(false));
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('setup-network-effect').textContent).toBe(
      '1 setup step uses the network and won’t run while this is off.',
    );
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    const put = s.calls.find((c) => c.method === 'PUT' && c.path === `${BASE}/setup`);
    expect(put?.body).toEqual({
      projectKey: 'WEB',
      maxConcurrentHelpers: 3,
      maxDepth: 1,
      defaultBudgetTokensPerAgent: 500_000,
      model: null,
      contextFiles: [],
      setupNetwork: true,
    });
    expect(screen.getByTestId('setup-network-effect').textContent).toBe('');
  });

  it('networkRequest leaves out approvals, the allowlist and branching (kept by the server)', () => {
    const body = networkRequest(setup({ setupNetwork: true }), false);
    expect(body).not.toBeNull();
    expect(body).not.toHaveProperty('approvals');
    expect(body).not.toHaveProperty('allowlist');
    expect(body).not.toHaveProperty('branching');
    expect(body?.setupNetwork).toBe(false);
  });

  it('“Run setup and checks now” runs the same POST as before', async () => {
    const ran: CheckRunDto[] = [checkRun({ checkId: 'test', place: 'main' })];
    const { s } = renderPage({ [`POST ${BASE}/harness/checks`]: ran });
    const run = await screen.findByRole('button', { name: 'Run setup and checks now' });
    fireEvent.click(run);
    await waitFor(() =>
      expect(s.calls.some((c) => c.method === 'POST' && c.path === `${BASE}/harness/checks`)).toBe(
        true,
      ),
    );
  });

  it('each check shows its labels and the Checks blocks that run it', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Harness checks' });
    const test = table.querySelector<HTMLElement>('[data-check="test"]');
    const e2e = table.querySelector<HTMLElement>('[data-check="e2e"]');
    if (test === null || e2e === null) throw new Error('check rows missing');
    expect(within(test).getByText('fast')).toBeTruthy();
    await waitFor(() => expect(within(test).getByTestId('check-where')).toBeTruthy());
    expect(within(test).getByTestId('check-where').textContent).toBe(
      'Before the lead’s merge: Checks',
    );
    expect(within(e2e).getByTestId('check-where').textContent).toBe(
      'On the ticket branch: Full checks',
    );
  });

  it('an older server: no setup runs route, no graph, no setup list; still “Run checks now”', async () => {
    renderPage({
      [`${BASE}/harness`]: harness('ready'),
      [`${BASE}/harness/setup-runs`]: jsonResponse(404, {
        error: { code: 'not_found', message: 'no route', requestId: 'r' },
      }),
      [`${BASE}/workflow-graph`]: jsonResponse(404, {
        error: { code: 'not_found', message: 'no route', requestId: 'r' },
      }),
    });
    expect(await screen.findByRole('button', { name: 'Run checks now' })).toBeTruthy();
    expect(screen.queryByTestId('harness-setup')).toBeNull();
    expect(screen.getByRole('table', { name: 'Harness checks' }).textContent).not.toContain(
      'Where it runs',
    );
  });
});
