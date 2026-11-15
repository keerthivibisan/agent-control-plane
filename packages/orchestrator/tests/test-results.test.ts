// Synthetic data only. ADR-0038 §1 (FR-1): the tester's structured test results.
import { describe, expect, it } from 'vitest';
import type { RunState } from '../src/index.js';
import {
  TEST_RESULTS_LINE,
  agentEvent,
  cancelRun,
  controlToolsFor,
  testResultsText,
} from '../src/index.js';
import { LEAD, agentOf, makeCtx, ok, refused } from './helpers.js';
import { A, effectsOf, leadTool, mergedA } from './loop-helpers.js';
import { workflow } from './workflow-helpers.js';

const TESTS_ONLY = workflow({ unitTests: true });
const TESTER = 'h-1';

/** Helper A merged, the lead handed over, and the tester `h-1` is working on the ticket branch. */
function testing(): RunState {
  let s = mergedA({ workflow: TESTS_ONLY });
  s = ok(leadTool(s, 'request_review', {}, 'h')).state;
  expect(agentOf(s, TESTER)).toMatchObject({ kind: 'tester', status: 'STARTING' });
  return ok(
    agentEvent(
      s,
      TESTER,
      { type: 'started', providerSessionId: 'sess-t', model: null },
      makeCtx(9000),
    ),
  ).state;
}

const FAILED = {
  status: 'failed',
  failed: [
    { test: 'dark mode toggles', file: 'src/theme.test.ts', message: 'expected dark\ngot light' },
  ],
  summary: '1 of 4 tests failed.',
};
const PASSED = { status: 'passed', failed: [], summary: 'All 4 tests passed.' };

describe('report_test_results (ADR-0038 §1)', () => {
  it('is the tester’s own tool in a ticket run; nobody else gets it', () => {
    const s = testing();
    expect(controlToolsFor(s, TESTER)).toEqual([
      'report_test_results',
      'report_work',
      'ask_lead',
      'code_map',
    ]);
    expect(controlToolsFor(s, LEAD)).not.toContain('report_test_results');
    expect(controlToolsFor(s, A)).not.toContain('report_test_results');
    expect(refused(leadTool(s, 'report_test_results', PASSED))).toBe('not-lead');
    expect(refused(leadTool(s, 'report_test_results', PASSED, 'x', A))).toBe('not-lead');
  });

  it('records the results as an effect and in engine state; the comment text lists each failure', () => {
    const s = testing();
    const r = ok(leadTool(s, 'report_test_results', FAILED, 'tr', TESTER));
    const recorded = effectsOf(r.effects, 'record-test-results');
    expect(recorded).toEqual([
      {
        type: 'record-test-results',
        agentRunId: TESTER,
        ticketId: s.run.ticketId,
        runId: s.run.id,
        status: 'failed',
        text: [
          'Tests failed: 1 failing test.',
          'Summary:\n1 of 4 tests failed.',
          'Failing tests:\n- dark mode toggles (src/theme.test.ts): expected dark got light',
        ].join('\n\n'),
      },
    ]);
    expect(r.state.testResultsByAgent?.[TESTER]).toMatchObject({
      status: 'failed',
      summary: '1 of 4 tests failed.',
      turn: 0,
    });
    expect(r.value).toContain('Do not change product code');
    expect(r.state.run.status).toBe(s.run.status);
  });

  it('passed results have no failure list', () => {
    expect(testResultsText({ status: 'passed', failed: [], summary: 'ok' })).toBe(
      'Tests passed.\n\nSummary:\nok',
    );
    const r = ok(leadTool(testing(), 'report_test_results', PASSED, 'tr', TESTER));
    expect(effectsOf(r.effects, 'record-test-results')[0]?.status).toBe('passed');
  });

  it('redacts secrets in the test names, messages and summary', () => {
    const secret = 'sk-ant-abcdefghijklmnop0123456789';
    const r = ok(
      leadTool(
        testing(),
        'report_test_results',
        {
          status: 'failed',
          failed: [{ test: `uses ${secret}`, message: `token ${secret}` }],
          summary: `key ${secret}`,
        },
        'tr',
        TESTER,
      ),
    );
    expect(JSON.stringify(r.effects)).not.toContain(secret);
    expect(JSON.stringify(r.state.testResultsByAgent)).not.toContain(secret);
  });

  it('refuses invalid input: failures when passed, none when failed, a path outside the repo', () => {
    const s = testing();
    const call = (input: unknown) =>
      refused(leadTool(s, 'report_test_results', input, 'x', TESTER));
    expect(call({ ...PASSED, failed: FAILED.failed })).toBe('invalid-input');
    expect(call({ ...FAILED, failed: [] })).toBe('invalid-input');
    expect(
      call({ ...FAILED, failed: [{ test: 't', file: '../../etc/passwd', message: 'm' }] }),
    ).toBe('invalid-input');
    expect(call({ ...FAILED, failed: Array.from({ length: 51 }, () => FAILED.failed[0]) })).toBe(
      'invalid-input',
    );
    expect(call({ status: 'failed' })).toBe('invalid-input');
  });

  it('once per turn; refused after the turn and while the run stops', () => {
    const s = ok(leadTool(testing(), 'report_test_results', FAILED, 'tr', TESTER)).state;
    expect(refused(leadTool(s, 'report_test_results', PASSED, 'x', TESTER))).toBe('invalid-input');
    const ended = ok(
      agentEvent(
        testing(),
        TESTER,
        { type: 'finished', outcome: 'success', reportedCostUsd: null },
        makeCtx(10_000),
      ),
    ).state;
    expect(refused(leadTool(ended, 'report_test_results', PASSED, 'x', TESTER))).toBe(
      'agent-not-live',
    );
    const stopping = ok(cancelRun(testing(), makeCtx(10_000))).state;
    expect(refused(leadTool(stopping, 'report_test_results', PASSED, 'x', TESTER))).toMatch(
      /^(run-cancelling|agent-not-live)$/,
    );
  });

  it('the tester’s brief asks for one report_test_results call and no product-code fix', () => {
    const r = ok(leadTool(mergedA({ workflow: TESTS_ONLY }), 'request_review', {}, 'h'));
    const start = effectsOf(r.effects, 'start-agent').find((e) => e.agentRunId === TESTER);
    expect(start?.prompt).toContain(TEST_RESULTS_LINE);
    expect(start?.prompt).toContain('report_test_results once');
    expect(start?.prompt).not.toContain('say so in your final message');
  });
});
