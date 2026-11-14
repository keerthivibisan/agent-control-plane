import {
  WorkflowGraphSchema,
  migrateWorkflowV2,
  type WorkflowGraph,
  WorkflowGraphV3Schema,
  validateWorkflowGraphV3,
} from '@acp/core';
import { sentAsV2 } from './sent-graph';
import {
  AgentRunDtoSchema,
  WorkflowGraphDtoSchema,
  type AgentMessageMetaDto,
  type WorkflowGraphDto,
} from '@acp/core/api';
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { directLoopScenario } from '../../e2e/live-graph-fixtures';
import {
  CSRF as LOOP_CSRF,
  L_API,
  L_LEAD,
  L_UI,
  LOOP_RUN_PATH,
  LOOP_TICKET_ID,
  type LoopScenario,
} from '../../e2e/review-loop-fixtures';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  agentFilesFixture,
  customGraph,
  graphDto,
  setupFixture,
} from '../../e2e/workflow-fixtures';
import { DataHealthPage } from '../../src/features/health/DataHealthPage';
import { ProjectSettings } from '../../src/features/project-setup/ProjectSettings';
import { OutboxList } from '../../src/features/ticket/OutboxList';
import { liveProvider } from '../../src/features/ticket/LiveGraphNodes';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { patchNode } from '../../src/features/workflow/editor/state';
import { WorkflowPage } from '../../src/features/workflow/WorkflowPage';
import { HEALTH_COPY } from '../../src/lib/copy';
import { CSRF } from '../fixtures/control';
import { diagnostics, project, T1 } from '../fixtures/dto';
import { PROJECT_ID, candidates, harness, setup } from '../fixtures/project-setup';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/*
 * CX-6 (ADR-0031, ADR-0033): Codex as a second managed provider in the web. The provider picker
 * on agent blocks, the project's default provider, provider chips, the Codex graph issues, the
 * providers on Data health and the run's message list. Synthetic fixtures only; core is not
 * mocked, so the issues are core's own.
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

type Json = Record<string, unknown>;

// ---------------------------------------------------------------- the workflow editor

const BASE = `/api/projects/${WF_PROJECT_ID}`;
const GRAPH = `${BASE}/workflow-graph`;
const parse = (dto: unknown): WorkflowGraphDto => WorkflowGraphDtoSchema.parse(dto);
/** A fixture graph (version 2), or a graph the page sent (version 3) in its version 2 form. */
const graphOf = (g: unknown): WorkflowGraph =>
  (g as { version?: unknown }).version === 3 ? sentAsV2(g) : WorkflowGraphSchema.parse(g);

function renderEditor(initial: unknown) {
  let current = parse(initial);
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
  renderWithApi(<WorkflowPage projectId={WF_PROJECT_ID} />, s);
  return s;
}

const panel = () => screen.getByRole('complementary', { name: 'Block settings' });

async function selectBlock(id: string) {
  fireEvent.click(await screen.findByTestId(`block-${id}`));
  await waitFor(() => expect(panel().querySelector(`[data-node="${id}"]`)).not.toBeNull());
}

const suggestions = () =>
  Array.from(panel().querySelectorAll('datalist option')).map((o) => o.getAttribute('value'));

describe('provider per agent block', () => {
  it('the Provider select saves `provider`, switches the suggestions and the chip', async () => {
    const s = renderEditor(graphDto());
    await selectBlock('orchestrate');
    const select = within(panel()).getByRole('combobox', { name: 'Provider' });
    expect((select as HTMLSelectElement).value).toBe('project-default');
    expect(
      within(within(panel()).getByTestId('provider-field'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Project default (Claude Code)', 'Claude Code', 'Codex']);
    expect(suggestions()).toEqual(['sonnet', 'opus', 'haiku', 'inherit']);
    const chip = () =>
      within(screen.getByTestId('block-orchestrate')).getByTestId('block-provider');
    expect(chip().textContent).toBe('Claude');

    fireEvent.change(select, { target: { value: 'codex' } });
    expect(suggestions()).toEqual(['gpt-6.1-sol', 'gpt-6-astra']);
    expect(chip().textContent).toBe('Codex');
    expect(chip().dataset['provider']).toBe('codex');
    // The model stays free text.
    fireEvent.change(within(panel()).getByLabelText('Model'), {
      target: { value: 'my-own-model' },
    });
    fireEvent.click(screen.getByTestId('save-workflow'));
    await screen.findByTestId('saved');
    const puts = () => s.calls.filter((c) => c.method === 'PUT' && c.path === GRAPH);
    const saved = graphOf((puts()[0]?.body as { graph: unknown }).graph);
    expect(saved.nodes.find((n) => n.id === 'orchestrate')).toMatchObject({
      provider: 'codex',
      model: 'my-own-model',
    });

    // Back to the project default: the field is dropped, not stored as null.
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Provider' }), {
      target: { value: 'project-default' },
    });
    fireEvent.click(screen.getByTestId('save-workflow'));
    await waitFor(() => expect(puts()).toHaveLength(2));
    const node = (puts()[1]?.body as { graph: { nodes: Json[] } }).graph.nodes.find(
      (n) => n['id'] === 'orchestrate',
    );
    expect(node !== undefined && 'provider' in node).toBe(false);
  });

  it('warns on the block when its model looks like the other provider’s', async () => {
    renderEditor(graphDto());
    await selectBlock('orchestrate');
    fireEvent.change(within(panel()).getByLabelText('Model'), { target: { value: 'opus' } });
    expect(within(panel()).queryByTestId('panel-issues')).toBeNull();
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Provider' }), {
      target: { value: 'codex' },
    });
    const issue = within(within(panel()).getByTestId('panel-issues'))
      .getAllByTestId('issue')
      .find((i) => i.dataset['code'] === 'model-provider-mismatch');
    expect(issue?.dataset['severity']).toBe('warning');
    expect(issue?.textContent).toContain('runs on Codex');
  });

  it('follows the project’s default provider: chips, the picker’s default and the Codex issues', async () => {
    renderEditor(
      graphDto({
        graph: customGraph(),
        stored: 'v3',
        setup: setupFixture({
          approvals: { mode: 'auto-edits', commands: [] },
          provider: 'codex',
        }),
      }),
    );
    const chip = async (id: string) =>
      within(await screen.findByTestId(`block-${id}`)).getByTestId('block-provider');
    expect((await chip('plan')).textContent).toBe('Codex');
    await selectBlock('helpers');
    expect(
      within(within(panel()).getByTestId('provider-field')).getAllByRole('option')[0]?.textContent,
    ).toBe('Project default (Codex)');
    // The pool's agent file narrows its tools (db-migrator): Codex can't apply that, an error.
    const tools = within(within(panel()).getByTestId('panel-issues'))
      .getAllByTestId('issue')
      .find((i) => i.dataset['code'] === 'codex-agent-tools');
    expect(tools?.dataset['severity']).toBe('error');
    expect(tools?.textContent).toContain('Codex cannot apply that limit yet');
    // The planner's skills are left out on Codex: a warning.
    await selectBlock('plan');
    const skills = within(within(panel()).getByTestId('panel-issues'))
      .getAllByTestId('issue')
      .find((i) => i.dataset['code'] === 'codex-skills-ignored');
    expect(skills?.dataset['severity']).toBe('warning');
    // On Claude, neither issue.
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Provider' }), {
      target: { value: 'claude-code' },
    });
    expect(
      within(panel())
        .queryAllByTestId('issue')
        .some((i) => i.dataset['code'] === 'codex-skills-ignored'),
    ).toBe(false);
  });

  it('patchNode sets and clears provider on agent blocks only', () => {
    const g = migrateWorkflowV2(graphOf(customGraph()));
    const lead = g.nodes.find((n) => n.id === 'orchestrate');
    const ticket = g.nodes.find((n) => n.id === 'ticket');
    if (lead === undefined || ticket === undefined) throw new Error('fixture');
    const codex = patchNode(lead, { provider: 'codex' });
    expect(codex).toMatchObject({ provider: 'codex' });
    expect('provider' in patchNode(codex, { provider: null })).toBe(false);
    expect(patchNode(codex, { label: 'Lead 2' })).toMatchObject({ provider: 'codex' });
    expect(patchNode(ticket, { provider: 'codex' })).toBe(ticket);
  });
});

// ---------------------------------------------------------------- project settings

const P = `/api/projects/${PROJECT_ID}`;

function settingsServer(initial = setup()) {
  let current = initial;
  return fakeServer({
    '/api/control/token': { token: CSRF },
    [P]: project({ id: PROJECT_ID, name: 'web-app', rootPath: '/work/web-app' }),
    [`${P}/setup`]: () => jsonResponse(200, current),
    [`${P}/harness`]: harness('none'),
    [`${P}/context-candidates`]: candidates(),
    [`PUT ${P}/setup`]: (body: unknown) => {
      // Like the server: absent keeps the stored provider, null removes it.
      const { provider, ...rest } = body as Json;
      const kept = provider === undefined ? current.provider : provider;
      current = setup({
        ...(rest as object),
        ...(kept === null || kept === undefined ? {} : { provider: kept as 'codex' }),
        updatedAt: '2026-10-13T10:00:00.000Z',
      });
      return jsonResponse(200, current);
    },
  });
}

describe('the project’s default provider (Settings)', () => {
  it('saves Codex, then Claude Code as null (cleared)', async () => {
    const s = settingsServer();
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    const card = await screen.findByTestId('settings-project');
    const select = await within(card).findByRole('combobox', { name: 'Default provider' });
    expect((select as HTMLSelectElement).value).toBe('claude-code');
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true);

    fireEvent.change(select, { target: { value: 'codex' } });
    expect(within(card).getByLabelText<HTMLInputElement>('Default model').placeholder).toBe(
      'Codex’s default',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    const puts = () => s.calls.filter((c) => c.method === 'PUT');
    expect(puts()[0]?.body).toMatchObject({ provider: 'codex' });

    await waitFor(() =>
      expect(
        within(card).getByRole<HTMLSelectElement>('combobox', { name: 'Default provider' }).value,
      ).toBe('codex'),
    );
    fireEvent.change(within(card).getByRole('combobox', { name: 'Default provider' }), {
      target: { value: 'claude-code' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1]?.body).toMatchObject({ provider: null });
  });

  it('leaves the provider out of a save that does not change it', async () => {
    const s = settingsServer(setup({ provider: 'codex' }));
    renderWithApi(<ProjectSettings id={PROJECT_ID} />, s);
    fireEvent.change(await screen.findByLabelText('Board key'), { target: { value: 'app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(s.calls.find((c) => c.method === 'PUT')?.body).not.toHaveProperty('provider');
  });
});

// ---------------------------------------------------------------- the ticket page

function loopScenario(o: { leadProvider?: string; outbox?: AgentMessageMetaDto[] } = {}) {
  const sc = directLoopScenario();
  const run = sc.routes[LOOP_RUN_PATH] as Json;
  const agents = (run['agents'] as Json[]).map((a) =>
    a['id'] === L_LEAD && o.leadProvider !== undefined ? { ...a, provider: o.leadProvider } : a,
  );
  const routes = {
    ...sc.routes,
    [LOOP_RUN_PATH]: { ...run, agents, ...(o.outbox !== undefined ? { outbox: o.outbox } : {}) },
  };
  return { routes } satisfies LoopScenario;
}

function renderTicket(sc: LoopScenario) {
  const s = fakeServer({ ...sc.routes, '/api/control/token': { token: LOOP_CSRF } });
  window.location.hash = '#?tab=agents';
  renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
  return s;
}

const SHA = 'a'.repeat(64);
const msg = (over: Partial<AgentMessageMetaDto> & { id: string }): AgentMessageMetaDto => ({
  from: L_LEAD,
  to: L_API,
  kind: 'message',
  state: 'delivered',
  createdAt: T1,
  deliveredAt: T1,
  length: 42,
  sha256: SHA,
  ...over,
});

describe('provider chips on the live graph and in the agent’s Details', () => {
  it('shows the provider the server reports, and nothing it doesn’t know', async () => {
    renderTicket(loopScenario({ leadProvider: 'codex' }));
    await screen.findByTestId('live-run-graph');
    const lead = within(screen.getByTestId('live-block-orchestrate'));
    expect(lead.getByTestId('live-provider').textContent).toBe('Codex');
    // No agent and no choice in the run's graph: the default isn't known here, so no chip.
    expect(
      within(screen.getByTestId('live-block-code-review')).queryByTestId('live-provider'),
    ).toBeNull();

    fireEvent.click(screen.getByTestId('live-node-orchestrate'));
    const side = () => screen.getByTestId('side-panel');
    await waitFor(() => expect(within(side()).getByRole('heading', { name: 'Lead' })).toBeTruthy());
    fireEvent.click(within(side()).getByRole('tab', { name: 'Details' }));
    const row = await within(side()).findByTestId('details-provider');
    expect(row.textContent).toContain('Codex');
  });

  it('liveProvider: the agents’ provider first, then the block’s own, else null', () => {
    const node = migrateWorkflowV2(graphOf(customGraph())).nodes.find(
      (n) => n.id === 'orchestrate',
    );
    if (node === undefined) throw new Error('fixture');
    const agent = AgentRunDtoSchema.parse({
      id: 'a1',
      runId: 'r1',
      parentAgentRunId: null,
      kind: 'lead',
      role: 'Lead',
      task: null,
      status: 'RUNNING',
      sessionId: null,
      budget: { used: 0, limit: 1 },
      latestActivity: null,
      review: null,
      branch: null,
      createdAt: T1,
      endedAt: null,
    });
    // The live graph reads the run's version 3 graph: the block with a provider of its own.
    const codexNode = { ...node, provider: 'codex' as const };
    expect(liveProvider(node, [])).toBeNull();
    expect(liveProvider(codexNode, [])).toBe('codex');
    expect(liveProvider(codexNode, [{ ...agent, provider: 'claude-code' }])).toBe('claude-code');
    // A server before ADR-0031 sends no provider: the block's own choice still shows.
    expect(liveProvider(codexNode, [agent])).toBe('codex');
  });
});

describe('the run’s messages (outbox)', () => {
  it('lists when, who to whom, kind, state and length, and never any text', async () => {
    renderTicket(
      loopScenario({
        outbox: [
          msg({ id: 'm1' }),
          msg({ id: 'm2', from: L_UI, to: L_LEAD, kind: 'question', state: 'held', length: 7 }),
          msg({ id: 'm3', from: 'engine', to: L_LEAD, kind: 'notice', state: 'dropped' }),
        ],
      }),
    );
    await screen.findByTestId('live-run-graph');
    fireEvent.click(screen.getByTestId('live-node-orchestrate'));
    const side = () => screen.getByTestId('side-panel');
    await waitFor(() => expect(within(side()).getByRole('heading', { name: 'Lead' })).toBeTruthy());
    fireEvent.click(within(side()).getByRole('tab', { name: 'Details' }));
    const outbox = await within(side()).findByTestId('outbox');
    expect(outbox.tagName).toBe('DETAILS');
    expect(outbox.hasAttribute('open')).toBe(false);
    expect(within(outbox).getByText('Messages (3)')).toBeTruthy();
    const rows = within(outbox).getAllByTestId('outbox-row');
    // Newest last in the run's order, so the list reads newest first.
    expect(rows.map((r) => r.dataset['state'])).toEqual(['dropped', 'held', 'delivered']);
    expect(rows[0]?.textContent).toContain('The app');
    expect(rows[0]?.textContent).toContain('Notice');
    expect(rows[1]?.textContent).toContain('Search UI');
    expect(rows[1]?.textContent).toContain('Question');
    expect(rows[1]?.textContent).toContain('Held');
    expect(rows[1]?.textContent).toContain('7 characters');
    expect(rows[2]?.textContent).toContain('API helper');
    expect(outbox.textContent).not.toContain(SHA);
  });

  it('is hidden when the server sends no outbox, or an empty one', () => {
    const { container, rerender } = rtlRender(<OutboxList outbox={undefined} agents={[]} />);
    expect(container.innerHTML).toBe('');
    rerender(<OutboxList outbox={[]} agents={[]} />);
    expect(container.innerHTML).toBe('');
    rerender(<OutboxList outbox={[msg({ id: 'm1', from: 'gone', to: 'gone' })]} agents={[]} />);
    expect(screen.getByTestId('outbox-row').textContent).toContain('An earlier agent');
  });
});

// ---------------------------------------------------------------- Data health

describe('agent providers on Data health', () => {
  it('shows each provider: available, not available with its reason, not checked yet', async () => {
    renderWithApi(
      <DataHealthPage />,
      fakeServer({
        '/api/diagnostics/ingestion': diagnostics({
          managedProviders: [
            { provider: 'claude-code', available: true, reason: null, checkedAt: T1 },
            {
              provider: 'codex',
              available: false,
              reason: 'Codex is not signed in; run codex login.',
              checkedAt: T1,
            },
          ],
        }),
      }),
    );
    const card = await screen.findByTestId('health-providers');
    const claude = within(card).getByTestId('provider-claude-code');
    expect(claude.dataset['state']).toBe('available');
    expect(claude.textContent).toContain('Claude Code');
    expect(claude.textContent).toContain('Available');
    expect(within(claude).getByTestId('provider-checked').textContent).toContain('Checked');
    const codex = within(card).getByTestId('provider-codex');
    expect(codex.dataset['state']).toBe('unavailable');
    expect(codex.textContent).toContain('Not available');
    expect(within(codex).getByTestId('provider-reason').textContent).toBe(
      'Codex is not signed in; run codex login.',
    );
  });

  it('reads "Not checked yet" before the first check, and hides the card without the field', async () => {
    renderWithApi(
      <DataHealthPage />,
      fakeServer({
        '/api/diagnostics/ingestion': diagnostics({
          managedProviders: [{ provider: 'codex', available: null, reason: null, checkedAt: null }],
        }),
      }),
    );
    const codex = await screen.findByTestId('provider-codex');
    expect(codex.dataset['state']).toBe('unchecked');
    expect(codex.textContent).toContain('Not checked yet');
    expect(within(codex).queryByTestId('provider-checked')).toBeNull();
  });

  it('has no providers card when the server sends none (managed agents off)', async () => {
    renderWithApi(<DataHealthPage />, fakeServer({ '/api/diagnostics/ingestion': diagnostics() }));
    await screen.findByTestId('health-reading');
    expect(screen.queryByTestId('health-providers')).toBeNull();
  });

  it('names Codex on the capabilities card', () => {
    expect(HEALTH_COPY.capabilities.providerName('codex')).toBe('Codex');
    expect(HEALTH_COPY.capabilities.providerName('claude-code')).toBe('Claude Code');
  });
});
