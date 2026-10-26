import { describe, expect, it } from 'vitest';
import {
  MAX_SESSION_TITLE,
  defaultProjectWorkflow,
  workflowTemplate,
  type WorkflowGraph,
} from '@acp/core';
import { EMPTY_LEDGER, type EngineAgent, type RunState } from '@acp/orchestrator';
import { agentName, capTitle } from '../../src/control/session-names.js';
import { withHelper, withTester } from '../board/graph-helpers.js';

/**
 * Session names (ADR-0024 §1–§2, v0.3.0 S-A): the title the server gives every agent it starts,
 * and the label the app shows. App data only: the ticket key and the workflow block's label (or
 * the role word). Hand-built engine states; synthetic data only.
 */

const T = '2026-10-21T09:00:00.000Z';
const CANARY = 'CANARY-PROMPT-TEXT';

function agent(id: string, kind: EngineAgent['kind'], extra: Partial<EngineAgent> = {}) {
  const a: EngineAgent = {
    id,
    runId: 'run-1',
    parentAgentRunId: kind === 'lead' ? null : 'lead',
    kind,
    // The lead's own words: never part of a name.
    role: `${CANARY} role`,
    task: kind === 'lead' ? null : `${CANARY} task`,
    status: 'RUNNING',
    sessionId: null,
    budgetTokensUsed: 0,
    createdAt: T,
    endedAt: null,
    budgetLimit: 1000,
    latestActivity: null,
    review: null,
    reportedCostUsd: null,
    ...extra,
  };
  return a;
}

function state(agents: EngineAgent[], graph?: WorkflowGraph, ticketId: string | null = 't1') {
  const s: RunState = {
    run: {
      id: 'run-1',
      projectId: 'p1',
      ticketId,
      title: `${CANARY} title`,
      status: 'RUNNING',
      budget: { maxTokensPerAgent: 1000, softCostUsdPerRun: null },
      createdAt: T,
      updatedAt: T,
      endedAt: null,
    },
    agents,
    approvals: [],
    ledger: EMPTY_LEDGER,
  };
  if (graph !== undefined) {
    s.graph = graph;
    s.graphContext = { projectMode: 'manual', approvalCeilings: [], maxConcurrentHelpers: 3 };
  }
  return s;
}

const frontend = (label = 'Frontend helper') =>
  withTester(
    withHelper(workflowTemplate('todays-setup'), { id: 'frontend', label, maxInstances: 2 }),
    null,
  );

const title = (s: RunState, id: string, key: string | null = 'WEB-12') =>
  agentName({ state: s, agentRunId: id, ticketKey: key })?.title;

describe('session titles (ADR-0024 §1)', () => {
  it('names every block of a ticket run by its label', () => {
    const s = state(
      [
        agent('lead', 'lead', { stage: 'orchestrate' }),
        agent('fe', 'worker', { stage: 'frontend' }),
        agent('pool', 'worker', { stage: 'helpers' }),
        agent('cr', 'reviewer', { stage: 'review', reviewsAgentRunId: 'fe' }),
        agent('t', 'tester', { stage: 'unit-tests' }),
      ],
      frontend(),
    );
    expect(title(s, 'lead')).toBe('WEB-12 · Lead');
    expect(title(s, 'fe')).toBe('WEB-12 · Frontend helper');
    expect(title(s, 'pool')).toBe('WEB-12 · Helpers');
    expect(title(s, 'cr')).toBe('WEB-12 · Change reviewer → Frontend helper');
    expect(title(s, 't')).toBe('WEB-12 · Tester');
    expect(agentName({ state: s, agentRunId: 'cr', ticketKey: 'WEB-12' })).toEqual({
      prefix: 'WEB-12',
      label: 'Change reviewer → Frontend helper',
      title: 'WEB-12 · Change reviewer → Frontend helper',
    });
  });

  it('names the planner and the final code reviewer of a version 1 run', () => {
    const s = state([
      agent('planner', 'planner', { stage: 'plan' }),
      agent('lead', 'lead', { stage: 'orchestrate' }),
      agent('fr', 'reviewer', { stage: 'code-review' }),
      agent('w', 'worker'),
    ]);
    const base = defaultProjectWorkflow('p1', T);
    s.workflow = {
      ...base,
      plannerMode: 'separate',
      stages: { ...base.stages, 'code-review': { ...base.stages['code-review'], enabled: true } },
    };
    expect(title(s, 'planner')).toBe('WEB-12 · Planner');
    expect(title(s, 'lead')).toBe('WEB-12 · Lead');
    expect(title(s, 'fr')).toBe('WEB-12 · Code reviewer');
    // No stage recorded (an early Phase 4 row): the pool, by its default label.
    expect(title(s, 'w')).toBe('WEB-12 · Helpers');
    // A block the run's workflow does not have: the role word.
    delete s.workflow;
    expect(title(s, 'fr')).toBe('WEB-12 · Reviewer');
  });

  it('numbers a second agent of the same block, the same at launch and after a reload', () => {
    const agents = [
      agent('lead', 'lead', { stage: 'orchestrate' }),
      agent('p1', 'worker', { stage: 'helpers' }),
      agent('p2', 'worker', { stage: 'helpers' }),
      agent('cr2', 'reviewer', { stage: 'review', reviewsAgentRunId: 'p2' }),
      agent('p3', 'worker', { stage: 'helpers' }),
    ];
    const s = state(agents, frontend());
    expect(title(s, 'p1')).toBe('WEB-12 · Helpers');
    expect(title(s, 'p2')).toBe('WEB-12 · Helpers 2');
    expect(title(s, 'p3')).toBe('WEB-12 · Helpers 3');
    expect(title(s, 'cr2')).toBe('WEB-12 · Change reviewer → Helpers 2');
    // At launch of p2 the later agents did not exist yet: same name.
    expect(title(state(agents.slice(0, 3), frontend()), 'p2')).toBe('WEB-12 · Helpers 2');
  });

  it('finds a reloaded change reviewer’s helper through the review rounds', () => {
    const s = state(
      [
        agent('lead', 'lead', { stage: 'orchestrate' }),
        agent('fe', 'worker', { stage: 'frontend' }),
        // After a restart the state no longer carries `reviewsAgentRunId`.
        agent('cr', 'reviewer', { stage: 'review', status: 'NEEDS_REVIEW' }),
      ],
      frontend(),
    );
    expect(title(s, 'cr')).toBe('WEB-12 · Change reviewer');
    expect(
      agentName({
        state: s,
        agentRunId: 'cr',
        ticketKey: 'WEB-12',
        reviewedAgentRunId: (id) => (id === 'cr' ? 'fe' : undefined),
      })?.title,
    ).toBe('WEB-12 · Change reviewer → Frontend helper');
  });

  it('names agents of a run without a ticket by their role', () => {
    const s = state(
      [agent('lead', 'lead'), agent('w1', 'worker'), agent('w2', 'worker')],
      undefined,
      null,
    );
    expect(title(s, 'lead', null)).toBe('Run · Lead');
    expect(title(s, 'w1', null)).toBe('Run · Helper');
    expect(title(s, 'w2', null)).toBe('Run · Helper 2');
    expect(agentName({ state: s, agentRunId: 'w1', ticketKey: null })?.label).toBe('Helper');
  });

  it('keeps long labels within MAX_SESSION_TITLE, cut cleanly', () => {
    const long = `Frontend ${'x'.repeat(40)}`;
    const s = state(
      [
        agent('lead', 'lead', { stage: 'orchestrate' }),
        agent('fe', 'worker', { stage: 'frontend' }),
        agent('cr', 'reviewer', { stage: 'review', reviewsAgentRunId: 'fe' }),
      ],
      mapLabel(frontend(long), 'review', `Reviewer ${'y'.repeat(45)}`),
    );
    const name = agentName({ state: s, agentRunId: 'cr', ticketKey: 'WEBAPP-123456' });
    expect(name?.title.length).toBeLessThanOrEqual(MAX_SESSION_TITLE);
    expect(name?.title.endsWith('…')).toBe(true);
    expect(name?.title.startsWith('WEBAPP-123456 · Reviewer yyy')).toBe(true);
    expect(name?.label.length).toBeLessThanOrEqual(MAX_SESSION_TITLE);
  });

  it('never splits a surrogate pair when it cuts', () => {
    const emoji = '\u{1F680}';
    for (let n = 110; n < 125; n++) {
      const cut = capTitle(`${'a'.repeat(n)}${emoji.repeat(10)}`);
      expect(cut.length).toBeLessThanOrEqual(MAX_SESSION_TITLE);
      // A lone high surrogate before the ellipsis would be a broken character.
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut)).toBe(false);
      expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut)).toBe(false);
    }
    expect(capTitle('short')).toBe('short');
    expect(capTitle('line\none\u0007 two')).toBe('line one two');
  });

  it('holds no prompt, task, role or ticket text', () => {
    const s = state(
      [
        agent('lead', 'lead', { stage: 'orchestrate' }),
        agent('w', 'worker', { stage: 'frontend' }),
      ],
      frontend(),
    );
    for (const id of ['lead', 'w']) {
      const name = agentName({ state: s, agentRunId: id, ticketKey: 'WEB-12' });
      expect(JSON.stringify(name)).not.toContain(CANARY);
    }
    const cp = state([agent('lead', 'lead'), agent('w', 'worker')], undefined, null);
    expect(
      JSON.stringify(agentName({ state: cp, agentRunId: 'w', ticketKey: null })),
    ).not.toContain(CANARY);
  });

  it('is undefined for an agent the run does not have', () => {
    expect(
      agentName({ state: state([]), agentRunId: 'nope', ticketKey: 'WEB-12' }),
    ).toBeUndefined();
  });
});

function mapLabel(graph: WorkflowGraph, id: string, label: string): WorkflowGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, label } : n)) };
}
