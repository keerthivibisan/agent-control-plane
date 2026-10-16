import { MAX_AGENT_BYTES } from '@acp/core';
import type {
  AgentRoleKind,
  ManagedAgentSpec,
  ManagedCallbacks,
  PermissionRequest,
} from '@acp/core';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createManagedClaudeCode } from '../../src/index.js';
import { agentFileHeading } from '../../src/managed/adapter.js';
import {
  agentToolNames,
  DENY_NOT_IN_AGENT_FILE,
  DENY_NOT_IN_ROLE,
  DENY_READ_ONLY,
  READ_ONLY_DISALLOWED_TOOLS,
  roleBaseTools,
} from '../../src/managed/permissions.js';
import { fakeQuery, idle } from './fake-query.js';

/**
 * Stage agent files (ADR-0019 §6, docs/research/sdk-tool-narrowing-2026-10-16.md) through a fake
 * `query` (synthetic; the real Agent SDK never runs): the file's instructions go into the system
 * prompt, and its `tools` only narrow the role's tools.
 */

const realQuery = vi.hoisted(() => ({
  fn: (): never => {
    throw new Error('the real Agent SDK query() was called');
  },
}));
const servers = vi.hoisted(() => ({ toolNames: [] as string[][] }));
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const original = await importOriginal<typeof Sdk>();
  return {
    ...original,
    query: realQuery.fn,
    createSdkMcpServer: (options: Parameters<typeof Sdk.createSdkMcpServer>[0]) => {
      servers.toolNames.push((options.tools ?? []).map((t) => t.name));
      return original.createSdkMcpServer(options);
    },
  };
});

const CWD = '/work/acp/checkouts/run-1/agent-1';
const ALL_KINDS: readonly AgentRoleKind[] = ['lead', 'planner', 'worker', 'reviewer', 'tester'];
const PLUGIN = { path: '/data/runs/run-1/skills-plugin', skills: ['acp-skills:unit-tests'] };

function profile(tools: readonly string[] | null, instructions = 'Be brief.\n') {
  return { name: 'strict-style', instructions, tools };
}

function spec(kind: AgentRoleKind, extra: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return {
    agentRunId: `agent-${kind}`,
    kind,
    cwd: CWD,
    prompt: 'First task',
    model: null,
    leadTools: () => Promise.resolve('ok'),
    ...extra,
  };
}

function callbacks(): ManagedCallbacks & { requests: PermissionRequest[] } {
  const requests: PermissionRequest[] = [];
  return {
    requests,
    requestPermission(r) {
      requests.push(r);
      return Promise.resolve({ allow: true });
    },
  };
}

function optionsFor(s: ManagedAgentSpec, cb: ManagedCallbacks = callbacks()): Sdk.Options {
  servers.toolNames.length = 0;
  const { query, calls } = fakeQuery(async function* (ctx) {
    await idle(ctx);
    yield* [];
  });
  createManagedClaudeCode({ query }).start(s, cb).abort();
  const options = calls[0]?.options;
  if (options === undefined) throw new Error('query was not called');
  return options;
}

function appendOf(options: Sdk.Options): string | undefined {
  const prompt = options.systemPrompt;
  if (typeof prompt !== 'object' || Array.isArray(prompt) || prompt.type !== 'preset') {
    throw new Error('expected a preset system prompt');
  }
  expect(prompt.preset).toBe('claude_code');
  return prompt.append;
}

type CanUseToolOptions = Parameters<Sdk.CanUseTool>[2];
const toolOpts = (extra: Partial<CanUseToolOptions> = {}): CanUseToolOptions => ({
  signal: new AbortController().signal,
  toolUseID: 'toolu_1',
  requestId: 'req_1',
  ...extra,
});
const OURS = toolOpts({ mcpServer: { name: 'acp', source: 'sdk' } });

function canUseTool(options: Sdk.Options): Sdk.CanUseTool {
  const fn = options.canUseTool;
  if (fn === undefined) throw new Error('no canUseTool');
  return fn;
}

describe('agent file instructions in the system prompt', () => {
  it('appends them after the project context, under a heading naming the file', () => {
    const options = optionsFor(
      spec('worker', { context: '=== README.md ===\nFacts.', profile: profile(null) }),
    );
    expect(appendOf(options)).toBe(
      `=== README.md ===\nFacts.\n\n${agentFileHeading('strict-style')}\nBe brief.\n`,
    );
    expect(agentFileHeading('strict-style')).toContain('.claude/agents/strict-style.md');
  });

  it('appends them alone without context, and keeps the preset for every role', () => {
    for (const kind of ALL_KINDS) {
      const append = appendOf(optionsFor(spec(kind, { profile: profile(null) })));
      expect(append).toBe(`${agentFileHeading('strict-style')}\nBe brief.\n`);
    }
  });

  it('adds nothing for blank instructions or no profile', () => {
    const preset = { type: 'preset', preset: 'claude_code' };
    expect(optionsFor(spec('worker', { profile: profile(null, ' \n') })).systemPrompt).toEqual(
      preset,
    );
    expect(optionsFor(spec('worker')).systemPrompt).toEqual(preset);
  });

  it('caps the instructions at MAX_AGENT_BYTES', () => {
    const long = 'x'.repeat(MAX_AGENT_BYTES + 100);
    const append = appendOf(optionsFor(spec('worker', { profile: profile(null, long) }))) ?? '';
    const heading = `${agentFileHeading('strict-style')}\n`;
    expect(append.startsWith(heading)).toBe(true);
    expect(Buffer.byteLength(append.slice(heading.length), 'utf8')).toBe(MAX_AGENT_BYTES);
  });

  it('never puts an unexpected name into the heading', () => {
    expect(agentFileHeading('../../x')).not.toContain('../');
  });
});

describe('agent file tools only narrow (ADR-0019 §6)', () => {
  it('sets the SDK tools base set to the listed built-ins for a worker', () => {
    const options = optionsFor(spec('worker', { profile: profile(['Read', 'Grep', 'Edit']) }));
    expect(options.tools).toEqual(['Read', 'Grep', 'Edit']);
    expect(options).not.toHaveProperty('disallowedTools');
  });

  it('keeps a reviewer read-only even when its file lists Bash and Edit', async () => {
    const cb = callbacks();
    const options = optionsFor(
      spec('reviewer', { profile: profile(['Read', 'Bash', 'Edit', 'Write', 'Grep']) }),
      cb,
    );
    expect(options.tools).toEqual(['Read', 'Grep']);
    expect(options.disallowedTools).toEqual([...READ_ONLY_DISALLOWED_TOOLS]);
    expect(servers.toolNames).toEqual([['post_review']]);
    const use = canUseTool(options);
    await expect(use('mcp__acp__post_review', {}, OURS)).resolves.toMatchObject({
      behavior: 'allow',
    });
    await expect(use('Bash', { command: 'ls' }, toolOpts())).resolves.toMatchObject({
      behavior: 'deny',
    });
    await expect(use('Edit', { file_path: `${CWD}/a.ts` }, toolOpts())).resolves.toMatchObject({
      behavior: 'deny',
    });
    expect(cb.requests).toEqual([]);
  });

  it('keeps a planner read-only and its submit_plan tool, whatever the file lists', async () => {
    const options = optionsFor(spec('planner', { profile: profile(['Edit', 'MultiEdit']) }));
    expect(options.tools).toEqual([]);
    expect(options.disallowedTools).toEqual([...READ_ONLY_DISALLOWED_TOOLS]);
    expect(servers.toolNames).toEqual([['submit_plan']]);
    await expect(canUseTool(options)('mcp__acp__submit_plan', {}, OURS)).resolves.toMatchObject({
      behavior: 'allow',
    });
  });

  it("keeps the role's mcp__acp__ control tools; MCP entries in the file are not built-ins", () => {
    const options = optionsFor(
      spec('lead', { profile: profile(['Read', 'mcp__github__create_issue', 'mcp__acp__*']) }),
    );
    expect(options.tools).toEqual(['Read']);
    expect(servers.toolNames[0]).toContain('submit_plan');
    expect(servers.toolNames[0]).toContain('start_agent');
  });

  it('adds Skill exactly when the run has a skills plugin', () => {
    expect(
      optionsFor(spec('tester', { profile: profile(['Read']), skillPlugin: PLUGIN })).tools,
    ).toEqual(['Read', 'Skill']);
    expect(optionsFor(spec('tester', { profile: profile(['Read', 'Skill']) })).tools).toEqual([
      'Read',
    ]);
    expect(
      optionsFor(spec('reviewer', { profile: profile([]), skillPlugin: PLUGIN })).tools,
    ).toEqual(['Skill']);
  });

  it('an empty list disables every built-in tool', () => {
    expect(optionsFor(spec('worker', { profile: profile([]) })).tools).toEqual([]);
  });

  it('the gate denies an unlisted built-in without asking; a listed one asks as before', async () => {
    const cb = callbacks();
    const use = canUseTool(optionsFor(spec('worker', { profile: profile(['Read', 'Edit']) }), cb));
    await expect(use('Bash', { command: 'ls' }, toolOpts())).resolves.toEqual({
      behavior: 'deny',
      message: DENY_NOT_IN_AGENT_FILE,
      toolUseID: 'toolu_1',
    });
    await expect(use('Glob', { pattern: '*.ts' }, toolOpts())).resolves.toMatchObject({
      behavior: 'deny',
      message: DENY_NOT_IN_AGENT_FILE,
    });
    await expect(use('Read', { file_path: `${CWD}/a.ts` }, toolOpts())).resolves.toMatchObject({
      behavior: 'allow',
    });
    await expect(use('Edit', { file_path: `${CWD}/a.ts` }, toolOpts())).resolves.toMatchObject({
      behavior: 'allow',
    });
    expect(cb.requests.map((r) => r.toolName)).toEqual(['Edit']);
  });

  it('the gate denies an unlisted built-in for a read-only role with the agent file message', async () => {
    const use = canUseTool(optionsFor(spec('planner', { profile: profile(['Read']) })));
    await expect(use('Grep', { pattern: 'x' }, toolOpts())).resolves.toMatchObject({
      behavior: 'deny',
      message: DENY_NOT_IN_AGENT_FILE,
    });
    await expect(use('Edit', { file_path: `${CWD}/a.ts` }, toolOpts())).resolves.toMatchObject({
      behavior: 'deny',
    });
    await expect(use('Read', { file_path: `${CWD}/a.ts` }, toolOpts())).resolves.toMatchObject({
      behavior: 'allow',
    });
  });

  it('never adds a tool outside the base set: Task and Agent stay out under either name', async () => {
    const cb = callbacks();
    const options = optionsFor(spec('worker', { profile: profile(['Task', 'Agent', 'Read']) }), cb);
    expect(options.tools).toEqual(['Read']);
    const use = canUseTool(options);
    for (const name of ['Task', 'Agent']) {
      await expect(use(name, {}, toolOpts())).resolves.toEqual({
        behavior: 'deny',
        message: DENY_NOT_IN_ROLE,
        toolUseID: 'toolu_1',
      });
    }
    expect(cb.requests).toEqual([]);
  });

  it("null tools keep the role's base set", async () => {
    for (const kind of ALL_KINDS) {
      const withNull = optionsFor(spec(kind, { profile: profile(null) }));
      const without = optionsFor(spec(kind));
      expect(withNull.tools).toEqual([...roleBaseTools(kind)]);
      expect(withNull.tools).toEqual(without.tools);
      expect(withNull.disallowedTools).toEqual(without.disallowedTools);
      expect(agentToolNames(spec(kind, { profile: profile(null) }))).toEqual(roleBaseTools(kind));
    }
    const cb = callbacks();
    const use = canUseTool(optionsFor(spec('worker', { profile: profile(null) }), cb));
    await expect(use('Bash', { command: 'ls' }, toolOpts())).resolves.toMatchObject({
      behavior: 'allow',
    });
    expect(cb.requests.map((r) => r.toolName)).toEqual(['Bash']);
    expect(DENY_READ_ONLY).not.toBe(DENY_NOT_IN_AGENT_FILE);
  });

  it('never sets allowedTools, and never changes permissions or settings', () => {
    for (const kind of ALL_KINDS) {
      for (const p of [profile(['Read', 'Bash', 'Edit']), profile(null), profile([])]) {
        const options = optionsFor(spec(kind, { profile: p, skillPlugin: PLUGIN }));
        expect(options).not.toHaveProperty('allowedTools');
        expect(options.permissionMode).toBe('default');
        expect(options.settingSources).toEqual([]);
        expect(options.strictMcpConfig).toBe(true);
      }
    }
  });

  it('passes a copy of the tools, so a later change never reaches a running agent', () => {
    const tools = ['Read'];
    const options = optionsFor(spec('worker', { profile: profile(tools) }));
    tools.push('Bash');
    expect(options.tools).toEqual(['Read']);
  });
});
