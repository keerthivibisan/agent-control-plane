import { describe, expect, it } from 'vitest';
import {
  SessionDetailDtoSchema,
  SessionSummaryDtoSchema,
  SessionTreeDtoSchema,
  pageSchema,
} from '@acp/core/api';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone, reviewers, type Board } from './loop-helpers.js';

/*
 * ADR-0024 §1–§2 through the server (v0.3.0 S-A): every agent the app starts gets a session title
 * built from the ticket key and its block's label, and the session list, detail and tree name the
 * sessions the app started (`SessionSummaryDto.managed`). The fake managed adapter records each
 * spec; session rows are inserted as the observation pipeline would. Synthetic data only.
 */

const T = '2026-10-16T09:00:00.000Z';

function observe(s: Board, providerSessionId: string, providerAgentId: string | null = null) {
  return s.repos.sessions.upsert({
    key: { provider: 'claude-code', providerSessionId, providerAgentId },
    origin: 'managed',
    firstSeenAt: T,
    lastObservedAt: T,
  });
}

describe('session titles at launch (ADR-0024 §1)', () => {
  it('titles the lead, each helper and its change reviewer from app data', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead } = await approved(s);
    expect(lead.spec.title).toBe('WEBAPP-1 · Lead');
    const first = await helperDone(s, lead, runId, { 'fixed.txt': 'ok\n' }, 'Theme builder');
    expect(first.spec.title).toBe('WEBAPP-1 · Helpers');
    const reviewer = reviewers(s)[0];
    expect(reviewer?.spec.title).toBe('WEBAPP-1 · Change reviewer → Helpers');
    // The lead's own role words never reach a title.
    expect(s.fake.agents.map((a) => a.spec.title ?? '').join()).not.toContain('Theme builder');
  }, 60_000);

  it('gives a second helper of the pool a number, and a rework turn the same title', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead } = await approved(s);
    const a = await helperDone(s, lead, runId, { 'a.txt': 'a\n', 'fixed.txt': 'ok\n' }, 'A');
    const b = await helperDone(s, lead, runId, { 'b.txt': 'b\n', 'fixed.txt': 'ok\n' }, 'B');
    expect(a.spec.title).toBe('WEBAPP-1 · Helpers');
    expect(b.spec.title).toBe('WEBAPP-1 · Helpers 2');
    for (const r of reviewers(s)) {
      r.started();
      await s.settle();
      await r.callLead('submit_review', { verdict: 'approve', findings: 'Fine. Synthetic.' });
      r.finish('success');
      await s.settle();
    }
    expect(reviewers(s).map((r) => r.spec.title)).toEqual([
      'WEBAPP-1 · Change reviewer → Helpers',
      'WEBAPP-1 · Change reviewer → Helpers 2',
    ]);
    expect(
      await lead.callLead('request_rework', { agentId: b.id, comments: 'Again.' }),
    ).toBeTruthy();
    await s.settle();
    const rework = s.fake.byId(b.id);
    expect(rework).not.toBe(b);
    expect(rework.spec.rework).toBeDefined();
    // The server names it the same; the adapter leaves the title out when it resumes a session.
    expect(rework.spec.title).toBe('WEBAPP-1 · Helpers 2');
  }, 60_000);
});

describe('managed sessions in the session DTOs (ADR-0024 §2)', () => {
  it('names the app’s sessions in the list, the detail and the tree', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId, lead } = await approved(s);
    const worker = await helperDone(s, lead, runId, { 'fixed.txt': 'ok\n' });
    const reviewer = reviewers(s)[0];
    if (reviewer === undefined) throw new Error('no change reviewer');
    reviewer.started();
    await s.settle();

    const leadRow = observe(s, `sess-${lead.id}`);
    const workerRow = observe(s, `sess-${worker.id}`);
    const reviewerRow = observe(s, `sess-${reviewer.id}`);
    // A helper agent Claude Code started inside the worker's session is not an agent run.
    const sub = observe(s, `sess-${worker.id}`, 'agent-sub-1');
    // The owner's own session: not the app's.
    const own = observe(s, 'sess-owner-1');

    const list = pageSchema(SessionSummaryDtoSchema).parse(
      (await s.get('/api/sessions?limit=50')).body,
    );
    const byId = new Map(list.items.map((i) => [i.id, i]));
    expect(byId.get(leadRow.id)?.managed).toEqual({
      runId,
      agentRunId: lead.id,
      ticketKey: 'WEBAPP-1',
      kind: 'lead',
      label: 'Lead',
    });
    expect(byId.get(workerRow.id)?.managed).toEqual({
      runId,
      agentRunId: worker.id,
      ticketKey: 'WEBAPP-1',
      kind: 'worker',
      label: 'Helpers',
    });
    expect(byId.get(reviewerRow.id)?.managed).toMatchObject({
      kind: 'reviewer',
      label: 'Change reviewer → Helpers',
    });
    expect(byId.get(sub.id)?.managed).toBeUndefined();
    expect(byId.get(own.id)?.managed).toBeUndefined();
    expect(byId.get(own.id)).not.toHaveProperty('managed');

    const detail = SessionDetailDtoSchema.parse(
      (await s.get(`/api/sessions/${workerRow.id}`)).body,
    );
    expect(detail.managed?.label).toBe('Helpers');
    const tree = SessionTreeDtoSchema.parse((await s.get(`/api/sessions/${leadRow.id}/tree`)).body);
    expect(tree.nodes.find((n) => n.session.id === leadRow.id)?.session.managed?.label).toBe(
      'Lead',
    );

    // After a restart the names come from the database alone, the change reviewer's included.
    await s.control.close();
    const again = await setupBoard({
      reopen: { dbPath: s.dbPath, repo: s.repo, dataDir: s.dataDir },
    });
    const { createSessionsService } = await import('../../src/services/sessions.js');
    const { createManagedSessionNames } = await import('../../src/services/managed-sessions.js');
    const sessions = createSessionsService({
      repos: again.repos,
      queries: again.queries,
      now: () => new Date(T),
      thresholds: again.config.statusThresholds,
      managed: createManagedSessionNames({ db: again.db, now: () => new Date(T) }),
    });
    const reloaded = sessions.summaries(
      again.repos.sessions.getByIds([leadRow.id, workerRow.id, reviewerRow.id]),
    );
    const labels = new Map(reloaded.map((r) => [r.id, r.managed?.label]));
    expect([leadRow.id, workerRow.id, reviewerRow.id].map((id) => labels.get(id))).toEqual([
      'Lead',
      'Helpers',
      'Change reviewer → Helpers',
    ]);
  }, 60_000);
});
