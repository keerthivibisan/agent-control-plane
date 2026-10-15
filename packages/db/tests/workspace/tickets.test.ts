import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkspaceRepositories, openDatabase } from '../../src/index.js';
import { tempDir, thrown } from '../helpers.js';
import { BUDGET, setupInput, setupWorkspace, ticketWithRun } from './setup.js';

describe('tickets repository (P4-B)', () => {
  it('creates a BACKLOG ticket with defaults and the key <PROJECT_KEY>-<n>', () => {
    const store = setupWorkspace();
    const t = store.ws.tickets.insert({ projectId: store.projectId, title: '  Dark mode  ' });
    expect(t).toEqual({
      id: 'id-0002',
      projectId: store.projectId,
      key: 'WEB-1',
      title: 'Dark mode',
      description: '',
      type: 'feature',
      priority: 'medium',
      labels: [],
      status: 'BACKLOG',
      currentRunId: null,
      createdAt: '2026-10-13T12:00:02.000Z',
      updatedAt: '2026-10-13T12:00:02.000Z',
    });
    expect(store.ws.tickets.getById(t.id)).toEqual(t);
    expect(store.ws.tickets.getById('missing')).toBeUndefined();

    const r = store.ws.tickets.insert({
      projectId: store.projectId,
      title: 'Rate limit',
      description: 'Synthetic description',
      type: 'bug',
      priority: 'urgent',
      labels: [' api ', 'backend'],
      status: 'READY',
    });
    expect(r).toMatchObject({
      key: 'WEB-2',
      type: 'bug',
      priority: 'urgent',
      labels: ['api', 'backend'],
      status: 'READY',
    });
  });

  it('numbers tickets per project from an atomic counter that never reuses a number', () => {
    const store = setupWorkspace();
    const other = store.repos.projects.insert({ name: 'api', rootPath: '/home/user/api' });
    store.ws.projectSetup.upsert(setupInput(other.id, 'API'));
    const keys: string[] = [];
    for (let i = 0; i < 3; i++) {
      keys.push(store.ws.tickets.insert({ projectId: store.projectId, title: `W${i}` }).key);
      keys.push(store.ws.tickets.insert({ projectId: other.id, title: `A${i}` }).key);
    }
    expect(keys).toEqual(['WEB-1', 'API-1', 'WEB-2', 'API-2', 'WEB-3', 'API-3']);

    // A failed insert (invalid input is rejected before the counter moves) leaves no gap…
    expect(
      thrown(() => store.ws.tickets.insert({ projectId: store.projectId, title: '' })),
    ).toMatchObject({ code: 'invalid_input' });
    // …and a renamed key applies to new tickets only; numbers keep counting.
    store.ws.projectSetup.upsert(setupInput(store.projectId, 'APP'));
    expect(store.ws.tickets.insert({ projectId: store.projectId, title: 'X' }).key).toBe('APP-4');
    expect(store.ws.tickets.listForProject(store.projectId).map((t) => t.key)).toEqual([
      'WEB-1',
      'WEB-2',
      'WEB-3',
      'APP-4',
    ]);
  });

  it('two connections to one file never hand out the same number', () => {
    const path = join(tempDir(), 'shared.sqlite');
    const store = setupWorkspace({ path });
    const second = openDatabase(path);
    try {
      const ws2 = createWorkspaceRepositories(second);
      const keys = new Set<string>();
      for (let i = 0; i < 10; i++) {
        keys.add(store.ws.tickets.insert({ projectId: store.projectId, title: `a${i}` }).key);
        keys.add(ws2.tickets.insert({ projectId: store.projectId, title: `b${i}` }).key);
      }
      expect(keys.size).toBe(20);
      expect(
        store.db.connection
          .prepare('SELECT next_ticket_seq FROM project_setup WHERE project_id = ?')
          .pluck()
          .get(store.projectId),
      ).toBe(21);
    } finally {
      second.close();
    }
  });

  it('rejects bad input, unknown projects and projects without a setup', () => {
    const store = setupWorkspace();
    const base = { projectId: store.projectId, title: 'T' };
    for (const bad of [
      { ...base, title: 'x'.repeat(201) },
      { ...base, description: 'x'.repeat(20_001) },
      { ...base, labels: Array.from({ length: 11 }, (_, i) => `l${i}`) },
      { ...base, labels: ['x'.repeat(31)] },
      { ...base, status: 'ACTIVE' },
      { ...base, type: 'epic' },
      { ...base, priority: 'p0' },
    ]) {
      expect(
        thrown(() =>
          // @ts-expect-error: invalid values are rejected at runtime too
          store.ws.tickets.insert(bad),
        ),
        JSON.stringify(bad).slice(0, 60),
      ).toMatchObject({ code: 'invalid_input' });
    }
    expect(thrown(() => store.ws.tickets.insert({ ...base, projectId: 'nope' }))).toMatchObject({
      code: 'not_found',
      message: 'project not found',
    });
    const bare = store.repos.projects.insert({ name: 'bare', rootPath: '/home/user/bare' });
    expect(thrown(() => store.ws.tickets.insert({ ...base, projectId: bare.id }))).toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('no agent setup') as unknown,
    });
  });

  it('updates owner fields and leaves absent ones unchanged', () => {
    const store = setupWorkspace();
    const t = store.ws.tickets.insert({ projectId: store.projectId, title: 'Old', labels: ['a'] });
    const u = store.ws.tickets.update(t.id, { title: 'New', priority: 'high', labels: [] });
    expect(u).toMatchObject({
      title: 'New',
      priority: 'high',
      labels: [],
      type: 'feature',
      key: 'WEB-1',
    });
    expect(u?.updatedAt > t.updatedAt).toBe(true);
    expect(store.ws.tickets.update('missing', { title: 'x' })).toBeUndefined();
    expect(thrown(() => store.ws.tickets.update(t.id, { type: 'epic' as 'bug' }))).toMatchObject({
      code: 'invalid_input',
    });
  });

  it('changes status with a from guard and lists by status in number order', () => {
    const store = setupWorkspace();
    const a = store.ws.tickets.insert({ projectId: store.projectId, title: 'A' });
    const b = store.ws.tickets.insert({ projectId: store.projectId, title: 'B' });
    expect(store.ws.tickets.setStatus(a.id, 'READY', { from: ['BACKLOG'] })?.status).toBe('READY');
    expect(
      thrown(() => store.ws.tickets.setStatus(a.id, 'READY', { from: ['BACKLOG'] })),
    ).toMatchObject({ code: 'conflict' });
    expect(thrown(() => store.ws.tickets.setStatus(a.id, 'READY', { from: [] }))).toMatchObject({
      code: 'invalid_input',
    });
    expect(store.ws.tickets.setStatus('missing', 'READY')).toBeUndefined();
    store.ws.tickets.setStatus(b.id, 'CANCELLED');
    const list = (statuses?: ('READY' | 'CANCELLED' | 'BACKLOG')[]) =>
      store.ws.tickets.listForProject(store.projectId, { statuses }).map((t) => t.key);
    expect(list()).toEqual(['WEB-1', 'WEB-2']);
    expect(list(['CANCELLED'])).toEqual(['WEB-2']);
    expect(list([])).toEqual([]);
    expect(store.ws.tickets.countForProject(store.projectId)).toBe(2);
  });

  it('sets the current run only to a run of the same ticket', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    expect(ticket).toMatchObject({ status: 'ACTIVE', currentRunId: run.id });
    const other = store.ws.tickets.insert({ projectId: store.projectId, title: 'Other' });
    expect(
      thrown(() => store.ws.tickets.setStatus(other.id, 'ACTIVE', { currentRunId: run.id })),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() => store.ws.tickets.setStatus(other.id, 'ACTIVE', { currentRunId: 'nope' })),
    ).toMatchObject({ code: 'not_found' });
    // Absent leaves it; null clears it.
    expect(store.ws.tickets.setStatus(ticket.id, 'DONE')?.currentRunId).toBe(run.id);
    expect(
      store.ws.tickets.setStatus(ticket.id, 'READY', { currentRunId: null })?.currentRunId,
    ).toBeNull();
  });

  it('runs carry their ticket id; a ticket of another project is refused', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    expect(store.orch.runs.getById(run.id)?.ticketId).toBe(ticket.id);
    const second = store.orch.runs.insert({
      projectId: store.projectId,
      ticketId: ticket.id,
      title: 'Re-run',
      budget: BUDGET,
    });
    const plain = store.orch.runs.insert({
      projectId: store.projectId,
      title: 'Control panel',
      budget: BUDGET,
    });
    expect(plain.ticketId).toBeNull();
    expect(store.orch.runs.list({ ticketId: ticket.id }).map((r) => r.id)).toEqual([
      second.id,
      run.id,
    ]);
    expect(store.orch.runs.list().map((r) => r.ticketId)).toEqual([null, ticket.id, ticket.id]);

    const otherProject = store.repos.projects.insert({ name: 'api', rootPath: '/home/user/api' });
    expect(
      thrown(() =>
        store.orch.runs.insert({
          projectId: otherProject.id,
          ticketId: ticket.id,
          title: 'Wrong',
          budget: BUDGET,
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() =>
        store.orch.runs.insert({
          projectId: store.projectId,
          ticketId: 'nope',
          title: 'Unknown',
          budget: BUDGET,
        }),
      ),
    ).toMatchObject({ code: 'not_found' });
  });

  it('deleting the current run clears it; tickets block unregistering the project', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    store.orch.runs.remove(run.id);
    expect(store.ws.tickets.getById(ticket.id)?.currentRunId).toBeNull();
    // Tickets are never deleted (ADR-0016), so the project stays registered.
    expect(() => store.repos.projects.remove(store.projectId)).toThrow(/FOREIGN KEY/);
    expect(store.ws.tickets.countForProject(store.projectId)).toBe(1);
  });
});
