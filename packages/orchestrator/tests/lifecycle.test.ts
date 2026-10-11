import { describe, expect, it } from 'vitest';
import {
  cancelRun,
  checkReviewAction,
  completeCancellation,
  isRunPastDeadline,
  ownerChat,
  recordReview,
  recoverAfterRestart,
  requestPermission,
  requestReview,
  stopAgent,
  timeOutRun,
} from '../src/index.js';
import type { RunState } from '../src/index.js';
import {
  LEAD,
  agentOf,
  event,
  makeCtx,
  newRun,
  ok,
  refused,
  runningRun,
  startWorker,
  statusOf,
} from './helpers.js';

function twoWorkers(): { state: RunState; a: string; b: string } {
  const first = startWorker(runningRun(), 'Builder', 'wa');
  const second = startWorker(first.state, 'Tester', 'wb');
  return { state: second.state, a: first.id, b: second.id };
}

describe('run start and owner chat', () => {
  it('creates a QUEUED run whose lead starts with the first owner message', () => {
    const state = newRun();
    expect(state.run.status).toBe('QUEUED');
    expect(statusOf(state, LEAD)).toBe('QUEUED');
    const chat = ok(ownerChat(state, '  spin up two agents  ', makeCtx(100)));
    expect(chat.effects).toEqual([
      { type: 'chat-message', role: 'owner', text: 'spin up two agents' },
      {
        type: 'start-agent',
        agentRunId: LEAD,
        kind: 'lead',
        role: 'Lead',
        prompt: 'spin up two agents',
      },
    ]);
    expect(statusOf(chat.state, LEAD)).toBe('STARTING');
    const started = ok(
      event(chat.state, LEAD, { type: 'started', providerSessionId: 's1', model: 'm' }),
    );
    expect(started.state.run.status).toBe('RUNNING');
    expect(started.effects).toEqual([
      { type: 'link-session', agentRunId: LEAD, providerSessionId: 's1' },
    ]);
  });

  it('sends later messages to the running lead and stores them as owner chat', () => {
    const chat = ok(ownerChat(runningRun(), 'next', makeCtx(5000)));
    expect(chat.effects).toEqual([
      { type: 'chat-message', role: 'owner', text: 'next' },
      { type: 'send-to-agent', agentRunId: LEAD, text: 'next' },
    ]);
  });

  it('refuses empty chat and chat to a cancelling run', () => {
    expect(refused(ownerChat(runningRun(), '   ', makeCtx()))).toBe('invalid-input');
    const cancelling = ok(cancelRun(runningRun(), makeCtx())).state;
    expect(refused(ownerChat(cancelling, 'hi', makeCtx()))).toBe('run-cancelling');
  });

  it('fails the run when the lead fails before it runs', () => {
    const chat = ok(ownerChat(newRun(), 'go', makeCtx(100))).state;
    const failed = ok(
      event(chat, LEAD, { type: 'finished', outcome: 'error', reportedCostUsd: null }),
    );
    expect(failed.state.run.status).toBe('FAILED');
    expect(failed.state.run.endedAt).toBe('2026-10-11T10:00:01.000Z');
  });
});

describe('agent events', () => {
  it('stores lead text as chat, and drops worker text with a content-free diagnostic', () => {
    const { state, id } = startWorker(runningRun());
    const lead = ok(event(state, LEAD, { type: 'lead-text', text: 'Started two agents.' }));
    expect(lead.effects).toEqual([
      { type: 'chat-message', role: 'lead', text: 'Started two agents.' },
    ]);
    const worker = ok(event(state, id, { type: 'lead-text', text: 'SECRET worker thought' }));
    expect(worker.effects).toEqual([
      { type: 'diagnostic', code: 'worker-text-dropped', agentRunId: id },
    ]);
    expect(JSON.stringify(worker.state)).not.toContain('SECRET');
  });

  it('keeps a redacted, capped activity line', () => {
    const { state, id } = startWorker(runningRun());
    const s = ok(event(state, id, { type: 'activity', summary: 'Used tool: Edit' })).state;
    expect(agentOf(s, id).latestActivity).toBe('Used tool: Edit');
  });

  it('maps finished outcomes and keeps the reported cost as an estimate', () => {
    const { state, a, b } = twoWorkers();
    let s = ok(
      event(state, a, { type: 'finished', outcome: 'success', reportedCostUsd: 0.12 }),
    ).state;
    s = ok(event(s, b, { type: 'finished', outcome: 'cancelled', reportedCostUsd: null })).state;
    expect(statusOf(s, a)).toBe('SUCCEEDED');
    expect(agentOf(s, a).reportedCostUsd).toBe(0.12);
    expect(statusOf(s, b)).toBe('CANCELLED');
    expect(agentOf(s, b).reportedCostUsd).toBeNull();
    expect(agentOf(s, a).review).toBe('pending');
  });

  it('ignores a second finished event and refuses events for unknown agents', () => {
    const { state, id } = startWorker(runningRun());
    const s = ok(
      event(state, id, { type: 'finished', outcome: 'success', reportedCostUsd: null }),
    ).state;
    const again = ok(event(s, id, { type: 'finished', outcome: 'error', reportedCostUsd: null }));
    expect(statusOf(again.state, id)).toBe('SUCCEEDED');
    expect(refused(event(s, 'ghost', { type: 'activity', summary: 'x' }))).toBe('unknown-agent');
  });

  it('never mutates the input state', () => {
    const { state, id } = startWorker(runningRun());
    const before = JSON.stringify(state);
    event(state, id, {
      type: 'usage',
      messageId: 'm',
      tokens: { input: 1, output: 1, cacheCreation: 1, cacheRead: 1 },
    });
    cancelRun(state, makeCtx());
    recoverAfterRestart(state, makeCtx());
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('cancellation (Stop all)', () => {
  it('stops scheduling, denies approvals, aborts workers, then the lead', () => {
    const { state, a, b } = twoWorkers();
    const asked = ok(
      requestPermission(
        state,
        { agentRunId: b, toolName: 'Bash', toolUseId: null, summary: 'Run tests' },
        makeCtx(4000, 'ap'),
      ),
    );
    const cancelled = ok(cancelRun(asked.state, makeCtx(5000)));
    expect(cancelled.state.run.status).toBe('CANCELLING');
    expect(cancelled.effects).toEqual([
      {
        type: 'resolve-permission',
        approvalId: asked.value.id,
        decision: { allow: false, message: 'The agent was stopped; the action was denied.' },
      },
      { type: 'abort-agent', agentRunId: a },
      { type: 'abort-agent', agentRunId: b },
      { type: 'abort-agent', agentRunId: LEAD },
    ]);
    for (const id of [a, b, LEAD]) expect(statusOf(cancelled.state, id)).toBe('CANCELLED');
    expect(refused(cancelRun(cancelled.state, makeCtx()))).toBe('run-cancelling');
    const done = ok(completeCancellation(cancelled.state, makeCtx(9000)));
    expect(done.state.run.status).toBe('CANCELLED');
    expect(done.state.run.endedAt).toBe('2026-10-11T10:00:09.000Z');
  });

  it('refuses completing a cancellation that was never started', () => {
    expect(refused(completeCancellation(runningRun(), makeCtx()))).toBe('illegal-transition');
  });

  it('times out a run past its deadline with TIMED_OUT agents', () => {
    const { state, a } = twoWorkers();
    expect(isRunPastDeadline(state.run, makeCtx(59_999).now, 60_000)).toBe(false);
    expect(isRunPastDeadline(state.run, makeCtx(60_000).now, 60_000)).toBe(true);
    const timed = ok(timeOutRun(state, makeCtx(60_000)));
    expect(timed.state.run.status).toBe('CANCELLING');
    expect(statusOf(timed.state, a)).toBe('TIMED_OUT');
    expect(statusOf(timed.state, LEAD)).toBe('TIMED_OUT');
  });

  it('stops a single worker without touching the others', () => {
    const { state, a, b } = twoWorkers();
    const stopped = ok(stopAgent(state, a, makeCtx(5000)));
    expect(stopped.effects).toEqual([{ type: 'abort-agent', agentRunId: a }]);
    expect(statusOf(stopped.state, a)).toBe('CANCELLED');
    expect(statusOf(stopped.state, b)).toBe('RUNNING');
    expect(refused(stopAgent(stopped.state, a, makeCtx()))).toBe('agent-not-live');
  });
});

describe('review and completion', () => {
  it('refuses review while workers are live', () => {
    expect(refused(requestReview(twoWorkers().state, makeCtx()))).toBe('workers-still-running');
  });

  it('REVIEW when all workers stopped, COMPLETED once each is merged or discarded', () => {
    const { state, a, b } = twoWorkers();
    let s = ok(
      event(state, a, { type: 'finished', outcome: 'success', reportedCostUsd: null }),
    ).state;
    s = ok(event(s, b, { type: 'finished', outcome: 'error', reportedCostUsd: null })).state;
    expect(s.run.status).toBe('RUNNING'); // the lead is still chatting
    expect(checkReviewAction(s, a)?.code).toBe('review-not-allowed');
    s = ok(requestReview(s, makeCtx(6000))).state;
    expect(s.run.status).toBe('REVIEW');
    expect(checkReviewAction(s, a)).toBeNull();
    expect(checkReviewAction(s, LEAD)?.code).toBe('review-not-allowed');

    s = ok(recordReview(s, a, 'merged', makeCtx(7000))).state;
    expect(s.run.status).toBe('REVIEW');
    expect(refused(recordReview(s, a, 'discarded', makeCtx(7500)))).toBe('review-not-allowed');
    const last = ok(recordReview(s, b, 'discarded', makeCtx(8000)));
    expect(last.state.run.status).toBe('COMPLETED');
    // The lead was still waiting for chat; completion stops it.
    expect(last.effects).toEqual([{ type: 'abort-agent', agentRunId: LEAD }]);
    expect(statusOf(last.state, LEAD)).toBe('CANCELLED');
  });

  it('goes to REVIEW by itself when the lead ends and no worker is live', () => {
    const { state, id } = startWorker(runningRun());
    let s = ok(
      event(state, id, { type: 'finished', outcome: 'success', reportedCostUsd: null }),
    ).state;
    s = ok(event(s, LEAD, { type: 'finished', outcome: 'success', reportedCostUsd: null })).state;
    expect(s.run.status).toBe('REVIEW');
    s = ok(recordReview(s, id, 'no-changes', makeCtx())).state;
    expect(s.run.status).toBe('COMPLETED');
  });

  it('fails the run when the lead fails without having started any worker', () => {
    const s = ok(
      event(runningRun(), LEAD, { type: 'finished', outcome: 'error', reportedCostUsd: null }),
    ).state;
    expect(s.run.status).toBe('FAILED');
  });
});

describe('restart', () => {
  it('marks live agents and the run NEEDS_REVIEW and never relaunches', () => {
    const { state, a, b } = twoWorkers();
    const ended = ok(
      event(state, a, { type: 'finished', outcome: 'success', reportedCostUsd: null }),
    ).state;
    const asked = ok(
      requestPermission(
        ended,
        { agentRunId: b, toolName: 'Edit', toolUseId: null, summary: 'Edit x' },
        makeCtx(4000, 'ap'),
      ),
    );
    const recovered = ok(recoverAfterRestart(asked.state, makeCtx(10_000)));
    expect(recovered.effects).toEqual([]); // no start-agent, no abort: processes are gone
    expect(recovered.state.run.status).toBe('NEEDS_REVIEW');
    expect(statusOf(recovered.state, a)).toBe('SUCCEEDED');
    expect(statusOf(recovered.state, b)).toBe('NEEDS_REVIEW');
    expect(statusOf(recovered.state, LEAD)).toBe('NEEDS_REVIEW');
    expect(recovered.state.approvals[0]?.status).toBe('expired');
    expect(refused(ownerChat(recovered.state, 'continue', makeCtx()))).toBe('run-not-active');

    // The owner then reviews what the interrupted workers left.
    let s = ok(recordReview(recovered.state, a, 'merged', makeCtx(11_000))).state;
    expect(s.run.status).toBe('REVIEW');
    s = ok(recordReview(s, b, 'discarded', makeCtx(12_000))).state;
    expect(s.run.status).toBe('COMPLETED');
  });

  it('finishes a cancellation that a restart interrupted', () => {
    const { state, a } = twoWorkers();
    const cancelling = { ...state, run: { ...state.run, status: 'CANCELLING' as const } };
    const recovered = ok(recoverAfterRestart(cancelling, makeCtx()));
    expect(recovered.state.run.status).toBe('CANCELLED');
    expect(statusOf(recovered.state, a)).toBe('CANCELLED');
  });

  it('leaves ended runs alone', () => {
    const cancelled = ok(
      completeCancellation(ok(cancelRun(runningRun(), makeCtx())).state, makeCtx()),
    ).state;
    const recovered = ok(recoverAfterRestart(cancelled, makeCtx()));
    expect(recovered.state.run.status).toBe('CANCELLED');
  });
});
