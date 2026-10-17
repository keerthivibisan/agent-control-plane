import type { Oracle } from './sim.js';

/**
 * Named scripts for the simulator: each answers some choice points and leaves the rest to the
 * default (the first option: approve the plan, helpers change files, reviewers approve, the lead
 * and the owner merge, merges succeed). `n` counts how often the same key was asked before, so a
 * script can answer a retry differently. Synthetic data only.
 */
export type ScriptRule = (key: string, options: readonly string[], n: number) => string | undefined;

export function scriptOracle(rule: ScriptRule = () => undefined): Oracle {
  const asked = new Map<string, number>();
  return ({ key, options }) => {
    const n = asked.get(key) ?? 0;
    asked.set(key, n + 1);
    const answer = rule(key, options, n);
    return answer !== undefined && options.includes(answer) ? answer : (options[0] ?? '');
  };
}

/** The first of `wanted` that is an option. */
function prefer(options: readonly string[], ...wanted: string[]): string | undefined {
  return wanted.find((w) => options.includes(w));
}

export const SCRIPTS = {
  /** Everyone approves; every merge succeeds. */
  approve: scriptOracle,
  /** The Store helper's first round is sent back (by the reviewer's verdict and the lead). */
  'rework-then-approve': () =>
    scriptOracle((key, options) => {
      if (key === 'verdict:Store:0') return 'rework';
      if (key === 'lead:Store:0') return prefer(options, 'rework', 'merge');
      return undefined;
    }),
  /** The lead discards the Store helper's change. */
  discard: () => scriptOracle((key) => (key === 'lead:Store:0' ? 'discard' : undefined)),
  /** The lead asks the owner about the Store change; the owner merges it. */
  'ask-owner': () => scriptOracle((key) => (key === 'lead:Store:0' ? 'ask-owner' : undefined)),
  /** The owner, asked, sends the Store change back; the lead then merges it. */
  'ask-owner-rework': () =>
    scriptOracle((key, options) => {
      if (key === 'lead:Store:0') return 'ask-owner';
      if (key === 'owner-change:Store:0') return prefer(options, 'rework', 'merge');
      return undefined;
    }),
  /** The Store change fails a required check on its first merge; the lead reworks or discards. */
  'failed-check': () =>
    scriptOracle((key, options, n) => {
      if (key === 'merge:Store:0:0') return 'checks-failed';
      if (key === 'lead:Store:0' && n === 1) return prefer(options, 'rework', 'discard');
      return undefined;
    }),
  /** The Store helper's turn fails; the lead discards its change. */
  'failing-helper': () =>
    scriptOracle((key) => {
      if (key === 'turn:Store:0') return 'error';
      if (key === 'lead:Store:0') return 'discard';
      return undefined;
    }),
  /** The UI change conflicts on its first merge; the lead reworks it, else asks the owner. */
  conflict: () =>
    scriptOracle((key, options, n) => {
      if (key === 'merge:UI:0:0') return 'conflict';
      if (key === 'lead:UI:0' && n === 1) return prefer(options, 'rework', 'ask-owner');
      return undefined;
    }),
  /** The UI helper changes nothing. */
  'no-changes': () => scriptOracle((key) => (key === 'turn:UI:0' ? 'no-changes' : undefined)),
  /** The owner asks for changes to plan v1, then approves v2. */
  'plan-changes': () => scriptOracle((key) => (key === 'plan:1' ? 'request-changes' : undefined)),
  /** Legacy flow: the owner discards the Store helper's change. */
  'legacy-discard': () =>
    scriptOracle((key) => (key === 'legacy-review:Store' ? 'discarded' : undefined)),
  /** Legacy flow: the Store helper fails and the owner discards it. */
  'legacy-failing-helper': () =>
    scriptOracle((key) => {
      if (key === 'turn:Store:0') return 'error';
      if (key === 'legacy-review:Store') return 'discarded';
      return undefined;
    }),
  /** The owner denies the first tool use it is asked about. */
  'owner-denies': () =>
    scriptOracle((key, _options, n) =>
      key.startsWith('approval:') && n === 0 ? 'deny' : undefined,
    ),
} as const satisfies Record<string, () => Oracle>;

export type ScriptName = keyof typeof SCRIPTS;
