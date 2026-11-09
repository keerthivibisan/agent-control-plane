import { ASSISTANT_CONTROL_TOOL_NAMES, AgentRunSchema, RunAgentKindSchema } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { controlToolsFor, leadToolCall } from '../src/index.js';
import type { EngineAgent, RunState } from '../src/index.js';
import { LEAD, REGISTERED, makeCtx, refused, runningRun } from './helpers.js';

/**
 * ADR-0035: the project assistant is never an agent of a run. The engine never launches it, never
 * answers its tools, and refuses it as a run's agent or plan role.
 */

const call = (state: RunState, name: string, input: unknown, caller = LEAD) =>
  leadToolCall(
    state,
    { callerAgentRunId: caller, name, input, registeredProjectIds: REGISTERED },
    makeCtx(5000, 'n'),
  );

describe('the assistant role in the engine (ADR-0035)', () => {
  it("refuses the assistant's tools from every agent of a run, the lead included", () => {
    for (const name of ASSISTANT_CONTROL_TOOL_NAMES) {
      const r = call(runningRun(), name, {});
      expect(refused(r), name).toBe('not-lead');
      if (!r.ok) expect(r.refusal.message).toContain('project assistant');
    }
  });

  it('never offers them to the lead', () => {
    const tools = controlToolsFor(runningRun(), LEAD);
    for (const name of ASSISTANT_CONTROL_TOOL_NAMES) expect(tools).not.toContain(name);
  });

  it('refuses an agent of a run that claims the assistant role, for every tool', () => {
    const state = runningRun();
    const lead = state.agents.find((a) => a.id === LEAD);
    if (lead === undefined) throw new Error('no lead');
    const forged = { ...lead, id: 'forged', kind: 'assistant' } as unknown as EngineAgent;
    const withForged: RunState = { ...state, agents: [...state.agents, forged] };
    for (const name of ['start_agent', 'submit_plan', 'ticket_status', 'code_map']) {
      expect(refused(call(withForged, name, {}, 'forged')), name).toBe('not-lead');
    }
  });

  it('cannot be stored or launched as a run agent kind', () => {
    expect(RunAgentKindSchema.safeParse('assistant').success).toBe(false);
    for (const kind of ['lead', 'planner', 'worker', 'reviewer', 'tester']) {
      expect(RunAgentKindSchema.safeParse(kind).success).toBe(true);
    }
    const lead = runningRun().agents.find((a) => a.id === LEAD);
    expect(AgentRunSchema.safeParse(lead).success).toBe(true);
    expect(AgentRunSchema.safeParse({ ...lead, kind: 'assistant' }).success).toBe(false);
  });
});
