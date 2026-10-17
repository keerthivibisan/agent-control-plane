import { defaultProjectWorkflow, migrateWorkflowV1 } from '@acp/core';
import { effectiveMode } from '../../src/index.js';
import type { EngineAgent, RunState } from '../../src/index.js';
import type { GoldenCase } from './cases.js';
import { SCRIPTS } from './scripts.js';
import { SIM_LEAD, SIM_PROJECT, SIM_RUN, simulate } from './sim.js';
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

/**
 * The same case as a graph run: the run's version 1 workflow, with the run's review settings,
 * migrated with `migrateWorkflowV1` and passed as `graph` with the context a v1 run compiles
 * with. The run gets no v1 `workflow` snapshot, so only the graph decides.
 */
export function asGraphRun(config: SimConfig): SimConfig {
  const base = config.workflow ?? defaultProjectWorkflow(SIM_PROJECT, '2026-10-11T09:00:00.000Z');
  const loop = config.loop;
  const workflow =
    loop === undefined
      ? base
      : {
          ...base,
          stages: {
            ...base.stages,
            review: {
              ...base.stages.review,
              reviewer: loop.reviewer,
              maxReworkRounds: loop.rounds,
            },
          },
        };
  const projectMode = config.approvals?.mode ?? 'manual';
  const limits = config.limits ?? { maxConcurrentHelpers: 3, maxDepth: 1 };
  return {
    ...config,
    omitWorkflow: true,
    extra: {
      ...config.extra,
      graph: migrateWorkflowV1(workflow, { projectMode }),
      graphContext: {
        projectMode,
        approvalCeilings: [],
        maxConcurrentHelpers: limits.maxConcurrentHelpers,
      },
    },
  };
}

/** A graph run's launch fields that version 1 runs never carry (ADR-0023 §5). */
export function withoutGraphLaunchFields(trace: string): string {
  return trace.replace(/ autoMode=true/g, '').replace(/ sandbox=true/g, '');
}

/** The mode the server uses since WG-B: the agent's own (`effectiveMode`). */
export function agentModeOf(state: RunState, agent: EngineAgent) {
  return effectiveMode(state, agent);
}
