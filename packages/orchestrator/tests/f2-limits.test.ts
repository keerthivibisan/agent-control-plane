import { describe, expect, it } from 'vitest';
import {
  MAX_FAILED_MERGES,
  changeMergeBlocked,
  changeSealed,
  checkChangeAction,
  recordChangeDecision,
  stepAttemptLimit,
} from '../src/index.js';
import type { MergeBlocked, RunState, SealFailure } from '../src/index.js';
import { LEAD, event, makeCtx, ok, refused } from './helpers.js';
import {
  COMMIT,
  changeOf,
  finishTurn,
  leadMessages,
  leadTool,
  loopRunning,
  sealed,
} from './loop-helpers.js';

/*
 * F-2 (after T-1 and ACPGIT-3): replacement helpers are bounded per plan step and per run, a
 * change whose seal failed for any reason can be discarded by the lead, and a merge that cannot
 * succeed (the ticket branch moved or is checked out elsewhere, or git keeps failing) goes to the
 * owner instead of "Try again". Synthetic data only. The plan (`PLAN_INPUT`) has three steps:
 * `Store` once and `UI` twice.
 */

const running = (rounds = 2) => loopRunning({ reviewer: 'lead', rounds });

/** The lead starts `<prefix>-1` as `role`; it starts and ends its turn. Null when refused. */
function turn(s: RunState, role: string, prefix: string, at: number) {
  const r = leadTool(s, 'start_agent', { role, task: `Build the ${role}` }, prefix, LEAD, at);
  if (!r.ok) return { refusal: r.refusal } as const;
  const id = `${prefix}-1`;
  let state = ok(
    event(r.state, id, { type: 'started', providerSessionId: `sess-${id}`, model: null }, at + 1),
  ).state;
  state = ok(finishTurn(state, id, 'success', at + 2)).state;
  return { state, id } as const;
}

/** Starts `role` helpers whose sealed work the lead discards, until a start is refused. */
function discardLoop(s: RunState, roles: (i: number) => string, max = 20) {
  let starts = 0;
  for (let i = 1; i <= max; i++) {
    const t = turn(s, roles(i), `r${i}`, i * 1000);
    if ('refusal' in t) return { s, starts, refusal: t.refusal };
    starts++;
    s = ok(sealed(t.state, t.id, `rv${i}`, true, COMMIT, i * 1000 + 3)).state;
    s = ok(
      leadTool(
        s,
        'discard_change',
        { agentId: t.id, reason: 'Synthetic.' },
        `d${i}`,
        LEAD,
        i * 1000 + 4,
      ),
    ).state;
  }
  return { s, starts, refusal: null };
}

describe('stepAttemptLimit', () => {
  it('is 1 + the rework rounds, at least 2', () => {
    expect(stepAttemptLimit({})).toBe(2);
    for (const [rounds, limit] of [
      [0, 2],
      [1, 2],
      [2, 3],
      [5, 6],
    ] as const) {
      expect(stepAttemptLimit(running(rounds))).toBe(limit);
    }
  });
});

describe('replacement helpers per plan step', () => {
  it('a role that is no step: refused after the limit; then the lead can hand over', () => {
    const { s, starts, refusal } = discardLoop(running(), () => 'Builder');
    expect(starts).toBe(3);
    expect(refusal?.code).toBe('attempts-exhausted');
    expect(refusal?.message).toContain('request_review');
    expect(refusal?.message).toContain('Builder');
    const handed = ok(leadTool(s, 'request_review', { summary: 'Synthetic.' }, 'rr', LEAD, 90_000));
    expect(handed.state.run.status).toBe('REVIEW');
  });

  it('a role two plan steps share gets the limit twice', () => {
    expect(discardLoop(running(), () => 'UI').starts).toBe(6);
    expect(discardLoop(running(), () => '  ui ').starts).toBe(6);
  });

  it('renaming the role does not escape the run limit (limit × plan steps)', () => {
    const { starts, refusal } = discardLoop(running(), (i) => `Builder ${i}`);
    expect(starts).toBe(9);
    expect(refusal?.message).toContain('helpers in this run');
  });

  it('a change that could not be saved counts while it waits, before any discard', () => {
    let s = running();
    for (let i = 1; i <= 3; i++) {
      const t = turn(s, 'Builder', `w${i}`, i * 1000);
      if ('refusal' in t) throw new Error('refused too early');
      s = ok(sealed(t.state, t.id, `rv${i}`, true, null, i * 1000 + 3)).state;
      expect(changeOf(s, t.id).state).toBe('needs-owner');
    }
    expect(refused(leadTool(s, 'start_agent', { role: 'Builder', task: 'x' }, 'w4'))).toBe(
      'attempts-exhausted',
    );
  });

  it('merged work never counts: a well-behaved lead is never limited', () => {
    let s = running();
    for (let i = 1; i <= 8; i++) {
      const t = turn(s, 'Builder', `m${i}`, i * 1000);
      if ('refusal' in t) throw new Error(`refused at ${i}`);
      s = ok(sealed(t.state, t.id, `rv${i}`, true, COMMIT, i * 1000 + 3)).state;
      s = ok(leadTool(s, 'merge_change', { agentId: t.id }, `mc${i}`, LEAD, i * 1000 + 4)).state;
      s = ok(
        recordChangeDecision(
          s,
          t.id,
          { decision: 'merge', by: 'lead', outcome: 'merged', headCommit: 'def5678' },
          makeCtx(i * 1000 + 5, `md${i}`),
        ),
      ).state;
    }
  });
});

describe('a failed seal the lead may discard', () => {
  const failures: (SealFailure | undefined)[] = ['invalid-workspace', 'not-saved', undefined];
  for (const failure of failures) {
    it(`${failure ?? 'no code'}: waits for the owner; the lead may discard, never merge or rework`, () => {
      const t = turn(running(), 'Builder', 'wa', 3000);
      if ('refusal' in t) throw new Error('refused');
      const r = ok(
        changeSealed(
          t.state,
          t.id,
          {
            changed: true,
            headCommit: null,
            changedFiles: null,
            ...(failure !== undefined && { failure }),
          },
          makeCtx(3100, 'rv'),
        ),
      );
      const s = r.state;
      expect(changeOf(s, t.id)).toMatchObject({
        state: 'needs-owner',
        sealFailure: failure ?? 'not-saved',
      });
      const [message] = leadMessages(r.effects);
      expect(message).toContain('could not be saved');
      expect(message).toContain('discard_change');
      expect(checkChangeAction(s, t.id, 'discard', 'lead')).toBeNull();
      for (const action of ['merge', 'rework', 'ask-owner'] as const) {
        expect(checkChangeAction(s, t.id, action, 'lead')).not.toBeNull();
      }
      // The owner keeps every action it had.
      expect(checkChangeAction(s, t.id, 'discard', 'owner')).toBeNull();
      const discarded = ok(
        leadTool(s, 'discard_change', { agentId: t.id, reason: 'Synthetic.' }, 'd', LEAD, 3200),
      ).state;
      expect(changeOf(discarded, t.id).state).toBe('discarded');
    });
  }

  it('a later successful seal (after the owner’s rework) clears the failure', () => {
    const t = turn(running(), 'Builder', 'wa', 3000);
    if ('refusal' in t) throw new Error('refused');
    let s = ok(sealed(t.state, t.id, 'rv', true, null, 3100)).state;
    s = ok(
      recordChangeDecision(
        s,
        t.id,
        { decision: 'rework', by: 'owner', comments: 'Synthetic: try again.' },
        makeCtx(3200, 'ow'),
      ),
    ).state;
    s = ok(
      event(s, t.id, { type: 'started', providerSessionId: `sess-${t.id}`, model: null }, 3300),
    ).state;
    s = ok(finishTurn(s, t.id, 'success', 3400)).state;
    s = ok(sealed(s, t.id, 'rv2', true, COMMIT, 3500)).state;
    expect(changeOf(s, t.id).sealFailure).toBeUndefined();
    expect(changeOf(s, t.id).headCommit).toBe(COMMIT);
  });
});

describe('a merge that cannot succeed goes to the owner', () => {
  /** A sealed change the lead reviews, with a merge under way. */
  function merging(): { s: RunState; id: string } {
    const t = turn(running(), 'Builder', 'wa', 3000);
    if ('refusal' in t) throw new Error('refused');
    const s = ok(sealed(t.state, t.id, 'rv', true, COMMIT, 3100)).state;
    return {
      s: ok(leadTool(s, 'merge_change', { agentId: t.id }, 'm', LEAD, 3200)).state,
      id: t.id,
    };
  }

  for (const [reason, words] of [
    ['ticket-branch-moved', 'Only the owner can reset it'],
    ['ticket-branch-checked-out', 'Only the owner can free it'],
  ] as const) {
    it(`${reason}: at once, never "Try again"; the lead cannot retry`, () => {
      const { s, id } = merging();
      const r = ok(changeMergeBlocked(s, id, { reason }, makeCtx(3300, 'b')));
      expect(r.value).toContain(words);
      expect(r.value).toContain('do not try the merge again');
      expect(r.value).not.toContain('Try again');
      expect(changeOf(r.state, id).state).toBe('needs-owner');
      expect(refused(leadTool(r.state, 'merge_change', { agentId: id }, 'm2', LEAD, 3400))).toBe(
        'change-not-decidable',
      );
      // The owner may merge it (after resetting the branch) or discard it.
      expect(checkChangeAction(r.state, id, 'merge', 'owner')).toBeNull();
      expect(checkChangeAction(r.state, id, 'discard', 'owner')).toBeNull();
    });
  }

  it(`"failed" offers "Try again" ${MAX_FAILED_MERGES - 1} times, then goes to the owner`, () => {
    const m = merging();
    const id = m.id;
    let s = m.s;
    const replies: string[] = [];
    for (let i = 1; i <= MAX_FAILED_MERGES; i++) {
      const r = ok(
        changeMergeBlocked(s, id, { reason: 'failed' }, makeCtx(3300 + i * 10, `b${i}`)),
      );
      replies.push(r.value);
      s = r.state;
      if (i < MAX_FAILED_MERGES) {
        s = ok(leadTool(s, 'merge_change', { agentId: id }, `m${i}`, LEAD, 3305 + i * 10)).state;
      }
    }
    expect(replies.slice(0, -1).every((r) => r.includes('Try again'))).toBe(true);
    expect(replies.at(-1)).toContain(`failed ${MAX_FAILED_MERGES} times in a row`);
    expect(changeOf(s, id).state).toBe('needs-owner');
  });

  it('another blocked reason resets the count of failed merges', () => {
    const m = merging();
    const id = m.id;
    let s = m.s;
    const blocks: MergeBlocked[] = [
      { reason: 'failed' },
      { reason: 'failed' },
      { reason: 'checks-pending' },
      { reason: 'failed' },
    ];
    blocks.forEach((b, i) => {
      if (i > 0)
        s = ok(leadTool(s, 'merge_change', { agentId: id }, `m${i}`, LEAD, 4000 + i)).state;
      s = ok(changeMergeBlocked(s, id, b, makeCtx(4100 + i, `b${i}`))).state;
      if (b.reason === 'checks-pending') {
        // The checks pass; the lead merges again.
        s = {
          ...s,
          agents: s.agents.map((a) =>
            a.id === id && a.change !== undefined
              ? { ...a, change: { ...a.change, checks: 'passed' } }
              : a,
          ),
        };
      }
    });
    expect(changeOf(s, id).failedMerges).toBe(1);
    expect(changeOf(s, id).state).not.toBe('needs-owner');
  });
});
