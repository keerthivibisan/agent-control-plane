import type {
  AgentRoleKind,
  ManagedAgentSpec,
  ManagedCallbacks,
  PermissionRequest,
} from '@acp/core';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createManagedClaudeCode } from '../../src/index.js';
import {
  agentToolNames,
  DENY_FOLLOW_UP,
  DENY_NOT_IN_AGENT_FILE,
  DENY_NOT_IN_ROLE,
  DENY_READ_ONLY,
  DENY_SKILL,
  EDITING_BASE_TOOLS,
  READ_ONLY_BASE_TOOLS,
  READ_ONLY_DISALLOWED_TOOLS,
  roleBaseTools,
} from '../../src/managed/permissions.js';
import { fakeQuery, idle } from './fake-query.js';

/**
 * A fixed built-in tool base set per role (ADR-0019 §7, WP R-K), through a fake `query`
 * (synthetic; the real Agent SDK never runs). The R-V real run
 * (docs/research/r-v-real-run-2026-10-16.md) showed that a role without a `tools` base set gets
 * every tool of the local Claude Code install; these tests pin the exact set per role and the
 * gate behind it.
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
const READING_KINDS: readonly AgentRoleKind[] = ['lead', 'planner', 'reviewer'];
const EDITING_KINDS: readonly AgentRoleKind[] = ['worker', 'tester'];
const PLUGIN = {
  path: '/data/runs/run-1/skills-plugin',
  skills: ['acp-skills:unit-tests', 'acp-skills:code-review'],
};

/**
 * Tools the R-V run's `system/init` listed for roles without a base set (plus subagents under both
 * names and the edit variants), none of which is in any base set.
 */
const EXTRA_TOOLS = [
  'SendMessage',
  'ListAgents',
  'CronCreate',
  'ScheduleWakeup',
  'RemoteTrigger',
  'PushNotification',
  'WebFetch',
  'WebSearch',
  'Monitor',
  'EnterWorktree',
  'EnterPlanMode',
  'Artifact',
  'Task',
  'Agent',
  'NotebookEdit',
  'MultiEdit',
] as const;

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
      // Approves everything, so any deny below comes from the gate itself, never the owner.
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

type CanUseToolOptions = Parameters<Sdk.CanUseTool>[2];
const toolOpts = (): CanUseToolOptions => ({
  signal: new AbortController().signal,
  toolUseID: 'toolu_1',
  requestId: 'req_1',
});

function gateFor(s: ManagedAgentSpec, cb: ManagedCallbacks = callbacks()): Sdk.CanUseTool {
  const fn = optionsFor(s, cb).canUseTool;
  if (fn === undefined) throw new Error('no canUseTool');
  return fn;
}

const deny = (message: string) => ({ behavior: 'deny', message, toolUseID: 'toolu_1' });
const ALLOW = { behavior: 'allow', toolUseID: 'toolu_1' };

describe('role base sets: the SDK tools option (ADR-0019 §7)', () => {
  it('gives each role exactly its base set', () => {
    const expected: Record<AgentRoleKind, readonly string[]> = {
      lead: ['Read', 'Grep', 'Glob'],
      planner: ['Read', 'Grep', 'Glob'],
      reviewer: ['Read', 'Grep', 'Glob'],
      worker: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
      tester: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    };
    for (const kind of ALL_KINDS) {
      expect(optionsFor(spec(kind)).tools).toEqual(expected[kind]);
      expect(roleBaseTools(kind)).toEqual(expected[kind]);
    }
    expect(optionsFor(spec('worker', { canStartHelpers: true })).tools).toEqual(EDITING_BASE_TOOLS);
    expect(READ_ONLY_BASE_TOOLS).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('never puts an extra tool in a base set', () => {
    for (const kind of ALL_KINDS) {
      const tools = optionsFor(spec(kind, { skillPlugin: PLUGIN })).tools ?? [];
      for (const extra of EXTRA_TOOLS) expect(tools).not.toContain(extra);
    }
  });

  it('adds Skill only when the run has a skills plugin', () => {
    for (const kind of ALL_KINDS) {
      expect(optionsFor(spec(kind)).tools).not.toContain('Skill');
      expect(optionsFor(spec(kind, { skillPlugin: PLUGIN })).tools).toEqual([
        ...roleBaseTools(kind),
        'Skill',
      ]);
    }
  });

  it('an agent file narrows the base set per role but never widens it', () => {
    const everything = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'Skill', ...EXTRA_TOOLS];
    for (const kind of ALL_KINDS) {
      const wide = { name: 'wide', instructions: '', tools: [...everything, 'mcp__x__y'] };
      expect(optionsFor(spec(kind, { profile: wide })).tools).toEqual([...roleBaseTools(kind)]);
      // `Skill` in the file adds nothing; only the plugin brings it.
      expect(
        optionsFor(spec(kind, { profile: { ...wide, tools: ['Skill'] }, skillPlugin: PLUGIN }))
          .tools,
      ).toEqual(['Skill']);
      const narrow = { name: 'narrow', instructions: '', tools: ['Bash', 'Grep', 'WebFetch'] };
      expect(optionsFor(spec(kind, { profile: narrow })).tools).toEqual(
        EDITING_KINDS.includes(kind) ? ['Grep', 'Bash'] : ['Grep'],
      );
    }
  });

  it('keeps disallowedTools for the planner and reviewer only, and the control tools', () => {
    const control: Record<AgentRoleKind, unknown[]> = {
      lead: [expect.arrayContaining(['submit_plan', 'start_agent'])],
      planner: [['submit_plan']],
      reviewer: [['post_review']],
      // ADR-0026 §3: the helper's and tester's note.
      worker: [['report_work']],
      tester: [['report_work']],
    };
    for (const kind of ALL_KINDS) {
      const options = optionsFor(spec(kind));
      if (kind === 'planner' || kind === 'reviewer') {
        expect(options.disallowedTools).toEqual([...READ_ONLY_DISALLOWED_TOOLS]);
      } else {
        expect(options).not.toHaveProperty('disallowedTools');
      }
      expect(servers.toolNames).toEqual(control[kind]);
    }
  });

  it('never sets allowedTools and keeps the isolation settings for every role', () => {
    for (const kind of ALL_KINDS) {
      for (const extra of [{}, { skillPlugin: PLUGIN }, { followUp: { resumeSessionId: 's' } }]) {
        const options = optionsFor(spec(kind, extra));
        expect(options).not.toHaveProperty('allowedTools');
        expect(options.permissionMode).toBe('default');
        expect(options.settingSources).toEqual([]);
        expect(options.strictMcpConfig).toBe(true);
      }
    }
  });

  it('leaves the follow-up turn as it was: Read, Grep, Glob, no Skill', () => {
    const followUp = spec('lead', { followUp: { resumeSessionId: 's' }, skillPlugin: PLUGIN });
    expect(optionsFor(followUp).tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(agentToolNames(followUp)).toEqual(['Read', 'Grep', 'Glob']);
  });
});

describe('the gate as a second layer (ADR-0019 §7)', () => {
  it('denies every extra built-in for every role without asking', async () => {
    for (const kind of ALL_KINDS) {
      const cb = callbacks();
      const use = gateFor(spec(kind, { skillPlugin: PLUGIN }), cb);
      for (const name of EXTRA_TOOLS) {
        const editVariant = name === 'MultiEdit' || name === 'NotebookEdit';
        const message =
          editVariant && READING_KINDS.includes(kind) ? DENY_READ_ONLY : DENY_NOT_IN_ROLE;
        await expect(use(name, {}, toolOpts())).resolves.toEqual(deny(message));
      }
      expect(cb.requests).toEqual([]);
    }
  });

  it('denies the lead edits and shell commands without asking, even if its file lists them', async () => {
    const lists = { name: 'lead-file', instructions: '', tools: ['Read', 'Edit', 'Write', 'Bash'] };
    for (const extra of [{}, { profile: lists }]) {
      const cb = callbacks();
      const use = gateFor(spec('lead', extra), cb);
      for (const [name, input] of [
        ['Edit', { file_path: `${CWD}/a.ts`, old_string: 'a', new_string: 'b' }],
        ['Write', { file_path: `${CWD}/a.ts`, content: 'x' }],
        ['Bash', { command: 'git status' }],
        ['MultiEdit', { file_path: `${CWD}/a.ts` }],
      ] as const) {
        await expect(use(name, input, toolOpts())).resolves.toEqual(deny(DENY_READ_ONLY));
      }
      expect(cb.requests).toEqual([]);
    }
  });

  it("still asks about a lead's read outside its folder, and a worker's edits and commands", async () => {
    const lead = callbacks();
    await expect(
      gateFor(spec('lead'), lead)('Read', { file_path: '/elsewhere/a.ts' }, toolOpts()),
    ).resolves.toEqual(ALLOW);
    expect(lead.requests.map((r) => r.toolName)).toEqual(['Read']);
    for (const kind of EDITING_KINDS) {
      const cb = callbacks();
      const use = gateFor(spec(kind), cb);
      await use('Edit', { file_path: `${CWD}/a.ts` }, toolOpts());
      await use('Write', { file_path: `${CWD}/b.ts`, content: 'x' }, toolOpts());
      await use('Bash', { command: 'pnpm test' }, toolOpts());
      expect(cb.requests.map((r) => r.toolName)).toEqual(['Edit', 'Write', 'Bash']);
    }
  });

  it('names the agent file when it narrowed a role tool away', async () => {
    const file = { name: 'grep-only', instructions: '', tools: ['Grep'] };
    for (const kind of ALL_KINDS) {
      const use = gateFor(spec(kind, { profile: file }));
      await expect(use('Read', { file_path: `${CWD}/a.ts` }, toolOpts())).resolves.toEqual(
        deny(DENY_NOT_IN_AGENT_FILE),
      );
    }
  });
});

describe('the Skill gate (ADR-0019 §4, §7)', () => {
  it("allows only the run's plugin skills, without asking, for every role", async () => {
    for (const kind of ALL_KINDS) {
      const cb = callbacks();
      const use = gateFor(spec(kind, { skillPlugin: PLUGIN }), cb);
      for (const skill of [
        'acp-skills:unit-tests',
        'acp-skills:code-review',
        '/acp-skills:unit-tests',
      ]) {
        await expect(use('Skill', { skill }, toolOpts())).resolves.toEqual(ALLOW);
      }
      await expect(
        use('Skill', { skill: 'acp-skills:unit-tests', args: 'src/' }, toolOpts()),
      ).resolves.toEqual(ALLOW);
      expect(cb.requests).toEqual([]);
    }
  });

  it('denies bundled and other skills, and malformed input, without asking', async () => {
    for (const kind of ALL_KINDS) {
      const cb = callbacks();
      const use = gateFor(spec(kind, { skillPlugin: PLUGIN }), cb);
      for (const skill of [
        'update-config',
        'schedule',
        'loop',
        'unit-tests',
        'acp-skills:other',
        'acp-skills:unit-tests ',
        'other-plugin:unit-tests',
        '//acp-skills:unit-tests',
      ]) {
        await expect(use('Skill', { skill }, toolOpts())).resolves.toEqual(deny(DENY_SKILL));
      }
      for (const input of [
        {},
        { skill: '' },
        { skill: 3 },
        { skill: ['acp-skills:unit-tests'] },
        { name: 'acp-skills:unit-tests' },
      ]) {
        await expect(use('Skill', input, toolOpts())).resolves.toEqual(deny(DENY_SKILL));
      }
      expect(cb.requests).toEqual([]);
    }
  });

  it('denies Skill outright without a plugin, and in a follow-up turn', async () => {
    for (const kind of ALL_KINDS) {
      const use = gateFor(spec(kind));
      await expect(use('Skill', { skill: 'acp-skills:unit-tests' }, toolOpts())).resolves.toEqual(
        deny(DENY_NOT_IN_ROLE),
      );
    }
    const followUp = gateFor(
      spec('lead', { followUp: { resumeSessionId: 's' }, skillPlugin: PLUGIN }),
    );
    for (const name of ['Skill', 'SendMessage', 'Bash']) {
      await expect(followUp(name, { skill: 'acp-skills:unit-tests' }, toolOpts())).resolves.toEqual(
        deny(DENY_FOLLOW_UP),
      );
    }
  });
});
