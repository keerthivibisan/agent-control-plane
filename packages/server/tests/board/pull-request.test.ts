// Branching strategies and pull requests through the routes (G-A, ADR-0025): a fake `gh` and a
// local bare `origin`, the fake managed adapter for every agent; no network, no real `claude`.
// Synthetic repository, tickets and texts.
import { branchStrategyPreset } from '@acp/core';
import {
  CodeHostStatusDtoSchema,
  TicketBranchDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
} from '@acp/core/api';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCodeHostService } from '../../src/code-host/index.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { expectError } from '../control/helpers.js';
import { CANARY, bareTip, createFakeGh, withBareOrigin } from '../code-host/fake-gh.js';
import { GIT_TEST_ENV, git, head, makeRepo } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone, reviewers, run, type Board } from './loop-helpers.js';

const TIMEOUT = 90_000;

async function setup(options: { strategy?: boolean } = {}) {
  const lines: string[] = [];
  const logger = { log: (...args: unknown[]) => lines.push(JSON.stringify(args)) };
  const gh = createFakeGh();
  const codeHost = createCodeHostService({
    git: createGitRunner({ env: GIT_TEST_ENV }),
    cli: gh.run,
    logger,
  });
  const s = await setupBoard({ files: FILES, logger, codeHost });
  const bare = withBareOrigin(s.repo);
  git(s.repo, 'branch', 'develop');
  if (options.strategy !== false) {
    const setupNow = await s.board.getSetup(s.project.id);
    if (setupNow === undefined) throw new Error('no setup');
    const { updatedAt: _u, ...rest } = setupNow;
    s.workspace.projectSetup.upsert({ ...rest, branching: branchStrategyPreset('git-flow') });
  }
  return { s, gh, bare, lines };
}

/** The lead's helper merged into the ticket branch, then the hand-over: the run is in REVIEW. */
async function toReview(
  s: Board,
  lead: Awaited<ReturnType<typeof approved>>['lead'],
  runId: string,
) {
  const before = reviewers(s).length;
  const n = before + 1;
  const worker = await helperDone(s, lead, runId, {
    'fixed.txt': 'ok\n',
    [`src/x${n}.ts`]: `export const x = ${n};\n`,
  });
  await s.settle();
  expect(reviewers(s)).toHaveLength(before + 1);
  const reviewer = reviewers(s).at(-1);
  if (reviewer === undefined) throw new Error('no change reviewer');
  reviewer.started();
  await s.settle();
  await reviewer.callLead('submit_review', { verdict: 'approve', findings: 'Synthetic.' });
  reviewer.finish('success');
  await s.settle();
  expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged');
  await s.settle();
  await lead.callLead('request_review', { summary: 'Synthetic lead note for the summary.' });
  const detail = await run(s, runId);
  expect(detail.status).toBe('REVIEW');
  return detail;
}

describe('branching strategy at plan approval (ADR-0025 §3, §4)', () => {
  it(
    'names the ticket branch from the strategy and starts it at the target',
    async () => {
      const { s, lines } = await setup();
      const develop = head(s.repo, 'refs/heads/develop');
      git(s.repo, 'checkout', '--quiet', '-b', 'spike');
      const { runId } = await approved(s);
      const detail = await run(s, runId);
      expect(detail.ticketBranch).toMatchObject({
        branch: 'feature/WEBAPP-1-add-dark-mode',
        baseBranch: 'develop',
        baseCommit: develop,
        state: 'open',
        pullRequest: null,
      });
      // The engine took the name too (it allowed only `acp/<KEY>` before ADR-0025).
      expect(lines.join('\n')).not.toContain('ticket branch not recorded');
      // The owner's checkout stayed on its own branch.
      expect(git(s.repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('spike');
    },
    TIMEOUT,
  );

  it(
    "uses the ticket's own name and target; refuses a missing target before the run",
    async () => {
      const { s } = await setup();
      const created = await s.post(`/api/projects/${s.project.id}/tickets`, {
        title: 'Hotfix',
        type: 'bug',
        branch: { name: 'hotfix/login', target: 'release/9' },
      });
      expect(created.status).toBe(201);
      const ticket = TicketDtoSchema.parse(created.body);
      expect(ticket.branch).toEqual({ name: 'hotfix/login', target: 'release/9' });
      await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
      const refused = await s.post(`/api/tickets/${ticket.id}/start`, {});
      expectError(refused, 409, 'target_branch_missing');
      expect((refused.body as { error: { message: string } }).error.message).toContain('release/9');
      // No run was made.
      expect((await s.detail(ticket.id)).runs).toEqual([]);

      // PATCH: a value sets a field, null puts it back to the project's, null for all clears both.
      const patched = await s.send('patch', `/api/tickets/${ticket.id}`, {
        branch: { target: null },
      });
      expect(patched.status).toBe(200);
      expect(TicketDetailDtoSchema.parse(patched.body).ticket.branch).toEqual({
        name: 'hotfix/login',
      });
      const bad = await s.send('patch', `/api/tickets/${ticket.id}`, { branch: { name: 'a b' } });
      expect(bad.status).toBe(400);
      // A long-lived name is refused before the run starts too.
      await s.send('patch', `/api/tickets/${ticket.id}`, { branch: { name: 'develop' } });
      expectError(
        await s.post(`/api/tickets/${ticket.id}/start`, {}),
        409,
        'invalid_ticket_branch',
      );
      const cleared = await s.send('patch', `/api/tickets/${ticket.id}`, { branch: null });
      expect(TicketDetailDtoSchema.parse(cleared.body).ticket).not.toHaveProperty('branch');
      const started = await s.post(`/api/tickets/${ticket.id}/start`, {});
      expect(started.status).toBe(200);
    },
    TIMEOUT,
  );
});

describe('Push & open PR, Refresh, merged on GitHub → Done (ADR-0025 §4)', () => {
  it(
    'pushes, opens the pull request with the run summary, and completes on merge',
    async () => {
      const { s, gh, bare, lines } = await setup();
      const { ticket, runId, lead } = await approved(s);
      const detail = await toReview(s, lead, runId);
      const tip = detail.ticketBranch?.headCommit ?? '';
      const branch = 'feature/WEBAPP-1-add-dark-mode';

      // The code host status: owner/name and the CLI by exit code, never its output.
      const status = await s.get(`/api/projects/${s.project.id}/code-host`);
      expect(status.status).toBe(200);
      expect(CodeHostStatusDtoSchema.parse(status.body)).toMatchObject({
        provider: 'github',
        repo: 'acme/widgets',
        defaultBranch: 'main',
        cli: { installed: true, loggedIn: true },
        problem: null,
      });

      // Only the owner's click, with the CSRF token.
      expectError(
        await request(s.app).post(`/api/tickets/${ticket.id}/branch/pull-request`).send({}),
        403,
        'csrf_missing',
      );
      expect(gh.calls.some((c) => c.args[1] === 'create')).toBe(false);
      const opened = await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {});
      expect(opened.status).toBe(200);
      expect(TicketBranchDtoSchema.parse(opened.body)).toMatchObject({
        branch,
        baseBranch: 'develop',
        state: 'open',
        pullRequest: {
          provider: 'github',
          number: 12,
          url: 'https://github.com/acme/widgets/pull/12',
          state: 'open',
          baseBranch: 'develop',
          headBranch: branch,
        },
      });
      expect(bareTip(bare, branch)).toBe(tip);
      expect(gh.prs[0]).toMatchObject({ title: 'WEBAPP-1: Add dark mode', baseRefName: 'develop' });
      // ADR-0026 §2: the lead's ticket summary first, then the run's facts.
      expect(gh.prs[0]?.body).toMatch(/^Synthetic lead note for the summary\.\n\nRun summary\n/);
      expect(gh.prs[0]?.body.endsWith('\n\nOpened from Agent Control Plane')).toBe(true);

      // The ticket shows it; nothing more runs until the owner asks (no timer).
      const shown = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticket.id}`)).body);
      expect(shown.currentRun?.ticketBranch?.pullRequest?.number).toBe(12);
      expect(shown.comments.at(-1)).toMatchObject({
        author: 'app',
        body: `Pushed ${branch} and opened pull request #12 into develop.`,
      });
      const before = gh.calls.length;
      await s.settle();
      await new Promise((r) => setTimeout(r, 100));
      await s.settle();
      expect(gh.calls.length).toBe(before);

      // A second click links the same pull request.
      const again = await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, { title: 'x' });
      expect(TicketBranchDtoSchema.parse(again.body).pullRequest?.number).toBe(12);
      expect(gh.prs).toHaveLength(1);

      // Still open on refresh; then GitHub merges it.
      const open = await s.post(`/api/tickets/${ticket.id}/branch/pull-request/refresh`, {});
      expect(TicketBranchDtoSchema.parse(open.body)).toMatchObject({
        state: 'open',
        pullRequest: { state: 'open' },
      });
      const mergeOid = 'd'.repeat(40);
      gh.merge(12, mergeOid);
      expectError(
        await request(s.app).post(`/api/tickets/${ticket.id}/branch/pull-request/refresh`).send({}),
        403,
        'csrf_missing',
      );
      const merged = await s.post(`/api/tickets/${ticket.id}/branch/pull-request/refresh`, {});
      expect(merged.status).toBe(200);
      expect(TicketBranchDtoSchema.parse(merged.body)).toMatchObject({
        state: 'merged',
        mergedCommit: mergeOid,
        pullRequest: { state: 'merged' },
      });
      const after = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticket.id}`)).body);
      expect(after.currentRun?.status).toBe('COMPLETED');
      expect(after.ticket).toMatchObject({ status: 'DONE', stage: 'DONE' });
      expect(after.comments.map((c) => c.body)).toContainEqual(
        `Merged via pull request #12 into develop at ${mergeOid.slice(0, 7)}; checks passed on the tip (1).`,
      );
      // The local branches are the owner's: the app did not merge develop locally.
      expect(head(s.repo, 'refs/heads/develop')).not.toBe(tip);

      // Canary: no token or CLI output in any response or log line.
      for (const body of [status.body, opened.body, again.body, open.body, merged.body, after]) {
        expect(JSON.stringify(body)).not.toContain(CANARY);
      }
      expect(lines.join('\n')).not.toContain(CANARY);
      expect(lines.join('\n')).not.toContain(bare);
    },
    TIMEOUT,
  );

  it(
    'refusals: not in review, no pull request yet, gh logged out, closed on GitHub',
    async () => {
      const { s, gh } = await setup();
      const { ticket, runId, lead } = await approved(s);
      // Before the hand-over: the owner cannot publish yet.
      expectError(
        await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {}),
        409,
        'run_not_active',
      );
      await toReview(s, lead, runId);
      expectError(
        await s.post(`/api/tickets/${ticket.id}/branch/pull-request/refresh`, {}),
        409,
        'no_pull_request',
      );
      gh.state.loggedIn = false;
      const loggedOut = await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {});
      expectError(loggedOut, 409, 'gh-not-logged-in');
      expect(JSON.stringify(loggedOut.body)).not.toContain(CANARY);
      gh.state.loggedIn = true;
      gh.fail.create = { exitCode: null, stdout: '', timedOut: true, notFound: false };
      expectError(
        await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {}),
        504,
        'timeout',
      );
      delete gh.fail.create;
      gh.fail.create = { exitCode: 1, stdout: '', timedOut: false, notFound: false };
      expectError(
        await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {}),
        502,
        'gh-failed',
      );
      delete gh.fail.create;
      expect((await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {})).status).toBe(200);
      gh.close(12);
      const closed = await s.post(`/api/tickets/${ticket.id}/branch/pull-request/refresh`, {});
      expect(TicketBranchDtoSchema.parse(closed.body)).toMatchObject({
        state: 'open',
        pullRequest: { state: 'closed' },
      });
      // Closed unmerged: the owner can still merge locally (into the target, by ref update).
      const local = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
      expect(local.status).toBe(200);
      const after = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticket.id}`)).body);
      expect(after.ticket.status).toBe('DONE');
      expect(after.comments.map((c) => c.body).at(-1)).toMatch(
        /^Merged feature\/WEBAPP-1-add-dark-mode into develop at [0-9a-f]{7}/,
      );
    },
    TIMEOUT,
  );

  it(
    'after Request changes, the next click pushes the new tip to the same pull request',
    async () => {
      const { s, gh, bare } = await setup();
      const { ticket, runId, lead } = await approved(s);
      const first = await toReview(s, lead, runId);
      const branch = 'feature/WEBAPP-1-add-dark-mode';
      const opened = TicketBranchDtoSchema.parse(
        (await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {})).body,
      );
      expect(opened.pullRequest?.pushedCommit).toBe(first.ticketBranch?.headCommit);
      expect(opened.pullRequest?.pushedCommit).toBe(opened.headCommit);

      // The owner asks for more; the lead's next change lands on the ticket branch.
      const asked = await s.post(`/api/runs/${runId}/ticket-branch`, {
        action: 'request-changes',
        comment: 'Also handle the settings page.',
      });
      expect(asked.status).toBe(200);
      const second = await toReview(s, lead, runId);
      const newTip = second.ticketBranch?.headCommit ?? '';
      expect(newTip).not.toBe(first.ticketBranch?.headCommit);
      // The web can tell there is something new to push.
      const shown = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticket.id}`)).body);
      const tb = shown.currentRun?.ticketBranch;
      expect(tb?.headCommit).not.toBe(tb?.pullRequest?.pushedCommit);

      const again = TicketBranchDtoSchema.parse(
        (await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {})).body,
      );
      expect(again.pullRequest).toMatchObject({ number: 12, state: 'open', pushedCommit: newTip });
      expect(bareTip(bare, branch)).toBe(newTip);
      expect(gh.prs).toHaveLength(1);
      expect(gh.calls.filter((c) => c.args[1] === 'create')).toHaveLength(1);

      // Someone pushed to the branch on GitHub: never forced, refused as push-rejected.
      const other = makeRepo({ 'other.txt': 'x\n' });
      git(other, 'push', '--quiet', '--force', bare, `HEAD:refs/heads/${branch}`);
      const theirs = bareTip(bare, branch);
      expectError(
        await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {}),
        409,
        'push-rejected',
      );
      expect(bareTip(bare, branch)).toBe(theirs);
      const kept = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticket.id}`)).body);
      expect(kept.currentRun?.ticketBranch?.pullRequest?.pushedCommit).toBe(newTip);
    },
    TIMEOUT,
  );

  it(
    'a project without a strategy keeps acp/<KEY> from the checked-out branch',
    async () => {
      const { s, gh } = await setup({ strategy: false });
      const { ticket, runId, lead } = await approved(s);
      const detail = await toReview(s, lead, runId);
      expect(detail.ticketBranch).toMatchObject({ branch: 'acp/WEBAPP-1', baseBranch: 'main' });
      const opened = await s.post(`/api/tickets/${ticket.id}/branch/pull-request`, { draft: true });
      expect(TicketBranchDtoSchema.parse(opened.body).pullRequest).toMatchObject({
        baseBranch: 'main',
        headBranch: 'acp/WEBAPP-1',
      });
      expect(gh.prs[0]?.draft).toBe(true);
    },
    TIMEOUT,
  );
});
