import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectDtoSchema, RunDetailDtoSchema } from '@acp/core/api';
import { dumpDatabase } from '../control/harness.js';
import { tempDir } from '../../workspace/helpers.js';
import {
  approveLatestPlan,
  bootWorkspace,
  createProject,
  createTicket,
  expectError,
  expectStatus,
  listenToStream,
  setupBody,
  startHelper,
  startTicket,
  submitPlan,
  waitForRun,
  worktreeOf,
  type WorkspaceServer,
} from './harness.js';

/*
 * P4-H security spot checks through the real server (README §7, ADR-0013 §6, ADR-0017 §1,
 * ADR-0009 and the ADR-0013 amendment): every mutating route refuses a request without the
 * `X-ACP-CSRF` token (and with a wrong one) and changes nothing; `POST /api/projects/new` never
 * touches an existing folder and refuses a missing parent; the raw tool input of a permission
 * request reaches no response, log line, SSE frame or database row.
 */

const open: WorkspaceServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe('P4-H CSRF on every mutation', () => {
  it('refuses each board and control mutation without the token and with a wrong one; nothing changes', async () => {
    const b = await bootWorkspace();
    open.push(b);
    const parent = tempDir('acp-p4h-parent-');
    const project = await createProject(b, 'shop', parent);
    const ticket = await createTicket(b, project.id, { title: 'Guarded' });
    const { runId, lead } = await startTicket(b, ticket.id);
    const p = project.id;
    const t = ticket.id;
    const routes: [Method, string][] = [
      // Board (README §6.3).
      ['POST', '/api/projects/new'],
      ['DELETE', `/api/projects/${p}`],
      ['PUT', `/api/projects/${p}/setup`],
      ['POST', `/api/projects/${p}/harness/checks`],
      ['POST', `/api/projects/${p}/harness/ticket`],
      ['POST', `/api/projects/${p}/tickets`],
      ['PATCH', `/api/tickets/${t}`],
      ['POST', `/api/tickets/${t}/move`],
      ['POST', `/api/tickets/${t}/start`],
      ['POST', `/api/tickets/${t}/comments`],
      ['POST', `/api/tickets/${t}/plans/x/decision`],
      ['POST', `/api/runs/${runId}/agents/${lead.id}/checks`],
      // Control panel (Phase 3), used by the ticket page.
      ['POST', '/api/runs'],
      ['POST', `/api/runs/${runId}/chat`],
      ['POST', `/api/runs/${runId}/stop`],
      ['POST', `/api/runs/${runId}/agents/${lead.id}/stop`],
      ['POST', `/api/runs/${runId}/agents/${lead.id}/message`],
      ['POST', `/api/runs/${runId}/review`],
      ['POST', '/api/approvals/x'],
    ];
    const bodies: Record<string, unknown> = {
      '/api/projects/new': { parentDir: parent, name: 'csrf-made' },
      [`/api/projects/${p}/tickets`]: { title: 'Not created' },
      [`/api/tickets/${t}`]: { title: 'Not renamed' },
      [`/api/tickets/${t}/move`]: { status: 'CANCELLED' },
      [`/api/tickets/${t}/comments`]: { body: 'Not stored' },
      '/api/runs': { projectId: p },
      [`/api/runs/${runId}/chat`]: { text: 'Not sent' },
      [`/api/runs/${runId}/agents/${lead.id}/message`]: { text: 'Not sent' },
    };
    for (const [method, path] of routes) {
      const body = bodies[path] ?? {};
      expectError(await b.request(method, path, body, { csrf: null }), 403, 'csrf_missing');
      expectError(
        await b.request(method, path, body, { csrf: 'f'.repeat(64) }),
        403,
        'csrf_invalid',
      );
    }

    // Nothing changed.
    expect(existsSync(join(parent, 'csrf-made'))).toBe(false);
    const cards = expectStatus(await b.get(`/api/projects/${p}/tickets`), 200) as unknown[];
    expect(cards).toHaveLength(1);
    const d = expectStatus(await b.get(`/api/tickets/${t}`), 200) as {
      ticket: { title: string; stage: string };
      comments: unknown[];
    };
    expect(d.ticket).toMatchObject({ title: 'Guarded', stage: 'PLANNING' });
    expect(d.comments).toEqual([]);
    expect((expectStatus(await b.get('/api/runs'), 200) as unknown[]).length).toBe(1);
    expect(lead.sent).toEqual([]);
    expect(lead.ended).toBe(false);
    expect(expectStatus(await b.get(`/api/projects/${p}`), 200)).toMatchObject({ id: p });
  }, 60_000);

  // Finding (P4-H, see docs/phase-4/wp/P4-H.md "Blockers"): the Phase 1 "add an existing folder"
  // route has no CSRF check, while every Phase 3/4 mutation has one. Remove `.fails` once fixed.
  it.fails(
    'POST /api/projects (add an existing folder) refuses a request without the token',
    async () => {
      const b = await bootWorkspace();
      open.push(b);
      const folder = tempDir('acp-p4h-existing-');
      const res = await b.request(
        'POST',
        '/api/projects',
        { name: 'x', rootPath: folder },
        {
          csrf: null,
        },
      );
      expectError(res, 403, 'csrf_missing');
    },
  );
});

describe('P4-H POST /api/projects/new refusals (ADR-0017 §1)', () => {
  it('refuses an existing folder (409) without touching it, a missing parent and a file as parent', async () => {
    const b = await bootWorkspace();
    open.push(b);
    const parent = tempDir('acp-p4h-parent-');
    mkdirSync(join(parent, 'taken'));
    writeFileSync(join(parent, 'taken', 'keep.txt'), 'mine\n');
    writeFileSync(join(parent, 'a-file'), 'not a folder\n');

    expectError(
      await b.post('/api/projects/new', { parentDir: parent, name: 'taken' }),
      409,
      'conflict',
    );
    expect(readdirSync(join(parent, 'taken'))).toEqual(['keep.txt']);
    // A file with that name is "taken" too.
    expectError(
      await b.post('/api/projects/new', { parentDir: parent, name: 'a-file' }),
      409,
      'conflict',
    );
    expectError(
      await b.post('/api/projects/new', { parentDir: join(parent, 'missing'), name: 'x' }),
      400,
      'invalid_root',
    );
    expect(existsSync(join(parent, 'missing'))).toBe(false);
    expectError(
      await b.post('/api/projects/new', { parentDir: join(parent, 'a-file'), name: 'x' }),
      400,
      'invalid_root',
    );
    expectError(
      await b.post('/api/projects/new', { parentDir: parent, name: '../escape' }),
      400,
      'invalid_request',
    );
    expectError(
      await b.post('/api/projects/new', { parentDir: 'relative/dir', name: 'x' }),
      400,
      'invalid_request',
    );
    expect(readdirSync(parent).sort()).toEqual(['a-file', 'taken']);
    expect(expectStatus(await b.get('/api/projects'), 200)).toEqual([]);

    // The same name in a fresh parent works, once.
    const fresh = tempDir('acp-p4h-parent-');
    ProjectDtoSchema.parse(
      expectStatus(await b.post('/api/projects/new', { parentDir: fresh, name: 'taken' }), 201),
    );
    expectError(
      await b.post('/api/projects/new', { parentDir: fresh, name: 'taken' }),
      409,
      'conflict',
    );
  }, 30_000);
});

describe('P4-H raw tool input stays in memory (ADR-0009, ADR-0013 amendment)', () => {
  it('appears in no response, log line, SSE frame or database row, whether allowlisted, asked, approved, denied or expired by a restart', async () => {
    const MARK = {
      inside: 'P4H-MARK-INSIDE',
      approved: 'P4H-MARK-APPROVED',
      denied: 'P4H-MARK-DENIED',
      notebook: 'P4H-MARK-NOTEBOOK',
      pending: 'P4H-MARK-PENDING',
    } as const;
    const dataDir = tempDir('acp-p4h-data-');
    const claudeDir = tempDir('acp-p4h-claude-');
    const logs: string[] = [];
    const b = await bootWorkspace({ dataDir, claudeDir, logs });
    open.push(b);
    const sse = listenToStream(b);
    const project = await createProject(b, 'vault');
    expectStatus(
      await b.put(
        `/api/projects/${project.id}/setup`,
        setupBody('VAULT', { allowlist: { editInOwnWorktree: true, runHarnessChecks: true } }),
      ),
      200,
    );
    const ticket = await createTicket(b, project.id, { title: 'Touch some files' });
    const { runId, lead } = await startTicket(b, ticket.id);
    await submitPlan(b, ticket.id, lead, 'Edit things');
    await approveLatestPlan(b, ticket.id);
    const helper = await startHelper(b, runId, lead, 'Builder', 'Edit things');
    const wt = worktreeOf(helper);

    await expect(
      helper.ask('Edit', 'Edit README.md', {
        file_path: join(wt, 'README.md'),
        old_string: MARK.inside,
        new_string: MARK.inside,
      }),
    ).resolves.toEqual({ allow: true });
    const pendingOf = async (n: number) =>
      waitForRun(
        b,
        runId,
        (r) => r.approvals.filter((a) => a.status === 'pending').length === n,
        `${n} pending`,
      );
    const decideFirstPending = async (decision: 'approve' | 'deny') => {
      const run = await pendingOf(1);
      const id = run.approvals.find((a) => a.status === 'pending')?.id ?? '';
      expectStatus(await b.post(`/api/approvals/${id}`, { decision }), 200);
    };
    const approved = helper.ask('Bash', 'Run a command', { command: `echo ${MARK.approved}` });
    await decideFirstPending('approve');
    await expect(approved).resolves.toEqual({ allow: true });
    const denied = helper.ask('Write', 'Write outside', {
      file_path: join(project.rootPath, MARK.denied),
      content: MARK.denied,
    });
    await decideFirstPending('deny');
    await expect(denied).resolves.toMatchObject({ allow: false });
    // A notebook outside the worktree, then a request left pending until a restart expires it.
    const notebook = helper.ask('NotebookEdit', 'Edit a notebook', {
      notebook_path: join(project.rootPath, `${MARK.notebook}.ipynb`),
      new_source: MARK.notebook,
    });
    await decideFirstPending('deny');
    await expect(notebook).resolves.toMatchObject({ allow: false });
    void helper.ask('Edit', 'Edit src', {
      file_path: `/elsewhere/${MARK.pending}`,
      old_string: MARK.pending,
    });
    await pendingOf(1);

    // Everything the UI would read while the run is live.
    for (const path of [
      `/api/runs/${runId}`,
      '/api/runs',
      `/api/tickets/${ticket.id}`,
      `/api/board?projectId=${project.id}`,
      `/api/projects/${project.id}/tickets`,
      '/api/diagnostics/ingestion',
    ]) {
      expectStatus(await b.get(path), 200);
    }
    const frames = await sse.stop();
    await b.close();

    const second = await bootWorkspace({ dataDir, claudeDir, logs });
    open.push(second);
    const after = RunDetailDtoSchema.parse(
      expectStatus(await second.get(`/api/runs/${runId}`), 200),
    );
    expect(after.approvals.map((a) => a.status)).toEqual([
      'approved',
      'approved',
      'denied',
      'denied',
      'expired',
    ]);
    expectStatus(await second.get(`/api/tickets/${ticket.id}`), 200);
    await second.close();

    const database = dumpDatabase(second.databasePath);
    const responses = [...b.responses, ...second.responses];
    expect(responses.length).toBeGreaterThan(20);
    for (const marker of Object.values(MARK)) {
      expect(responses.filter((r) => r.includes(marker))).toEqual([]);
      expect(logs.filter((l) => l.includes(marker))).toEqual([]);
      expect(frames).not.toContain(marker);
      expect(database).not.toContain(marker);
    }
  }, 60_000);
});
