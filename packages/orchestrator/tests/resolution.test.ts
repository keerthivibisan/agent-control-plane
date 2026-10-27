// Synthetic data only. ADR-0030 (CR-A): the conflict resolver and structured helper outcomes.
import { describe, expect, it } from 'vitest';
import {
  RESOLVER_ROLE,
  abandonResolver,
  checkStepAttempts,
  checkTicketBranchAction,
  controlToolsFor,
  programOf,
  recoverAfterRestart,
  resolverSealed,
  startResolver,
  stopAgent,
  type RunState,
  type StartResolverInput,
} from '../src/index.js';
import { LEAD, agentOf, event, makeCtx, ok, refused, statusOf } from './helpers.js';
import {
  A,
  BRANCH,
  effectsOf,
  finishTurn,
  helper,
  leadMessages,
  leadTool,
  loopRunning,
  mergedA,
  sealed,
} from './loop-helpers.js';

const OP = 'op-1';
const R = 'res-1';

function atFinalStep(): RunState {
  return ok(leadTool(mergedA(), 'request_review', {}, 'h')).state;
}

function input(over: Partial<StartResolverInput> = {}): StartResolverInput {
  return {
    operationId: OP,
    ticketBranch: BRANCH,
    targetBranch: 'main',
    ticketCommit: 'a'.repeat(40),
    targetCommit: 'b'.repeat(40),
    conflictFiles: ['src/app.ts', 'README.md'],
    attempt: 1,
    maxAttempts: 2,
    previous: [],
    failedChecks: [],
    helperNode: null,
    ...over,
  };
}

function started(state = atFinalStep(), over: Partial<StartResolverInput> = {}) {
  const r = ok(startResolver(state, input(over), makeCtx(9000, 'res')));
  const s = ok(
    event(r.state, R, { type: 'started', providerSessionId: 'sess-r', model: null }, 9100),
  ).state;
  return { r, s };
}

describe('startResolver', () => {
  it('starts a worker on a helper block in the prepared worktree, while the run stays REVIEW', () => {
    const { r } = started();
    expect(r.value).toBe(R);
    const agent = agentOf(r.state, R);
    expect(agent).toMatchObject({
      kind: 'worker',
      role: RESOLVER_ROLE,
      resolution: { operationId: OP },
    });
    expect(agent.stage).toBe(programOf(r.state).helpers[0]?.id);
    expect(r.state.run.status).toBe('REVIEW');
    const start = effectsOf(r.effects, 'start-agent')[0];
    expect(start).toMatchObject({ fromBranch: BRANCH, resolution: { operationId: OP } });
    expect(start?.canStartHelpers).toBeUndefined();
    expect(start?.prompt).toContain('src/app.ts');
    expect(start?.prompt).toContain('never run git commands');
    expect(start?.prompt).toContain('assessment');
  });

  it('the brief carries earlier attempts and failed checks', () => {
    const { r } = started(atFinalStep(), {
      attempt: 2,
      previous: [{ attempt: 1, outcome: 'markers-left', note: 'kept both' }],
      failedChecks: ['unit'],
    });
    const prompt = effectsOf(r.effects, 'start-agent')[0]?.prompt ?? '';
    expect(prompt).toContain('attempt 2 of 2');
    expect(prompt).toContain('attempt 1: markers-left — kept both');
    expect(prompt).toContain('unit');
  });

  it('is refused outside the final step, while anything works, or twice', () => {
    expect(refused(startResolver(loopRunning(), input(), makeCtx(1, 'x')))).toBe('run-not-active');
    const { s } = started();
    expect(refused(startResolver(s, input(), makeCtx(1, 'x')))).toBe('workers-still-running');
    expect(
      refused(startResolver(atFinalStep(), input({ ticketBranch: 'other' }), makeCtx(1, 'x'))),
    ).toBe('no-ticket-branch');
    expect(
      refused(startResolver(atFinalStep(), input({ helperNode: 'nope' }), makeCtx(1, 'x'))),
    ).toBe('invalid-input');
  });

  it('has no child tools and blocks the owner merge while it works', () => {
    const { s } = started();
    expect(controlToolsFor(s, R)).toEqual(['report_work']);
    expect(checkTicketBranchAction(s, 'merge')?.code).toBeDefined();
  });
});

describe('the resolver turn', () => {
  it('a finished turn is sealed by the server, never entering the review loop', () => {
    const { s } = started();
    const done = ok(finishTurn(s, R, 'success', 9500));
    expect(statusOf(done.state, R)).toBe('AWAITING_REVIEW');
    expect(agentOf(done.state, R).change).toBeUndefined();
    expect(effectsOf(done.effects, 'seal-resolution')).toEqual([
      { type: 'seal-resolution', agentRunId: R, operationId: OP },
    ]);
    expect(effectsOf(done.effects, 'seal-change')).toEqual([]);
  });

  it('report_work carries the outcome and assessment to the operation', () => {
    const { s } = started();
    const assessment = {
      classification: 'runtime' as const,
      recommendation: 'run-checks' as const,
      proposedCheckIds: ['unit'],
      reason: 'startup path changed',
    };
    const r = ok(
      leadTool(
        s,
        'report_work',
        { note: 'Kept both menus.', outcome: 'completed', assessment },
        'rw',
        R,
      ),
    );
    expect(effectsOf(r.effects, 'helper-outcome')).toEqual([
      { type: 'helper-outcome', agentRunId: R, outcome: 'completed', assessment },
    ]);
  });

  it('the seal result ends it and tells the lead with its report', () => {
    const { s } = started();
    const reported = ok(
      leadTool(
        s,
        'report_work',
        { note: 'Both sides changed the port.', outcome: 'blocked' },
        'rw',
        R,
      ),
    ).state;
    const sealedState = ok(finishTurn(reported, R, 'success', 9500)).state;
    const r = ok(resolverSealed(sealedState, R, 'no-change', makeCtx(9600, 'z')));
    expect(statusOf(r.state, R)).toBe('FAILED');
    const line = leadMessages(r.effects)[0] ?? '';
    expect(line).toContain('made no change');
    expect(line).toContain('blocked: Both sides changed the port.');
    expect(r.state.run.status).toBe('REVIEW');
    const resolved = ok(
      resolverSealed(
        ok(finishTurn(s, R, 'success', 9500)).state,
        R,
        'resolved',
        makeCtx(9600, 'z'),
      ),
    );
    expect(statusOf(resolved.state, R)).toBe('SUCCEEDED');
    expect(refused(resolverSealed(resolved.state, R, 'resolved', makeCtx(9700, 'z')))).toBe(
      'change-not-decidable',
    );
  });

  it('a failed or stopped resolver ends its attempt, with no change for anyone to merge', () => {
    const { s } = started();
    const failed = ok(finishTurn(s, R, 'error', 9500));
    expect(statusOf(failed.state, R)).toBe('FAILED');
    expect(effectsOf(failed.effects, 'resolver-ended')).toEqual([
      { type: 'resolver-ended', agentRunId: R, operationId: OP },
    ]);
    expect(agentOf(failed.state, R).change).toBeUndefined();
    const stopped = ok(stopAgent(s, R, makeCtx(9500, 'st')));
    expect(effectsOf(stopped.effects, 'resolver-ended')).toHaveLength(1);
    expect(agentOf(stopped.state, R).change).toBeUndefined();
    expect(checkTicketBranchAction(stopped.state, 'merge')).toBeNull();
  });

  it('after a restart, an interrupted resolver is never left as a change to merge', () => {
    const { s } = started();
    // The record of a restart loses the in-memory resolver mark.
    const loaded: RunState = {
      ...s,
      agents: s.agents.map(({ resolution: _, ...a }) => a),
    };
    const recovered = ok(recoverAfterRestart(loaded, makeCtx(10000, 'rr'))).state;
    const r = ok(abandonResolver(recovered, R, OP, makeCtx(10100, 'ab')));
    expect(agentOf(r.state, R).change?.state ?? 'discarded').toBe('discarded');
    expect(effectsOf(r.effects, 'discard-change')).toHaveLength(1);
    expect(checkTicketBranchAction(r.state, 'merge')).toBeNull();
  });
});

describe('structured helper outcomes (ADR-0030 §5)', () => {
  it('a no-change seal tells the lead the helper’s reported reason', () => {
    let s = helper(loopRunning(), 'API builder', 'wa');
    s = ok(
      leadTool(
        s,
        'report_work',
        { note: 'The API already exists.', outcome: 'no-change' },
        'rw',
        A,
      ),
    ).state;
    s = ok(finishTurn(s, A)).state;
    const r = ok(sealed(s, A, 'rv', false, null));
    const line = leadMessages(r.effects)[0] ?? '';
    expect(line).toContain('API builder (agentId wa-1) finished with no changes');
    expect(line).toContain('It reported no-change: The API already exists.');
  });

  it('a blocked helper is reported as blocked, and one without a report says so', () => {
    let s = helper(loopRunning(), 'API builder', 'wa');
    s = ok(
      leadTool(s, 'report_work', { note: 'No access to the schema.', outcome: 'blocked' }, 'rw', A),
    ).state;
    const blocked = ok(sealed(ok(finishTurn(s, A)).state, A, 'rv', false, null));
    expect(leadMessages(blocked.effects)[0]).toContain('blocked: No access to the schema.');
    const silent = helper(loopRunning(), 'API builder', 'wa');
    const r = ok(sealed(ok(finishTurn(silent, A)).state, A, 'rv', false, null));
    expect(leadMessages(r.effects)[0]).toContain('sent no report');
  });

  it('no-change attempts count, so replacements stop with the reasons', () => {
    let s = loopRunning();
    const node = programOf(s).helpers[0];
    if (node === undefined) throw new Error('no helper node');
    for (let i = 0; i < 3; i++) {
      const prefix = `w${i}`;
      s = helper(s, 'API builder', prefix);
      s = ok(
        leadTool(
          s,
          'report_work',
          { note: `Blocked ${i}.`, outcome: 'blocked' },
          `rw${i}`,
          `${prefix}-1`,
        ),
      ).state;
      s = ok(finishTurn(s, `${prefix}-1`, 'success', 4000 + i)).state;
      s = ok(sealed(s, `${prefix}-1`, `rv${i}`, false, null, 5000 + i)).state;
    }
    const refusal = checkStepAttempts(s, node, 'API builder');
    expect(refusal?.code).toBe('attempts-exhausted');
    expect(refusal?.message).toContain('ended with no changes');
    expect(refusal?.message).toContain('blocked: Blocked 2.');
    expect(statusOf(s, LEAD)).toBe('RUNNING');
  });
});
