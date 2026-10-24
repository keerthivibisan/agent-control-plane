import { describe, expect, it } from 'vitest';
import {
  changeMergeBlocked,
  checkChangeAction,
  recordChangeDecision,
  undecidedChanges,
} from '../../src/index.js';
import type { MergeBlocked, RunState } from '../../src/index.js';
import { LEAD, event, makeCtx, ok } from '../helpers.js';
import { COMMIT, changeOf, finishTurn, leadTool, loopRunning, sealed } from '../loop-helpers.js';
import { knownGap } from './known-gap.js';

/*
 * Misbehaviour at the engine level (T-1): the server's reports are scripted the way a hostile
 * helper would make them come out (a seal that fails, a merge that keeps failing), and the lead is
 * a loop that never gives up, as the real lead of ACPGIT-3 did. The engine must keep the run
 * finite (bounded agent starts) and never leave a decider with only refused actions. Known gaps
 * are `knownGap`s (docs/testing/adversarial.md). Synthetic data only.
 *
 * The engine's `changeSealed` takes no failure code today: every failed seal (`headCommit: null`)
 * is the same to it, whatever the WorkspaceError was. The per-code cases are in the server suite
 * (`packages/server/tests/adversarial/hostile-helper.test.ts`).
 */

const ROLE = 'Builder';
const ROUNDS = 2;
/** One plan step: its first helper, its rework rounds, and one replacement. */
const START_BOUND = 1 + ROUNDS + 1;
const ATTEMPTS = 8;

const running = () => loopRunning({ reviewer: 'lead', rounds: ROUNDS });

/** The lead starts a helper `<prefix>-1` for the same step; it starts and finishes its turn. */
function helperTurn(
  s: RunState,
  prefix: string,
  at: number,
): { state: RunState; id: string } | null {
  const r = leadTool(s, 'start_agent', { role: ROLE, task: `Build the ${ROLE}` }, prefix, LEAD, at);
  if (!r.ok) return null;
  const id = `${prefix}-1`;
  let state = ok(
    event(r.state, id, { type: 'started', providerSessionId: `sess-${id}`, model: null }, at + 10),
  ).state;
  state = ok(finishTurn(state, id, 'success', at + 20)).state;
  return { state, id };
}

/** The lead's change actions the engine would accept on `id` right now. */
const leadOptions = (s: RunState, id: string) =>
  (['merge', 'rework', 'discard', 'ask-owner'] as const).filter(
    (a) => checkChangeAction(s, id, a, 'lead') === null,
  );
const ownerOptions = (s: RunState, id: string) =>
  (['merge', 'merge-anyway', 'rework', 'discard'] as const).filter(
    (a) => checkChangeAction(s, id, a, 'owner') === null,
  );

describe('a failed seal (the worktree left its branch, or any WorkspaceError)', () => {
  it('goes to the owner, who can always discard it; then the lead can hand over', () => {
    const turn = helperTurn(running(), 'wa', 3000);
    if (turn === null) throw new Error('no helper');
    let s = ok(sealed(turn.state, turn.id, 'rv', true, null, 3100)).state;
    expect(changeOf(s, turn.id).state).toBe('needs-owner');
    expect(ownerOptions(s, turn.id)).toContain('discard');
    s = ok(
      recordChangeDecision(
        s,
        turn.id,
        { decision: 'discard', by: 'owner', comments: 'Synthetic.' },
        makeCtx(3200, 'od'),
      ),
    ).state;
    expect(undecidedChanges(s)).toEqual([]);
    expect(leadTool(s, 'request_review', { summary: 'Synthetic.' }, 'rr', LEAD, 3300).ok).toBe(
      true,
    );
  });

  // F-1: a failed seal is a failure the lead can discard (not only the owner).
  knownGap('F-1', 'lead-progress', 'the lead has a deciding action on the failed change', () => {
    const turn = helperTurn(running(), 'wa', 3000);
    if (turn === null) throw new Error('no helper');
    const s = ok(sealed(turn.state, turn.id, 'rv', true, null, 3100)).state;
    expect(
      leadOptions(s, turn.id),
      '[lead-progress] the lead can only start another helper',
    ).toContain('discard');
  });
});

describe('a lead that never gives up', () => {
  // follow-up: the engine bounds replacement helpers for one plan step. ACPGIT-3's lead started
  // a new helper after every failed seal; nothing stops it today.
  knownGap(
    'follow-up',
    'bounded',
    'replacement helpers after failed seals stay within the start bound',
    () => {
      let s = running();
      let starts = 0;
      for (let i = 1; i <= ATTEMPTS; i++) {
        const turn = helperTurn(s, `r${i}`, i * 10_000);
        if (turn === null) break;
        starts++;
        s = ok(sealed(turn.state, turn.id, `rv${i}`, true, null, i * 10_000 + 30)).state;
        expect(changeOf(s, turn.id).state).toBe('needs-owner');
      }
      expect(starts, `[bounded] ${starts} helpers started for one plan step`).toBeLessThanOrEqual(
        START_BOUND,
      );
    },
  );

  // follow-up: the same loop with changes the lead may discard (what F-1 enables for failed
  // seals): discard, start a replacement, again. Rework rounds are bounded; replacements are not.
  knownGap(
    'follow-up',
    'bounded',
    'discard-and-replace on one plan step stays within the start bound',
    () => {
      let s = running();
      let starts = 0;
      for (let i = 1; i <= ATTEMPTS; i++) {
        const turn = helperTurn(s, `r${i}`, i * 10_000);
        if (turn === null) break;
        starts++;
        s = ok(sealed(turn.state, turn.id, `rv${i}`, true, COMMIT, i * 10_000 + 30)).state;
        const discarded = leadTool(
          s,
          'discard_change',
          { agentId: turn.id, reason: 'Synthetic: try again.' },
          `d${i}`,
          LEAD,
          i * 10_000 + 40,
        );
        s = ok(discarded).state;
      }
      expect(starts, `[bounded] ${starts} helpers started for one plan step`).toBeLessThanOrEqual(
        START_BOUND,
      );
    },
  );

  // follow-up: a merge that fails for a reason that will not go away (the ticket branch moved or
  // is checked out elsewhere; the server reports `failed`) is retried forever: the lead hears
  // "Try again" each time. After a few failures the change should go to the owner.
  knownGap(
    'follow-up',
    'bounded',
    'merges retried after "failed" are bounded, then the change goes to the owner',
    () => {
      const turn = helperTurn(running(), 'wa', 3000);
      if (turn === null) throw new Error('no helper');
      let s = ok(sealed(turn.state, turn.id, 'rv', true, COMMIT, 3100)).state;
      let attempts = 0;
      for (let i = 1; i <= ATTEMPTS; i++) {
        const r = leadTool(s, 'merge_change', { agentId: turn.id }, `m${i}`, LEAD, 4000 + i * 100);
        if (!r.ok) break;
        attempts++;
        s = ok(
          changeMergeBlocked(
            r.state,
            turn.id,
            { reason: 'failed' },
            makeCtx(4050 + i * 100, `b${i}`),
          ),
        ).state;
        if (changeOf(s, turn.id).state === 'needs-owner') break;
      }
      expect(
        attempts,
        `[bounded] the lead retried a failing merge ${attempts} times`,
      ).toBeLessThanOrEqual(3);
    },
  );

  for (const blocked of [
    { reason: 'merge-conflict', files: ['src/app.ts'] },
    { reason: 'checks-failed', failed: ['test'] },
  ] satisfies MergeBlocked[]) {
    it(`a merge that is always blocked (${blocked.reason}) ends within the rework limit`, () => {
      const turn = helperTurn(running(), 'wa', 3000);
      if (turn === null) throw new Error('no helper');
      const id = turn.id;
      let s = ok(sealed(turn.state, id, 'rv', true, COMMIT, 3100)).state;
      let starts = 1;
      for (let i = 1; i <= ATTEMPTS; i++) {
        const at = 10_000 * i;
        if (leadOptions(s, id).includes('merge')) {
          s = ok(leadTool(s, 'merge_change', { agentId: id }, `m${i}`, LEAD, at)).state;
          s = ok(changeMergeBlocked(s, id, blocked, makeCtx(at + 10, `b${i}`))).state;
        }
        // Liveness: the lead always has something it may do with the change.
        expect(leadOptions(s, id)).not.toEqual([]);
        const rework = leadTool(
          s,
          'request_rework',
          { agentId: id, comments: 'Synthetic: fix it.' },
          `w${i}`,
          LEAD,
          at + 20,
        );
        if (!rework.ok) break;
        starts++;
        s = ok(
          event(
            rework.state,
            id,
            { type: 'started', providerSessionId: `sess-${id}`, model: null },
            at + 30,
          ),
        ).state;
        s = ok(finishTurn(s, id, 'success', at + 40)).state;
        s = ok(sealed(s, id, `rv${i}`, true, COMMIT, at + 50)).state;
      }
      expect(starts).toBeLessThanOrEqual(1 + ROUNDS);
      // With the rounds used up, the lead can still end it: discard or ask the owner.
      expect(leadOptions(s, id)).toEqual(expect.arrayContaining(['discard', 'ask-owner']));
    });
  }
});
