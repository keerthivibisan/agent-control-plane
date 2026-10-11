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
    ]);
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
