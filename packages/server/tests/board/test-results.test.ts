import { describe, expect, it } from 'vitest';
import { defaultProjectWorkflow } from '@acp/core';
import { TicketActivityDtoSchema } from '@acp/core/api';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone, type Board } from './loop-helpers.js';

/*
 * ADR-0038 §1 (FR-1) through the server: a tester's `report_test_results` is stored as ticket
 * comments of kind `test-results` (author `app`, with its agent run) and shown on the
 * Conversation tab. The fake managed adapter plays every agent. Synthetic data only.
 */

const LEAD_REVIEWS = { reviewer: 'lead' } as const;
const CANARY = 'CANARY-FR-1-9Q';

/** A ticket whose helper wrote `files`, merged by the lead; then the tester runs and has started. */
export async function testerRunning(s: Board, files: Record<string, string>) {
  const st = defaultProjectWorkflow('x', '2026-10-17T09:00:00.000Z').stages;
  st['unit-tests'] = { ...st['unit-tests'], enabled: true };
  const saved = await s.send('put', `/api/projects/${s.project.id}/workflow`, {
    plannerMode: 'lead',
    stages: st,
  });
  expect(saved.status).toBe(200);
  const { ticket, runId, lead } = await approved(s, LEAD_REVIEWS);
  const worker = await helperDone(s, lead, runId, files);
  expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged');
  await lead.callLead('request_review', {});
  await s.settle();
  const tester = s.fake.agents.find((a) => a.spec.kind === 'tester');
  if (tester === undefined) throw new Error('no tester');
  tester.started();
  await s.settle();
  return { ticket, runId, lead, worker, tester };
}

describe('report_test_results through the server (ADR-0038 §1)', () => {
  it('stores the results as test-results comments and shows them on Conversation', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, tester } = await testerRunning(s, {
      'src/theme.ts': 'export const t = 1;\n',
      'fixed.txt': 'ok\n',
    });
    // 50 long failures: longer than one comment body (8,000), so kept whole as parts.
    const failed = Array.from({ length: 50 }, (_, i) => ({
      test: `case ${i} ${CANARY}`,
      file: 'src/theme.test.ts',
      message: `expected ${i} ${'x'.repeat(400)}`,
    }));
    const reply = await tester.callLead('report_test_results', {
      status: 'failed',
      failed,
      summary: `50 of 60 failed. ${CANARY}`,
    });
    expect(reply).toContain('recorded');
    await expect(
      tester.callLead('report_test_results', { status: 'passed', failed: [], summary: 'ok' }),
    ).rejects.toThrow('already reported');
    await s.settle();

    const comments = (await s.detail(ticket.id)).comments.filter((c) => c.kind === 'test-results');
    expect(comments.length).toBeGreaterThan(1);
    for (const c of comments) {
      expect(c.author).toBe('app');
      expect(c.agentRunId).toBe(tester.id);
      expect(c.runId).toBe(runId);
    }
    const joined = comments.map((c) => c.body.replace(/^\(part \d+ of \d+\)\n/, '')).join('\n');
    expect(joined.startsWith('Tests failed: 50 failing tests.')).toBe(true);
    expect(joined).toContain(`- case 49 ${CANARY} (src/theme.test.ts): expected 49`);

    const res = await s.get(`/api/tickets/${ticket.id}/activity`);
    expect(res.status).toBe(200);
    const items = TicketActivityDtoSchema.parse(res.body).items.filter(
      (i) => i.type === 'test-results',
    );
    expect(items).toHaveLength(comments.length);
    expect(items[0]?.actor).toMatchObject({ kind: 'tester', agentRunId: tester.id });
    expect(items[0]?.title).toContain('reported test results');
    expect(items[0]?.link).toEqual({ kind: 'change', agentRunId: tester.id });
  }, 60_000);

  it('adversarial: a helper or the lead calling report_test_results is refused', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, lead, worker } = await testerRunning(s, { 'fixed.txt': 'ok\n' });
    const input = { status: 'passed', failed: [], summary: 'ok' };
    await expect(lead.callLead('report_test_results', input)).rejects.toThrow();
    await expect(worker.callLead('report_test_results', input)).rejects.toThrow();
    await s.settle();
    expect((await s.detail(ticket.id)).comments.some((c) => c.kind === 'test-results')).toBe(false);
  }, 60_000);
});

describe('the failure context through the server (ADR-0038 §2)', () => {
  it('a seal reports the changed paths; failing tests name the helper that changed the file', async () => {
    const s = await setupBoard({ files: FILES });
    const { lead, worker, tester } = await testerRunning(s, {
      'src/theme.ts': 'export const t = 1;\n',
      'fixed.txt': 'ok\n',
    });
    const before = lead.sent.length;
    await tester.callLead('report_test_results', {
      status: 'failed',
      failed: [{ test: 'toggles', file: 'src/theme.test.ts', message: 'expected dark' }],
      summary: '1 failed.',
    });
    await s.settle();
    const notice = lead.sent.slice(before).join('\n');
    expect(notice).toContain('reported failing tests');
    expect(notice).toContain('Likely authors (helpers whose changes touched the failing files):');
    expect(notice).toContain(`(agentId ${worker.id}, node`);
    expect(notice).toContain('> src/theme.ts');
    // ADR-0038 §3: the tester is not sent back; the lead may start a helper to fix it.
    expect(s.fake.agents.filter((a) => a.spec.kind === 'tester')).toHaveLength(1);
    expect(
      await lead.callLead('start_agent', { role: 'Builder', task: 'Fix the theme toggle' }),
    ).toContain('Started agent');
  }, 60_000);
});
