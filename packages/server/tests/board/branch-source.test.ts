// Where a ticket branch starts, through the routes (G-H, ADR-0025 §10): the project's "start from"
// branch, the ticket's own, the refusal of a missing one, and the pull request against the target.
// A fake `gh`, a local bare `origin` and the fake managed adapter; no network, no real `claude`.
// Synthetic repository, tickets and texts.
import { branchStrategyPreset, type BranchStrategy } from '@acp/core';
import {
  ProjectAgentSetupDtoSchema,
  TicketBranchDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  type TicketDto,
} from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import { createCodeHostService } from '../../src/code-host/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { expectError } from '../control/helpers.js';
import { createFakeGh, withBareOrigin } from '../code-host/fake-gh.js';
import { GIT_TEST_ENV, git, head } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, helperDone, reviewers, run, type Board } from './loop-helpers.js';

const TIMEOUT = 90_000;
const githubFlow = branchStrategyPreset('github-flow');

/** `main` checked out; `dev` one commit ahead; `release/1.0` one commit ahead of `dev`. */
async function setup() {
  const gh = createFakeGh();
  const codeHost = createCodeHostService({
    git: createGitRunner({ env: GIT_TEST_ENV }),
    cli: gh.run,
    logger: { log: () => undefined },
  });
  const s = await setupBoard({ files: FILES, codeHost });
  withBareOrigin(s.repo);
  const commitOn = (branch: string, file: string): string => {
    git(s.repo, 'checkout', '--quiet', branch);
    git(s.repo, 'commit', '--quiet', '--allow-empty', '-m', `work on ${file}`);
    const tip = head(s.repo);
    git(s.repo, 'checkout', '--quiet', 'main');
    return tip;
  };
  git(s.repo, 'branch', 'dev');
  const dev = commitOn('dev', 'dev');
  git(s.repo, 'branch', 'release/1.0', 'dev');
  const release = commitOn('release/1.0', 'release');
  return { s, gh, dev, release };
}

/** Saves the strategy through the Settings route, as the web does. */
async function saveStrategy(s: Board, branching: BranchStrategy | null) {
  const current = await s.board.getSetup(s.project.id);
  if (current === undefined) throw new Error('no setup');
  const { updatedAt: _u, projectId: _p, ...rest } = current;
  const res = await s.send('put', `/api/projects/${s.project.id}/setup`, { ...rest, branching });
  expect(res.status).toBe(200);
  return ProjectAgentSetupDtoSchema.parse(res.body);
}

/** Moves a ticket to READY, starts it and approves the lead's plan: the branch exists then. */
async function startAndApprove(s: Board, ticket: TicketDto) {
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  const started = await s.post(`/api/tickets/${ticket.id}/start`, {});
  expect(started.status).toBe(200);
  await s.settle();
  const lead = s.fake.agents.filter((a) => a.spec.kind === 'lead').at(-1);
  if (lead === undefined) throw new Error('the lead has not started');
  lead.started();
  await s.settle();
  await lead.callLead('submit_plan', {
    summary: 'Write the notes',
    steps: [{ title: 'Write them', role: 'Builder', detail: 'In docs' }],
  });
  await s.settle();
  const plan = (await s.detail(ticket.id)).plans[0];
  await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
    decision: 'approve',
  });
  await s.settle();
  const runId = (await s.detail(ticket.id)).currentRun?.id ?? '';
  return { runId, lead };
}

describe('the project and ticket "start from" branch (ADR-0025 §10)', () => {
  it(
    'without a source the branch starts at the target and shows no source, as before',
    async () => {
      const { s, dev } = await setup();
      await saveStrategy(s, { ...githubFlow, defaultTargetBranch: 'dev' });
      const ticket = await s.createTicket('Release notes');
      const { runId } = await startAndApprove(s, ticket);
      const branch = (await run(s, runId)).ticketBranch;
      expect(branch).toMatchObject({ baseBranch: 'dev', baseCommit: dev });
      expect(branch).not.toHaveProperty('sourceBranch');
    },
    TIMEOUT,
  );

  it(
    "starts at the project's source, the ticket's own overrides it, null resets to the project's",
    async () => {
      const { s, dev, release } = await setup();
      const saved = await saveStrategy(s, {
        ...githubFlow,
        defaultTargetBranch: 'dev',
        defaultSourceBranch: 'release/1.0',
      });
      expect(saved.branching?.defaultSourceBranch).toBe('release/1.0');

      const first = await s.createTicket('Release notes');
      const { runId } = await startAndApprove(s, first);
      const branch = TicketBranchDtoSchema.parse((await run(s, runId)).ticketBranch);
      expect(branch).toMatchObject({
        branch: 'feature/WEBAPP-1-release-notes',
        baseBranch: 'dev',
        baseCommit: release,
        sourceBranch: 'release/1.0',
      });
      expect(head(s.repo, `refs/heads/${branch.branch}`)).toBe(release);
      expect(git(s.repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');

      // A ticket's own source, stored with the ticket, overrides the project's.
      const created = await s.post(`/api/projects/${s.project.id}/tickets`, {
        title: 'Hotfix notes',
        branch: { from: 'main' },
      });
      expect(created.status).toBe(201);
      const second = TicketDtoSchema.parse(created.body);
      expect(second.branch).toEqual({ from: 'main' });
      const patched = await s.send('patch', `/api/tickets/${second.id}`, {
        branch: { from: 'dev', target: 'main' },
      });
      expect(TicketDetailDtoSchema.parse(patched.body).ticket.branch).toEqual({
        target: 'main',
        from: 'dev',
      });
      const own = await startAndApprove(s, second);
      expect((await run(s, own.runId)).ticketBranch).toMatchObject({
        baseBranch: 'main',
        baseCommit: dev,
        sourceBranch: 'dev',
      });

      // null puts one field back to the project's; the others stay.
      const third = await s.createTicket('Third', { branch: { from: 'main', target: 'main' } });
      const reset = await s.send('patch', `/api/tickets/${third.id}`, { branch: { from: null } });
      expect(TicketDetailDtoSchema.parse(reset.body).ticket.branch).toEqual({ target: 'main' });
      const bad = await s.send('patch', `/api/tickets/${third.id}`, { branch: { from: '-x' } });
      expect(bad.status).toBe(400);
    },
    TIMEOUT,
  );

  it(
    'refuses Start plainly when the source is missing, and starts once it exists',
    async () => {
      const { s } = await setup();
      await saveStrategy(s, {
        ...githubFlow,
        defaultTargetBranch: 'dev',
        defaultSourceBranch: 'release/2.0',
      });
      const ticket = await s.createTicket('Release notes');
      await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
      const refused = await s.post(`/api/tickets/${ticket.id}/start`, {});
      expectError(refused, 409, 'source_branch_missing');
      expect((refused.body as { error: { message: string } }).error.message).toBe(
        'The branch release/2.0, which the ticket branch starts from, does not exist in the project yet',
      );
      expect((await s.detail(ticket.id)).runs).toEqual([]);
      // G-F's create, then Start again.
      const made = await s.post(`/api/projects/${s.project.id}/branches`, {
        name: 'release/2.0',
        from: 'dev',
      });
      expect(made.status).toBe(201);
      expect((await s.post(`/api/tickets/${ticket.id}/start`, {})).status).toBe(200);
    },
    TIMEOUT,
  );
});

describe('the final step with a source (ADR-0025 §10)', () => {
  it(
    'the pull request targets the target, and a source the target lacks asks to update first',
    async () => {
      const { s, gh } = await setup();
      await saveStrategy(s, {
        ...githubFlow,
        defaultTargetBranch: 'dev',
        defaultSourceBranch: 'release/1.0',
      });
      // dev moves on after release/1.0 was cut: the ticket branch does not contain dev's tip.
      git(s.repo, 'checkout', '--quiet', 'dev');
      git(s.repo, 'commit', '--quiet', '--allow-empty', '-m', 'dev moves on');
      git(s.repo, 'checkout', '--quiet', 'main');
      const ticket = await s.createTicket('Release notes');
      const { runId, lead } = await startAndApprove(s, ticket);
      const worker = await helperDone(s, lead, runId, {
        'fixed.txt': 'ok\n',
        'notes.md': 'notes\n',
      });
      await s.settle();
      const reviewer = reviewers(s).at(-1);
      if (reviewer === undefined) throw new Error('no change reviewer');
      reviewer.started();
      await s.settle();
      await reviewer.callLead('submit_review', { verdict: 'approve', findings: 'Synthetic.' });
      reviewer.finish('success');
      await s.settle();
      expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged');
      await s.settle();
      await lead.callLead('request_review', { summary: 'Synthetic lead note.' });
      expect((await run(s, runId)).status).toBe('REVIEW');

      // The owner's local merge: dev is not in the branch, so it asks to update it first.
      const review = await s.get(`/api/runs/${runId}/ticket-branch`);
      expect(review.status).toBe(200);
      expect((review.body as { baseMoved: boolean }).baseMoved).toBe(true);
      const refused = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
      expectError(refused, 409, 'base_moved');
      expect((refused.body as { error: { message: string } }).error.message).toContain(
        'update it from dev first',
      );

      // Push & open PR: against the target, never the source.
      const opened = await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {});
      expect(opened.status).toBe(200);
      expect(TicketBranchDtoSchema.parse(opened.body)).toMatchObject({
        baseBranch: 'dev',
        sourceBranch: 'release/1.0',
        pullRequest: { baseBranch: 'dev' },
      });
      expect(gh.prs[0]).toMatchObject({ baseRefName: 'dev' });
    },
    TIMEOUT,
  );
});
