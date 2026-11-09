// Synthetic data only (CM-2, ADR-0034 §4): the code_map dynamic tool, the repository map in the
// developer instructions, and content-free tool-use categories. The real codex never runs.
import { MAX_REPO_MAP_BYTES } from '@acp/core';
import type { ManagedAgentSpec } from '@acp/core';
import { describe, expect, it, vi } from 'vitest';
import { createManagedCodex } from '../src/adapter.js';
import { mapNotification } from '../src/events.js';
import { developerInstructionsFor } from '../src/instructions.js';
import { dynamicToolsFor, toolInputSchema } from '../src/lead-tools.js';
import { commandCategory } from '../src/summary.js';
import { FakeAppServer, makeSpec, settle } from './helpers/fake-app-server.js';

const leadTools = () => Promise.resolve('ok');

describe('code_map dynamic tool (ADR-0034 §4)', () => {
  it('is offered to every role through managedToolNames, follow-ups included', () => {
    const specs: Partial<ManagedAgentSpec>[] = [
      { kind: 'lead' },
      { kind: 'planner' },
      { kind: 'reviewer' },
      { kind: 'reviewer', reviewScope: 'change' },
      { kind: 'worker' },
      { kind: 'worker', canStartHelpers: true },
      { kind: 'tester' },
      { kind: 'lead', followUp: { resumeSessionId: 'thr' } },
    ];
    for (const extra of specs) {
      const names = dynamicToolsFor(makeSpec({ ...extra, leadTools })).map((t) => t.name);
      expect(names, JSON.stringify(extra)).toContain('code_map');
    }
    expect(dynamicToolsFor(makeSpec({ kind: 'worker' }))).toEqual([]);
  });

  it('has a plain JSON schema with the four fields and the action list', () => {
    const schema = toolInputSchema('code_map');
    expect(schema['additionalProperties']).toBe(false);
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(props)).toEqual(['action', 'query', 'path', 'depth']);
    expect(props['action']?.['enum']).toEqual(['find_symbol', 'file', 'neighbors', 'search']);
    expect(schema['required']).toEqual(['action']);
    const tool = dynamicToolsFor(makeSpec({ kind: 'tester', leadTools })).find(
      (t) => t.name === 'code_map',
    );
    expect(tool?.description).toContain('never file content');
  });

  it('start_agent and submit_plan take starting points, described as hints (CM-3)', () => {
    const start = toolInputSchema('start_agent');
    const props = start['properties'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(props)).toEqual(['role', 'task', 'helper', 'files', 'notes']);
    expect(props['files']?.['maxItems']).toBe(20);
    expect(start['required']).toEqual(['role', 'task']);
    const tools = dynamicToolsFor(makeSpec({ kind: 'lead', leadTools }));
    for (const name of ['start_agent', 'submit_plan']) {
      const description = tools.find((t) => t.name === name)?.description ?? '';
      expect(description).toContain('code_map');
      expect(description).toContain('not a limit');
    }
  });

  it('a follow-up turn may call code_map and nothing else', async () => {
    const handler = vi.fn(() => Promise.resolve('map answer'));
    const server = new FakeAppServer();
    const adapter = createManagedCodex({ spawn: () => server, env: {}, tmpRoots: [] });
    const handle = adapter.start(
      makeSpec({ followUp: { resumeSessionId: 'thr-old' }, leadTools: handler }),
      { requestPermission: vi.fn() },
    );
    await settle();
    const call = (tool: string) =>
      server.request('item/tool/call', {
        callId: 'c',
        namespace: null,
        tool,
        arguments: { action: 'search', query: 'x' },
      });
    expect((await call('code_map')).result).toMatchObject({ success: true });
    expect((await call('start_agent')).result).toMatchObject({ success: false });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('code_map', { action: 'search', query: 'x' });
    handle.abort();
  });
});

describe('repository map in the developer instructions', () => {
  it('comes first, before the role lines and the project context', () => {
    const text = developerInstructionsFor(
      makeSpec({ repoMap: '=== Repository map ===', context: 'PROJECT CONTEXT' }),
    );
    expect(text.startsWith('=== Repository map ===\n\nYou run inside Agent Control Plane')).toBe(
      true,
    );
    expect(text.indexOf('PROJECT CONTEXT')).toBeGreaterThan(text.indexOf('You run inside'));
  });

  it('is capped at its own allowance', () => {
    const text = developerInstructionsFor(
      makeSpec({ repoMap: 'm'.repeat(MAX_REPO_MAP_BYTES + 9) }),
    );
    expect(text.startsWith(`${'m'.repeat(MAX_REPO_MAP_BYTES)}\n\n`)).toBe(true);
  });
});

describe('tool-use categories (CM-2)', () => {
  it('reads a command by its name inside the shell wrapper', () => {
    const cases: [string, string][] = [
      ["/bin/zsh -lc 'cat src/a.ts'", 'read'],
      ['bash -lc "head -n 20 a.ts"', 'read'],
      ['tail -f log', 'read'],
      ['less README.md', 'read'],
      ["/bin/zsh -lc 'sed -n 1,80p src/a.ts'", 'read'],
      ["/bin/zsh -lc 'sed -i s/a/b/ a.ts'", 'shell'],
      ["/bin/zsh -lc 'rg --files'", 'search'],
      ['grep -rn foo src', 'search'],
      ['find . -name "*.ts"', 'search'],
      ['ls -la', 'search'],
      ['fd index', 'search'],
      ['/usr/bin/git grep token', 'search'],
      ['git status', 'shell'],
      ['FOO=1 rg x', 'search'],
      ['pnpm test', 'shell'],
      ['', 'shell'],
    ];
    for (const [command, category] of cases)
      expect(commandCategory(command), command).toBe(category);
  });

  it('emits a category for each started item, never its command, paths or tool input', () => {
    const spec = { kind: 'worker' as const, cwd: '/synthetic/project' };
    const started = (item: Record<string, unknown>) =>
      mapNotification('item/started', { item }, spec).events.filter((e) => e.type === 'tool-use');
    expect(started({ type: 'commandExecution', command: "zsh -lc 'rg secret-token'" })).toEqual([
      { type: 'tool-use', category: 'search' },
    ]);
    expect(started({ type: 'fileChange', changes: [{ path: 'a.ts' }] })).toEqual([
      { type: 'tool-use', category: 'edit' },
    ]);
    expect(started({ type: 'dynamicToolCall', tool: 'code_map', arguments: {} })).toEqual([
      { type: 'tool-use', category: 'code_map' },
    ]);
    expect(started({ type: 'dynamicToolCall', tool: 'report_work', arguments: {} })).toEqual([
      { type: 'tool-use', category: 'other' },
    ]);
    expect(started({ type: 'mcpToolCall', tool: 'code_map' })).toEqual([
      { type: 'tool-use', category: 'other' },
    ]);
    expect(started({ type: 'reasoning' })).toEqual([]);
  });
});
