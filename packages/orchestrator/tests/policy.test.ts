import { MAX_CONCURRENT_CHILD_AGENTS } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  agentDepth,
  cancelRun,
  checkStartAgent,
  createRun,
  leadToolCall,
  requestPermission,
  stopAgent,
} from '../src/index.js';
import type { RunState } from '../src/index.js';
import {
  LEAD,
  PROJECT,
  REGISTERED,
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

/** ADR-0013 guardrails: each refusal is tested, never assumed. */

const startAgent = (state: RunState, caller = LEAD, registered: string[] = REGISTERED) =>
  leadToolCall(
    state,
    {
      callerAgentRunId: caller,
      name: 'start_agent',
      input: { role: 'Extra', task: 'More work' },
      registeredProjectIds: registered,
    },
    makeCtx(5000, 'extra'),
  );

function threeWorkers(): { state: RunState; ids: string[] } {
  let state = runningRun();
  const ids: string[] = [];
  for (let i = 0; i < MAX_CONCURRENT_CHILD_AGENTS; i++) {
    const w = startWorker(state, `Worker ${i}`, `w${i}`);
    state = w.state;
    ids.push(w.id);
  }
  return { state, ids };
}

describe('start_agent policy', () => {
  it('allows up to MAX_CONCURRENT_CHILD_AGENTS workers', () => {
    const { state, ids } = threeWorkers();
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(statusOf(state, id)).toBe('RUNNING');
  });

  it('refuses a 4th live worker with too-many-agents', () => {
    const { state } = threeWorkers();
    expect(refused(startAgent(state))).toBe('too-many-agents');
    expect(checkStartAgent(state, LEAD, REGISTERED)?.code).toBe('too-many-agents');
  });

  it('allows a new worker once one of three has ended', () => {
    const { state, ids } = threeWorkers();
    const after = ok(stopAgent(state, ids[0] ?? '', makeCtx(4000))).state;
    expect(ok(startAgent(after)).value).toMatch(/^Started agent extra-1/);
  });

  it('refuses depth 2: a worker calling start_agent gets depth-exceeded', () => {
    const { state, id } = startWorker(runningRun());
    expect(agentDepth(state, agentOf(state, id))).toBe(1);
    expect(refused(startAgent(state, id))).toBe('depth-exceeded');
    expect(checkStartAgent(state, id, REGISTERED)?.code).toBe('depth-exceeded');
  });

  it('refuses a worker calling any other lead tool with not-lead', () => {
    const { state, id } = startWorker(runningRun());
    const result = leadToolCall(
      state,
      { callerAgentRunId: id, name: 'list_agents', input: {}, registeredProjectIds: REGISTERED },
      makeCtx(),
    );
    expect(refused(result)).toBe('not-lead');
  });

  it('refuses a run for an unregistered project', () => {
    const result = createRun(
      {
        runId: 'r',
        leadAgentRunId: 'l',
        projectId: 'not-registered',
        title: 't',
        registeredProjectIds: REGISTERED,
      },
      makeCtx(),
    );
    expect(refused(result)).toBe('project-not-registered');
  });

  it('refuses start_agent once the project is no longer registered', () => {
    expect(refused(startAgent(runningRun(), LEAD, []))).toBe('project-not-registered');
  });

  it('refuses start_agent in a cancelling run with run-cancelling', () => {
    const cancelling = ok(cancelRun(runningRun(), makeCtx(4000))).state;
    expect(cancelling.run.status).toBe('CANCELLING');
    expect(refused(startAgent(cancelling))).toBe('run-cancelling');
  });

  it('refuses start_agent before the lead runs and after the run is in review', () => {
    let state = runningRun();
    const queued = { ...state, run: { ...state.run, status: 'QUEUED' as const } };
    expect(refused(startAgent(queued))).toBe('run-not-active');
    state = ok(
      leadToolCall(
        state,
        {
          callerAgentRunId: LEAD,
          name: 'request_review',
          input: {},
          registeredProjectIds: REGISTERED,
        },
        makeCtx(),
      ),
    ).state;
    expect(state.run.status).toBe('COMPLETED');
    expect(refused(startAgent(state))).toBe('run-not-active');
  });

  it('refuses start_agent from an over-budget lead', () => {
    let state = runningRun(100);
    state = ok(event(state, LEAD, { type: 'usage', messageId: 'm1', tokens: tokens(200) })).state;
    expect(statusOf(state, LEAD)).toBe('BLOCKED');
    expect(refused(startAgent(state))).toBe('over-budget');
  });

  it('refuses a tool permission for an over-budget agent', () => {
    const started = startWorker(runningRun(100));
    const id = started.id;
    let state = started.state;
    state = ok(event(state, id, { type: 'usage', messageId: 'w-m1', tokens: tokens(150) })).state;
    expect(statusOf(state, id)).toBe('BLOCKED');
    const result = requestPermission(
      state,
      { agentRunId: id, toolName: 'Edit', toolUseId: 't1', summary: 'Edit src/a.ts' },
      makeCtx(5000),
    );
    expect(refused(result)).toBe('over-budget');
  });

  it('refuses message_agent to an over-budget worker', () => {
    const started = startWorker(runningRun(100));
    const id = started.id;
    let state = started.state;
    state = ok(event(state, id, { type: 'usage', messageId: 'w-m1', tokens: tokens(150) })).state;
    const result = leadToolCall(
      state,
      {
        callerAgentRunId: LEAD,
        name: 'message_agent',
        input: { agentId: id, text: 'keep going' },
        registeredProjectIds: REGISTERED,
      },
      makeCtx(),
    );
    expect(refused(result)).toBe('over-budget');
  });

  it('refuses tool permissions while the run is cancelling', () => {
    const { state, id } = startWorker(runningRun());
    const cancelling = ok(cancelRun(state, makeCtx(4000))).state;
    const result = requestPermission(
      cancelling,
      { agentRunId: id, toolName: 'Bash', toolUseId: null, summary: 'Run npm' },
      makeCtx(5000),
    );
    expect(refused(result)).toBe('run-cancelling');
  });

  it('uses the registered project id of the run, not a lookalike', () => {
    expect(refused(startAgent(runningRun(), LEAD, [`${PROJECT}-other`]))).toBe(
      'project-not-registered',
    );
  });
});
