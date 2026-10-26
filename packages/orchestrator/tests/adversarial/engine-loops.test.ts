import { describe, expect, it } from 'vitest';
import {
  changeMergeBlocked,
  changeSealed,
  checkChangeAction,
  recordChangeDecision,
  undecidedChanges,
} from '../../src/index.js';
import type { MergeBlocked, RunState } from '../../src/index.js';
import { LEAD, event, makeCtx, ok } from '../helpers.js';
import { COMMIT, changeOf, finishTurn, leadTool, loopRunning, sealed } from '../loop-helpers.js';

/*
 * Misbehaviour at the engine level (T-1): the server's reports are scripted the way a hostile
 * helper would make them come out (a seal that fails, a merge that keeps failing), and the lead is
 * a loop that never gives up, as the real lead of ACPGIT-3 did. The engine must keep the run
 * finite (bounded agent starts) and never leave a decider with only refused actions. Known gaps
 * are `knownGap`s (docs/testing/adversarial.md). Synthetic data only.
 *
 * Since F-1, `changeSealed` takes one failure code: `branch-changed` (the worktree left its
 * branch) goes to the lead, who may discard it. Any other failed seal (`headCommit: null` with no
 * code, e.g. `invalid-workspace`) still goes to the owner only. The per-code cases are in the
 * server suite (`packages/server/tests/adversarial/hostile-helper.test.ts`).
 */

const branchChanged = (s: RunState, id: string, prefix: string, at: number) =>
  changeSealed(
    s,
    id,
    { changed: true, headCommit: null, changedFiles: null, failure: 'branch-changed' },
    makeCtx(at, prefix),
  );

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

describe('a failed seal', () => {
  it('another failure goes to the owner, who can always discard it; then the lead hands over', () => {
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

  // F-1 closed this gap: a seal that found the worktree off its branch goes to the lead, who
  // can discard it (merge and rework are refused).
  it('the lead has a deciding action on a change whose worktree left its branch', () => {
    const turn = helperTurn(running(), 'wa', 3000);
    if (turn === null) throw new Error('no helper');
    const s = ok(branchChanged(turn.state, turn.id, 'rv', 3100)).state;
    expect(
      leadOptions(s, turn.id),
      '[lead-progress] the lead can only start another helper',
    ).toContain('discard');
    expect(leadOptions(s, turn.id)).not.toContain('merge');
    expect(leadOptions(s, turn.id)).not.toContain('rework');
    const discarded = ok(
      leadTool(s, 'discard_change', { agentId: turn.id, reason: 'Synthetic.' }, 'd', LEAD, 3200),
    ).state;
    expect(changeOf(discarded, turn.id).state).toBe('discarded');
  });

  // Closed by F-2: any other failed seal (no failure code: the worktree is gone, a committed
  // attachment copy or setup output) is also a failure the lead may discard, not only the owner.
  it('the lead has a deciding action on any failed seal', () => {
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
  // Closed by F-2: the engine bounds replacement helpers for one plan step. ACPGIT-3's lead
  // started a new helper after every failed seal; since F-1 it can discard each one first, and
  // now `start_agent` is refused once the step lost `stepAttemptLimit` attempts.
  it('replacement helpers after branch-changed seals stay within the start bound', () => {
    let s = running();
    let starts = 0;
    for (let i = 1; i <= ATTEMPTS; i++) {
      const turn = helperTurn(s, `r${i}`, i * 10_000);
      if (turn === null) break;
      starts++;
      s = ok(branchChanged(turn.state, turn.id, `rv${i}`, i * 10_000 + 30)).state;
      const discarded = leadTool(
        s,
        'discard_change',
        { agentId: turn.id, reason: 'Synthetic: the worktree left its branch.' },
        `d${i}`,
        LEAD,
        i * 10_000 + 40,
      );
      s = ok(discarded).state;
    }
    expect(starts, `[bounded] ${starts} helpers started for one plan step`).toBeLessThanOrEqual(
      START_BOUND,
    );
  });

  // Closed by F-2: the same loop with changes that sealed fine: discard, start a replacement,
  // again. Rework rounds were bounded; replacements now are too.
  it('discard-and-replace on one plan step stays within the start bound', () => {
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
  });

  // Closed by F-2: a merge that kept failing (`failed`) was retried forever: the lead heard "Try
  // again" each time. After `MAX_FAILED_MERGES` in a row the change goes to the owner; the
  // ticket branch moved or checked out elsewhere goes there at once (tests below).
  it('merges retried after "failed" are bounded, then the change goes to the owner', () => {
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
  });

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
