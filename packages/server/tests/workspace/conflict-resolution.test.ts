// Real throwaway git repositories (ADR-0030, CR-C): the candidate merge, the resolver's worktree
// with the merge left in progress, the server's seal of it, and the marker check. Synthetic data.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkspaceManager } from '../../src/workspace/index.js';
import { git, head, makeRepo, tempDir, write } from './helpers.js';

const GIT_TIMEOUT_MS = 30_000;
const RUN = '3f1c2a9e-0b4d-4c55-9b0e-5a7d2f1e8c01';
const OP = '9a8b7c6d-1111-4222-8333-944455556666';
const AGENT = 'c8f5e3b2-7d40-4f9b-8e21-3a6c8d0f1b23';

/** A repository with `acp/WEB-1` changing `src/app.ts`, and `main` moved on by the owner. */
async function moved(ownerChange: Record<string, string>) {
  const dataDir = tempDir('acp-cr-data-');
  const manager = createWorkspaceManager({ dataDir });
  const repo = makeRepo({ 'README.md': 'hello\n', 'src/app.ts': 'port = 1\n' });
  const created = await manager.createTicketBranch(repo, 'WEB-1');
  git(repo, 'switch', '--quiet', 'acp/WEB-1');
  write(repo, 'src/app.ts', 'port = 2\n');
  git(repo, 'commit', '--quiet', '-am', 'ticket');
  git(repo, 'switch', '--quiet', 'main');
  for (const [path, content] of Object.entries(ownerChange)) write(repo, path, content);
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', 'owner');
  const ref = { projectRoot: repo, branch: 'acp/WEB-1', baseBranch: 'main', runId: RUN };
  return {
    manager,
    repo,
    ref,
    base: created.baseCommit,
    ticketTip: head(repo, 'refs/heads/acp/WEB-1'),
    targetTip: head(repo, 'refs/heads/main'),
  };
}

describe('prepareCandidate', { timeout: GIT_TIMEOUT_MS }, () => {
  it('a clean merge becomes a pinned candidate; the ticket branch and checkout stay', async () => {
    const m = await moved({ 'docs/guide.md': 'guide\n' });
    const r = await m.manager.prepareCandidate(m.ref, {
      operationId: OP,
      ticketTip: m.ticketTip,
      targetTip: m.targetTip,
    });
    if (r.kind !== 'clean') throw new Error(`expected clean, got ${r.kind}`);
    expect(r.mergeBase).toBe(m.base);
    expect(head(m.repo, `refs/acp/resolutions/${OP}`)).toBe(r.candidate);
    expect(git(m.repo, 'rev-list', '--parents', '-n', '1', r.candidate).trim().split(' ')).toEqual([
      r.candidate,
      m.ticketTip,
      m.targetTip,
    ]);
    expect(head(m.repo, 'refs/heads/acp/WEB-1')).toBe(m.ticketTip);
    expect(git(m.repo, 'status', '--porcelain').trim()).toBe('');
    // The entire combined change: the ticket's file and the target update's.
    const paths = await m.manager.combinedPaths(m.repo, {
      mergeBase: r.mergeBase,
      targetCommit: m.targetTip,
      candidateCommit: r.candidate,
    });
    expect(paths.sort()).toEqual(['docs/guide.md', 'src/app.ts']);
    await m.manager.dropCandidate(m.repo, OP);
    expect(git(m.repo, 'for-each-ref', 'refs/acp/').trim()).toBe('');
  });

  it('a conflict is reported with its files and leaves nothing behind', async () => {
    const m = await moved({ 'src/app.ts': 'port = 3\n' });
    const r = await m.manager.prepareCandidate(m.ref, {
      operationId: OP,
      ticketTip: m.ticketTip,
      targetTip: m.targetTip,
    });
    expect(r).toEqual({ kind: 'conflict', files: ['src/app.ts'], mergeBase: m.base });
    expect(git(m.repo, 'for-each-ref', 'refs/acp/').trim()).toBe('');
    expect(head(m.repo, 'refs/heads/acp/WEB-1')).toBe(m.ticketTip);
  });

  it('an up-to-date branch needs nothing; a moved ticket branch is refused', async () => {
    const m = await moved({ 'docs/guide.md': 'guide\n' });
    const up = await m.manager.prepareCandidate(m.ref, {
      operationId: OP,
      ticketTip: m.ticketTip,
      targetTip: m.base,
    });
    expect(up.kind).toBe('up-to-date');
    await expect(
      m.manager.prepareCandidate(m.ref, {
        operationId: OP,
        ticketTip: m.base,
        targetTip: m.targetTip,
      }),
    ).rejects.toMatchObject({ code: 'ticket-branch-moved' });
  });
});

describe('the resolver worktree', { timeout: GIT_TIMEOUT_MS }, () => {
  it('starts with the merge in progress; the seal makes a two-parent merge; markers are found', async () => {
    const m = await moved({ 'src/app.ts': 'port = 3\n' });
    const ws = await m.manager.create(m.repo, RUN, AGENT, {
      from: { branch: 'acp/WEB-1', commit: m.ticketTip },
      mergeTarget: { commit: m.targetTip },
    });
    const conflicted = readFileSync(join(ws.path, 'src/app.ts'), 'utf8');
    expect(conflicted).toContain('<<<<<<<');
    // Left as is: the server's check finds the markers.
    const leftover = await m.manager.seal(ws, { role: 'Conflict resolver' });
    const check = await m.manager.checkResolution(m.repo, {
      commit: leftover.headCommit,
      targetCommit: m.targetTip,
      files: ['src/app.ts'],
    });
    expect(check).toEqual({ containsTarget: true, markerFiles: ['src/app.ts'] });
    expect(head(m.repo, 'refs/heads/acp/WEB-1')).toBe(m.ticketTip);
  });

  it('a resolved file seals to a clean merge that contains the target', async () => {
    const m = await moved({ 'src/app.ts': 'port = 3\n' });
    const ws = await m.manager.create(m.repo, RUN, AGENT, {
      from: { branch: 'acp/WEB-1', commit: m.ticketTip },
      mergeTarget: { commit: m.targetTip },
    });
    write(ws.path, 'src/app.ts', 'port = 23\n');
    const sealed = await m.manager.seal(ws, { role: 'Conflict resolver' });
    expect(sealed.changed).toBe(true);
    const parents = git(m.repo, 'rev-list', '--parents', '-n', '1', sealed.headCommit).trim();
    expect(parents.split(' ')).toEqual([sealed.headCommit, m.ticketTip, m.targetTip]);
    expect(
      await m.manager.checkResolution(m.repo, {
        commit: sealed.headCommit,
        targetCommit: m.targetTip,
        files: ['src/app.ts'],
      }),
    ).toEqual({ containsTarget: true, markerFiles: [] });
  });

  it('a merge whose result equals the ticket side still records the target', async () => {
    const m = await moved({ 'src/app.ts': 'port = 3\n' });
    const ws = await m.manager.create(m.repo, RUN, AGENT, {
      from: { branch: 'acp/WEB-1', commit: m.ticketTip },
      mergeTarget: { commit: m.targetTip },
    });
    write(ws.path, 'src/app.ts', 'port = 2\n');
    const sealed = await m.manager.seal(ws);
    expect(git(m.repo, 'merge-base', '--is-ancestor', m.targetTip, sealed.headCommit)).toBe('');
  });
});
