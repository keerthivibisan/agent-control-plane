import { describe, expect, it } from 'vitest';
import { withoutCheckBlocks } from '@acp/core';
import type { ManagedAgentEvent, ManagedProviderId, WorkflowGraph, WorkflowNode } from '@acp/core';
import {
  agentBudgetUsage,
  followUpChat,
  hasLedgerEntry,
  resolveAgentModel,
  resolveAgentProvider,
} from '../src/index.js';
import type { EngineEffect, RunState } from '../src/index.js';
import { POOL, createGraphRun, graphRunning, testGraph } from './graph-helpers.js';
import { LEAD, agentOf, event, makeCtx, newRun, ok, tokens } from './helpers.js';
import { effectsOf, finishTurn, leadTool, sealed } from './loop-helpers.js';

/**
 * ADR-0031 and ADR-0032 in the engine (CX-2): an agent's provider is its node's, else the
 * project's default, else Claude Code; it is fixed on the agent and carried by its start, its
 * session link and its lead's follow-up; usage is deduplicated by (provider, messageId); a node's
 * inherited model must not belong to the other provider. Synthetic data only.
 */

const W = 'w-1';
const STORE = [{ title: 'Store', role: 'Store', detail: 'Persist it.' }];

function graphWith(providers: Record<string, ManagedProviderId>): WorkflowGraph {
  const graph = withoutCheckBlocks(testGraph({ named: false, route: 'lead' }));
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      providers[n.id] === undefined ? n : ({ ...n, provider: providers[n.id] } as WorkflowNode),
    ),
  };
}

const startOf = (effects: readonly EngineEffect[], id: string) =>
  effectsOf(effects, 'start-agent').find((e) => e.agentRunId === id);

describe('resolveAgentProvider', () => {
  it('picks the node, then the project, then Claude Code', () => {
    expect(resolveAgentProvider({ stage: 'codex', project: 'claude-code' })).toBe('codex');
    expect(resolveAgentProvider({ stage: undefined, project: 'codex' })).toBe('codex');
    expect(resolveAgentProvider({ stage: null, project: null })).toBe('claude-code');
    expect(resolveAgentProvider({ stage: 'claude-code', project: 'codex' })).toBe('claude-code');
  });
});

describe('provider-aware resolveAgentModel', () => {
  it('a Codex node skips a Claude project model and agent-file model', () => {
    expect(
      resolveAgentModel({ stage: null, agentFile: null, project: 'sonnet', provider: 'codex' }),
    ).toBeNull();
    expect(
      resolveAgentModel({
        stage: null,
        agentFile: 'claude-opus-4-1',
        project: 'gpt-5-codex',
        provider: 'codex',
      }),
    ).toBe('gpt-5-codex');
  });

  it('a Claude node skips a Codex project model', () => {
    expect(
      resolveAgentModel({ stage: null, agentFile: null, project: 'o3', provider: 'claude-code' }),
    ).toBeNull();
    expect(
      resolveAgentModel({
        stage: null,
        agentFile: 'haiku',
        project: 'o3',
        provider: 'claude-code',
      }),
    ).toBe('haiku');
  });

  it('keeps unknown names and the node’s own model (the graph warns about a mismatch)', () => {
    expect(
      resolveAgentModel({ stage: null, agentFile: null, project: 'custom-1', provider: 'codex' }),
    ).toBe('custom-1');
    expect(
      resolveAgentModel({ stage: 'sonnet', agentFile: null, project: null, provider: 'codex' }),
    ).toBe('sonnet');
  });

  it('without a provider, behaves as before', () => {
    expect(resolveAgentModel({ stage: null, agentFile: null, project: 'sonnet' })).toBe('sonnet');
    expect(resolveAgentModel({ stage: null, agentFile: 'o3', project: 'sonnet' })).toBe('o3');
  });
});

describe('provider on agents and effects', () => {
  it('a graph and project without providers: Claude Code, and no provider on the start', () => {
    const r = ok(createGraphRun(graphWith({})));
    expect(agentOf(r.state, LEAD).provider).toBe('claude-code');
    expect(startOf(r.effects, LEAD)).not.toHaveProperty('provider');
  });

  it('the lead starts with its node’s provider and records it', () => {
    const r = ok(createGraphRun(graphWith({ orchestrate: 'codex' })));
    expect(agentOf(r.state, LEAD).provider).toBe('codex');
    expect(startOf(r.effects, LEAD)).toMatchObject({ provider: 'codex' });
  });

  it('a node without a provider takes the project’s default; its own wins', () => {
    const fromProject = ok(createGraphRun(graphWith({}), { projectProvider: 'codex' }));
    expect(agentOf(fromProject.state, LEAD).provider).toBe('codex');
    expect(startOf(fromProject.effects, LEAD)).toMatchObject({ provider: 'codex' });
    const own = ok(
      createGraphRun(graphWith({ orchestrate: 'claude-code' }), { projectProvider: 'codex' }),
    );
    expect(agentOf(own.state, LEAD).provider).toBe('claude-code');
  });

  it('a helper keeps its node’s provider on every start, session link and usage report', () => {
    let s = graphRunning(graphWith({ [POOL]: 'codex' }), {}, STORE);
    expect(agentOf(s, LEAD).provider).toBe('claude-code');
    const started = ok(leadTool(s, 'start_agent', { role: 'Store', task: 'Build it' }, 'w'));
    expect(agentOf(started.state, W).provider).toBe('codex');
    expect(startOf(started.effects, W)).toMatchObject({ provider: 'codex' });

    const linked = ok(
      event(started.state, W, { type: 'started', providerSessionId: 'thr-w', model: null }),
    );
    expect(effectsOf(linked.effects, 'link-session')).toEqual([
      { type: 'link-session', agentRunId: W, provider: 'codex', providerSessionId: 'thr-w' },
    ]);
    s = ok(
      event(linked.state, W, { type: 'usage', messageId: 'turn:1', tokens: tokens(5, 0, 0, 0) }),
    ).state;
    expect(hasLedgerEntry(s.ledger, 'codex', 'turn:1')).toBe(true);
    expect(hasLedgerEntry(s.ledger, 'claude-code', 'turn:1')).toBe(false);

    s = ok(finishTurn(s, W)).state;
    s = ok(sealed(s, W, 'rv')).state;
    const rework = ok(leadTool(s, 'request_rework', { agentId: W, comments: 'Add a test.' }, 'rw'));
    expect(startOf(rework.effects, W)).toMatchObject({
      rework: { resumeSessionId: 'thr-w' },
      provider: 'codex',
    });
  });

  it('CX-7 C10: the usage a resumed Codex thread replays is charged once (ledger dedup)', () => {
    let s = graphRunning(graphWith({ [POOL]: 'codex' }), {}, STORE);
    s = ok(leadTool(s, 'start_agent', { role: 'Store', task: 'Build it' }, 'w')).state;
    s = ok(event(s, W, { type: 'started', providerSessionId: 'thr-w', model: null })).state;
    const last: ManagedAgentEvent = {
      type: 'usage',
      messageId: 'thr-w:turn-1:300',
      tokens: tokens(9, 3, 0, 0),
    };
    s = ok(event(s, W, last)).state;
    expect(agentBudgetUsage(s.ledger, W).used).toBe(12);
    s = ok(finishTurn(s, W)).state;
    s = ok(sealed(s, W, 'rv')).state;
    s = ok(leadTool(s, 'request_rework', { agentId: W, comments: 'Add a test.' }, 'rw')).state;
    // CX-1 result 2: `thread/resume` repeats the thread's last usage notification.
    s = ok(event(s, W, { type: 'started', providerSessionId: 'thr-w', model: null })).state;
    s = ok(event(s, W, last)).state;
    expect(agentBudgetUsage(s.ledger, W).used).toBe(12);
    // A new request of the rework turn is a new record.
    s = ok(
      event(s, W, { type: 'usage', messageId: 'thr-w:turn-2:310', tokens: tokens(10, 0, 0, 0) }),
    ).state;
    expect(agentBudgetUsage(s.ledger, W).used).toBe(22);
  });

  it('the same message id from agents of two providers is charged to each', () => {
    let s = graphRunning(graphWith({ [POOL]: 'codex' }), {}, STORE);
    s = ok(leadTool(s, 'start_agent', { role: 'Store', task: 'Build it' }, 'w')).state;
    s = ok(event(s, W, { type: 'usage', messageId: 'm1', tokens: tokens(7, 0, 0, 0) })).state;
    s = ok(event(s, LEAD, { type: 'usage', messageId: 'm1', tokens: tokens(4, 0, 0, 0) })).state;
    expect(agentBudgetUsage(s.ledger, W).used).toBe(7);
    expect(agentBudgetUsage(s.ledger, LEAD).used).toBe(4);
  });

  it('the lead’s follow-up carries its provider', () => {
    const s0 = graphRunning(graphWith({ orchestrate: 'codex' }), {}, STORE);
    const ended: RunState = {
      ...s0,
      agents: s0.agents.map((a) => (a.id === LEAD ? { ...a, status: 'SUCCEEDED' } : a)),
    };
    const r = ok(
      followUpChat(ended, 'Why?', makeCtx(20_000), {
        managed: true,
        leadSessionId: 'sess-lead',
        leadProcessActive: false,
      }),
    );
    expect(effectsOf(r.effects, 'start-follow-up')[0]).toMatchObject({ provider: 'codex' });
  });

  it('a control-panel run (no graph) links its lead under Claude Code', () => {
    const run = newRun();
    expect(agentOf(run, LEAD).provider).toBe('claude-code');
  });
});
