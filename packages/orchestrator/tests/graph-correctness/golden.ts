import type { EngineAgent, RunState } from '../../src/index.js';
import type { GoldenCase } from './cases.js';
import { SCRIPTS } from './scripts.js';
import { SIM_LEAD, SIM_RUN, simulate } from './sim.js';
import type { SimConfig, SimHooks, SimResult } from './sim.js';
import { IdNames, effectLine, finalLines, shortText, stateDiff, traceDigest } from './trace.js';

/**
 * Runs one golden case through the simulator and renders its normalized trace (layer 5).
 * `modeOf` is how the fake server picks an agent's approval mode for its gate and allowlist.
 */
export function goldenTrace(
  c: GoldenCase,
  modeOf: SimHooks['modeOf'],
  configure: (config: SimConfig) => SimConfig = (config) => config,
): { trace: string; digest: string; result: SimResult } {
  const names = new IdNames(SIM_RUN, SIM_LEAD);
  const lines: string[] = [];
  const result = simulate(configure(c.config), SCRIPTS[c.script](), {
    modeOf,
    onStep: (step) => {
      names.learn(step.after);
      const r = step.result;
      const verdict = r === null ? 'server' : r.ok ? 'ok' : `refused:${r.refusal.code}`;
      lines.push(
        `#${step.index} ${step.actor} ${shortText(names.text(step.action))} -> ${verdict}`,
      );
      if (r !== null && r.ok) {
        if (typeof r.value === 'string') lines.push(`  = ${shortText(names.text(r.value))}`);
        for (const e of r.effects) lines.push(`  > ${effectLine(names, e)}`);
        for (const d of stateDiff(names, step.before, step.after)) lines.push(`  ~ ${d}`);
      } else if (r !== null) {
        lines.push(`  ! ${shortText(names.text(r.refusal.message))}`);
      }
    },
  });
  const tail = [
    `outcome=${result.outcome} steps=${result.steps}`,
    ...finalLines(names, result.state),
  ];
  const trace = [...lines, ...tail].join('\n');
  return { trace, digest: [`digest=${traceDigest(trace)}`, ...tail].join('\n'), result };
}

/** The mode the server used before WG-B: the run's snapshotted policy, for every agent. */
export function runModeOf(state: RunState, _agent: EngineAgent) {
  return state.approvalPolicy?.mode;
}
