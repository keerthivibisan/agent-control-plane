import {
  workflowTemplate,
  type ApprovalMode,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from '@acp/core';
import type { StartTicketRequest } from '@acp/core/api';
import type { AutopilotScript } from '../autopilot.js';

/*
 * The four WG-V real-run scenarios (docs/workflow-graph/RESUME.md Step 4; README "every review
 * scenario must be expressible"), vitest-free. Each one is a project mode, a stored graph, the
 * ticket the owner writes, the run's own options at Start and, for `--dry-run` only, the script
 * the fake agents follow. Every text is synthetic; the repositories are throwaway.
 *
 * Node ids follow core's templates: `orchestrate` is the lead, `helpers` the pool, `review` the
 * change reviewer, `unit-tests` the tester.
 */

export const SCENARIO_IDS = ['a', 'b', 'c', 'mixed'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const LEAD = 'orchestrate';
export const POOL = 'helpers';
export const CHANGE_REVIEWER = 'review';
export const TESTER = 'unit-tests';
export const FRONTEND = 'frontend';

/** The review skill (b, c): it asks for a test with each new module, so (c) likely loops. */
export const REVIEW_SKILL = {
  name: 'review-tests',
  description: 'How to review one helper change.',
  instructions:
    'Approve a change only if every new .mjs module it adds has a matching test file ' +
    'test/<name>.test.mjs that uses node:test. Otherwise ask for rework and name the missing ' +
    'test files. Keep the findings to three short sentences.\n',
};

export interface Scenario {
  id: ScenarioId;
  /** What it shows, in one line (the summary's `about`). */
  about: string;
  projectKey: string;
  projectMode: ApprovalMode;
  /** Project skills created and committed before the graph is saved. */
  skills: (typeof REVIEW_SKILL)[];
  graph: WorkflowGraph;
  ticket: { title: string; description: string };
  /** The run's own options at Start (its ceilings). */
  start: StartTicketRequest;
  /** What the summary must show for this scenario (beyond the invariants every run checks). */
  expect: {
    /** Who reviews helper changes: the lead itself (a) or a change reviewer (b, c, mixed: lead). */
    reviewer: 'lead' | 'agent';
    /** Route (c): the reviewer may send a change back itself (`decidedBy: reviewer`). */
    direct: boolean;
    planAuto: boolean;
    /** A Full auto block a ceiling tightened (it must keep the sandbox in `default`). */
    tightenedFullAuto: boolean;
    /** Nodes that must have run an agent. */
    nodes: string[];
  };
  /** `--dry-run`: what the fake agents do. */
  dryRun: AutopilotScript;
}

function mapNodes(graph: WorkflowGraph, f: (n: WorkflowNode) => WorkflowNode): WorkflowGraph {
  return { ...graph, template: 'custom', nodes: graph.nodes.map(f) };
}

function poolMode(graph: WorkflowGraph, mode: ApprovalMode | null): WorkflowGraph {
  return mapNodes(graph, (n) => (n.type === 'helper-pool' ? { ...n, approvalMode: mode } : n));
}

function reviewerSkill(graph: WorkflowGraph, skill: string): WorkflowGraph {
  return mapNodes(graph, (n) =>
    n.type === 'reviewer' && n.scope === 'change' ? { ...n, skills: [skill] } : n,
  );
}

function planAuto(graph: WorkflowGraph): WorkflowGraph {
  return mapNodes(graph, (n) => (n.type === 'plan-approval' ? { ...n, auto: true } : n));
}

/** A named helper the lead assigns; the lead reviews its change (route a, no rework edge). */
function withNamedHelper(graph: WorkflowGraph, mode: ApprovalMode): WorkflowGraph {
  const edges: WorkflowEdge[] = [
    { type: 'assigns', id: `assigns-${FRONTEND}`, from: LEAD, to: FRONTEND },
    { type: 'review', id: `review-${FRONTEND}`, from: FRONTEND, to: LEAD },
  ];
  return {
    ...graph,
    template: 'custom',
    nodes: [
      ...graph.nodes,
      {
        type: 'helper',
        id: FRONTEND,
        label: 'Frontend helper',
        description: 'Writes the web page',
        model: null,
        skills: [],
        agent: null,
        approvalMode: mode,
        maxInstances: 1,
        canStartHelpers: false,
      },
    ],
    edges: [...graph.edges, ...edges],
  };
}

/** A tester between the ticket merge and the owner's merge (project mode); the lead reviews it. */
function withTester(graph: WorkflowGraph): WorkflowGraph {
  const edges = graph.edges.filter(
    (e) => !(e.type === 'flow' && e.from === 'ticket-merge' && e.to === 'owner-merge'),
  );
  return {
    ...graph,
    template: 'custom',
    nodes: [
      ...graph.nodes,
      {
        type: 'tester',
        id: TESTER,
        label: 'Tester',
        model: null,
        skills: [],
        agent: null,
        approvalMode: null,
      },
    ],
    edges: [
      ...edges,
      { type: 'flow', id: 'flow-merge-tester', from: 'ticket-merge', to: TESTER },
      { type: 'flow', id: 'flow-tester-owner', from: TESTER, to: 'owner-merge' },
      { type: 'review', id: 'review-tester', from: TESTER, to: LEAD },
    ],
  };
}

const SLUG =
  'export function slugify(text) {\n  return text.trim().toLowerCase().split(/\\s+/).join("-");\n}\n';
const SLUG_TEST = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { slugify } from '../src/slug.mjs';",
  "test('slugify', () => assert.equal(slugify(' Hello World '), 'hello-world'));",
  '',
].join('\n');
const SLUG_FILES = { 'src/slug.mjs': SLUG, 'test/slug.test.mjs': SLUG_TEST };

const ONE_HELPER_PLAN = [
  { title: 'Slugify module', role: 'Module builder', detail: 'src/slug.mjs' },
];

const SLUG_TICKET = {
  title: 'Add a slugify module',
  description:
    'One helper: add src/slug.mjs exporting slugify(text) that lowercases, trims and joins ' +
    'words with "-", and test/slug.test.mjs that checks it with node:test. Keep it tiny.',
};

export function scenario(id: ScenarioId): Scenario {
  switch (id) {
    case 'a':
      return {
        id,
        about: 'route (a): the lead reviews and merges each change itself',
        projectKey: 'WGVA',
        projectMode: 'auto-edits',
        skills: [],
        graph: workflowTemplate('lead-only'),
        ticket: SLUG_TICKET,
        start: {},
        expect: {
          reviewer: 'lead',
          direct: false,
          planAuto: false,
          tightenedFullAuto: false,
          nodes: [LEAD, POOL],
        },
        dryRun: { plan: ONE_HELPER_PLAN, helperFiles: () => SLUG_FILES },
      };
    case 'b':
      // The pool is configured Full auto and the run's ceiling tightens it to Auto edits: the
      // helper must keep the OS sandbox while its session stays in `default` (ADR-0023 §5).
      return {
        id,
        about:
          'route (b): a change reviewer sends its findings to the lead, who decides; ' +
          'the Full auto pool is tightened to Auto edits by the run and keeps the sandbox',
        projectKey: 'WGVB',
        projectMode: 'auto-edits',
        skills: [REVIEW_SKILL],
        graph: reviewerSkill(
          poolMode(workflowTemplate('todays-setup'), 'full-auto'),
          'review-tests',
        ),
        ticket: SLUG_TICKET,
        start: { approvalMode: 'auto-edits' },
        expect: {
          reviewer: 'agent',
          direct: false,
          planAuto: false,
          tightenedFullAuto: true,
          nodes: [LEAD, POOL, CHANGE_REVIEWER],
        },
        dryRun: { plan: ONE_HELPER_PLAN, helperFiles: () => SLUG_FILES },
      };
    case 'c':
      // The ticket does not mention tests while the review skill asks for them, so a first
      // round of direct rework is likely in a real run (not forced); the dry run scripts it.
      return {
        id,
        about:
          'route (c): the change reviewer sends a change straight back to its helper, ' +
          'telling the lead; the lead then merges',
        projectKey: 'WGVC',
        projectMode: 'auto-edits',
        skills: [REVIEW_SKILL],
        graph: reviewerSkill(workflowTemplate('reviewer-helper-loop'), 'review-tests'),
        ticket: {
          title: 'Add a slugify module',
          description:
            'One helper: add src/slug.mjs exporting slugify(text) that lowercases, trims and ' +
            'joins words with "-". Keep it tiny.',
        },
        start: {},
        expect: {
          reviewer: 'agent',
          direct: true,
          planAuto: false,
          tightenedFullAuto: false,
          nodes: [LEAD, POOL, CHANGE_REVIEWER],
        },
        dryRun: {
          plan: ONE_HELPER_PLAN,
          helperFiles: (_role, round) =>
            round === 0 ? { 'src/slug.mjs': SLUG } : { 'test/slug.test.mjs': SLUG_TEST },
          verdict: (_role, round) => (round === 0 ? 'rework' : 'approve'),
        },
      };
    case 'mixed':
      // A Manual named helper, a Full auto pool and an Auto edits tester (the project's mode);
      // the plan gate approves by itself (no ceiling, a Full auto block).
      return {
        id,
        about:
          'mixed modes: a Manual named helper, a Full auto pool and an Auto edits tester; ' +
          'the plan gate approves automatically',
        projectKey: 'WGVM',
        projectMode: 'auto-edits',
        skills: [],
        graph: withTester(
          withNamedHelper(planAuto(poolMode(workflowTemplate('lead-only'), 'full-auto')), 'manual'),
        ),
        ticket: {
          title: 'Add a slug page and module',
          description:
            'Two parts, one helper each: (1) for the Frontend helper, web/index.html, a page with ' +
            'the heading "Slug"; (2) for a pool helper, src/slug.mjs exporting slugify(text) that ' +
            'lowercases, trims and joins words with "-", with test/slug.test.mjs using node:test. ' +
            'Keep both tiny.',
        },
        start: {},
        expect: {
          reviewer: 'lead',
          direct: false,
          planAuto: true,
          tightenedFullAuto: false,
          nodes: [LEAD, POOL, FRONTEND, TESTER],
        },
        dryRun: {
          plan: [
            {
              title: 'Slug page',
              role: 'Page builder',
              detail: 'web/index.html',
              helper: FRONTEND,
            },
            { title: 'Slugify module', role: 'Module builder', detail: 'src/slug.mjs' },
          ],
          helperFiles: (role) =>
            role === 'Page builder' ? { 'web/index.html': '<h1>Slug</h1>\n' } : SLUG_FILES,
          testerFiles: {
            'test/page.test.mjs': [
              "import { test } from 'node:test';",
              "import assert from 'node:assert/strict';",
              "import { readFileSync } from 'node:fs';",
              "test('page', () => assert.match(readFileSync('web/index.html', 'utf8'), /Slug/));",
              '',
            ].join('\n'),
          },
          // The Manual helper asks even for its own edit (the owner allows it); the Full auto
          // pool's command is decided without asking; the Auto edits tester's command asks (the
          // owner denies it).
          asks: (role) => {
            if (role === 'Page builder') {
              return [
                {
                  toolName: 'Write',
                  summary: 'Write web/index.html',
                  input: { file_path: '{cwd}/web/index.html' },
                },
              ];
            }
            if (role === 'tester') {
              return [
                {
                  toolName: 'Bash',
                  summary: 'Bash curl',
                  input: { command: 'curl https://x.test' },
                },
              ];
            }
            return [
              { toolName: 'Bash', summary: 'Bash curl', input: { command: 'curl https://x.test' } },
            ];
          },
        },
      };
  }
}
