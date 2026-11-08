// Synthetic data only (CM-2, ADR-0034 §4): the repository map in the system prompt, the code_map
// tool definition, and content-free tool-use categories. The real Agent SDK never runs.
import { MAX_REPO_MAP_BYTES } from '@acp/core';
import type { ManagedAgentEvent, ManagedAgentSpec } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { systemPromptFor } from '../../src/managed/adapter.js';
import { leadToolDefinitions } from '../../src/managed/lead-tools.js';
import { mapSdkMessage, toolUseCategory } from '../../src/managed/messages.js';
import { assistant } from './fake-query.js';

const CWD = '/work/projects/web-app';

function spec(extra: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return { agentRunId: 'a-1', kind: 'worker', cwd: CWD, prompt: 'Do it', model: null, ...extra };
}

function appendOf(s: ManagedAgentSpec): string {
  const prompt = systemPromptFor(s);
  if (typeof prompt !== 'object' || Array.isArray(prompt) || prompt.type !== 'preset') {
    throw new Error('expected a preset system prompt');
  }
  return prompt.append ?? '';
}

describe('repository map in the system prompt (ADR-0034 §4)', () => {
  it('comes first, before the project context and the agent file', () => {
    const append = appendOf(
      spec({
        repoMap: '=== Repository map: commit abcdef1 ===',
        context: 'PROJECT CONTEXT',
        profile: { name: 'helper', instructions: 'AGENT FILE', tools: null },
      }),
    );
    const at = (s: string) => append.indexOf(s);
    expect(at('=== Repository map')).toBe(0);
    expect(at('PROJECT CONTEXT')).toBeGreaterThan(at('=== Repository map'));
    expect(at('AGENT FILE')).toBeGreaterThan(at('PROJECT CONTEXT'));
  });

  it('gives two agents with the same map the same prefix', () => {
    const map = '=== Repository map ===\n- packages/server: 3 files';
    const a = appendOf(spec({ kind: 'lead', repoMap: map, context: 'ctx' }));
    const b = appendOf(spec({ kind: 'tester', repoMap: map, context: 'ctx' }));
    expect(a).toBe(b);
    expect(a.startsWith(map)).toBe(true);
  });

  it('is capped at its own allowance and absent when blank', () => {
    const append = appendOf(spec({ repoMap: 'm'.repeat(MAX_REPO_MAP_BYTES + 100) }));
    expect(append).toBe('m'.repeat(MAX_REPO_MAP_BYTES));
    expect(systemPromptFor(spec({ repoMap: '  ' }))).toEqual({
      type: 'preset',
      preset: 'claude_code',
    });
  });
});

describe('code_map tool definition', () => {
  it('describes the actions and takes action, query, path and depth', () => {
    const tool = leadToolDefinitions(() => Promise.resolve(''), ['code_map'])[0];
    expect(tool?.name).toBe('code_map');
    expect(tool?.description).toContain('never file content');
    expect(tool?.description).toContain('before broad searches');
    expect(Object.keys((tool?.inputSchema ?? {}) as Record<string, unknown>)).toEqual([
      'action',
      'query',
      'path',
      'depth',
    ]);
  });
});

describe('tool-use categories (CM-2)', () => {
  it('maps tool names to categories', () => {
    const cases: [string, string][] = [
      ['Read', 'read'],
      ['NotebookRead', 'read'],
      ['Grep', 'search'],
      ['Glob', 'search'],
      ['LS', 'search'],
      ['Edit', 'edit'],
      ['MultiEdit', 'edit'],
      ['Write', 'edit'],
      ['NotebookEdit', 'edit'],
      ['Bash', 'shell'],
      ['mcp__acp__code_map', 'code_map'],
      ['mcp__other__code_map', 'other'],
      ['mcp__acp__report_work', 'other'],
      ['WebFetch', 'other'],
      ['Skill', 'other'],
    ];
    for (const [name, category] of cases) expect(toolUseCategory(name), name).toBe(category);
  });

  it('emits one content-free tool-use event per tool use, counting a repeated frame once', () => {
    const state = { started: true };
    const block = (id: string, name: string, input: unknown) => ({
      type: 'tool_use',
      id,
      name,
      input,
    });
    const first = mapSdkMessage(
      assistant('m1', [
        block('toolu_1', 'Read', { file_path: `${CWD}/secret-name.ts` }),
        block('toolu_2', 'mcp__acp__code_map', { action: 'search', query: 'token' }),
      ]),
      spec(),
      state,
    );
    const again = mapSdkMessage(
      assistant('m1', [block('toolu_2', 'mcp__acp__code_map', { action: 'search' })]),
      spec(),
      state,
    );
    const uses = (events: ManagedAgentEvent[]) => events.filter((e) => e.type === 'tool-use');
    expect(uses(first.events)).toEqual([
      { type: 'tool-use', category: 'read' },
      { type: 'tool-use', category: 'code_map' },
    ]);
    expect(uses(again.events)).toEqual([]);
    // Never a name, path or input in the event.
    expect(JSON.stringify(uses(first.events))).not.toMatch(/secret|token|Read|acp/);
  });
});
