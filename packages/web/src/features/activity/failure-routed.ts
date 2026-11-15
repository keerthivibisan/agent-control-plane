/*
 * ADR-0038 §4 (FR-7): the app's one-line comment for a failure routed along a When arrow, read
 * back into its parts so the Conversation tab can show who fixes it and the round. The server
 * writes it (`failureRoutedComment` in packages/server/src/control/failure-routing.ts) from the
 * app's own records: "When <event> at <block>: <fixer> is fixing it (round n of m). The lead was
 * told." and so on. Null for any other line, which is then shown as it is.
 */
export type FailureRoutedKind = 'fix-started' | 'rerouted' | 'taken-over' | 'to-lead';

export interface FailureRoutedLine {
  kind: FailureRoutedKind;
  /** "When tests fail at Tester". */
  when: string;
  /** The fixer's role (fix started, moved), or why the lead decides (to the lead). */
  who: string | null;
  round: { used: number; max: number } | null;
}

const ROUND = String.raw`(?: \(round (\d+) of (\d+)\))?`;

const PATTERNS: readonly [FailureRoutedKind, RegExp][] = [
  [
    'fix-started',
    new RegExp(String.raw`^(When .+?): (.+) is fixing it${ROUND}\. The lead was told\.$`),
  ],
  ['taken-over', new RegExp(String.raw`^(When .+?): the lead took the fix over${ROUND}\.$`)],
  ['rerouted', new RegExp(String.raw`^(When .+?): the lead moved the fix to (.+?)${ROUND}\.$`)],
  ['to-lead', new RegExp(String.raw`^(When .+?): the lead decides, as (.+?)${ROUND}\.$`)],
];

export function parseFailureRoutedLine(text: string): FailureRoutedLine | null {
  const line = text.trim();
  if (line.includes('\n')) return null;
  for (const [kind, re] of PATTERNS) {
    const m = re.exec(line);
    if (m === null) continue;
    const when = m[1] ?? '';
    const who = kind === 'taken-over' ? null : (m[2] ?? null);
    const [used, max] = kind === 'taken-over' ? [m[2], m[3]] : [m[3], m[4]];
    return {
      kind,
      when,
      who,
      round:
        used !== undefined && max !== undefined ? { used: Number(used), max: Number(max) } : null,
    };
  }
  return null;
}
