// Session names in every view that lists or draws sessions (ADR-0024 §2, v0.3.0 S-B). Each view
// uses lib/session-name.ts; these check that it does, and that the marker and the helper's task
// show where they should. Synthetic data only.
import { render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { SessionRows } from '../../src/features/all-projects/SessionRows';
import { SessionDetail } from '../../src/features/session-detail/SessionDetail';
import { FamilyTree } from '../../src/features/sessions/FamilyTree';
import type { SessionNodeData } from '../../src/features/sessions/graph';
import { SessionList } from '../../src/features/sessions/SessionList';
import { SessionNodeView } from '../../src/features/sessions/SessionNodeView';
import { formatSessionStart } from '../../src/lib/session-name';
import { detail, edge, page, session, T0, tree, usage } from '../fixtures/dto';
import { fakeServer, renderWithApi } from '../helpers';

const managed = session({
  id: 's-app',
  title: 'Some title Claude Code wrote',
  origin: 'managed',
  managed: {
    runId: 'r-1',
    agentRunId: 'a-1',
    ticketKey: 'WEB-12',
    kind: 'worker',
    label: 'Frontend helper',
  },
});
const runOnly = session({
  id: 's-run',
  managed: { runId: 'r-2', agentRunId: 'a-2', ticketKey: null, kind: 'lead', label: 'Lead' },
});
const titled = session({ id: 's-titled', title: 'Fix login' });
const helper = session({
  id: 's-helper',
  providerAgentId: 'ag-1',
  agentType: 'Explore',
  description: 'Find the login handler',
});
const unnamed = session({ id: 's-unnamed', gitBranch: 'feature/login' });
const noBranch = session({ id: 's-nobranch', gitBranch: null });
const all = [managed, runOnly, titled, helper, unnamed, noBranch];
const started = formatSessionStart(T0);

const EXPECTED: Record<string, string> = {
  's-app': 'WEB-12 · Frontend helper',
  's-run': 'Lead',
  's-titled': 'Fix login',
  's-helper': 'Helper agent: Explore',
  's-unnamed': `Session on feature/login · ${started}`,
  's-nobranch': `Session started ${started}`,
};

describe('the Sessions list', () => {
  it('names each session by the rules, marks the app’s, and keeps the id', () => {
    renderWithApi(
      <SessionList sessions={all} projectNames={new Map()} empty={null} />,
      fakeServer({}),
    );
    for (const [id, name] of Object.entries(EXPECTED)) {
      const row = document.querySelector(`tr[data-session-id="${id}"]`) as HTMLElement;
      const link = within(row).getByTestId('session-name');
      expect(link.textContent).toBe(name);
      expect(link.getAttribute('href')).toBe(`#/sessions/${id}`);
      expect(row.textContent).toContain(id.slice(0, 8));
    }
    const appRow = document.querySelector('tr[data-session-id="s-app"]') as HTMLElement;
    expect(within(appRow).getByTestId('started-by-app').textContent).toBe(
      'Started by Agent Control Plane',
    );
    const helperRow = document.querySelector('tr[data-session-id="s-helper"]') as HTMLElement;
    expect(within(helperRow).getByTestId('session-detail-text').textContent).toBe(
      'Find the login handler',
    );
    expect(within(helperRow).queryByTestId('started-by-app')).toBeNull();
    expect(screen.getAllByTestId('started-by-app')).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/untitled/i);
  });
});

describe('the family tree (also the agent trees’ helper lists)', () => {
  it('names the members and marks the one the app started', () => {
    const root = session({ ...managed, childCount: 1 });
    render(<FamilyTree tree={tree('s-app', [root, helper], [edge('s-app', 's-helper')])} />);
    const top = screen.getByTestId('family-member-s-app');
    expect(within(top).getByRole('link').textContent).toBe('WEB-12 · Frontend helper');
    expect(within(top).getByTestId('started-by-app')).toBeTruthy();
    const child = screen.getByTestId('family-member-s-helper');
    expect(within(child).getByRole('link').textContent).toBe('Helper agent: Explore');
    expect(within(child).getByText('Find the login handler')).toBeTruthy();
    expect(
      screen.getByRole('list', { name: 'Helper agents: WEB-12 · Frontend helper' }),
    ).toBeTruthy();
  });
});

describe('the relationships diagram', () => {
  function node(s: typeof managed): SessionNodeData {
    return {
      session: s,
      aggregateUsage: usage(),
      isRoot: true,
      isFocus: false,
      parent: 'unknown',
      childEdgeCount: 0,
      collapsed: false,
      hiddenDescendants: 0,
    };
  }
  function renderNode(s: typeof managed) {
    const props = { id: s.id, data: node(s) } as unknown as Parameters<typeof SessionNodeView>[0];
    return render(
      <ReactFlowProvider>
        <SessionNodeView {...props} />
      </ReactFlowProvider>,
    );
  }

  it('draws the app’s name and marker, a helper’s task, and the fallback', () => {
    renderNode(managed);
    let n = screen.getByTestId('node-s-app');
    expect(within(n).getByRole('link').textContent).toBe('WEB-12 · Frontend helper');
    expect(within(n).getByTestId('started-by-app')).toBeTruthy();
    expect(n.textContent).toContain('s-app');
    renderNode(helper);
    n = screen.getByTestId('node-s-helper');
    expect(within(n).getByRole('link').textContent).toBe('Helper agent: Explore');
    expect(within(n).getByText('Find the login handler')).toBeTruthy();
    renderNode(unnamed);
    n = screen.getByTestId('node-s-unnamed');
    expect(within(n).getByRole('link').textContent).toBe(EXPECTED['s-unnamed']);
  });
});

describe('a session’s own page', () => {
  function renderDetail(s: ReturnType<typeof detail>) {
    renderWithApi(
      <SessionDetail id={s.id} />,
      fakeServer({ [`/api/sessions/${s.id}`]: s, [`/api/sessions/${s.id}/events`]: page([]) }),
    );
  }

  it('titles the app’s session after its ticket, with the marker and a link to the ticket', async () => {
    const { id: _id, ...rest } = managed;
    renderDetail(detail({ ...rest, id: 's-app' }));
    expect(
      await screen.findByRole('heading', { name: 'WEB-12 · Frontend helper', level: 1 }),
    ).toBeTruthy();
    expect(screen.getAllByTestId('started-by-app').length).toBeGreaterThan(0);
    const link = screen.getByTestId('managed-link');
    expect(link.textContent).toBe('Open WEB-12');
    expect(link.getAttribute('href')).toBe('#/control/r-1');
    // The id stays visible in the facts.
    expect(screen.getByTestId('session-facts').textContent).toContain('s-app');
  });

  it('links a run without a ticket to its run', async () => {
    const { id: _id, ...rest } = runOnly;
    renderDetail(detail({ ...rest, id: 's-run' }));
    expect(await screen.findByRole('heading', { name: 'Lead', level: 1 })).toBeTruthy();
    expect(screen.getByTestId('managed-link').textContent).toBe('Open the run');
  });

  it('gives a helper its task under the title, and an unnamed session its branch', async () => {
    const { id: _h, ...h } = helper;
    renderDetail(detail({ ...h, id: 's-helper' }));
    expect(
      await screen.findByRole('heading', { name: 'Helper agent: Explore', level: 1 }),
    ).toBeTruthy();
    expect(screen.getByTestId('session-detail-text').textContent).toBe('Find the login handler');
    expect(screen.queryByTestId('managed-link')).toBeNull();
  });

  it('never titles a session "Untitled"', async () => {
    const { id: _u, ...u } = unnamed;
    renderDetail(detail({ ...u, id: 's-unnamed' }));
    expect(
      await screen.findByRole('heading', {
        name: `Session on feature/login · ${started}`,
        level: 1,
      }),
    ).toBeTruthy();
  });
});

describe('All projects lists', () => {
  it('names sessions by the same rules', () => {
    render(<SessionRows sessions={all} projectNames={new Map()} label="Running now" />);
    const list = screen.getByRole('list', { name: 'Running now' });
    for (const [id, name] of Object.entries(EXPECTED)) {
      const row = list.querySelector(`[data-session-id="${id}"]`) as HTMLElement;
      expect(within(row).getByRole('link').textContent).toBe(name);
    }
    expect(within(list).getAllByTestId('started-by-app')).toHaveLength(2);
  });
});
