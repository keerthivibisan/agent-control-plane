import { describe, expect, it } from 'vitest';
import { TicketCommentSchema } from '@acp/core';
import { EMPTY_LEDGER, type RunState } from '@acp/orchestrator';
import {
  COMMENT_BODY_MAX,
  RUN_SUMMARY_HEADING,
  composeRunSummary,
  endTrigger,
  isRunSummaryComment,
  mergeLine,
  type ChangeFact,
  type RunSummaryFacts,
} from '../../src/control/run-summary.js';

/**
 * The run summary's layout and triggers (ADR-0024 §3, v0.3.0 S-A). Pure: synthetic facts and
 * hand-built states. The facts' agreement with the database is in board/run-summary.test.ts.
 */

const change = (extra: Partial<ChangeFact> = {}): ChangeFact => ({
  label: 'Frontend helper',
  outcome: 'merged',
  agentEnded: null,
  files: 3,
  additions: 42,
  deletions: 5,
  checks: { passed: 2, failed: [], notRun: [] },
  rework: { lead: 1, reviewer: 1, owner: 0 },
  ...extra,
});

const facts = (extra: Partial<RunSummaryFacts> = {}): RunSummaryFacts => ({
  ticketKey: 'WEB-12',
  headline: 'the lead handed the work over.',
  plan: { version: 2, steps: ['Frontend helper', 'Helpers'] },
  changes: [
    change(),
    change({
      label: 'Helpers',
      outcome: 'discarded',
      files: 1,
      additions: null,
      deletions: null,
      checks: { passed: 1, failed: ['Unit tests'], notRun: ['Lint'] },
      rework: { lead: 0, reviewer: 0, owner: 0 },
    }),
  ],
  ticketBranch: {
    branch: 'acp/WEB-12',
    baseBranch: 'main',
    state: 'open',
    awaitingMerge: true,
    merged: 1,
    tipChecks: { passed: 2, failed: [], notRun: [] },
  },
  tokens: [
    { kind: 'planner', agents: 0, tokens: 0 },
    { kind: 'lead', agents: 1, tokens: 12400 },
    { kind: 'worker', agents: 2, tokens: 48000 },
    { kind: 'reviewer', agents: 2, tokens: 9100 },
    { kind: 'tester', agents: 0, tokens: 0 },
  ],
  note: 'Added the theme toggle and its settings entry. The helpers pool change was discarded as a duplicate. Dark mode for the print view is still missing.',
  ...extra,
});

describe('composeRunSummary', () => {
  it('lays out the facts and the lead’s note as plain text', () => {
    expect(composeRunSummary(facts())).toBe(
      [
        'Run summary',
        'WEB-12: the lead handed the work over.',
        '',
        'Plan v2: 2 steps (Frontend helper, Helpers).',
        '',
        'Changes (2):',
        '- Frontend helper: merged; 3 files, +42 -5 lines; checks passed (2); 2 rework rounds (lead 1, reviewer 1).',
        '- Helpers: discarded; 1 file; checks: 1 of 3 passed; failed: Unit tests; not run: Lint.',
        '',
        'Ticket branch acp/WEB-12 (from main): 1 change merged; waiting for your merge; checks passed on the tip (2).',
        '',
        'Budget tokens: lead 12,400; helpers 48,000 (2 agents); reviewers 9,100 (2 agents).',
        '',
        "Lead's note:",
        'Added the theme toggle and its settings entry. The helpers pool change was discarded as a duplicate. Dark mode for the print view is still missing.',
      ].join('\n'),
    );
  });

  it('has the facts only without a note, and says “updated” on a later handover', () => {
    const body = composeRunSummary(facts({ note: null }), true);
    expect(body.split('\n')[0]).toBe('Run summary (updated)');
    expect(body).not.toContain("Lead's note");
    expect(body.trimEnd().endsWith('(2 agents).')).toBe(true);
  });

  it('says what is unknown or missing instead of inventing it', () => {
    const body = composeRunSummary(
      facts({
        plan: { version: null, steps: null, proposed: 2 },
        changes: [
          change({
            outcome: 'no change',
            agentEnded: 'it failed',
            files: null,
            additions: null,
            deletions: null,
            checks: null,
            rework: { lead: 0, reviewer: 0, owner: 0 },
          }),
        ],
        ticketBranch: null,
        note: null,
      }),
    );
    expect(body).toContain('Plan: none approved (2 versions proposed).');
    expect(body).toContain('- Frontend helper: no change (it failed).');
    expect(body).not.toContain('Ticket branch');
    expect(composeRunSummary(facts({ changes: [] }))).toContain('Changes: none.');
  });

  it('stays within the comment limit, listing how many changes it left out', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      change({ label: `Helper block with a long label number ${i}` }),
    );
    const body = composeRunSummary(facts({ changes: many, note: 'x'.repeat(1500) }));
    expect(body.length).toBeLessThanOrEqual(COMMENT_BODY_MAX);
    expect(body).toMatch(/- …and \d+ more changes\./);
    expect(body.endsWith('x'.repeat(1500))).toBe(true);
    expect(TicketCommentSchema.shape.body.safeParse(body).success).toBe(true);
  });
});

describe('recognising the app’s comments', () => {
  it('knows a run summary by its author and first line', () => {
    const body = composeRunSummary(facts());
    expect(isRunSummaryComment({ author: 'app', body })).toBe(true);
    expect(isRunSummaryComment({ author: 'app', body: composeRunSummary(facts(), true) })).toBe(
      true,
    );
    expect(isRunSummaryComment({ author: 'lead', body })).toBe(false);
    expect(
      isRunSummaryComment({ author: 'app', body: 'Merged acp/WEB-12 into main at abc1234.' }),
    ).toBe(false);
    expect(RUN_SUMMARY_HEADING).toBe('Run summary');
  });

  it('writes the merge line with a short commit, and the tip checks when known', () => {
    const sha = 'abcdef0123456789abcdef0123456789abcdef01';
    expect(mergeLine('acp/WEB-12', 'main', sha)).toBe('Merged acp/WEB-12 into main at abcdef0.');
    expect(
      mergeLine('acp/WEB-12', 'main', sha, { tipChecks: { passed: 2, failed: [], notRun: [] } }),
    ).toBe('Merged acp/WEB-12 into main at abcdef0; checks passed on the tip (2).');
    // Merge anyway says so, never with the owner's reason.
    expect(
      mergeLine('acp/WEB-12', 'main', sha, {
        tipChecks: { passed: 1, failed: ['Unit tests'], notRun: [] },
        anyway: true,
      }),
    ).toBe(
      'Merged acp/WEB-12 into main at abcdef0 (merged anyway, with a reason); checks on the tip: 1 of 2 passed; failed: Unit tests.',
    );
  });

  it('says where the ticket branch stands, never just "open"', () => {
    const tb = (state: 'open' | 'merged' | 'discarded', awaitingMerge: boolean) =>
      composeRunSummary(
        facts({
          ticketBranch: {
            branch: 'acp/WEB-12',
            baseBranch: 'main',
            state,
            awaitingMerge,
            merged: 2,
            tipChecks: null,
          },
        }),
      )
        .split('\n')
        .find((l) => l.startsWith('Ticket branch'));
    expect(tb('open', true)).toBe(
      'Ticket branch acp/WEB-12 (from main): 2 changes merged; waiting for your merge.',
    );
    expect(tb('open', false)).toBe(
      'Ticket branch acp/WEB-12 (from main): 2 changes merged; not merged.',
    );
    expect(tb('merged', false)).toBe(
      'Ticket branch acp/WEB-12 (from main): 2 changes merged; merged into main.',
    );
    expect(tb('discarded', false)).toBe(
      'Ticket branch acp/WEB-12 (from main): 2 changes merged; discarded.',
    );
    for (const state of ['open', 'merged', 'discarded'] as const) {
      expect(tb(state, state === 'open')).not.toMatch(/: open\b|; open\b/);
    }
  });
});

describe('endTrigger', () => {
  const T = '2026-10-21T09:00:00.000Z';
  const st = (
    status: RunState['run']['status'],
    extra: Partial<RunState> = {},
    ticketId: string | null = 't1',
  ): RunState => ({
    run: {
      id: 'r1',
      projectId: 'p1',
      ticketId,
      title: 'x',
      status,
      budget: { maxTokensPerAgent: 1000, softCostUsdPerRun: null },
      createdAt: T,
      updatedAt: T,
      endedAt: null,
    },
    agents: [],
    approvals: [],
    ledger: EMPTY_LEDGER,
    ...extra,
  });
  const loop = (handedOver: boolean) => ({
    integration: {
      reviewer: 'lead' as const,
      maxReworkRounds: 1,
      handedOver,
      ticketKey: 'WEB-12',
      ticketBranch: 'acp/WEB-12',
    },
  });

  it('asks for a facts-only summary when a run fails or is stopped', () => {
    expect(endTrigger(st('RUNNING'), st('FAILED'))).toEqual({ kind: 'ended', outcome: 'failed' });
    expect(endTrigger(st('PLANNING'), st('FAILED'))).toEqual({ kind: 'ended', outcome: 'failed' });
    expect(endTrigger(st('CANCELLING'), st('CANCELLED'))).toEqual({
      kind: 'ended',
      outcome: 'stopped',
    });
  });

  it('asks for the legacy review summary, and for a loop run only without a handover', () => {
    expect(endTrigger(st('RUNNING'), st('REVIEW'))).toEqual({ kind: 'review' });
    expect(endTrigger(st('RUNNING'), st('COMPLETED'))).toEqual({ kind: 'review' });
    expect(endTrigger(st('RUNNING', loop(false)), st('REVIEW', loop(false)))).toEqual({
      kind: 'ended',
      outcome: 'lead-ended',
    });
    expect(endTrigger(st('RUNNING', loop(true)), st('REVIEW', loop(true)))).toBeNull();
  });

  it('asks for nothing on other moves, or for a run without a ticket', () => {
    expect(endTrigger(st('RUNNING'), st('RUNNING'))).toBeNull();
    expect(endTrigger(st('RUNNING'), st('NEEDS_REVIEW'))).toBeNull();
    // The owner's first decision after a restart, and the owner's final merge.
    expect(endTrigger(st('NEEDS_REVIEW'), st('REVIEW'))).toBeNull();
    expect(endTrigger(st('REVIEW', loop(true)), st('COMPLETED', loop(true)))).toBeNull();
    expect(endTrigger(st('RUNNING', {}, null), st('FAILED', {}, null))).toBeNull();
  });
});
