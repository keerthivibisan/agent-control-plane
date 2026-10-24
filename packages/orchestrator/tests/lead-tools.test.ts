import { LEAD_TOOL_NAMES } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { BRANCH_RULE_LINE, leadToolCall } from '../src/index.js';
import type { RunState } from '../src/index.js';
import {
  LEAD,
  REGISTERED,
  event,
  makeCtx,
  ok,
  refused,
  runningRun,
  startWorker,
} from './helpers.js';

/** ADR-0012 lead tools, validated by the engine (ADR-0013). */

const call = (state: RunState, name: string, input: unknown, caller = LEAD) =>
  leadToolCall(
    state,
    { callerAgentRunId: caller, name, input, registeredProjectIds: REGISTERED },
    makeCtx(5000, 'n'),
  );

describe('lead tool calls', () => {
  it('refuses names outside LeadToolInputs, including prototype keys', () => {
    expect(refused(call(runningRun(), 'Bash', {}))).toBe('unknown-tool');
    expect(refused(call(runningRun(), 'toString', {}))).toBe('unknown-tool');
    expect(refused(call(runningRun(), 'mcp__acp__start_agent', {}))).toBe('unknown-tool');
  });

  it('validates input with LeadToolInputs and never echoes values', () => {
    const r = call(runningRun(), 'start_agent', { role: '', task: 'SECRET-TASK' });
    expect(refused(r)).toBe('invalid-input');
    if (!r.ok) {
      expect(r.refusal.message).toContain('role');
      expect(r.refusal.message).not.toContain('SECRET-TASK');
    }
    expect(refused(call(runningRun(), 'start_agent', { role: 'x', task: 'y'.repeat(4001) }))).toBe(
      'invalid-input',
    );
    expect(refused(call(runningRun(), 'message_agent', null))).toBe('invalid-input');
  });

  it('every lead tool name is handled', () => {
    for (const name of LEAD_TOOL_NAMES) {
      const r = call(runningRun(), name, {});
      if (!r.ok) expect(r.refusal.code).not.toBe('unknown-tool');
    }
  });

  it('start_agent creates a STARTING worker under the lead with the task as its prompt', () => {
    const r = ok(call(runningRun(), 'start_agent', { role: 'API builder', task: 'Build the API' }));
    expect(r.value).toBe('Started agent n-1 (API builder).');
    const worker = r.state.agents.find((a) => a.id === 'n-1');
    expect(worker).toMatchObject({
      kind: 'worker',
      parentAgentRunId: LEAD,
      role: 'API builder',
      task: 'Build the API',
      status: 'STARTING',
      budgetLimit: 1000,
      budgetTokensUsed: 0,
    });
    expect(r.effects).toEqual([
      {
        type: 'start-agent',
        agentRunId: 'n-1',
        kind: 'worker',
        role: 'API builder',
        prompt: `Build the API\n\n${BRANCH_RULE_LINE}`,
      },
    ]);
  });

  it('start_agent refuses an id collision from the id generator', () => {
    const state = runningRun();
    const r = leadToolCall(
      state,
      {
        callerAgentRunId: LEAD,
        name: 'start_agent',
        input: { role: 'a', task: 'b' },
        registeredProjectIds: REGISTERED,
      },
      { now: new Date(), newId: () => LEAD },
    );
    expect(refused(r)).toBe('duplicate-id');
  });

  it('list_agents and agent_status describe workers without changing state', () => {
    expect(ok(call(runningRun(), 'list_agents', {})).value).toBe('No agents started yet.');
    const started = startWorker(runningRun(), 'Tester');
    const id = started.id;
    let state = started.state;
    state = ok(event(state, id, { type: 'activity', summary: 'Used tool: Read' })).state;
    const list = ok(call(state, 'list_agents', {}));
    expect(list.value).toBe(`- ${id}: Tester, RUNNING`);
    expect(list.state).toBe(state);
    expect(list.effects).toEqual([]);
    expect(ok(call(state, 'agent_status', { agentId: id })).value).toBe(
      'Tester: RUNNING\nBudget: 0 of 1,000 budget tokens\nLatest activity: Used tool: Read',
    );
    expect(refused(call(state, 'agent_status', { agentId: LEAD }))).toBe('unknown-agent');
  });

  it('message_agent sends to a live worker and stores nothing', () => {
    const { state, id } = startWorker(runningRun());
    const r = ok(call(state, 'message_agent', { agentId: id, text: 'also add tests' }));
    expect(r.effects).toEqual([{ type: 'send-to-agent', agentRunId: id, text: 'also add tests' }]);
    expect(JSON.stringify(r.state)).not.toContain('also add tests');
  });

  it('message_agent refuses ended and unknown agents', () => {
    const started = startWorker(runningRun());
    const id = started.id;
    let state = started.state;
    state = ok(
      event(state, id, { type: 'finished', outcome: 'success', reportedCostUsd: null }),
    ).state;
    expect(refused(call(state, 'message_agent', { agentId: id, text: 'x' }))).toBe(
      'agent-not-live',
    );
    expect(refused(call(state, 'message_agent', { agentId: 'ghost', text: 'x' }))).toBe(
      'unknown-agent',
    );
  });

  it('stop_agent aborts a worker; request_review moves to REVIEW once workers stopped', () => {
    const { state, id } = startWorker(runningRun());
    expect(refused(call(state, 'request_review', {}))).toBe('workers-still-running');
    const stopped = ok(call(state, 'stop_agent', { agentId: id }));
    expect(stopped.effects).toEqual([{ type: 'abort-agent', agentRunId: id }]);
    const review = ok(call(stopped.state, 'request_review', {}));
    expect(review.state.run.status).toBe('REVIEW');
  });

  it('refuses calls from an unknown caller', () => {
    expect(refused(call(runningRun(), 'list_agents', {}, 'ghost'))).toBe('unknown-agent');
  });
});
