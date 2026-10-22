import { driveScenario } from './flow.js';
import { SCENARIO_IDS, type ScenarioId } from './scenarios.js';

/*
 * WG-V real-run driver for workflow graphs (docs/workflow-graph/RESUME.md Step 4;
 * docs/workflow-graph/wp/WG-V.md, "Real runs"). One scenario per call. From packages/server:
 *
 *   # Safe anywhere: the scripted FAKE adapter plays every agent; nothing is spawned.
 *   node --conditions=development --import tsx \
 *     tests/verification/workflow-graph/real-run/drive.ts --scenario a --dry-run
 *
 *   # REAL: starts real `claude` processes through the Agent SDK on the owner's account and
 *   # spends tokens. Only after the owner consents in chat to THIS scenario.
 *   ACP_REAL_RUN=1 node --conditions=development --import tsx \
 *     tests/verification/workflow-graph/real-run/drive.ts --scenario a
 *
 * Scenarios (scenarios.ts): `a` the lead reviews; `b` a change reviewer sends its findings to the
 * lead (with a Full auto pool the run tightens to Auto edits); `c` the reviewer ↔ helper loop with
 * direct rework; `mixed` a Manual named helper, a Full auto pool and an Auto edits tester.
 *
 * Refused (exit 2): no `--scenario`, an unknown one, a real run without ACP_REAL_RUN=1, a real run
 * in CI, and both `--dry-run` and ACP_REAL_RUN=1 at once (ambiguous). Never from `pnpm test` (the
 * file is not `*.test.ts`); its dry run is tested by `drive.test.ts`.
 *
 * Environment: ACP_REAL_RUN_LIMIT_MS (default 30 minutes real, 2 minutes dry) is the overall time
 * limit, after which the run is stopped; ACP_REAL_RUN_KEEP=1 keeps the temp folders (real runs
 * keep them by default, for inspection; ACP_REAL_RUN_CLEANUP=1 removes them). Ctrl-C stops the run
 * and the server.
 *
 * Output: ONE aggregate JSON summary on stdout (also `<data dir>/real-run-summary.json` for a real
 * run); progress and the kept folders on stderr. Exit 0 when every assertion held, 1 otherwise.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function refuse(message: string): never {
  process.stderr.write(`Refusing: ${message}\n`);
  process.exit(2);
}

const given = arg('--scenario');
if (given === undefined) refuse(`--scenario ${SCENARIO_IDS.join('|')} is required`);
if (!(SCENARIO_IDS as readonly string[]).includes(given)) {
  refuse(`--scenario must be one of ${SCENARIO_IDS.join(', ')}`);
}
const scenario = given as ScenarioId;
const dryRun = process.argv.includes('--dry-run');
// v0.3.0 C-V: attach a synthetic file and check notes, the summary and attachments (ADR-0026).
const attach = process.argv.includes('--attach');
const real = process.env['ACP_REAL_RUN'] === '1';
if (dryRun && real) refuse('--dry-run and ACP_REAL_RUN=1 together: choose one');
if (!dryRun && !real) {
  refuse('this starts real Claude Code agents. Set ACP_REAL_RUN=1 after consent, or --dry-run.');
}
if (real && process.env['CI'] !== undefined) refuse('never in CI');

const limitMs = Number(
  process.env['ACP_REAL_RUN_LIMIT_MS'] ?? String(dryRun ? 2 * 60_000 : 30 * 60_000),
);
if (!Number.isInteger(limitMs) || limitMs <= 0) refuse('ACP_REAL_RUN_LIMIT_MS must be > 0');
const keep = dryRun
  ? process.env['ACP_REAL_RUN_KEEP'] === '1'
  : process.env['ACP_REAL_RUN_CLEANUP'] !== '1';

const progress = (line: string) =>
  process.stderr.write(`WG-V ${dryRun ? 'dry run' : 'REAL run'}: ${line}\n`);
// Ctrl-C: the run is stopped and the server closed (every agent ends); a second one exits at once.
const interrupted = new AbortController();
process.once('SIGINT', () => {
  progress('Ctrl-C: stopping the run (Ctrl-C again exits at once)');
  interrupted.abort();
  process.once('SIGINT', () => process.exit(130));
});

try {
  const { ok, summary } = await driveScenario({
    scenario,
    dryRun,
    limitMs,
    attach,
    keep,
    onKept: (dirs) => progress(`kept for inspection: ${dirs.join(', ')}`),
    progress,
    signal: interrupted.signal,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!ok) {
    const failed = Object.entries(summary['assertions'] as Record<string, boolean>)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    progress(`assertions failed: ${failed.join(', ')}`);
  }
  process.exit(ok ? 0 : 1);
} catch (error) {
  // Only the message of our own errors (status and code; never agent text).
  progress(`failed: ${error instanceof Error ? error.message : 'error'}`);
  process.exit(1);
}
