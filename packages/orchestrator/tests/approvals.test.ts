import { APPROVAL_TIMEOUT_MS } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  SUMMARY_MAX_CHARS,
  decideApproval,
  expireApprovals,
  isApprovalOverdue,
  requestPermission,
} from '../src/index.js';
import type { RunState } from '../src/index.js';
import {
  agentOf,
  event,
  makeCtx,
  ok,
  refused,
  runningRun,
  startWorker,
  statusOf,
  tokens,
} from './helpers.js';

/** ADR-0013 §4 approval lifecycle; ADR-0014 budget-raise. */

function ask(state: RunState, agentId: string, summary = 'Edit src/app.ts', offset = 5000) {
  return ok(
    requestPermission(
      state,
      { agentRunId: agentId, toolName: 'Edit', toolUseId: 'tu-1', summary },
      makeCtx(offset, `ap${offset}`),
    ),
  );
}

describe('tool-use approvals', () => {
  it('opens a pending approval and parks the agent; the run is BLOCKED when nobody else works', () => {
    const { state, id } = startWorker(runningRun());
    const asked = ask(state, id);
    expect(asked.value).toMatchObject({
      kind: 'tool-use',
      toolName: 'Edit',
      summary: 'Edit src/app.ts',
      status: 'pending',
    });
    expect(asked.effects).toEqual([{ type: 'approval-requested', approvalId: asked.value.id }]);
    expect(statusOf(asked.state, id)).toBe('WAITING_APPROVAL');
    // The lead still runs, so the run is not blocked.
    expect(asked.state.run.status).toBe('RUNNING');
  });

  it('approve resolves the callback with allow and resumes the agent', () => {
    const { state, id } = startWorker(runningRun());
    const asked = ask(state, id);
    const decided = ok(decideApproval(asked.state, asked.value.id, 'approve', makeCtx(6000)));
    expect(decided.effects).toEqual([
      { type: 'resolve-permission', approvalId: asked.value.id, decision: { allow: true } },
    ]);
    expect(statusOf(decided.state, id)).toBe('RUNNING');
    expect(decided.state.approvals[0]).toMatchObject({
      status: 'approved',
      decidedAt: '2026-10-11T10:00:06.000Z',
    });
  });

  it('deny resolves with a deny result carrying the owner message', () => {
    const { state, id } = startWorker(runningRun());
    const asked = ask(state, id);
    const decided = ok(
      decideApproval(asked.state, asked.value.id, 'deny', makeCtx(6000), {
        message: 'Not that file',
      }),
    );
    expect(decided.effects).toEqual([
      {
        type: 'resolve-permission',
        approvalId: asked.value.id,
        decision: { allow: false, message: 'Not that file' },
      },
    ]);
    expect(statusOf(decided.state, id)).toBe('RUNNING');
  });

  it('keeps the agent waiting until every parallel request is decided', () => {
    const { state, id } = startWorker(runningRun());
    const a1 = ask(state, id, 'Edit a', 5000);
    const a2 = ask(a1.state, id, 'Edit b', 5001);
    const d1 = ok(decideApproval(a2.state, a1.value.id, 'approve', makeCtx(6000)));
    expect(statusOf(d1.state, id)).toBe('WAITING_APPROVAL');
    const d2 = ok(decideApproval(d1.state, a2.value.id, 'deny', makeCtx(6001)));
    expect(statusOf(d2.state, id)).toBe('RUNNING');
  });

  it('refuses a second decision and an unknown approval', () => {
    const { state, id } = startWorker(runningRun());
    const asked = ask(state, id);
    const decided = ok(decideApproval(asked.state, asked.value.id, 'approve', makeCtx(6000)));
    expect(refused(decideApproval(decided.state, asked.value.id, 'deny', makeCtx(7000)))).toBe(
      'approval-not-pending',
    );
    expect(refused(decideApproval(decided.state, 'nope', 'deny', makeCtx(7000)))).toBe(
      'approval-not-found',
    );
  });

  it('times out to deny after APPROVAL_TIMEOUT_MS', () => {
    const { state, id } = startWorker(runningRun());
    const asked = ask(state, id);
    const before = expireApprovals(asked.state, makeCtx(5000 + APPROVAL_TIMEOUT_MS - 1));
    expect(ok(before).value).toBe(0);
    const after = ok(expireApprovals(asked.state, makeCtx(5000 + APPROVAL_TIMEOUT_MS)));
    expect(after.value).toBe(1);
    expect(after.state.approvals[0]?.status).toBe('expired');
    expect(after.effects).toEqual([
      {
        type: 'resolve-permission',
        approvalId: asked.value.id,
        decision: {
          allow: false,
          message: 'No answer from the owner in time; the action was denied.',
        },
      },
    ]);
    expect(statusOf(after.state, id)).toBe('RUNNING');
  });

  it('refuses a late decision on an overdue approval (it already counts as denied)', () => {
    const { state, id } = startWorker(runningRun());
    const asked = ask(state, id);
    const late = makeCtx(5000 + APPROVAL_TIMEOUT_MS + 1);
    expect(isApprovalOverdue(asked.value, late.now)).toBe(true);
    expect(refused(decideApproval(asked.state, asked.value.id, 'approve', late))).toBe(
      'approval-not-pending',
    );
  });

  it('redacts and caps the summary at 200 characters', () => {
    const { state, id } = startWorker(runningRun());
    const secret = 'sk-ant-api03-abcdefghijklmnop1234567890';
    const asked = ask(state, id, `Bash curl -H "x: ${secret}" ${'x'.repeat(400)}`);
    expect(asked.value.summary).not.toContain(secret);
    expect(asked.value.summary.length).toBe(SUMMARY_MAX_CHARS);
    expect(ask(state, id, '   ').value.summary).toBe('Edit');
  });

  it('denies pending requests when the agent is stopped or ends', () => {
    const { state, id } = startWorker(runningRun());
    const asked = ask(state, id);
    const ended = ok(
      event(asked.state, id, { type: 'finished', outcome: 'error', reportedCostUsd: null }, 6000),
    );
    expect(ended.state.approvals[0]?.status).toBe('denied');
    expect(ended.effects[0]).toMatchObject({
      type: 'resolve-permission',
      decision: { allow: false },
    });
    expect(statusOf(ended.state, id)).toBe('FAILED');
  });

  it('refuses a permission request from an agent that has ended', () => {
    const started = startWorker(runningRun());
    const id = started.id;
    let state = started.state;
    state = ok(
      event(state, id, { type: 'finished', outcome: 'success', reportedCostUsd: null }),
    ).state;
    expect(
      refused(
        requestPermission(
          state,
          { agentRunId: id, toolName: 'Write', toolUseId: null, summary: 'Write x' },
          makeCtx(),
        ),
      ),
    ).toBe('agent-not-live');
  });
});

describe('budget-raise approvals', () => {
  function blocked() {
    const started = startWorker(runningRun(100));
    const id = started.id;
    let state = started.state;
    state = ok(
      event(state, id, { type: 'usage', messageId: 'm1', tokens: tokens(110, 0, 0) }),
    ).state;
    const approval = state.approvals.find((a) => a.kind === 'budget-raise');
    if (approval === undefined) throw new Error('no budget approval');
    return { state, id, approvalId: approval.id };
  }

  it('approve raises the cap by the run cap by default and resumes the agent', () => {
    const { state, id, approvalId } = blocked();
    const decided = ok(decideApproval(state, approvalId, 'approve', makeCtx(6000)));
    expect(agentOf(decided.state, id).budgetLimit).toBe(200);
    expect(statusOf(decided.state, id)).toBe('RUNNING');
    expect(decided.effects).toEqual([
      {
        type: 'send-to-agent',
        agentRunId: id,
        text: 'The owner raised your budget. Continue your task.',
      },
    ]);
  });

  it('approve with an explicit cap that is not above usage is refused', () => {
    const { state, approvalId } = blocked();
    expect(
      refused(decideApproval(state, approvalId, 'approve', makeCtx(6000), { newLimit: 110 })),
    ).toBe('invalid-input');
    expect(
      ok(decideApproval(state, approvalId, 'approve', makeCtx(6000), { newLimit: 500 })).state
        .agents[1]?.budgetLimit,
    ).toBe(500);
  });

  it('deny stops the agent', () => {
    const { state, id, approvalId } = blocked();
    const decided = ok(decideApproval(state, approvalId, 'deny', makeCtx(6000)));
    expect(statusOf(decided.state, id)).toBe('CANCELLED');
    expect(decided.effects).toEqual([{ type: 'abort-agent', agentRunId: id }]);
  });

  it('no answer in time stops the agent', () => {
    const { state, id } = blocked();
    const after = ok(expireApprovals(state, makeCtx(1000 + APPROVAL_TIMEOUT_MS + 5000)));
    expect(statusOf(after.state, id)).toBe('CANCELLED');
    expect(after.effects).toEqual([{ type: 'abort-agent', agentRunId: id }]);
  });

  it('blocks an agent that crossed the cap while waiting for a tool decision once it resumes', () => {
    const started = startWorker(runningRun(100));
    const id = started.id;
    let state = started.state;
    const asked = ask(state, id);
    state = ok(
      event(asked.state, id, { type: 'usage', messageId: 'm1', tokens: tokens(150, 0, 0) }, 5500),
    ).state;
    expect(statusOf(state, id)).toBe('WAITING_APPROVAL');
    const decided = ok(decideApproval(state, asked.value.id, 'approve', makeCtx(6000)));
    expect(statusOf(decided.state, id)).toBe('BLOCKED');
    expect(decided.effects.map((e) => e.type)).toEqual([
      'resolve-permission',
      'interrupt-agent',
      'approval-requested',
    ]);
  });

  it('marks the run BLOCKED when every live agent waits for the owner', () => {
    let state = runningRun(100);
    state = ok(
      event(state, 'lead-1', { type: 'usage', messageId: 'm1', tokens: tokens(150, 0, 0) }),
    ).state;
    expect(state.run.status).toBe('BLOCKED');
    const approval = state.approvals[0];
    if (approval === undefined) throw new Error('missing approval');
    state = ok(decideApproval(state, approval.id, 'approve', makeCtx(6000))).state;
    expect(state.run.status).toBe('RUNNING');
  });
});
