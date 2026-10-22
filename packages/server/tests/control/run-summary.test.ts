import { describe, expect, it } from 'vitest';
import { TicketCommentSchema } from '@acp/core';
import { EMPTY_LEDGER, type RunState } from '@acp/orchestrator';
import {
  COMMENT_BODY_MAX,
  RUN_SUMMARY_DETAILS_HEADING,
  RUN_SUMMARY_HEADING,
  RUN_SUMMARY_NOTE_HEADING,
  composeRunSummary,
  endTrigger,
  isRunSummaryComment,
  mergeLine,
  type ChangeFact,
  type CheckTally,
  type RunSummaryFacts,
} from '../../src/control/run-summary.js';

/**
 * The run summary's layout and triggers (ADR-0024 §3, v0.3.0 S-A, layout by S-C). Pure: synthetic
 * facts and hand-built states. The facts' agreement with the database is in
 * board/run-summary.test.ts.
 */

const NOTE =
  'Explored the settings code and found the theme is set in theme-store.ts. Added a dark mode switch on the Settings page. Tested it with three unit tests; all checks pass. Not done: the print view still uses the light colours.';

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
  opening: 'The lead handed the work over without a note.',
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
  note: NOTE,
  ...extra,
});

const DETAILS = [
  'Details:',
  '- Plan v2 was approved with 2 steps: Frontend helper and Helpers.',
  '- Merged 1 change from Frontend helper: 3 files, 42 lines added and 5 removed; both checks passed; 2 rework rounds, asked for by the lead (1) and the reviewer (1).',
  '- Discarded 1 change from Helpers: 1 file; 1 of 3 checks passed (failed: Unit tests; not run: Lint).',
  '- The ticket branch acp/WEB-12 (from main) has 1 change merged and is waiting for your merge; checks passed on the tip (2).',
  '- Budget tokens used: 12,400 by the lead, 48,000 by 2 helpers and 9,100 by 2 reviewers.',
];

/** The line of the details that starts with `prefix`. */
const detail = (body: string, prefix: string) =>
  body.split('\n').find((l) => l.startsWith(`- ${prefix}`));

describe('composeRunSummary', () => {
  it('puts the lead’s note first, as the comment, and the facts under Details', () => {
    expect(composeRunSummary(facts())).toBe(
      ['Run summary', '', 'From the lead:', NOTE, '', ...DETAILS].join('\n'),
    );
    expect(RUN_SUMMARY_NOTE_HEADING).toBe('From the lead:');
    expect(RUN_SUMMARY_DETAILS_HEADING).toBe('Details:');
  });

  it('opens with one plain sentence without a note, and says “updated” on a later handover', () => {
    const body = composeRunSummary(facts({ note: null }), true);
    expect(body).toBe(
      [
        'Run summary (updated)',
        '',
        'The lead handed the work over without a note.',
        '',
        ...DETAILS,
      ].join('\n'),
    );
    expect(body).not.toContain(RUN_SUMMARY_NOTE_HEADING);
  });

  it.each([
    'The run failed before the work was handed over.',
    'The run was stopped before the work was handed over.',
    'The run timed out before the work was handed over.',
    'The lead failed before handing the work over.',
    'The lead ended without handing the work over.',
    'The agents finished, and their changes are waiting for your review.',
  ])('opens a summary without a note with “%s”', (opening) => {
    const body = composeRunSummary(facts({ note: null, opening }));
    expect(body.split('\n').slice(0, 4)).toEqual(['Run summary', '', opening, '']);
    expect(body.split('\n')[4]).toBe('Details:');
  });

  it('ignores the opening sentence when the lead left a note', () => {
    const body = composeRunSummary(facts({ opening: 'UNUSED-OPENING' }));
    expect(body).not.toContain('UNUSED-OPENING');
  });

  it('words every fact as a short plain sentence', () => {
    const one = (c: Partial<ChangeFact>) =>
      composeRunSummary(facts({ changes: [change(c)] }))
        .split('\n')
        .find((l) => l.includes('Frontend helper') && !l.startsWith('- Plan'));
    const none = { lead: 0, reviewer: 0, owner: 0 };
    // The owner's example: lines added only, and the checks in words.
    expect(
      one({
        files: 2,
        additions: 18,
        deletions: 0,
        checks: { passed: 1, failed: [], notRun: [] },
        rework: none,
      }),
    ).toBe('- Merged 1 change from Frontend helper: 2 files, 18 lines added; the check passed.');
    expect(
      one({
        additions: 0,
        deletions: 1,
        checks: { passed: 3, failed: [], notRun: [] },
        rework: { lead: 0, reviewer: 2, owner: 0 },
      }),
    ).toBe(
      '- Merged 1 change from Frontend helper: 3 files, 1 line removed; all 3 checks passed; 2 rework rounds, asked for by the reviewer.',
    );
    expect(
      one({
        outcome: 'waiting-for-you',
        additions: 0,
        deletions: 0,
        checks: { passed: 0, failed: ['Unit tests'], notRun: [] },
        rework: { lead: 0, reviewer: 0, owner: 1 },
      }),
    ).toBe(
      '- 1 change from Frontend helper is waiting for your decision: 3 files; 0 of 1 check passed (failed: Unit tests); 1 rework round, asked for by you.',
    );
    expect(one({ outcome: 'in-review', files: null, checks: null, rework: none })).toBe(
      '- 1 change from Frontend helper is still in review.',
    );
    expect(one({ outcome: 'in-rework', files: null, checks: null, rework: none })).toBe(
      '- 1 change from Frontend helper is back in rework.',
    );
    expect(
      one({ outcome: 'waiting-for-review', files: 1, additions: 2, deletions: 0, checks: null }),
    ).toBe(
      '- 1 change from Frontend helper is waiting for your review: 1 file, 2 lines added; 2 rework rounds, asked for by the lead (1) and the reviewer (1).',
    );
    expect(one({ outcome: 'no-changes', files: null, checks: null, rework: none })).toBe(
      '- Frontend helper finished with no changes.',
    );
    expect(
      one({ outcome: 'merged', agentEnded: 'stopped', files: null, checks: null, rework: none }),
    ).toBe('- Merged 1 change from Frontend helper; it was stopped.');
    // Never log-like fragments.
    const body = composeRunSummary(facts());
    expect(body).not.toMatch(/\+\d+ -\d+|checks passed \(\d+\)\.|Budget tokens:|Changes \(/);
  });

  it('words the plan, the ticket branch and the tokens as sentences', () => {
    const tokens = composeRunSummary(
      facts({
        tokens: [
          { kind: 'planner', agents: 1, tokens: 900 },
          { kind: 'lead', agents: 1, tokens: 1540 },
          { kind: 'worker', agents: 1, tokens: 0 },
          { kind: 'reviewer', agents: 1, tokens: 300 },
          { kind: 'tester', agents: 2, tokens: 70 },
        ],
      }),
    );
    expect(detail(tokens, 'Budget')).toBe(
      '- Budget tokens used: 900 by the planner, 1,540 by the lead, 0 by 1 helper, 300 by 1 reviewer and 70 by 2 testers.',
    );
    expect(
      detail(composeRunSummary(facts({ plan: { version: 1, steps: ['Helpers'] } })), 'Plan'),
    ).toBe('- Plan v1 was approved with 1 step: Helpers.');
    expect(
      detail(composeRunSummary(facts({ plan: { version: 3, steps: ['A', 'B', 'C'] } })), 'Plan'),
    ).toBe('- Plan v3 was approved with 3 steps: A, B and C.');
    expect(detail(composeRunSummary(facts({ plan: { version: 1, steps: [] } })), 'Plan')).toBe(
      '- Plan v1 was approved with no steps.',
    );
  });

  it('says what is unknown or missing instead of inventing it', () => {
    const body = composeRunSummary(
      facts({
        plan: { version: null, steps: null, proposed: 2 },
        changes: [
          change({
            outcome: 'none',
            agentEnded: 'failed',
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
    expect(body).toContain('- No plan was approved; 2 versions were proposed.');
    expect(body).toContain('- There is no change from Frontend helper; it failed.');
    expect(body).not.toContain('ticket branch');
    expect(
      composeRunSummary(facts({ plan: { version: null, steps: null, proposed: 1 } })),
    ).toContain('- No plan was approved; 1 version was proposed.');
    expect(composeRunSummary(facts({ changes: [] }))).toContain('- No helpers were started.');
    const noTokens = composeRunSummary(facts({ tokens: [{ kind: 'lead', agents: 0, tokens: 0 }] }));
    expect(noTokens).not.toContain('Budget tokens');
  });

  it('stays within the comment limit, listing how many changes it left out', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      change({ label: `Helper block with a long label number ${i}` }),
    );
    const note = 'x'.repeat(1500);
    const body = composeRunSummary(facts({ changes: many, note }));
    expect(body.length).toBeLessThanOrEqual(COMMENT_BODY_MAX);
    expect(body).toMatch(/- …and \d+ more changes\./);
    // The note is kept whole, before the details.
    expect(body).toContain(`From the lead:\n${note}\n\nDetails:\n`);
    expect(TicketCommentSchema.shape.body.safeParse(body).success).toBe(true);
  });

  it('keeps a note that itself has a “Details:” line before the app’s own Details line', () => {
    const note = 'Added the switch.\nDetails:\nSee the plan.';
    const body = composeRunSummary(facts({ note }));
    expect(body.startsWith(`Run summary\n\nFrom the lead:\n${note}\n\nDetails:\n- Plan v2`)).toBe(
      true,
    );
    // The app's Details line is the last one: the facts never contain another.
    const lines = body.split('\n');
    expect(lines.slice(lines.lastIndexOf('Details:') + 1).every((l) => l.startsWith('- '))).toBe(
      true,
    );
  });
});

describe('recognising the app’s comments', () => {
  it('knows a run summary by its author and first line', () => {
    const body = composeRunSummary(facts());
    expect(isRunSummaryComment({ author: 'app', body })).toBe(true);
    expect(isRunSummaryComment({ author: 'app', body: composeRunSummary(facts(), true) })).toBe(
      true,
    );
    expect(
      isRunSummaryComment({ author: 'app', body: composeRunSummary(facts({ note: null })) }),
    ).toBe(true);
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
    const tb = (
      state: 'open' | 'merged' | 'discarded',
      awaitingMerge: boolean,
      merged = 2,
      tipChecks: CheckTally | null = null,
    ) =>
      detail(
        composeRunSummary(
          facts({
            ticketBranch: {
              branch: 'acp/WEB-12',
              baseBranch: 'main',
              state,
              awaitingMerge,
              merged,
              tipChecks,
            },
          }),
        ),
        'The ticket branch',
      );
    expect(tb('open', true)).toBe(
      '- The ticket branch acp/WEB-12 (from main) has 2 changes merged and is waiting for your merge.',
    );
    expect(tb('open', false)).toBe(
      '- The ticket branch acp/WEB-12 (from main) has 2 changes merged and was not merged.',
    );
    expect(tb('merged', false)).toBe(
      '- The ticket branch acp/WEB-12 (from main) has 2 changes merged and was merged into main.',
    );
    expect(tb('discarded', false, 0)).toBe(
      '- The ticket branch acp/WEB-12 (from main) has no changes merged and was discarded.',
    );
    // S-A2: the tip checks, as in the merge line.
    expect(tb('open', true, 1, { passed: 0, failed: ['Unit tests'], notRun: [] })).toBe(
      '- The ticket branch acp/WEB-12 (from main) has 1 change merged and is waiting for your merge; checks on the tip: 0 of 1 passed; failed: Unit tests.',
    );
    for (const state of ['open', 'merged', 'discarded'] as const) {
      expect(tb(state, state === 'open')).not.toMatch(/\bopen\b/);
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
