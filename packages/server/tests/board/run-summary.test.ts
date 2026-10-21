import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TicketComment } from '@acp/core';
import { createOrchestrationRepositories, createReviewLoopRepositories } from '@acp/db';
import { RUN_SUMMARY_HEADING, isRunSummaryComment } from '../../src/control/run-summary.js';
import { head } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone, reviewers, run, type Board } from './loop-helpers.js';

/*
 * The run summary comment through the server (ADR-0024 §3, v0.3.0 S-A): composed from the app's
 * records at every handover, with the lead's note when it gave one; a facts-only summary when a
 * run fails or is stopped; the merge line after the owner's merge; never twice for one moment,
 * across restarts; and no prompt, reply, task, finding or tool output in it. The fake managed
 * adapter plays every agent; git runs in a throwaway repository. Synthetic data only.
 */

type Lead = ReturnType<Board['fake']['lead']>;

const NOTE =
  'Added the dark theme toggle. Its checks pass. The print view is not covered yet; a follow-up ticket would add it.';

async function appComments(s: Board, ticketId: string): Promise<TicketComment[]> {
  return (await s.detail(ticketId)).comments.filter((c) => c.author === 'app');
}

async function summaries(s: Board, ticketId: string): Promise<TicketComment[]> {
  return (await appComments(s, ticketId)).filter(isRunSummaryComment);
}

/** The change reviewer approves and ends; the lead merges the change into the ticket branch. */
async function approveAndMerge(s: Board, lead: Lead, workerId: string, findings = 'Fine.') {
  const reviewer = reviewers(s).at(-1);
  if (reviewer === undefined) throw new Error('no change reviewer');
  reviewer.started();
  await s.settle();
  await reviewer.callLead('submit_review', { verdict: 'approve', findings });
  reviewer.finish('success');
  await s.settle();
  expect(await lead.callLead('merge_change', { agentId: workerId })).toContain('Merged');
  await s.settle();
}

describe('the run summary at the handover (ADR-0024 §3)', () => {
  it('holds the facts from the records and the lead’s note; the merge line follows', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    lead.usage('lead-m1', { input: 1200, output: 300, cacheCreation: 40, cacheRead: 9000 });
    await s.settle();
    const worker = await helperDone(s, lead, runId, {
      'src/theme.ts': 'export const dark = true;\n',
      'fixed.txt': 'ok\n',
    });
    await approveAndMerge(s, lead, worker.id);
    expect(await lead.callLead('request_review', { summary: NOTE })).toContain('Handed over');
    expect((await run(s, runId)).status).toBe('REVIEW');

    const [summary, ...more] = await summaries(s, ticket.id);
    expect(more).toEqual([]);
    expect(summary).toMatchObject({ author: 'app', runId, planId: null });
    const body = summary?.body ?? '';
    const lines = body.split('\n');
    expect(lines.slice(0, 2)).toEqual([
      RUN_SUMMARY_HEADING,
      'WEBAPP-1: the lead handed the work over.',
    ]);

    // Every fact against the database.
    const orch = createOrchestrationRepositories(s.db);
    const loopRepos = createReviewLoopRepositories(s.db);
    const plan = (await s.detail(ticket.id)).plans[0];
    expect(plan?.status).toBe('approved');
    expect(body).toContain(`Plan v${plan?.version ?? 0}: 1 step (Helpers).`);
    const change = loopRepos.workspaceChanges.getByAgentRun(worker.id);
    expect(change?.changeState).toBe('merged');
    const checks = loopRepos.checkCommits.latestForCommit(
      runId,
      worker.id,
      change?.headCommit ?? '',
    );
    expect(checks.map((c) => c.status)).toEqual(['passed']);
    expect(orch.workspaces.getByAgentRun(worker.id)?.changedFiles).toBe(2);
    expect(body).toContain(
      'Changes (1):\n- Helpers: merged; 2 files, +2 -0 lines; checks passed (1).',
    );
    const branch = loopRepos.ticketBranches.getByRun(runId);
    expect(body).toContain(
      `Ticket branch ${branch?.branch ?? ''} (from ${branch?.baseBranch ?? ''}): open; 1 change merged`,
    );
    const agents = orch.agentRuns.listForRun(runId);
    const leadRow = agents.find((a) => a.kind === 'lead');
    // ADR-0014 budget tokens: output + uncached input + cache write.
    expect(leadRow?.budgetTokensUsed).toBe(1540);
    const reviewerTokens = agents
      .filter((a) => a.kind === 'reviewer')
      .reduce((n, a) => n + a.budgetTokensUsed, 0);
    expect(body).toContain(
      `Budget tokens: lead 1,540; helpers 0; reviewers ${reviewerTokens.toLocaleString('en-US')}.`,
    );
    expect(body.endsWith(`Lead's note:\n${NOTE}`)).toBe(true);

    // The owner's single merge adds the app's merge line.
    await s.settle();
    const tip = branch?.headCommit ?? '';
    expect((await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' })).status).toBe(
      200,
    );
    expect(head(s.repo)).toBe(tip);
    const app = await appComments(s, ticket.id);
    expect(app.map((c) => c.body)).toEqual([
      body,
      `Merged acp/WEBAPP-1 into main at ${tip.slice(0, 7)}.`,
    ]);
    expect(app[1]).toMatchObject({ runId, author: 'app' });
  }, 60_000);

  it('has the facts only without a note, and an updated one after the owner asks for changes', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    const first = await helperDone(s, lead, runId, { 'a.txt': 'a\n', 'fixed.txt': 'ok\n' });
    await approveAndMerge(s, lead, first.id);
    await lead.callLead('request_review', {});
    await s.settle();
    let found = await summaries(s, ticket.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.body).not.toContain("Lead's note");
    expect(found[0]?.body).toContain('Changes (1):');

    const changes = await s.post(`/api/runs/${runId}/ticket-branch`, {
      action: 'request-changes',
      comment: 'Also cover the print view.',
    });
    expect(changes.status).toBe(200);
    await s.settle();
    // Asking for changes is no handover: nothing new yet.
    expect(await summaries(s, ticket.id)).toHaveLength(1);
    const second = await helperDone(s, lead, runId, { 'b.txt': 'b\nb\n', 'fixed.txt': 'ok\n' });
    await approveAndMerge(s, lead, second.id);
    await lead.callLead('request_review', { summary: 'Added the print view too.' });
    await s.settle();
    found = await summaries(s, ticket.id);
    expect(found.map((c) => c.body.split('\n')[0])).toEqual([
      'Run summary',
      'Run summary (updated)',
    ]);
    const updated = found[1]?.body ?? '';
    expect(updated).toContain('Changes (2):');
    // `fixed.txt` was already on the ticket branch: the second change is `b.txt` alone.
    expect(updated).toContain('- Helpers: merged; 2 files, +2 -0 lines; checks passed (1).');
    expect(updated).toContain('- Helpers 2: merged; 1 file, +2 -0 lines; checks passed (1).');
    expect(updated).toContain('open; 2 changes merged');
    expect(updated.endsWith("Lead's note:\nAdded the print view too.")).toBe(true);
  }, 90_000);
});

describe('a facts-only summary when a run ends without a handover', () => {
  it('when it fails: once', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket } = await s.startTicket('Add dark mode');
    // The lead ends in an error while planning: the run fails (plan first, ADR-0016).
    s.fake.lead().finish('error');
    await s.settle();
    expect((await s.detail(ticket.id)).runs.at(-1)?.status).toBe('FAILED');
    const found = await summaries(s, ticket.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.body).toBe(
      [
        'Run summary',
        'WEBAPP-1: the run failed before the lead handed over.',
        '',
        'Changes: none.',
        '',
        'Budget tokens: lead 0.',
      ].join('\n'),
    );
  }, 60_000);

  it('when the owner stops it, and not again after a restart', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    expect(await lead.callLead('start_agent', { role: 'Builder', task: 'Do it' })).toContain(
      'Started agent',
    );
    await s.settle();
    s.fake.workers().at(-1)?.started();
    await s.settle();
    expect((await s.post(`/api/runs/${runId}/stop`)).status).toBe(200);
    await s.settle();
    expect((await run(s, runId)).status).toBe('CANCELLED');
    const found = await summaries(s, ticket.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.body.split('\n')[1]).toBe(
      'WEBAPP-1: the run was stopped before the lead handed over.',
    );
    expect(found[0]?.body).toMatch(/- Helpers: [^\n]*\(it was stopped\)/);

    await s.control.close();
    const again = await setupBoard({
      reopen: { dbPath: s.dbPath, repo: s.repo, dataDir: s.dataDir },
    });
    expect(await summaries(again, ticket.id)).toHaveLength(1);
  }, 60_000);

  it('when a restart finishes stopping it: once, across a second restart', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId } = await approved(s);
    // Stopped, and the server goes down before the agents' ends are recorded.
    expect((await s.post(`/api/runs/${runId}/stop`)).status).toBe(200);
    await s.control.close();
    const again = await setupBoard({
      reopen: { dbPath: s.dbPath, repo: s.repo, dataDir: s.dataDir },
    });
    expect((await run(again, runId)).status).toBe('CANCELLED');
    const found = await summaries(again, ticket.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.body).toContain('the run was stopped before the lead handed over.');
    await again.control.close();
    const third = await setupBoard({
      reopen: { dbPath: s.dbPath, repo: s.repo, dataDir: s.dataDir },
    });
    expect(await summaries(third, ticket.id)).toHaveLength(1);
  }, 60_000);

  it('when the lead ends without handing over', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    const worker = await helperDone(s, lead, runId, { 'a.txt': 'a\n', 'fixed.txt': 'ok\n' });
    await approveAndMerge(s, lead, worker.id);
    lead.finish('error');
    await s.settle();
    expect((await run(s, runId)).status).toBe('REVIEW');
    const found = await summaries(s, ticket.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.body.split('\n')[1]).toBe('WEBAPP-1: the lead failed before handing over.');
    expect(found[0]?.body).toContain('- Helpers: merged;');
  }, 60_000);
});

describe('no duplicates', () => {
  it('a restart after the handover adds nothing', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, lead } = await approved(s);
    const worker = await helperDone(s, lead, runId, { 'fixed.txt': 'ok\n' });
    await approveAndMerge(s, lead, worker.id);
    await lead.callLead('request_review', { summary: NOTE });
    await s.settle();
    expect(await summaries(s, ticket.id)).toHaveLength(1);
    await s.control.close();
    const again = await setupBoard({
      reopen: { dbPath: s.dbPath, repo: s.repo, dataDir: s.dataDir },
    });
    await again.settle();
    expect(await summaries(again, ticket.id)).toHaveLength(1);
    // Stopping the recovered run later adds no second summary either.
    await again.post(`/api/runs/${runId}/stop`);
    await again.settle();
    expect(await summaries(again, ticket.id)).toHaveLength(1);
  }, 60_000);
});

describe('legacy runs (before the review loop)', () => {
  it('get a facts summary when they reach review', async () => {
    const s = await setupBoard({ legacyRuns: true });
    const { ticket } = await s.startTicket();
    await s.submitPlan();
    const plan = (await s.detail(ticket.id)).plans[0];
    await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
      decision: 'approve',
    });
    const lead = s.fake.lead();
    await lead.callLead('start_agent', { role: 'Builder', task: 'Build the toggle' });
    await s.settle();
    const worker = s.fake.workers()[0];
    if (worker === undefined) throw new Error('no worker');
    worker.started();
    const runId = (await s.detail(ticket.id)).currentRun?.id ?? '';
    writeFileSync(join(s.worktree(runId, worker.id), 'theme.txt'), 'dark\nlight\n');
    worker.finish('success');
    await s.settle();
    // A legacy lead may pass a note; legacy runs keep the facts only.
    await lead.callLead('request_review', { summary: 'Legacy note.' });
    await s.settle();
    const found = await summaries(s, ticket.id);
    expect(found).toHaveLength(1);
    const body = found[0]?.body ?? '';
    expect(body.split('\n')[1]).toBe(
      'WEBAPP-1: the agents finished; their changes wait for your review.',
    );
    expect(body).toContain('- Helpers: waiting for your review; 1 file, +2 -0 lines.');
    expect(body).not.toContain('Ticket branch');
    expect(body).not.toContain('Legacy note.');
  }, 60_000);
});

describe('no conversation content', () => {
  it('keeps every prompt, reply, task, finding and comment out of the summary', async () => {
    const CANARY = 'CANARY7Q';
    const s = await setupBoard({ files: FILES });
    const ticket = await s.createTicket(`${CANARY} ticket title`, {
      description: `${CANARY} ticket description`,
    });
    expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
    expect((await s.post(`/api/tickets/${ticket.id}/start`, {})).status).toBe(200);
    await s.settle();
    const lead = s.fake.agents.filter((a) => a.spec.kind === 'lead').at(-1);
    if (lead === undefined) throw new Error('no lead');
    expect(lead.spec.prompt).toContain(CANARY);
    lead.started();
    lead.emit({ type: 'lead-text', text: `${CANARY} lead reply` });
    lead.emit({ type: 'activity', summary: `${CANARY} activity` });
    await s.settle();
    await lead.callLead('submit_plan', {
      summary: `${CANARY} plan summary`,
      steps: [{ title: `${CANARY} step`, role: `${CANARY} role`, detail: `${CANARY} detail` }],
    });
    await s.settle();
    const plan = (await s.detail(ticket.id)).plans[0];
    await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
      decision: 'approve',
      comment: `${CANARY} owner note`,
    });
    await s.settle();
    const runId = (await s.detail(ticket.id)).currentRun?.id ?? '';
    expect(
      await lead.callLead('start_agent', { role: `${CANARY} helper`, task: `${CANARY} task` }),
    ).toContain('Started agent');
    await s.settle();
    const worker = s.fake.workers().at(-1);
    if (worker === undefined) throw new Error('no worker');
    worker.started();
    worker.emit({ type: 'activity', summary: `${CANARY} tool output` });
    await s.settle();
    writeFileSync(join(s.worktree(runId, worker.id), `${CANARY.toLowerCase()}.txt`), `${CANARY}\n`);
    writeFileSync(join(s.worktree(runId, worker.id), 'fixed.txt'), 'ok\n');
    worker.finish('success');
    await s.settle();
    await approveAndMerge(s, lead, worker.id, `${CANARY} finding`);
    await lead.callLead('request_review', { summary: 'Plain note.' });
    await s.settle();
    const found = await summaries(s, ticket.id);
    expect(found).toHaveLength(1);
    // The canary is in the ticket's other comments (the finding), never in the app's.
    expect((await s.detail(ticket.id)).comments.some((c) => c.body.includes(CANARY))).toBe(true);
    expect(found[0]?.body).not.toContain(CANARY);
    expect(found[0]?.body.toLowerCase()).not.toContain(CANARY.toLowerCase());
    expect(found[0]?.body).toContain('- Helpers: merged; 2 files, +2 -0 lines');
  }, 60_000);
});
