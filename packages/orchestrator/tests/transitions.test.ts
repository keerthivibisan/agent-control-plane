import { AgentRunStatusSchema, RunStatusSchema } from '@acp/core';
import type { AgentRunStatus, RunStatus } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  AGENT_TRANSITIONS,
  IllegalTransitionError,
  RUN_TRANSITIONS,
  TERMINAL_AGENT_STATUSES,
  TERMINAL_RUN_STATUSES,
  assertAgentTransition,
  assertRunTransition,
  canTransitionAgent,
  canTransitionRun,
  isLiveAgentStatus,
  isTerminalRunStatus,
} from '../src/index.js';

/** The M1 tables as specified (orchestration-lifecycle §0), written out independently of src. */
const EXPECTED_RUN: Record<RunStatus, RunStatus[]> = {
  QUEUED: ['PLANNING', 'RUNNING', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  PLANNING: ['PLAN_REVIEW', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  PLAN_REVIEW: ['PLANNING', 'RUNNING', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  RUNNING: ['BLOCKED', 'REVIEW', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  BLOCKED: ['RUNNING', 'REVIEW', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  // ADR-0021: REVIEW → RUNNING for the owner's "request changes" on the ticket branch.
  REVIEW: ['COMPLETED', 'RUNNING', 'CANCELLING'],
  NEEDS_REVIEW: ['REVIEW', 'CANCELLING'],
  CANCELLING: ['CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

const EXPECTED_AGENT: Record<AgentRunStatus, AgentRunStatus[]> = {
  QUEUED: ['STARTING', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW'],
  // ADR-0021: a helper's or tester's turn that ends goes to AWAITING_REVIEW in a loop run.
  STARTING: [
    'RUNNING',
    'AWAITING_REVIEW',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'NEEDS_REVIEW',
  ],
  RUNNING: [
    'WAITING_APPROVAL',
    'BLOCKED',
    'AWAITING_REVIEW',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'NEEDS_REVIEW',
  ],
  WAITING_APPROVAL: ['RUNNING', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'NEEDS_REVIEW'],
  BLOCKED: [
    'RUNNING',
    'AWAITING_REVIEW',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
    'NEEDS_REVIEW',
  ],
  // ADR-0021: rework → STARTING; merged → SUCCEEDED; discarded / Stop all → CANCELLED; restart.
  AWAITING_REVIEW: ['STARTING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  TIMED_OUT: [],
  NEEDS_REVIEW: [],
};

const RUN_STATUSES = RunStatusSchema.options;
const AGENT_STATUSES = AgentRunStatusSchema.options;

describe('run transition table', () => {
  it('covers every run status from the contract', () => {
    expect(Object.keys(RUN_TRANSITIONS).sort()).toEqual([...RUN_STATUSES].sort());
  });

  for (const from of RUN_STATUSES) {
    for (const to of RUN_STATUSES) {
      const allowed = EXPECTED_RUN[from].includes(to);
      it(`${from} -> ${to} is ${allowed ? 'allowed' : 'rejected'}`, () => {
        expect(canTransitionRun(from, to)).toBe(allowed);
        if (allowed) expect(() => assertRunTransition(from, to)).not.toThrow();
        else expect(() => assertRunTransition(from, to)).toThrow(IllegalTransitionError);
      });
    }
  }

  it('has COMPLETED, FAILED and CANCELLED as the only terminal states (no "completed" shortcut)', () => {
    expect([...TERMINAL_RUN_STATUSES].sort()).toEqual(['CANCELLED', 'COMPLETED', 'FAILED']);
    expect(isTerminalRunStatus('REVIEW')).toBe(false);
  });

  it('reaches COMPLETED only through REVIEW', () => {
    const into = RUN_STATUSES.filter((s) => canTransitionRun(s, 'COMPLETED'));
    expect(into).toEqual(['REVIEW']);
  });

  it('lets every live run state be cancelled or marked NEEDS_REVIEW after a restart', () => {
    for (const s of ['QUEUED', 'PLANNING', 'PLAN_REVIEW', 'RUNNING', 'BLOCKED'] as const) {
      expect(canTransitionRun(s, 'CANCELLING')).toBe(true);
      expect(canTransitionRun(s, 'NEEDS_REVIEW')).toBe(true);
    }
  });

  it('names the illegal edge in the error', () => {
    try {
      assertRunTransition('COMPLETED', 'RUNNING');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalTransitionError);
      expect((e as IllegalTransitionError).code).toBe('illegal-transition');
      expect((e as IllegalTransitionError).message).toBe(
        'illegal run transition COMPLETED -> RUNNING',
      );
    }
  });
});

describe('agent transition table', () => {
  it('covers every agent status from the contract', () => {
    expect(Object.keys(AGENT_TRANSITIONS).sort()).toEqual([...AGENT_STATUSES].sort());
  });

  for (const from of AGENT_STATUSES) {
    for (const to of AGENT_STATUSES) {
      const allowed = EXPECTED_AGENT[from].includes(to);
      it(`${from} -> ${to} is ${allowed ? 'allowed' : 'rejected'}`, () => {
        expect(canTransitionAgent(from, to)).toBe(allowed);
        if (allowed) expect(() => assertAgentTransition(from, to)).not.toThrow();
        else expect(() => assertAgentTransition(from, to)).toThrow(IllegalTransitionError);
      });
    }
  }

  it('has the five terminal states from the contract', () => {
    expect([...TERMINAL_AGENT_STATUSES].sort()).toEqual([
      'CANCELLED',
      'FAILED',
      'NEEDS_REVIEW',
      'SUCCEEDED',
      'TIMED_OUT',
    ]);
    for (const s of TERMINAL_AGENT_STATUSES) expect(isLiveAgentStatus(s)).toBe(false);
  });

  it('marks every live agent state as restartable to NEEDS_REVIEW (never relaunched)', () => {
    for (const s of AGENT_STATUSES.filter(isLiveAgentStatus)) {
      expect(canTransitionAgent(s, 'NEEDS_REVIEW')).toBe(true);
      expect(canTransitionAgent(s, 'CANCELLED')).toBe(true);
    }
  });
});
