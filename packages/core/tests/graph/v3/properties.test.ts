// Graph correctness for version 3 (ADR-0037; README "Graph correctness", layers 3 and 4; AR-1):
// - migration equivalence: every template and every graph the version 2 generators and the small
//   graph enumeration produce compiles, migrated, to the same program as the version 2 compiler
//   gave, under several run contexts, has the same verdict, and downgrades back unchanged;
// - generated version 3 graphs (with researchers, planners, fan-outs, custom arrows and labels)
//   validate, compile, and canConnectV3 agrees with the validator on every arrow;
// - every version 3 mutation is refused with its code, and every structural code is reached.
// A failure prints its seed or name. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  GRAPH_MUTATIONS,
  GRAPH_MUTATIONS_V3,
  GraphIssueCodeSchema,
  WORKFLOW_TEMPLATE_IDS,
  WorkflowGraphV3Schema,
  canConnectV3,
  compileWorkflowV2,
  compileWorkflowV3,
  createGraphRng,
  downgradeWorkflowV3,
  enumerateSmallGraphsV3,
  generateValidGraph,
  generateValidGraphV3,
  graphRunDefaults,
  graphRunDefaultsV3,
  migrateWorkflowV2,
  validateWorkflowGraph,
  validateWorkflowGraphV3,
  workflowTemplate,
  type CompileContext,
  type GenerateGraphOptions,
  type GraphIssueCode,
  type WorkflowGraph,
  type WorkflowGraphV3,
} from '../../../src/index.js';

const CONTEXTS: readonly CompileContext[] = [
  { projectMode: 'auto-edits', approvalCeilings: [], maxConcurrentHelpers: 3 },
  {
    projectMode: 'full-auto',
    approvalCeilings: ['full-auto', 'auto'],
    maxConcurrentHelpers: 5,
    projectProvider: 'codex',
  },
  { projectMode: 'manual', approvalCeilings: [], maxConcurrentHelpers: 2, reviewer: 'lead' },
  {
    projectMode: 'auto',
    approvalCeilings: ['manual'],
    maxConcurrentHelpers: 4,
    maxReworkRounds: 1,
  },
];

const OPTION_SETS: readonly [string, GenerateGraphOptions, number][] = [
  ['base', {}, 600],
  ['checks', { checkBlocks: true }, 300],
  ['optional checks', { optionalChecks: true }, 300],
];

function errorCodes(graph: WorkflowGraphV3): GraphIssueCode[] {
  return validateWorkflowGraphV3(graph)
    .filter((i) => i.severity === 'error')
    .map((i) => i.code);
}

function equivalenceFailures(name: string, v2: WorkflowGraph): string[] {
  const out: string[] = [];
  const v3 = migrateWorkflowV2(v2);
  if (!WorkflowGraphV3Schema.safeParse(v3).success) out.push(`${name}: not a version 3 shape`);
  const v2Valid = validateWorkflowGraph(v2).every((i) => i.severity !== 'error');
  const v3Codes = errorCodes(v3);
  if (v2Valid && v3Codes.length > 0) out.push(`${name}: version 3 refuses (${v3Codes.join(', ')})`);
  if (!v2Valid) return out;
  for (const ctx of CONTEXTS) {
    const before = JSON.stringify(compileWorkflowV2(v2, ctx));
    const after = JSON.stringify(compileWorkflowV3(v3, ctx));
    if (before !== after) out.push(`${name}: programs differ for ${JSON.stringify(ctx)}`);
  }
  if (JSON.stringify(graphRunDefaultsV3(v3)) !== JSON.stringify(graphRunDefaults(v2))) {
    out.push(`${name}: run defaults differ`);
  }
  const back = downgradeWorkflowV3(v3);
  if (!back.ok) out.push(`${name}: downgrade refused (${back.reason})`);
  else {
    try {
      expect(back.graph).toEqual(v2);
    } catch {
      out.push(`${name}: downgrade is not the original`);
    }
  }
  return out;
}

describe('migration equivalence (version 2 → 3)', () => {
  it('every template, planner on and off', () => {
    const failures = WORKFLOW_TEMPLATE_IDS.flatMap((id) =>
      [false, true].flatMap((planner) =>
        equivalenceFailures(`${id}/${planner}`, workflowTemplate(id, { planner })),
      ),
    );
    expect(failures).toEqual([]);
  });

  it.each(OPTION_SETS)('every generated graph (%s)', (label, opts, seeds) => {
    const failures: string[] = [];
    for (let seed = 0; seed < seeds && failures.length < 3; seed++) {
      failures.push(
        ...equivalenceFailures(`${label} seed ${seed}`, generateValidGraph(seed, opts)),
      );
    }
    expect(failures).toEqual([]);
  });

  it('every small graph: the same verdict, and the same program when valid', () => {
    const failures: string[] = [];
    for (const { name, graph, v3 } of enumerateSmallGraphsV3()) {
      const v2Valid = validateWorkflowGraph(graph).every((i) => i.severity !== 'error');
      const v3Valid = errorCodes(v3).length === 0;
      if (v2Valid !== v3Valid) failures.push(`${name}: v2 ${v2Valid}, v3 ${v3Valid}`);
      else if (v2Valid) failures.push(...equivalenceFailures(name, graph));
      if (failures.length >= 3) break;
    }
    expect(failures).toEqual([]);
  });

  it('every version 2 mutant stays refused after migration', () => {
    const failures: string[] = [];
    for (let seed = 0; seed < 300; seed++) {
      const base = generateValidGraph(seed, { checkBlocks: seed % 2 === 0 });
      for (const mutation of GRAPH_MUTATIONS) {
        const mutant = mutation.apply(base, createGraphRng(seed));
        if (mutant === null) continue;
        if (errorCodes(migrateWorkflowV2(mutant)).length === 0) {
          failures.push(`seed ${seed}: ${mutation.name} is accepted in version 3`);
        }
      }
      if (failures.length >= 3) break;
    }
    expect(failures).toEqual([]);
  });
});

const seenCodes = new Set<GraphIssueCode>();

describe('generated version 3 graphs', () => {
  const graphs = Array.from({ length: 500 }, (_, seed) => ({
    seed,
    graph: generateValidGraphV3(seed, { checkBlocks: seed % 3 === 0, v3Moves: (seed % 7) + 1 }),
  }));

  it('use the version 3 moves (researchers, planners, fan-outs, custom arrows, labels)', () => {
    const edges = graphs.flatMap(({ graph }) => graph.edges);
    expect(edges.some((e) => e.type === 'research')).toBe(true);
    expect(edges.some((e) => e.type === 'custom')).toBe(true);
    expect(edges.some((e) => e.label !== undefined || e.purpose !== undefined)).toBe(true);
    expect(
      graphs.some(({ graph }) => graph.edges.filter((e) => e.type === 'plan').length > 1),
    ).toBe(true);
    expect(
      graphs.some(({ graph }) => {
        const from = graph.edges.filter((e) => e.type === 'review').map((e) => e.from);
        return new Set(from).size < from.length;
      }),
    ).toBe(true);
  });

  it('validate, compile, and hold their research and custom arrows in the program', () => {
    const failures: string[] = [];
    for (const { seed, graph } of graphs) {
      const codes = errorCodes(graph);
      if (codes.length > 0) {
        failures.push(`seed ${seed}: ${codes.join(', ')}`);
        continue;
      }
      const p = compileWorkflowV3(
        graph,
        CONTEXTS[0] ?? { projectMode: 'auto', approvalCeilings: [], maxConcurrentHelpers: 3 },
      );
      const research = graph.edges.filter((e) => e.type === 'research').length;
      if (p.researchers.flatMap((r) => r.targets).length !== research) {
        failures.push(`seed ${seed}: research arrows missing from the program`);
      }
      if (p.handoffs.length !== graph.edges.filter((e) => e.type === 'custom').length) {
        failures.push(`seed ${seed}: hand-offs missing from the program`);
      }
      if (p.planners.length !== graph.edges.filter((e) => e.type === 'plan').length) {
        failures.push(`seed ${seed}: planners missing from the program`);
      }
      if (failures.length >= 3) break;
    }
    expect(failures).toEqual([]);
  });

  it('canConnectV3 accepts every arrow of a valid graph, drawn last', () => {
    const failures: string[] = [];
    for (const { seed, graph } of graphs.slice(0, 200)) {
      graph.edges.forEach((edge, i) => {
        const others = { ...graph, edges: graph.edges.filter((_, j) => j !== i) };
        const result = canConnectV3(others, edge.from, edge.to, edge.type);
        if (!result.ok) failures.push(`seed ${seed}: ${edge.id}: ${result.message}`);
      });
      if (failures.length >= 3) break;
    }
    expect(failures).toEqual([]);
  });

  it('every version 3 mutation is refused with its code', () => {
    const failures: string[] = [];
    const applied = new Set<string>();
    for (const { seed, graph } of graphs) {
      for (const mutation of GRAPH_MUTATIONS_V3) {
        const mutant = mutation.apply(graph, createGraphRng(seed));
        if (mutant === null) continue;
        applied.add(mutation.name);
        const codes = errorCodes(mutant);
        for (const code of codes) seenCodes.add(code);
        if (!codes.includes(mutation.expectedCode)) {
          failures.push(`seed ${seed}: ${mutation.name}: ${codes.join(', ') || 'accepted'}`);
        }
        try {
          compileWorkflowV3(
            mutant,
            CONTEXTS[0] ?? { projectMode: 'auto', approvalCeilings: [], maxConcurrentHelpers: 3 },
          );
          failures.push(`seed ${seed}: ${mutation.name}: compiled`);
        } catch {
          // refused, as it must be
        }
      }
      if (failures.length >= 3) break;
    }
    expect(failures).toEqual([]);
    expect([...applied].sort()).toEqual(GRAPH_MUTATIONS_V3.map((m) => m.name).sort());
  });

  it('rule coverage: every structural code is reached by a version 3 refusal', () => {
    for (let seed = 0; seed < 300; seed++) {
      const base = generateValidGraph(seed, { optionalChecks: seed % 2 === 0 });
      for (const mutation of GRAPH_MUTATIONS) {
        const mutant = mutation.apply(base, createGraphRng(seed));
        if (mutant !== null)
          for (const c of errorCodes(migrateWorkflowV2(mutant))) seenCodes.add(c);
      }
    }
    for (const { v3 } of enumerateSmallGraphsV3()) for (const c of errorCodes(v3)) seenCodes.add(c);
    const notStructural: readonly GraphIssueCode[] = [
      'missing-skill',
      'missing-agent-file',
      'full-auto-plan-manual',
      'plan-auto-without-full-auto',
      'instances-over-limit',
      'unknown-check',
      'unknown-check-label',
      'no-checks-selected',
      'merge-skips-required',
      'no-checks',
      'model-provider-mismatch',
      'codex-skills-ignored',
      'codex-agent-tools',
      // Version 3 has no such refusal: the implement arrow is what makes an agent a helper, so an
      // agent without one has no role (`agent-without-role`).
      'not-assigned',
    ];
    const dead = GraphIssueCodeSchema.options.filter(
      (c) => !notStructural.includes(c) && !seenCodes.has(c),
    );
    expect(dead).toEqual([]);
  });
});
