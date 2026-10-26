import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { defaultProjectWorkflow, isPathInside } from '@acp/core';
import { CSRF_HEADER } from '@acp/core/api';
import { createReviewLoopRepositories } from '@acp/db';
import { AGENT_ATTACHMENTS_DIR } from '../../src/attachments/agent-copies.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, reviewers, type Board } from './loop-helpers.js';

/*
 * ADR-0026 §4 (C-A): agents read the owner's attachments as read-only copies outside the owner's
 * checkout, listed in their brief, and the copies never reach a commit, the ticket branch or the
 * owner's checkout. The fake managed adapter plays every agent; git runs in a throwaway
 * repository. Synthetic data only.
 */

const NOTES = Buffer.from('Steps to reproduce: open settings.\n', 'utf8');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function attach(s: Board, ticketId: string, name = 'notes.txt') {
  const res = await request(s.app)
    .post(`/api/tickets/${ticketId}/attachments`)
    .set(CSRF_HEADER, s.token)
    .set('Content-Type', 'text/plain')
    .set('X-Attachment-Name', encodeURIComponent(name))
    .send(NOTES);
  expect(res.status).toBe(201);
}

/** The `path` of `name` listed in a brief (`- name (type, size): path`). */
function listedPath(prompt: string, name: string): string {
  const line = prompt.split('\n').find((l) => l.startsWith(`- ${name} (`));
  if (line === undefined) throw new Error(`${name} is not listed`);
  return line.slice(line.indexOf('): ') + 3);
}

function expectReadOnlyCopy(path: string) {
  expect(readFileSync(path).equals(NOTES)).toBe(true);
  expect(statSync(path).mode & 0o777).toBe(0o444);
}

describe('attachments for agents (ADR-0026 §4)', () => {
  it("gives the lead read-only copies in the run's folder, readable without asking", async () => {
    const s = await setupBoard({ files: FILES });
    const ticket = await s.createTicket('Add dark mode');
    await attach(s, ticket.id);
    await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
    expect((await s.post(`/api/tickets/${ticket.id}/start`, {})).status).toBe(200);
    await s.settle();
    const lead = s.fake.lead();
    expect(lead.spec.prompt).toContain('The owner attached a file to this ticket.');
    expect(lead.spec.prompt).not.toContain('asks the owner');
    const path = listedPath(lead.spec.prompt, 'notes.txt');
    // The adapter allows reads in this folder without asking (ADR-0026 §4, `readOnlyDirs`).
    expect(lead.spec.readOnlyDirs).toEqual([dirname(path)]);
    expect(isPathInside(s.dataDir, path)).toBe(true);
    expect(isPathInside(s.repo, path)).toBe(false);
    expectReadOnlyCopy(path);
    expect(git(s.repo, 'status', '--porcelain', '--ignored')).toBe('');
  });

  it('gives a separate planner its own copies, readable without asking', async () => {
    const s = await setupBoard({ files: FILES });
    const stages = defaultProjectWorkflow('x', '2026-10-17T09:00:00.000Z').stages;
    expect(
      (
        await s.send('put', `/api/projects/${s.project.id}/workflow`, {
          plannerMode: 'separate',
          stages,
        })
      ).status,
    ).toBe(200);
    const ticket = await s.createTicket('Add dark mode');
    await attach(s, ticket.id);
    await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
    expect((await s.post(`/api/tickets/${ticket.id}/start`, {})).status).toBe(200);
    await s.settle();
    const planner = s.fake.agents.find((a) => a.spec.kind === 'planner');
    if (planner === undefined) throw new Error('no planner');
    const path = listedPath(planner.spec.prompt, 'notes.txt');
    expect(planner.spec.readOnlyDirs).toEqual([dirname(path)]);
    expect(isPathInside(s.dataDir, path)).toBe(true);
    expect(isPathInside(s.repo, path)).toBe(false);
    expectReadOnlyCopy(path);
    expect(git(s.repo, 'status', '--porcelain', '--ignored')).toBe('');
  });

  it('gives helpers and reviewers ignored copies that never reach a commit or the owner', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    await attach(s, ticket.id);
    await attach(s, ticket.id); // the same name twice: both listed, the second numbered

    await lead.callLead('start_agent', { role: 'Builder', task: 'Build it' });
    await s.settle();
    const worker = s.fake.workers().at(-1);
    if (worker === undefined) throw new Error('no worker');
    const worktree = s.worktree(runId, worker.id);
    const copy = listedPath(worker.spec.prompt, 'notes.txt');
    expect(copy).toBe(join(worker.spec.cwd, AGENT_ATTACHMENTS_DIR, 'notes.txt'));
    expect(isPathInside(worktree, copy)).toBe(true);
    expectReadOnlyCopy(copy);
    expectReadOnlyCopy(join(worker.spec.cwd, AGENT_ATTACHMENTS_DIR, '2-notes.txt'));
    expect(worker.spec.prompt).not.toContain('asks the owner');
    expect(worker.spec.readOnlyDirs).toBeUndefined();
    // Ignored by its own .gitignore: nothing to stage.
    expect(git(worktree, 'status', '--porcelain')).toBe('');

    worker.started();
    await s.settle();
    writeFileSync(join(worktree, 'fixed.txt'), 'ok\n');
    worker.finish('success');
    await s.settle();
    const loop = createReviewLoopRepositories(s.db);
    const head = loop.workspaceChanges.getByAgentRun(worker.id)?.headCommit ?? '';
    expect(head).not.toBe('');
    const sealed = git(worktree, 'ls-tree', '-r', '--name-only', head);
    expect(sealed).toContain('fixed.txt');
    expect(sealed).not.toContain(AGENT_ATTACHMENTS_DIR);

    // The change reviewer reads its own copies in its temporary checkout.
    const reviewer = reviewers(s).at(-1);
    if (reviewer === undefined) throw new Error('no change reviewer');
    const reviewerCopy = listedPath(reviewer.spec.prompt, 'notes.txt');
    expect(isPathInside(reviewer.spec.cwd, reviewerCopy)).toBe(true);
    expectReadOnlyCopy(reviewerCopy);
    reviewer.started();
    await s.settle();
    await reviewer.callLead('submit_review', { verdict: 'approve', findings: 'Fine.' });
    reviewer.finish('success');
    await s.settle();
    expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged');
    await s.settle();
    await lead.callLead('request_review', {});
    await s.settle();
    expect((await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' })).status).toBe(
      200,
    );
    await s.settle();
    // The owner's checkout has the change and nothing of the attachments.
    expect(existsSync(join(s.repo, 'fixed.txt'))).toBe(true);
    expect(existsSync(join(s.repo, AGENT_ATTACHMENTS_DIR))).toBe(false);
    expect(git(s.repo, 'ls-tree', '-r', '--name-only', 'HEAD')).not.toContain(
      AGENT_ATTACHMENTS_DIR,
    );
    expect(git(s.repo, 'status', '--porcelain', '--ignored')).toBe('');
  }, 90_000);
});
