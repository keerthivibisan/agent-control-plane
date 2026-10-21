import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { migrateWorkflowV1, type ProjectWorkflow, type WorkflowStageId } from '@acp/core';
import type { AgentDefinitionDetailDto, AgentDefinitionSummaryDto } from '@acp/core/api';
import { App } from '../../src/app/App';
import { AGENT_TEMPLATES } from '../../src/features/skills/agent-templates';
import { SkillsPage } from '../../src/features/skills/SkillsPage';
import { createApiClient, type FetchLike } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { agentWorkflowDto, graphDto } from '../../e2e/workflow-fixtures';
import { CSRF } from '../fixtures/control';
import { project } from '../fixtures/dto';
import { SKILLS_PROJECT_ID, agentDetail, commitResult } from '../fixtures/skills';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

const P = `/api/projects/${SKILLS_PROJECT_ID}`;
const AG = `${P}/agents`;

/** `GET …/workflow-graph` for a version 1 project: its workflow migrated, as the server serves it. */
function migratedGraphDto(dto: Record<string, unknown>): unknown {
  const workflow = dto['workflow'] as ProjectWorkflow;
  return graphDto({ graph: migrateWorkflowV1(workflow, { projectMode: 'auto-edits' }) });
}

/**
 * A fake agents server that keeps state like the real one (writes, deletes, commits). `graph`
 * answers `GET …/workflow-graph` (left out: the page doesn't know which blocks use a file; WG-F:
 * the version 1 `GET …/workflow` is never asked);
 * `deleteRefusal` makes every DELETE answer that 409, as the server does for a file in use.
 */
function server(
  initial: AgentDefinitionDetailDto[] = [],
  options: { graph?: unknown; deleteRefusal?: { code: string; message: string } } = {},
) {
  const agents = new Map(initial.map((a) => [a.name, a]));
  const summary = (d: AgentDefinitionDetailDto): AgentDefinitionSummaryDto => {
    const { instructions: _i, ...rest } = d;
    return rest;
  };
  const base = fakeServer({
    '/api/control/token': { token: CSRF },
    '/api/projects': [project({ id: SKILLS_PROJECT_ID, name: 'web-app' })],
    [`${P}/skills`]: [],
    ...(options.graph !== undefined && { [`${P}/workflow-graph`]: options.graph }),
    [AG]: () => jsonResponse(200, [...agents.values()].map(summary)),
    [`POST ${AG}`]: (body: unknown) => {
      const created = agentDetail({
        ...(body as Partial<AgentDefinitionDetailDto>),
        uncommitted: true,
        lastCommittedAt: null,
      });
      agents.set(created.name, created);
      return jsonResponse(201, created);
    },
  });
  const headers: (string | null)[] = [];
  const fetch: FetchLike = (input, init) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      headers.push(((init?.headers ?? {}) as Record<string, string>)['X-ACP-CSRF'] ?? null);
    }
    const m = /^\/api\/projects\/[^/]+\/agents\/([^/]+)(\/commit)?$/.exec(input);
    if (m === null) return base.fetch(input, init);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    base.calls.push({ method, path: input, body });
    const name = decodeURIComponent(m[1] ?? '');
    const current = agents.get(name);
    let res: Response;
    if (method === 'POST' && m[2] !== undefined) {
      if (current) agents.set(name, { ...current, uncommitted: false });
      res = jsonResponse(200, commitResult({ name }));
    } else if (current === undefined) {
      res = jsonResponse(404, { error: { code: 'not_found', message: 'gone', requestId: 'r' } });
    } else if (method === 'GET') {
      res = jsonResponse(200, current);
    } else if (method === 'PUT') {
      const next = agentDetail({
        ...current,
        ...(body as Partial<AgentDefinitionDetailDto>),
        uncommitted: true,
      });
      agents.set(name, next);
      res = jsonResponse(200, next);
    } else if (options.deleteRefusal !== undefined) {
      res = jsonResponse(409, { error: { ...options.deleteRefusal, requestId: 'r' } });
    } else {
      agents.delete(name);
      res = new Response(null, { status: 204 });
    }
    return Promise.resolve(res);
  };
  return { fetch, calls: base.calls, headers, agents };
}

const mutations = (s: ReturnType<typeof server>) =>
  s.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

describe('Skills & Agents tabs', () => {
  it('shows two tabs; Agents has its own empty state with the three templates', async () => {
    const s = server();
    renderWithApi(<SkillsPage projectId={SKILLS_PROJECT_ID} />, s);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Skills & Agents');
    const tabs = screen.getByRole('tablist', { name: 'Skills or agents' });
    expect(within(tabs).getByRole('tab', { name: 'Skills' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Agents' }));
    await waitFor(() =>
      expect(window.location.hash).toBe(`#/p/${SKILLS_PROJECT_ID}/skills?tab=agents`),
    );
    const empty = await screen.findByTestId('agents-empty');
    expect(within(empty).getByText('No agent definitions yet')).toBeTruthy();
    for (const label of ['Code reviewer', 'Test writer', 'Planner', 'Blank agent']) {
      expect(within(empty).getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByText(/A workflow stage can use one/)).toBeTruthy();
  });

  it('opens the Agents tab from its address in the shell', async () => {
    const s = server([agentDetail({ name: 'planner' })]);
    window.location.hash = `#/p/${SKILLS_PROJECT_ID}/skills?tab=agents`;
    render(<App store={new QueryStore(createApiClient(s.fetch))} eventSource={null} />);
    expect(await screen.findByTestId('agent-card-planner')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Agents' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('agent templates fit the stages they suit (ADR-0019 §7)', () => {
  // The role base sets (ADR-0019 §7; the adapter's `roleBaseTools`). A stage's agent file only
  // narrows its role's set, so a template tool outside it would silently never be given.
  const READ_ONLY = ['Read', 'Grep', 'Glob'];
  const BASE: Record<WorkflowStageId, readonly string[]> = {
    plan: READ_ONLY, // planner, or the lead in lead mode
    orchestrate: READ_ONLY, // lead
    helpers: [...READ_ONLY, 'Edit', 'Write', 'Bash'], // worker
    review: [], // no agent: the owner merges
    'code-review': READ_ONLY, // reviewer
    'unit-tests': [...READ_ONLY, 'Edit', 'Write', 'Bash'], // tester
  };
  const LABEL: Partial<Record<WorkflowStageId, string>> = {
    plan: 'Plan',
    helpers: 'Helpers',
    'code-review': 'Final code review',
    'unit-tests': 'Unit tests',
  };

  it.each(AGENT_TEMPLATES.map((t) => [t.label, t] as const))(
    '%s lists only tools its stages get, and says which stages it suits',
    (_label, t) => {
      expect(t.stages.length).toBeGreaterThan(0);
      for (const stage of t.stages) {
        expect(t.tools.filter((tool) => !BASE[stage].includes(tool))).toEqual([]);
        expect(t.description).toContain(LABEL[stage]);
      }
    },
  );

  it('the code reviewer only reads: no shell tool and no shell commands in its instructions', () => {
    const reviewer = AGENT_TEMPLATES.find((t) => t.id === 'reviewer');
    expect(reviewer?.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(reviewer?.stages).toEqual(['code-review']);
    const text = reviewer?.instructions ?? '';
    expect(text).not.toMatch(/`|\bgit\b|\bnpm\b|\bpnpm\b|run the/i);
    expect(text).toContain('do not run commands');
  });
});

describe('Agents tab', () => {
  const openAgents = (s: ReturnType<typeof server>) => {
    renderWithApi(<SkillsPage projectId={SKILLS_PROJECT_ID} tab="agents" />, s);
  };

  it('fills a new agent from a template and saves it with its tools', async () => {
    const s = server();
    openAgents(s);
    fireEvent.click(
      within(await screen.findByTestId('agents-empty')).getByRole('button', {
        name: 'Code reviewer',
      }),
    );
    const editor = await screen.findByTestId('agent-editor');
    const reviewer = AGENT_TEMPLATES[0];
    expect(within(editor).getByLabelText<HTMLInputElement>('Name').value).toBe('reviewer');
    const tools = within(editor).getByTestId('tools-field');
    expect(within(tools).getByLabelText<HTMLInputElement>(/All tools/).checked).toBe(false);
    for (const t of reviewer?.tools ?? []) {
      expect(within(tools).getByRole('button', { name: `Remove ${t}` })).toBeTruthy();
    }
    fireEvent.change(within(editor).getByLabelText('Model'), { target: { value: 'sonnet' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    expect(await screen.findByTestId('skill-commit')).toBeTruthy();
    expect(s.calls.find((c) => c.method === 'POST' && c.path === AG)?.body).toEqual({
      name: 'reviewer',
      description: reviewer?.description,
      tools: reviewer?.tools,
      model: 'sonnet',
      instructions: reviewer?.instructions,
    });
    expect(s.headers).toEqual([CSRF]);
  });

  it('edits tools as chips, and "All tools" sends null', async () => {
    const s = server();
    openAgents(s);
    fireEvent.click(
      within(await screen.findByTestId('agents-empty')).getByRole('button', {
        name: 'Blank agent',
      }),
    );
    const editor = await screen.findByTestId('agent-editor');
    const tools = within(editor).getByTestId('tools-field');
    const all = within(tools).getByLabelText<HTMLInputElement>(/All tools/);
    // A blank agent starts with every tool (Claude Code's default).
    expect(all.checked).toBe(true);
    fireEvent.click(all);
    expect(within(tools).getByText(/No tools chosen/)).toBeTruthy();
    const input = within(tools).getByLabelText('Add tool');
    fireEvent.change(input, { target: { value: 'Read' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(within(tools).getByRole('button', { name: '+ Bash' }));
    fireEvent.change(input, { target: { value: 'mcp__github__get_pr' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(
      within(tools)
        .getAllByRole('button', { name: /^Remove / })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Remove Read', 'Remove Bash', 'Remove mcp__github__get_pr']);
    fireEvent.click(within(tools).getByRole('button', { name: 'Remove Bash' }));
    fireEvent.change(input, { target: { value: 'not a tool' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(tools).getByRole('alert').textContent).toContain('starts with a letter');

    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'helper' } });
    fireEvent.change(within(editor).getByLabelText('When to use it'), {
      target: { value: 'Small chores' },
    });
    // Back to every tool: the chips are kept for later, but the request says null.
    fireEvent.click(all);
    expect(within(tools).queryByLabelText('Add tool')).toBeNull();
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    await screen.findByTestId('skill-commit');
    expect(s.calls.find((c) => c.method === 'POST' && c.path === AG)?.body).toMatchObject({
      name: 'helper',
      tools: null,
      model: null,
    });
  });

  it('lists agents with tools, model, git state and problems', async () => {
    const s = server([
      agentDetail({
        name: 'reviewer',
        tools: ['Read', 'Grep'],
        model: 'sonnet',
        uncommitted: true,
      }),
      agentDetail({
        name: 'chores',
        tools: null,
        problems: ['The front matter has other keys (hooks): kept as is, not used by the app.'],
      }),
    ]);
    openAgents(s);
    const reviewer = await screen.findByTestId('agent-card-reviewer');
    expect(within(reviewer).getByText('Read')).toBeTruthy();
    expect(within(reviewer).getByText('sonnet')).toBeTruthy();
    expect(within(reviewer).getByText('Uncommitted')).toBeTruthy();
    const chores = screen.getByTestId('agent-card-chores');
    expect(within(chores).getByText('All tools')).toBeTruthy();
    expect(within(chores).getByText('Default model')).toBeTruthy();
    expect(within(chores).getByText(/kept as is, not used by the app/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New agent' })).toBeTruthy();
  });

  it('edits, commits, and deletes with confirmation then commits the removal', async () => {
    const s = server([agentDetail({ name: 'planner', tools: ['Read'] })]);
    openAgents(s);
    fireEvent.click(await screen.findByRole('button', { name: 'Open agent planner' }));
    const editor = await screen.findByTestId('agent-editor');
    expect(within(editor).getByTestId('skill-commit').textContent).toContain(
      'only this agent file',
    );
    fireEvent.change(within(editor).getByLabelText('Model'), { target: { value: 'opus' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    expect(await within(editor).findByText(/Saved to your working tree/)).toBeTruthy();
    const commit = within(editor).getByRole<HTMLButtonElement>('button', { name: 'Commit' });
    await waitFor(() => expect(commit.disabled).toBe(false));
    fireEvent.click(commit);
    expect(await within(editor).findByText('Committed abc1234 on main.')).toBeTruthy();

    // The page doesn't know the workflow here, so Delete is offered (the server would refuse a
    // file a stage uses: next tests).
    fireEvent.click(within(editor).getByRole('button', { name: 'Delete agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete planner?' });
    expect(dialog.textContent).toContain('.claude/agents/planner.md');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const notice = await screen.findByTestId('removal-notice');
    fireEvent.click(within(notice).getByRole('button', { name: 'Commit removal' }));
    await waitFor(() => expect(screen.queryByTestId('removal-notice')).toBeNull());
    expect(mutations(s)).toEqual([
      `PUT ${AG}/planner`,
      `POST ${AG}/planner/commit`,
      `DELETE ${AG}/planner`,
      `POST ${AG}/planner/commit`,
    ]);
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      tools: ['Read'],
      model: 'opus',
    });
  });

  it('disables Delete with an explanation while a block uses the agent file', async () => {
    const s = server([agentDetail({ name: 'db-migrator' })], {
      graph: migratedGraphDto(agentWorkflowDto()),
    });
    openAgents(s);
    fireEvent.click(await screen.findByRole('button', { name: 'Open agent db-migrator' }));
    const editor = await screen.findByTestId('agent-editor');
    const del = within(editor).getByTestId('skill-delete');
    await waitFor(() =>
      expect(
        within(del).getByRole<HTMLButtonElement>('button', { name: 'Delete agent' }).disabled,
      ).toBe(true),
    );
    expect(del.textContent).toContain(
      'Used by Helpers. Remove it from those blocks on the Workflow page',
    );
    expect(within(editor).getByTestId('skill-status').textContent).toContain('Helpers');
    expect(mutations(s)).toEqual([]);
  });

  it("shows the server's refusal when a stage uses the file (409 agent_in_use)", async () => {
    // No workflow on the page (for example not loaded yet): the server's guard answers.
    const message =
      'The agent file is used by these workflow stages: Orchestrate. Remove it from them first.';
    const s = server([agentDetail({ name: 'planner' })], {
      deleteRefusal: { code: 'agent_in_use', message },
    });
    openAgents(s);
    fireEvent.click(await screen.findByRole('button', { name: 'Open agent planner' }));
    const editor = await screen.findByTestId('agent-editor');
    fireEvent.click(within(editor).getByRole('button', { name: 'Delete agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete planner?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.getAttribute('data-refusal')).toBe('agent_in_use');
    expect(alert.textContent).toContain('A workflow stage still uses this agent file.');
    expect(alert.textContent).toContain(message);
    // Nothing was removed: the editor stays, the refusal stays next to Delete, no removal notice.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(within(editor).getByTestId('skill-delete')).getByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('removal-notice')).toBeNull();
    expect(s.agents.has('planner')).toBe(true);
  });

  it('refuses a taken name before sending', async () => {
    const s = server([agentDetail({ name: 'reviewer' })]);
    openAgents(s);
    fireEvent.click(await screen.findByRole('button', { name: 'New agent' }));
    const editor = await screen.findByTestId('agent-editor');
    fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: 'reviewer' } });
    fireEvent.change(within(editor).getByLabelText('When to use it'), { target: { value: 'x' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    expect(await within(editor).findByText('An agent with this name already exists.')).toBeTruthy();
    expect(mutations(s)).toEqual([]);
  });
});
