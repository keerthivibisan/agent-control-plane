import { LEAD_TOOL_NAMES } from '@acp/core';
import type { LeadToolName } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { createLeadToolServer, leadToolDefinitions } from '../../src/managed/lead-tools.js';

// createSdkMcpServer and tool() build an in-process MCP server; neither starts Claude.

describe('P3-B lead tools (ADR-0012)', () => {
  it('defines exactly the LeadToolInputs tools', () => {
    const tools = leadToolDefinitions(() => Promise.resolve(''));
    expect(tools.map((t) => t.name)).toEqual(LEAD_TOOL_NAMES);
    const startAgent = tools.find((t) => t.name === 'start_agent');
    expect(Object.keys((startAgent?.inputSchema ?? {}) as Record<string, unknown>)).toEqual([
      'role',
      'task',
      'helper',
    ]);
  });

  it('tells the lead that request_review must be called once every change is decided (RL-F)', () => {
    const tools = leadToolDefinitions(() => Promise.resolve(''));
    const description = tools.find((t) => t.name === 'request_review')?.description ?? '';
    expect(description).toContain('you must call it once every change is decided');
    expect(description).toContain('nothing goes on until you do');
  });

  it('calls the engine handler with the tool name and input and returns its text', async () => {
    const calls: [LeadToolName, unknown][] = [];
    const tools = leadToolDefinitions((name, input) => {
      calls.push([name, input]);
      return Promise.resolve(`done: ${name}`);
    });
    for (const t of tools) {
      const res = await t.handler({ role: 'API builder', task: 'Build it' }, {});
      expect(res).toEqual({ content: [{ type: 'text', text: `done: ${t.name}` }] });
    }
    expect(calls.map(([n]) => n)).toEqual(LEAD_TOOL_NAMES);
    expect(calls[0]?.[1]).toEqual({ role: 'API builder', task: 'Build it' });
  });

  it('turns a handler failure into a redacted MCP error result', async () => {
    const [startAgent] = leadToolDefinitions(() =>
      Promise.reject(new Error('limit reached; key sk-ant-abcdefghijkl0123')),
    );
    const res = await startAgent?.handler({ role: 'r', task: 't' }, {});
    expect(res?.isError).toBe(true);
    const text = JSON.stringify(res);
    expect(text).toContain('limit reached');
    expect(text).not.toContain('sk-ant-');
  });

  it('builds an in-process SDK server named "acp"', () => {
    const server = createLeadToolServer(() => Promise.resolve(''));
    expect(server.type).toBe('sdk');
    expect(server.name).toBe('acp');
    expect(server.instance).toBeDefined();
  });
});

describe('P4-I tool sets', () => {
  it('builds only the named tools, in contract order', () => {
    const names = leadToolDefinitions(
      () => Promise.resolve(''),
      ['agent_status', 'start_agent', 'list_agents', 'stop_agent', 'message_agent'],
    ).map((t) => t.name);
    expect(names).toEqual([
      'start_agent',
      'list_agents',
      'message_agent',
      'stop_agent',
      'agent_status',
    ]);
  });

  it('exposes submit_plan to the lead with the contract input schema', async () => {
    const calls: [LeadToolName, unknown][] = [];
    const tools = leadToolDefinitions((name, input) => {
      calls.push([name, input]);
      return Promise.resolve('plan v1 submitted');
    });
    const submitPlan = tools.find((t) => t.name === 'submit_plan');
    expect(Object.keys((submitPlan?.inputSchema ?? {}) as Record<string, unknown>)).toEqual([
      'summary',
      'steps',
    ]);
    const input = {
      summary: 'Add a toggle',
      steps: [{ title: 'UI', role: 'ui', detail: 'Do it' }],
    };
    await expect(submitPlan?.handler(input, {})).resolves.toEqual({
      content: [{ type: 'text', text: 'plan v1 submitted' }],
    });
    expect(calls).toEqual([['submit_plan', input]]);
  });
});
