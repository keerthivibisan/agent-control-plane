import { redact } from '@acp/core';
import type { LeadToolInputs } from '@acp/core';
import type { z } from 'zod';
import { applyCommand } from './commands.js';
import { refusal } from './errors.js';
import { renderFailureContext, testsFailedContext } from './failure-context.js';
import { notifyLead } from './loop.js';
import { TESTER_FAILURE_LINE } from './check-blocks.js';
import { reopenForFix } from './fix-turn.js';
import { routeFailure } from './failure-router.js';
import type { RouteOutcome } from './failure-router.js';
import { stageOf } from './stages.js';
import type {
  EngineAgent,
  EngineContext,
  EngineResult,
  EngineTestResults,
  RunState,
} from './state.js';
import { isLiveAgentStatus } from './transitions.js';

/**
 * The tester's structured test results (ADR-0038 §1): `report_test_results` keeps the status, the
 * failing tests and the summary in `testResultsByAgent` (for the failure context, FR-2) and emits
 * `record-test-results`, which the server stores as ticket comments of kind `test-results` (text
 * written for the ticket, like review findings, ADR-0021 §6). Once per tester turn: a rework turn
 * may report again, and its results replace the earlier ones. The input is validated with
 * `LeadToolInputs.report_test_results` in `leadToolCall`.
 */

/**
 * The tester's turn: 0 for its first, then one more for each rework (by the lead, the owner, a
 * reviewer, or its Checks block, which counts its own rounds apart from the review's).
 */
export function testTurnOf(agent: Pick<EngineAgent, 'change'>): number {
  return (agent.change?.round ?? 0) + (agent.change?.checkRounds ?? 0);
}

function clean(text: string): string {
  return redact(text).trim();
}

/** The comment text: a status line, the summary, then one line per failing test. */
export function testResultsText(
  results: Pick<EngineTestResults, 'status' | 'failed' | 'summary'>,
): string {
  const n = results.failed.length;
  const head =
    results.status === 'passed'
      ? 'Tests passed.'
      : `Tests failed: ${n} failing test${n === 1 ? '' : 's'}.`;
  const lines = results.failed.map(
    (f) =>
      `- ${oneLine(f.test)}${f.file === undefined ? '' : ` (${f.file})`}: ${oneLine(f.message)}`,
  );
  return [
    head,
    `Summary:\n${results.summary}`,
    ...(n > 0 ? [`Failing tests:\n${lines.join('\n')}`] : []),
  ].join('\n\n');
}

/** Line breaks and runs of white space become one space, so each test stays on its own line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A tester's `report_test_results`: allowed while it is live in a ticket run that is not being
 * stopped, once per turn. Emits `record-test-results`.
 */
export function reportTestResults(
  state: RunState,
  callerAgentRunId: string,
  input: z.infer<(typeof LeadToolInputs)['report_test_results']>,
  ctx: EngineContext,
): EngineResult<string> {
  return applyCommand(state, ctx, (d) => {
    const agent = d.agent(callerAgentRunId);
    if (agent === undefined || agent.kind !== 'tester') {
      return refusal('not-lead', 'Only the tester reports test results.');
    }
    const ticketId = d.run.ticketId;
    if (ticketId === null) {
      return refusal('invalid-input', 'This run has no ticket to report to.');
    }
    if (d.run.status === 'CANCELLING' || d.run.status === 'CANCELLED') {
      return refusal('run-cancelling', 'The run is being stopped.');
    }
    if (!isLiveAgentStatus(agent.status) || agent.status === 'AWAITING_REVIEW') {
      return refusal('agent-not-live', 'Your turn is over.');
    }
    const turn = testTurnOf(agent);
    if (d.testResultsByAgent?.[agent.id]?.turn === turn) {
      return refusal(
        'invalid-input',
        'You already reported your test results this turn. Call report_work, then end your turn.',
      );
    }
    const results: EngineTestResults = {
      status: input.status,
      failed: input.failed.map((f) => ({
        test: clean(f.test),
        ...(f.file !== undefined ? { file: f.file } : {}),
        message: clean(f.message),
      })),
      summary: clean(input.summary),
      turn,
    };
    d.testResultsByAgent = { ...(d.testResultsByAgent ?? {}), [agent.id]: results };
    d.effects.push({
      type: 'record-test-results',
      agentRunId: agent.id,
      ticketId,
      runId: d.run.id,
      status: results.status,
      text: testResultsText(results),
    });
    // ADR-0038 §2: the lead always gets a failure with its context (the likely authors).
    // ADR-0038 §4 (FR-5): a When arrow from the tester routes it (a fix turn, or the lead);
    // without one the lead decides who fixes them (§3); the handover is undone so it can start a
    // helper for the fix.
    let routed: RouteOutcome = { kind: 'none' };
    if (results.status === 'failed') {
      const context = testsFailedContext(d, agent, results.failed);
      routed = routeFailure(d, {
        context,
        sourceNodeId: stageOf(agent),
        change: agent,
        lineage: agent.id,
        headline: `${agent.role} (agentId ${agent.id}) reported failing tests.`,
        decideLine: TESTER_FAILURE_LINE,
      });
      if (routed.kind !== 'fixing') reopenForFix(d);
      if (routed.kind === 'none') {
        notifyLead(d, testsFailedNotice(agent, renderFailureContext(context)));
      }
    }
    if (routed.kind === 'fixing') {
      return {
        value:
          'Your test results are recorded. This workflow sends the failures to a fixer, and the lead is told. Do not change product code. Call report_work, then end your turn.',
      };
    }
    return {
      value:
        results.status === 'passed'
          ? 'Your test results are recorded. Call report_work, then end your turn.'
          : 'Your test results are recorded and go to the lead, who decides who fixes the failures. Do not change product code. Call report_work, then end your turn.',
    };
  });
}

/** The lead's notice of a tester's failing tests (ADR-0038 §2, §3). */
function testsFailedNotice(tester: EngineAgent, context: string): string {
  return [
    `${tester.role} (agentId ${tester.id}) reported failing tests. You decide who fixes them, for example the likely author below.`,
    context,
    TESTER_FAILURE_LINE,
  ].join('\n\n');
}
