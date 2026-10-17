// Graph correctness, core part (README "Graph correctness", layers 3 and 4):
// - layer 3: seeded random valid graphs (legal moves only) validate and compile; every single
//   mutation of them is refused with its specific code and compile throws; canConnect and the
//   validator agree on every edge of every generated and mutated graph;
// - layer 4: every small graph (legal and illegal) is refused by the validator exactly when compile
//   throws, and every structural error code is the reason for some refusal (no dead rules).
// The simulator-backed soundness and completeness checks are WG-B's. A failure prints its seed
// and graph. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  GRAPH_MUTATIONS,
  GraphIssueCodeSchema,
  WorkflowGraphSchema,
  canConnect,
  compileWorkflow,
  createGraphRng,
  enumerateSmallGraphs,
  generateValidGraph,
  validateWorkflowGraph,
  type CompileContext,
  type GraphIssueCode,
  type WorkflowGraph,
} from '../../src/index.js';

const SEEDS = 2000;
const ctx: CompileContext = {
  projectMode: 'auto-edits',
  approvalCeilings: [],
  maxConcurrentHelpers: 3,
};

const WARNING_CODES: readonly GraphIssueCode[] = [
  'missing-skill',
  'missing-agent-file',
  'full-auto-plan-manual',
  'plan-auto-without-full-auto',
  'instances-over-limit',
];
/** Structural error codes no generated, mutated or enumerated graph needs to reach, with why. */
const EXCLUDED_CODES: Readonly<Partial<Record<GraphIssueCode, string>>> = {};
const STRUCTURAL_CODES = GraphIssueCodeSchema.options.filter(
  (c) => !WARNING_CODES.includes(c) && EXCLUDED_CODES[c] === undefined,
);
const EDGE_CODES: readonly GraphIssueCode[] = [
  'edge-unknown-node',
  'self-edge',
  'edge-not-allowed',
  'duplicate-edge',
];

function compiles(graph: WorkflowGraph): boolean {
  try {
    compileWorkflow(graph, ctx);
    return true;
  } catch {
    return false;
  }
}

function describeFailure(label: string, graph: WorkflowGraph, detail: unknown): string {
  return `${label}: ${JSON.stringify(detail)}\ngraph: ${JSON.stringify(graph)}`;
}

/**
 * canConnect (edge i against the edges before it, as drawn in order) refuses exactly the edges the
 * validator reports an edge code on, with the same code. When the graph has no repeated
 * (from, to, type), checking edge i against all the other edges (the editor's view) agrees too.
 */
function agreementFailures(graph: WorkflowGraph): string[] {
  const ids = graph.edges.map((e) => e.id);
  if (new Set(ids).size !== ids.length) return []; // edge ids are ambiguous; the id rule covers it
  const issues = validateWorkflowGraph(graph).filter((i) => EDGE_CODES.includes(i.code));
  const keys = graph.edges.map((e) => `${e.type} ${e.from} ${e.to}`);
  const noRepeats = new Set(keys).size === keys.length;
  const failures: string[] = [];
  graph.edges.forEach((edge, i) => {
    const prefix = canConnect(
      { nodes: graph.nodes, edges: graph.edges.slice(0, i) },
      edge.from,
      edge.to,
      edge.type,
    );
    const reported = issues.filter((x) => x.edgeId === edge.id).map((x) => x.code);
    const expected = prefix.ok ? [] : [prefix.code];
    if (JSON.stringify(reported) !== JSON.stringify(expected)) {
      failures.push(
        `edge ${edge.id}: canConnect ${JSON.stringify(expected)} vs validator ${JSON.stringify(reported)}`,
      );
    }
    if (noRepeats) {
      const others = graph.edges.filter((_, j) => j !== i);
      const editor = canConnect(
        { nodes: graph.nodes, edges: others },
        edge.from,
        edge.to,
        edge.type,
      );
      if (editor.ok !== prefix.ok)
        failures.push(`edge ${edge.id}: editor view ${editor.ok} vs ${prefix.ok}`);
    }
  });
  return failures;
}

describe('layer 3: generated valid graphs and their mutants', () => {
  const graphs = Array.from({ length: SEEDS }, (_, i) => ({
    seed: i + 1,
    graph: generateValidGraph(i + 1),
  }));
  const seenCodes = new Set<GraphIssueCode>();

  it('createGraphRng is seeded and stays in range', () => {
    const a = createGraphRng(7);
    const b = createGraphRng(7);
    const draws = Array.from({ length: 200 }, () => a.next());
    expect(Array.from({ length: 200 }, () => b.next())).toEqual(draws);
    expect(draws.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(draws).size).toBe(200);
    const r = createGraphRng(1);
    expect(Array.from({ length: 100 }, () => r.int(3)).every((x) => x >= 0 && x < 3)).toBe(true);
    expect(() => r.pick([])).toThrow();
  });

  it('is deterministic for a seed', () => {
    expect(generateValidGraph(42)).toEqual(generateValidGraph(42));
    expect(generateValidGraph(42)).not.toEqual(generateValidGraph(43));
  });

  it(`accepts and compiles every generated graph (${SEEDS} seeds)`, () => {
    const failures: string[] = [];
    for (const { seed, graph } of graphs) {
      const parsed = WorkflowGraphSchema.safeParse(graph);
      const errs = validateWorkflowGraph(graph, { projectMode: ctx.projectMode }).filter(
        (i) => i.severity === 'error',
      );
      if (!parsed.success || errs.length > 0 || !compiles(graph)) {
        failures.push(
          describeFailure(`seed ${seed}`, graph, parsed.success ? errs : parsed.error.issues),
        );
      }
    }
    expect(failures.slice(0, 3)).toEqual([]);
  });

  it('explores the building blocks: planners, named helpers, testers, final reviewers and routes a, b, c', () => {
    const seen = new Set<string>();
    for (const { graph } of graphs) {
      const program = compileWorkflow(graph, ctx);
      if (program.planner !== null) seen.add('planner');
      if (program.planner === null) seen.add('no planner');
      if (program.helpers.some((h) => h.type === 'helper')) seen.add('named helper');
      if (!program.helpers.some((h) => h.type === 'helper-pool')) seen.add('no pool');
      if (program.finalStages.some((s) => s.type === 'tester')) seen.add('tester');
      if (program.finalStages.some((s) => s.type === 'reviewer')) seen.add('final reviewer');
      if (program.finalStages.length >= 2) seen.add('two final stages');
      if (program.changeReviewers.length >= 2) seen.add('two change reviewers');
      if (Object.values(program.nodeModes).some((m) => m.sandbox)) seen.add('full auto node');
      if (program.planAutoApprove) seen.add('plan auto');
      for (const route of [...program.helpers.map((h) => h.review)]) {
        seen.add(route.by === 'lead' ? 'route a' : route.then === 'lead' ? 'route b' : 'route c');
      }
    }
    expect([...seen].sort()).toEqual(
      [
        'planner',
        'no planner',
        'named helper',
        'no pool',
        'tester',
        'final reviewer',
        'two final stages',
        'two change reviewers',
        'full auto node',
        'plan auto',
        'route a',
        'route b',
        'route c',
      ].sort(),
    );
  });

  it('refuses every mutant with its specific code, and compile throws', () => {
    const failures: string[] = [];
    const applied = new Map<string, number>();
    for (const { seed, graph } of graphs) {
      const rng = createGraphRng(seed * 7919);
      for (const mutation of GRAPH_MUTATIONS) {
        const mutant = mutation.apply(graph, rng);
        if (mutant === null) continue;
        applied.set(mutation.name, (applied.get(mutation.name) ?? 0) + 1);
        const codes = validateWorkflowGraph(mutant)
          .filter((i) => i.severity === 'error')
          .map((i) => i.code);
        for (const code of codes) seenCodes.add(code);
        if (!codes.includes(mutation.expectedCode) || compiles(mutant)) {
          failures.push(
            describeFailure(`seed ${seed}, mutation "${mutation.name}"`, mutant, codes),
          );
        }
      }
    }
    expect(failures.slice(0, 3)).toEqual([]);
    // every mutation applied to some graph
    expect(
      GRAPH_MUTATIONS.filter((m) => (applied.get(m.name) ?? 0) === 0).map((m) => m.name),
    ).toEqual([]);
  });

  it('canConnect and the validator agree on every edge of every generated and mutated graph', () => {
    const failures: string[] = [];
    for (const { seed, graph } of graphs) {
      for (const f of agreementFailures(graph)) failures.push(`seed ${seed}: ${f}`);
      const rng = createGraphRng(seed * 7919);
      for (const mutation of GRAPH_MUTATIONS) {
        const mutant = mutation.apply(graph, rng);
        if (mutant === null) continue;
        for (const f of agreementFailures(mutant)) {
          failures.push(
            describeFailure(`seed ${seed}, mutation "${mutation.name}": ${f}`, mutant, null),
          );
        }
      }
    }
    expect(failures.slice(0, 3)).toEqual([]);
  });

  describe('layer 4: every small graph', () => {
    const small = [...enumerateSmallGraphs()];

    it('enumerates a few thousand distinct graphs, legal and illegal', () => {
      expect(small.length).toBeGreaterThan(2000);
      expect(small.length).toBeLessThan(6000);
      expect(new Set(small.map((s) => s.name)).size).toBe(small.length);
      expect(
        small.filter((s) => !WorkflowGraphSchema.safeParse(s.graph).success).map((s) => s.name),
      ).toEqual([]);
      const valid = small.filter((s) =>
        validateWorkflowGraph(s.graph).every((i) => i.severity !== 'error'),
      );
      expect(valid.length).toBeGreaterThan(500);
      expect(valid.length).toBeLessThan(small.length);
    });

    it('validator errors ⇔ compile throws, and canConnect agrees with the validator', () => {
      const failures: string[] = [];
      for (const { name, graph } of small) {
        const codes = validateWorkflowGraph(graph)
          .filter((i) => i.severity === 'error')
          .map((i) => i.code);
        for (const code of codes) seenCodes.add(code);
        if ((codes.length === 0) !== compiles(graph))
          failures.push(describeFailure(name, graph, codes));
        for (const f of agreementFailures(graph))
          failures.push(describeFailure(`${name}: ${f}`, graph, null));
      }
      expect(failures.slice(0, 3)).toEqual([]);
    });

    it('rule coverage: every structural error code is the reason for some refusal', () => {
      // runs after the mutant and small-graph tests above (vitest runs a file's tests in order)
      const dead = STRUCTURAL_CODES.filter((c) => !seenCodes.has(c));
      expect(dead).toEqual([]);
      expect(Object.keys(EXCLUDED_CODES)).toEqual([]);
    });
  });
});
