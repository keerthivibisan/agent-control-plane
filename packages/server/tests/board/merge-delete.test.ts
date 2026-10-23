// Merging the ticket's pull request from the app, Delete branch, and the ticket totals, through
// the routes (G-G and T-A; ADR-0025 §9): a fake `gh` over a local bare `origin`, the fake managed
// adapter for every agent; no network, no real `claude`. Synthetic repository, tickets and texts.
import { branchStrategyPreset } from '@acp/core';
import {
  ProjectTokensDtoSchema,
  RunDetailDtoSchema,
  TicketBranchDtoSchema,
  TicketBranchReviewDtoSchema,
  TicketDetailDtoSchema,
  TicketTotalsDtoSchema,
} from '@acp/core/api';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCodeHostService } from '../../src/code-host/index.js';
import { createTokensService } from '../../src/tokens/service.js';
import { createGitRunner } from '../../src/workspace/index.js';
import { expectError } from '../control/helpers.js';
import { CANARY, bareTip, createFakeGh, withBareOrigin } from '../code-host/fake-gh.js';
import { GIT_TEST_ENV, git, head } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone, reviewers, run, type Board } from './loop-helpers.js';

const TIMEOUT = 90_000;
const BRANCH = 'feature/WEBAPP-1-add-dark-mode';

async function setup() {
  const gh = createFakeGh();
  const codeHost = createCodeHostService({
    git: createGitRunner({ env: GIT_TEST_ENV }),
    cli: gh.run,
  });
  const s = await setupBoard({ files: FILES, codeHost });
  const bare = withBareOrigin(s.repo);
  gh.state.bare = bare;
  git(s.repo, 'branch', 'develop');
  const setupNow = await s.board.getSetup(s.project.id);
  const { updatedAt: _u, ...rest } = setupNow;
  s.workspace.projectSetup.upsert({ ...rest, branching: branchStrategyPreset('git-flow') });
  return { s, gh, bare };
}

/** The lead's helper merged into the ticket branch, then the hand-over: the run is in REVIEW. */
async function toReview(
  s: Board,
  lead: Awaited<ReturnType<typeof approved>>['lead'],
  runId: string,
) {
  const worker = await helperDone(s, lead, runId, { 'fixed.txt': 'ok\n', 'src/x1.ts': 'x\n' });
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
  const detail = await run(s, runId);
  expect(detail.status).toBe('REVIEW');
  return detail;
}

/** In REVIEW with an open pull request #12. */
async function withOpenPr() {
  const ctx = await setup();
  const { ticket, runId, lead } = await approved(ctx.s);
  await toReview(ctx.s, lead, runId);
  const opened = await ctx.s.post(`/api/tickets/${ticket.id}/branch/pull-request`, {});
  expect(opened.status).toBe(200);
  // ADR-0025 §9: the answer says where the branch is now (local refs).
  expect(TicketBranchDtoSchema.parse(opened.body)).toMatchObject({
    localExists: true,
    pullRequest: { number: 12, state: 'open', headOnOrigin: true },
  });
  return { ...ctx, ticket, runId };
}

const mergePath = (id: string) => `/api/tickets/${id}/branch/pull-request/merge`;
const deletePath = (id: string) => `/api/tickets/${id}/branch/delete`;

describe('Merge pull request from the app (ADR-0025 §9)', () => {
  it(
    'squash with Delete branch: merged on GitHub, Done, the branch gone there and here',
    async () => {
      const { s, gh, bare, ticket } = await withOpenPr();
      const checkout = { head: git(s.repo, 'symbolic-ref', 'HEAD'), tip: head(s.repo) };

      expectError(
        await request(s.app)
          .post(mergePath(ticket.id))
          .send({ method: 'squash', deleteBranch: true }),
        403,
        'csrf_missing',
      );
      expect((await s.post(mergePath(ticket.id), { method: 'fast' })).status).toBe(400);
      expect(gh.prs[0]?.state).toBe('OPEN');

      const merged = await s.post(mergePath(ticket.id), { method: 'squash', deleteBranch: true });
      expect(merged.status).toBe(200);
      expect(TicketBranchDtoSchema.parse(merged.body)).toMatchObject({
        branch: BRANCH,
        state: 'merged',
        localExists: false,
        pullRequest: { state: 'merged', headOnOrigin: false },
      });
      expect(gh.prs[0]).toMatchObject({ state: 'MERGED', mergedWith: 'squash' });
      expect(bareTip(bare, BRANCH)).toBeNull();
      expect(git(s.repo, 'branch', '--list', BRANCH).trim()).toBe('');
      // The checkout never moved.
      expect({ head: git(s.repo, 'symbolic-ref', 'HEAD'), tip: head(s.repo) }).toEqual(checkout);

      const after = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticket.id}`)).body);
      expect(after.ticket).toMatchObject({ status: 'DONE', stage: 'DONE' });
      expect(after.currentRun?.status).toBe('COMPLETED');
      expect(JSON.stringify(merged.body)).not.toContain(CANARY);

      // The final step reads where the branch is (local refs) to offer Delete branch.
      const review = TicketBranchReviewDtoSchema.parse(
        (await s.get(`/api/runs/${after.currentRun?.id ?? ''}/ticket-branch`)).body,
      );
      expect(review.ticketBranch).toMatchObject({
        localExists: false,
        pullRequest: { headOnOrigin: false },
      });

      // A second merge: nothing open any more.
      expectError(
        await s.post(mergePath(ticket.id), { method: 'merge', deleteBranch: false }),
        409,
        'no_open_pull_request',
      );
      // Delete again: nothing left anywhere, and that is fine.
      const again = await s.post(deletePath(ticket.id), {});
      expect(again.status).toBe(200);
      expect(TicketBranchDtoSchema.parse(again.body)).toMatchObject({
        localExists: false,
        pullRequest: { headOnOrigin: false },
      });
    },
    TIMEOUT,
  );

  it(
    'merge without Delete branch keeps both; Delete branch removes them afterwards',
    async () => {
      const { s, gh, bare, ticket } = await withOpenPr();
      const merged = await s.post(mergePath(ticket.id), { method: 'merge', deleteBranch: false });
      expect(TicketBranchDtoSchema.parse(merged.body)).toMatchObject({
        state: 'merged',
        localExists: true,
        pullRequest: { state: 'merged', headOnOrigin: true },
      });
      expect(gh.prs[0]?.mergedWith).toBe('merge');
      expect(bareTip(bare, BRANCH)).not.toBeNull();

      expectError(await request(s.app).post(deletePath(ticket.id)).send({}), 403, 'csrf_missing');
      const deleted = await s.post(deletePath(ticket.id), {});
      expect(deleted.status).toBe(200);
      expect(TicketBranchDtoSchema.parse(deleted.body)).toMatchObject({
        state: 'merged',
        localExists: false,
        pullRequest: { state: 'merged', headOnOrigin: false },
      });
      expect(bareTip(bare, BRANCH)).toBeNull();
      expect(git(s.repo, 'branch', '--list', BRANCH).trim()).toBe('');
    },
    TIMEOUT,
  );

  it(
    'GitHub refuses the method: a plain 409, the ticket waits; checked out: kept and said',
    async () => {
      const { s, gh, bare, ticket } = await withOpenPr();
      gh.state.methods.rebaseMergeAllowed = false;
      const refused = await s.post(mergePath(ticket.id), { method: 'rebase', deleteBranch: true });
      expectError(refused, 409, 'merge_method_not_allowed');
      expect(JSON.stringify(refused.body)).not.toContain(CANARY);
      expect(
        TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticket.id}`)).body).ticket.status,
      ).not.toBe('DONE');

      gh.state.loggedIn = false;
      expectError(
        await s.post(mergePath(ticket.id), { method: 'merge', deleteBranch: true }),
        409,
        'code_host_not_ready',
      );
      gh.state.loggedIn = true;

      // The owner's checkout is on the ticket branch: GitHub deletes its copy, the local one stays.
      git(s.repo, 'switch', '--quiet', BRANCH);
      const merged = await s.post(mergePath(ticket.id), { method: 'merge', deleteBranch: true });
      expect(merged.status).toBe(200);
      expect(TicketBranchDtoSchema.parse(merged.body)).toMatchObject({
        state: 'merged',
        localExists: true,
        pullRequest: { headOnOrigin: false },
      });
      expect(bareTip(bare, BRANCH)).toBeNull();
      expectError(await s.post(deletePath(ticket.id), {}), 409, 'branch_checked_out');
      expect(git(s.repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe(BRANCH);
      git(s.repo, 'switch', '--quiet', 'develop');
      expect((await s.post(deletePath(ticket.id), {})).status).toBe(200);
      expect(git(s.repo, 'branch', '--list', BRANCH).trim()).toBe('');
    },
    TIMEOUT,
  );
});

describe('Delete branch (ADR-0025 §9)', () => {
  it(
    'refused while the branch is open; after a local merge there is nothing left to delete',
    async () => {
      const { s, ticket, runId } = await (async () => {
        const ctx = await setup();
        const a = await approved(ctx.s);
        await toReview(ctx.s, a.lead, a.runId);
        return { ...ctx, ...a };
      })();
      expectError(await s.post(deletePath(ticket.id), {}), 409, 'branch_not_finished');
      expectError(
        await s.post(mergePath(ticket.id), { method: 'merge', deleteBranch: true }),
        409,
        'no_open_pull_request',
      );
      expect((await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' })).status).toBe(
        200,
      );
      const review = TicketBranchReviewDtoSchema.parse(
        (await s.get(`/api/runs/${runId}/ticket-branch`)).body,
      );
      // The local merge removes the ticket branch itself; it was never pushed.
      expect(review.ticketBranch).toMatchObject({ state: 'merged', localExists: false });
      expect((await s.post(deletePath(ticket.id), [])).status).toBe(400);
      const deleted = await s.post(deletePath(ticket.id), {});
      expect(deleted.status).toBe(200);
      expect(TicketBranchDtoSchema.parse(deleted.body)).toMatchObject({
        state: 'merged',
        localExists: false,
        pullRequest: null,
      });
      expect(git(s.repo, 'branch', '--list', BRANCH).trim()).toBe('');
      // develop (the target) is untouched and still there.
      expect(git(s.repo, 'branch', '--list', 'develop').trim()).not.toBe('');
    },
    TIMEOUT,
  );

  it(
    'discarded with its pull request pushed: Delete branch removes it on origin',
    async () => {
      const { s, bare, ticket, runId } = await withOpenPr();
      expect((await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'discard' })).status).toBe(
        200,
      );
      const review = TicketBranchReviewDtoSchema.parse(
        (await s.get(`/api/runs/${runId}/ticket-branch`)).body,
      );
      expect(review.ticketBranch).toMatchObject({
        state: 'discarded',
        localExists: false,
        pullRequest: { headOnOrigin: true },
      });
      const deleted = await s.post(deletePath(ticket.id), {});
      expect(deleted.status).toBe(200);
      expect(TicketBranchDtoSchema.parse(deleted.body)).toMatchObject({
        state: 'discarded',
        localExists: false,
        pullRequest: { headOnOrigin: false },
      });
      expect(bareTip(bare, BRANCH)).toBeNull();
    },
    TIMEOUT,
  );
});

describe('GET /api/tickets/:id/totals (T-A)', () => {
  it(
    'nothing before a run; a live run counts to now; usage equals the Tokens page’s row',
    async () => {
      const { s } = await setup();
      const ticket = await s.createTicket('Badge');
      const empty = TicketTotalsDtoSchema.parse(
        (await s.get(`/api/tickets/${ticket.id}/totals`)).body,
      );
      expect(empty).toMatchObject({
        ticketId: ticket.id,
        startedAt: null,
        finishedAt: null,
        elapsedMs: null,
        runs: [],
      });
      // No usage observed: unavailable, never 0.
      expect(empty.headline.totalProcessed).toBeNull();
      expect(empty.usage.tokens).toEqual({
        input: null,
        output: null,
        cacheCreation: null,
        cacheRead: null,
      });

      const { ticket: t2, runId } = await approved(s);
      const startedAt = RunDetailDtoSchema.parse(
        (await s.get(`/api/runs/${runId}`)).body,
      ).createdAt;
      s.clock.now = new Date(Date.parse(startedAt) + 14 * 60_000);
      const live = TicketTotalsDtoSchema.parse((await s.get(`/api/tickets/${t2.id}/totals`)).body);
      expect(live).toMatchObject({
        startedAt,
        finishedAt: null,
        elapsedMs: 14 * 60_000,
        runs: [{ runId, startedAt, endedAt: null, durationMs: null }],
      });
      // The Tokens page's service, as its route answers it.
      const tokens = ProjectTokensDtoSchema.parse(
        createTokensService({ db: s.db }).project(s.project.id, {}),
      );
      const row = tokens.byTicket.find((r) => r.ticketId === t2.id);
      expect(row).toBeDefined();
      expect({ usage: live.usage, headline: live.headline }).toEqual({
        usage: row?.usage,
        headline: row?.headline,
      });
      expect(JSON.stringify(live)).not.toMatch(/cost/i);
      expectError(await s.get('/api/tickets/no-such-ticket/totals'), 404, 'not_found');
    },
    TIMEOUT,
  );
});
