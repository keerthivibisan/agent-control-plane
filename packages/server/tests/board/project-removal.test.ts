import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { defaultProjectWorkflow } from '@acp/core';
import { ProjectRemovalPreviewDtoSchema, type StreamNoticeDto } from '@acp/core/api';
import {
  createCodeMapRepositories,
  createOrchestrationRepositories,
  createRedesignRepositories,
  createWorkspaceRepositories,
} from '@acp/db';
import { HttpError } from '../../src/errors.js';
import { createProjectRemovalService } from '../../src/projects/removal.js';
import { expectError } from '../control/helpers.js';
import { git, tempDir, write } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';

/*
 * ADR-0036 (RM-2): removing a project from ACP. ACP's records and its own folders in the data dir
 * go; the project folder, its git repository and branches, observed sessions and usage stay. No
 * git command runs during removal. Synthetic data only.
 */

type Board = Awaited<ReturnType<typeof setupBoard>>;

const TEXT = Buffer.from('Synthetic notes\n', 'utf8');

function upload(s: Board, ticketId: string, bytes: Buffer = TEXT) {
  return request(s.app)
    .post(`/api/tickets/${ticketId}/attachments`)
    .set('Content-Type', 'text/plain')
    .set('X-Attachment-Name', 'notes.txt')
    .set('X-ACP-CSRF', s.token)
    .send(bytes);
}

/** Every file of the project folder outside `.git`, with a hash of its content. */
function folderSnapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name === '.git' && dir === root) continue;
      if (entry.isDirectory()) walk(path);
      else
        out[relative(root, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  walk(root);
  return out;
}

const refs = (repo: string) => git(repo, 'for-each-ref', '--format=%(refname) %(objectname)');

/** A ticket whose run ended (the lead failed), with a comment and an attachment. */
async function endedTicket(s: Board, title = 'Add dark mode') {
  const { ticket } = await s.startTicket(title);
  s.fake.lead().finish('error');
  await s.settle();
  const runId = createOrchestrationRepositories(s.db).runs.list({ ticketId: ticket.id })[0]?.id;
  if (runId === undefined) throw new Error('the ticket has a run');
  expect((await s.post(`/api/tickets/${ticket.id}/comments`, { body: 'Synthetic' })).status).toBe(
    201,
  );
  const attachment = await upload(s, ticket.id);
  expect(attachment.status).toBe(201);
  return { ticket, runId, sha256: (attachment.body as { sha256: string }).sha256 };
}

/** ACP's own folders for a run: a real agent worktree (with its acp/ branch) and the others. */
function runFolders(s: Board, runId: string) {
  const worktree = join(s.dataDir, 'worktrees', runId, 'agent-1');
  mkdirSync(join(s.dataDir, 'worktrees', runId), { recursive: true });
  git(s.repo, 'worktree', 'add', '--quiet', '-b', `acp/${runId}/agent-1`, worktree);
  const others = ['ticket-checkouts', 'review-checkouts', 'runs'].map((dir) => {
    const path = join(s.dataDir, dir, runId);
    write(path, 'leftover.txt', 'synthetic\n');
    return path;
  });
  return { worktree, all: [join(s.dataDir, 'worktrees', runId), ...others] };
}

function count(s: Board, table: string, where = '1 = 1', ...params: unknown[]): number {
  return s.db.connection
    .prepare(`SELECT COUNT(*) FROM ${table} WHERE ${where}`)
    .pluck()
    .get(...params) as number;
}

describe('GET /api/projects/:id/removal (ADR-0036)', () => {
  it('previews the counts of an idle project', async () => {
    const s = await setupBoard();
    await endedTicket(s);
    await s.createTicket('Second');
    const res = await s.get(`/api/projects/${s.project.id}/removal`);
    expect(res.status).toBe(200);
    expect(ProjectRemovalPreviewDtoSchema.parse(res.body)).toEqual({
      projectId: s.project.id,
      name: 'web-app',
      rootPath: s.repo,
      tickets: 2,
      runs: 1,
      attachments: 1,
      activeRuns: [],
      busy: false,
      folderExists: true,
    });
    expectError(await s.get('/api/projects/nope/removal'), 404, 'not_found');
  });

  it('lists a run that has not ended, with its ticket', async () => {
    const s = await setupBoard();
    const { ticket } = await s.startTicket('Dark mode');
    const runId = createOrchestrationRepositories(s.db).runs.list({ ticketId: ticket.id })[0]?.id;
    const preview = ProjectRemovalPreviewDtoSchema.parse(
      (await s.get(`/api/projects/${s.project.id}/removal`)).body,
    );
    expect(preview).toMatchObject({ busy: true, busyReason: 'active-runs' });
    expect(preview.activeRuns).toEqual([
      {
        runId,
        ticketId: ticket.id,
        ticketKey: ticket.key,
        ticketTitle: 'Dark mode',
        status: 'PLANNING',
      },
    ]);
  });
});

describe('DELETE /api/projects/:id (ADR-0036)', () => {
  it('deletes ACP records and folders, keeps the folder, repo, branches, sessions and usage', async () => {
    const assistant = { end: vi.fn() };
    const codeMap = { forget: vi.fn() };
    const s = await setupBoard({ removal: { assistant, codeMap } });
    const { runId, sha256 } = await endedTicket(s);
    await s.createTicket('Backlog only');
    const folders = runFolders(s, runId);
    // The rest of the project's history: workflow, a main-branch check, a code map.
    createRedesignRepositories(s.db).workflow.put({
      ...defaultProjectWorkflow(s.project.id, s.project.createdAt),
      plannerMode: 'separate',
    });
    s.workspace.checkRuns.insert({
      projectId: s.project.id,
      runId: null,
      agentRunId: null,
      checkId: 'test',
      name: 'Unit tests',
      required: true,
      status: 'passed',
      exitCode: 0,
      durationMs: 1,
      outputTail: 'ok',
      startedAt: '2026-10-16T09:00:00.000Z',
    });
    createCodeMapRepositories(s.db).codeMap.insertManifest({
      projectId: s.project.id,
      commit: 'a'.repeat(40),
      builtAt: '2026-10-16T09:00:00.000Z',
      indexerVersion: 1,
      counts: {
        files: 0,
        indexed: 0,
        skipped: { 'too-large': 0, binary: 0, generated: 0, 'file-cap': 0 },
        symbols: 0,
        imports: 0,
        unresolved: 0,
      },
      entries: [],
    });
    // An observed session of the project, from a folder inside it, with its usage.
    const sessionId = s.repos.sessions.upsert({
      key: { provider: 'claude-code', providerSessionId: 'sess-obs', providerAgentId: null },
      origin: 'external',
      projectId: s.project.id,
      launchCwd: join(s.repo, 'src'),
      firstSeenAt: '2026-10-16T09:00:00.000Z',
      lastObservedAt: '2026-10-16T09:00:00.000Z',
    }).id;
    const usageBefore = count(s, 'usage_records');
    const sessionsBefore = count(s, 'sessions');
    const folderBefore = folderSnapshot(s.repo);
    const refsBefore = refs(s.repo);
    expect(refsBefore).toContain(`refs/heads/acp/${runId}/agent-1`);
    const notices: StreamNoticeDto[] = [];
    const unsubscribe = s.notifier.subscribe((n) => notices.push(n));
    const gitCallsBefore = s.gitCalls.length;

    expectError(await request(s.app).delete(`/api/projects/${s.project.id}`), 403, 'csrf_missing');
    expect((await s.send('delete', `/api/projects/${s.project.id}`)).status).toBe(204);
    unsubscribe();

    // No git command ran, on the repository or anywhere else.
    expect(s.gitCalls.slice(gitCallsBefore)).toEqual([]);
    expect(folderSnapshot(s.repo)).toEqual(folderBefore);
    expect(refs(s.repo)).toBe(refsBefore);
    // The repository's worktree entry is left for `git worktree prune`.
    expect(git(s.repo, 'worktree', 'list', '--porcelain')).toContain('prunable');

    for (const path of folders.all) expect(existsSync(path), path).toBe(false);
    expect(existsSync(s.control.attachmentFiles.pathOf(sha256))).toBe(false);
    expect(s.repos.projects.getById(s.project.id)).toBeUndefined();
    for (const table of [
      'tickets',
      'orchestration_runs',
      'agent_runs',
      'ticket_comments',
      'ticket_attachments',
      'ticket_plans',
      'project_setup',
      'project_workflow',
      'check_runs',
      'code_map_manifests',
    ]) {
      expect(count(s, table), table).toBe(0);
    }
    expect(count(s, 'sessions')).toBe(sessionsBefore);
    expect(count(s, 'usage_records')).toBe(usageBefore);
    expect(s.repos.sessions.getById(sessionId)?.projectId).toBeNull();
    expect(assistant.end).toHaveBeenCalledWith(s.project.id);
    expect(codeMap.forget).toHaveBeenCalledWith(s.project.id);
    expect(notices.map((n) => n.kind)).toContain('projects-changed');
    expectError(await s.send('delete', `/api/projects/${s.project.id}`), 404, 'not_found');

    // Adding the same folder again: the sessions come back, the tickets do not.
    const again = await s.services.projects.register({ name: 'web-app', rootPath: s.repo });
    expect(s.repos.sessions.getById(sessionId)?.projectId).toBe(again.id);
    expect(count(s, 'tickets', 'project_id = ?', again.id)).toBe(0);
  }, 60_000);

  it('removes a project whose folder was moved or deleted, with its ACP folders', async () => {
    const s = await setupBoard();
    const { runId } = await endedTicket(s);
    const folders = runFolders(s, runId);
    rmSync(s.repo, { recursive: true, force: true });
    const preview = ProjectRemovalPreviewDtoSchema.parse(
      (await s.get(`/api/projects/${s.project.id}/removal`)).body,
    );
    expect(preview).toMatchObject({ folderExists: false, busy: false, tickets: 1, runs: 1 });
    expect((await s.send('delete', `/api/projects/${s.project.id}`)).status).toBe(204);
    expect(s.repos.projects.getById(s.project.id)).toBeUndefined();
    expect(count(s, 'tickets', 'project_id = ?', s.project.id)).toBe(0);
    for (const path of folders.all) expect(existsSync(path)).toBe(false);
  });

  it('keeps an attachment file another project still uses', async () => {
    const s = await setupBoard();
    const { sha256 } = await endedTicket(s);
    const other = s.repos.projects.insert({ name: 'api', rootPath: tempDir('acp-other-') });
    await s.get(`/api/projects/${other.id}/setup`); // gives it a project key
    const ws = createWorkspaceRepositories(s.db);
    const otherTicket = ws.tickets.insert({ projectId: other.id, title: 'Same file' });
    ws.attachments.insert({
      ticketId: otherTicket.id,
      name: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: TEXT.byteLength,
      sha256,
    });
    expect((await s.send('delete', `/api/projects/${s.project.id}`)).status).toBe(204);
    expect(readFileSync(s.control.attachmentFiles.pathOf(sha256)).equals(TEXT)).toBe(true);
    expect(s.repos.projects.getById(other.id)).toBeDefined();
    expect(ws.tickets.getById(otherTicket.id)).toBeDefined();
  }, 60_000);

  it('refuses while a run has not ended (409 project_busy) and changes nothing', async () => {
    const assistant = { end: vi.fn() };
    const s = await setupBoard({ removal: { assistant } });
    const { ticket } = await s.startTicket();
    const runId = createOrchestrationRepositories(s.db).runs.list({ ticketId: ticket.id })[0]?.id;
    const folder = join(s.dataDir, 'runs', runId ?? 'x');
    write(folder, 'leftover.txt', 'synthetic\n');
    const before = ['tickets', 'orchestration_runs', 'agent_runs', 'project_setup'].map((t) =>
      count(s, t),
    );

    expectError(await s.send('delete', `/api/projects/${s.project.id}`), 409, 'project_busy');
    expect(
      ['tickets', 'orchestration_runs', 'agent_runs', 'project_setup'].map((t) => count(s, t)),
    ).toEqual(before);
    expect(s.repos.projects.getById(s.project.id)).toBeDefined();
    expect(existsSync(folder)).toBe(true);
    expect(assistant.end).not.toHaveBeenCalled();
  }, 60_000);

  it('refuses while a check or setup step runs, and ignores a missing assistant chat', async () => {
    const s = await setupBoard();
    let busy = true;
    const end = vi.fn(() => {
      throw new HttpError(404, 'not_found', 'There is no assistant chat for this project');
    });
    const removal = createProjectRemovalService({
      db: s.db,
      repos: s.repos,
      control: s.control,
      checks: { projectBusy: () => busy },
      assistant: { end },
      dataDir: s.dataDir,
      logger: { log() {} },
      publish: () => {},
    });
    expect(removal.preview(s.project.id)).toMatchObject({
      busy: true,
      busyReason: 'checks-running',
      activeRuns: [],
    });
    await expect(removal.remove(s.project.id)).rejects.toMatchObject({
      status: 409,
      code: 'project_busy',
    });
    busy = false;
    await removal.remove(s.project.id);
    expect(end).toHaveBeenCalledOnce();
    expect(s.repos.projects.getById(s.project.id)).toBeUndefined();
  });
});

describe('project removal never deletes outside the data dir (adversarial, ADR-0036 §2)', () => {
  it('a recorded worktree path outside the data dir and a symlink pointing out are left alone', async () => {
    const s = await setupBoard();
    const { runId } = await endedTicket(s);
    const orch = createOrchestrationRepositories(s.db);
    const worker = orch.agentRuns.insert({
      runId,
      kind: 'worker',
      parentAgentRunId: orch.agentRuns.listForRun(runId).find((a) => a.kind === 'lead')?.id ?? null,
      role: 'Builder',
      task: 'Synthetic',
    });
    // A forged workspace row naming a folder outside the data dir.
    const outside = tempDir('acp-victim-');
    write(outside, 'precious.txt', 'keep me\n');
    orch.workspaces.insert({
      runId,
      agentRunId: worker.id,
      worktreePath: outside,
      branch: `acp/${runId}/${worker.id}`,
      baseBranch: 'main',
      baseCommit: null,
    });
    // A run folder that is a symlink to another folder outside the data dir.
    const target = tempDir('acp-victim-link-');
    write(target, 'precious.txt', 'keep me too\n');
    mkdirSync(join(s.dataDir, 'runs'), { recursive: true });
    symlinkSync(target, join(s.dataDir, 'runs', runId));
    // And a recorded path that is the project folder itself.
    const otherWorker = orch.agentRuns.insert({
      runId,
      kind: 'worker',
      parentAgentRunId: worker.parentAgentRunId,
      role: 'Builder',
      task: 'Synthetic',
    });
    orch.workspaces.insert({
      runId,
      agentRunId: otherWorker.id,
      worktreePath: s.repo,
      branch: `acp/${runId}/${otherWorker.id}`,
      baseBranch: 'main',
      baseCommit: null,
    });
    const folderBefore = folderSnapshot(s.repo);

    expect((await s.send('delete', `/api/projects/${s.project.id}`)).status).toBe(204);

    expect(readFileSync(join(outside, 'precious.txt'), 'utf8')).toBe('keep me\n');
    expect(readFileSync(join(target, 'precious.txt'), 'utf8')).toBe('keep me too\n');
    expect(folderSnapshot(s.repo)).toEqual(folderBefore);
    expect(s.repos.projects.getById(s.project.id)).toBeUndefined();
  }, 60_000);

  it('the data dir itself, or a project folder inside it, is never removed', async () => {
    const dataDir = tempDir('acp-data-');
    const { removeInsideDataDir } = await import('../../src/projects/safe-remove.js');
    expect(await removeInsideDataDir(dataDir, dataDir)).toBe('refused');
    expect(await removeInsideDataDir(dataDir, '.')).toBe('refused');
    expect(await removeInsideDataDir(dataDir, '../')).toBe('refused');
    const project = join(dataDir, 'worktrees', 'r1', 'project');
    write(project, 'a.txt', 'a\n');
    expect(
      await removeInsideDataDir(dataDir, join(dataDir, 'worktrees', 'r1'), { protect: [project] }),
    ).toBe('refused');
    expect(existsSync(join(project, 'a.txt'))).toBe(true);
    expect(await removeInsideDataDir(dataDir, 'worktrees/missing')).toBe('missing');
    expect(await removeInsideDataDir(dataDir, 'worktrees/r1')).toBe('removed');
    expect(existsSync(join(dataDir, 'worktrees'))).toBe(true);
    expect(statSync(dataDir).isDirectory()).toBe(true);
  });
});

describe('startup cleanup after a removal (ADR-0036 §5)', () => {
  it('removes a leftover worktree of a deleted run without git and keeps its branch', async () => {
    const first = await setupBoard();
    const repo = first.repo;
    const goneRun = '0b5e7c1a-2d3f-4a6b-8c9d-0e1f2a3b4c5d';
    const leftover = join(first.dataDir, 'worktrees', goneRun, 'agent-1');
    mkdirSync(join(first.dataDir, 'worktrees', goneRun), { recursive: true });
    git(repo, 'worktree', 'add', '--quiet', '-b', `acp/${goneRun}/agent-1`, leftover);
    const review = join(first.dataDir, 'review-checkouts', goneRun, 'agent-2');
    mkdirSync(join(first.dataDir, 'review-checkouts', goneRun), { recursive: true });
    git(repo, 'worktree', 'add', '--quiet', '--detach', review);
    const refsBefore = refs(repo);

    const s = await setupBoard({
      reopen: { dbPath: first.dbPath, dataDir: first.dataDir, repo },
    });
    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(review)).toBe(false);
    expect(refs(repo)).toBe(refsBefore);
    expect(refsBefore).toContain(`refs/heads/acp/${goneRun}/agent-1`);
    // No git command ran in the leftover folders or on the repository for them.
    for (const call of s.gitCalls) {
      expect(call.cwd.startsWith(leftover)).toBe(false);
      expect(call.cwd.startsWith(review)).toBe(false);
      expect(call.args).not.toContain('-D');
    }
  }, 60_000);
});
