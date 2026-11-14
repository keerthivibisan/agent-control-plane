import { describe, expect, it } from 'vitest';
import { workflowTemplateV3 } from '@acp/core';
import type { WorkflowEdgeV3, WorkflowGraphV3 } from '@acp/core';
import { putGraph } from './graph-helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, approved, helperDone } from './loop-helpers.js';

/*
 * ADR-0038 §4-§5 (FR-5) through the server: a tester's failing tests go along a When arrow to the
 * Author, a new helper fixes them, the lead is told, and the ticket's Conversation gets a one-line
 * app comment without any failure text; the lead's view_workflow reads the run's workflow. The
 * fake managed adapter plays every agent. Synthetic data only.
 */

const CANARY = 'CANARY-FR-5-7Z';

/** The lead-only template with a tester after the ticket merge and a When arrow to Author. */
function testerGraph(): WorkflowGraphV3 {
  const base = workflowTemplateV3('lead-only');
  const edges: WorkflowEdgeV3[] = base.edges.filter(
    (e) => !(e.type === 'flow' && e.from === 'ticket-merge'),
  );
  edges.push(
    { type: 'test', id: 'test-tester', from: 'ticket-merge', to: 'tester-1' },
    { type: 'flow', id: 'flow-tester-owner', from: 'tester-1', to: 'owner-merge' },
    { type: 'review', id: 'review-tester', from: 'tester-1', to: 'orchestrate' },
    {
      type: 'when',
      id: 'when-tests',
      from: 'tester-1',
      to: 'author',
      on: ['tests-failed'],
      maxRounds: 2,
      label: 'fix it',
    },
  );
  return {
    ...base,
    template: 'custom',
    nodes: [
      ...base.nodes,
      { type: 'agent', id: 'tester-1', label: 'Tester', model: null, skills: [], agent: null },
      { type: 'author', id: 'author', label: 'Author' },
    ],
    edges,
  };
}

describe('failures routed by When arrows through the server (ADR-0038 §4)', () => {
  it('starts the author’s fix, tells the lead and writes a one-line app comment', async () => {
    const s = await setupBoard({ files: FILES });
    await putGraph(s, testerGraph());
    const { ticket, runId, lead } = await approved(s, { reviewer: 'lead' });
    const worker = await helperDone(s, lead, runId, {
      'src/theme.ts': 'export const t = 1;\n',
      'fixed.txt': 'ok\n',
    });
    expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged');
    const words = await lead.callLead('view_workflow', {});
    expect(words).toContain('When tests fail at "Tester"');
    await lead.callLead('request_review', {});
    await s.settle();
    const tester = s.fake.agents.find((a) => a.spec.kind === 'tester');
    if (tester === undefined) throw new Error('no tester');
    tester.started();
    await s.settle();
    const before = lead.sent.length;
    const reply = await tester.callLead('report_test_results', {
      status: 'failed',
      failed: [{ test: `toggles ${CANARY}`, file: 'src/theme.ts', message: 'expected dark' }],
      summary: '1 failed.',
    });
    expect(reply).toContain('sends the failures to a fixer');
    await s.settle();
    const notice = lead.sent.slice(before).join('\n');
    expect(notice).toContain('is fixing it (round 1 of 2, fixId');
    const fixer = s.fake.workers().at(-1);
    expect(fixer?.id).not.toBe(worker.id);
    expect(fixer?.spec.prompt).toContain(`> - toggles ${CANARY} (src/theme.ts): expected dark`);
    const comments = (await s.detail(ticket.id)).comments.filter((c) => c.kind === 'system');
    const line = comments.find((c) => c.body.startsWith('When tests fail'));
    expect(line?.body).toBe(
      'When tests fail at Tester: Builder is fixing it (round 1 of 2). The lead was told.',
    );
    expect(line?.author).toBe('app');
    // No failure text in the app's line.
    expect(comments.some((c) => c.body.includes(CANARY))).toBe(false);
  }, 60_000);
});
