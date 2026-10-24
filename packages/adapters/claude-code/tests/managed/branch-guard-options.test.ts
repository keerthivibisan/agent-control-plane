import type { AgentRoleKind, ManagedAgentSpec, ManagedCallbacks } from '@acp/core';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { buildOptions } from '../../src/managed/adapter.js';
import { GIT_DENY_RULES } from '../../src/managed/branch-guard.js';
import { fullAutoDenyRules, fullAutoSandbox } from '../../src/managed/full-auto.js';

/**
 * F-1 (synthetic; the real Agent SDK never runs): every worker and tester, in every approval
 * mode, gets the branch guard hook and deny rules, and its gate denies a branch command without
 * asking the owner; in Full auto the sandbox also denies writes to the repository's git folders.
 */

const realQuery = vi.hoisted(() => ({
  fn: (): never => {
    throw new Error('the real Agent SDK query() was called');
  },
}));
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const original = await importOriginal<typeof Sdk>();
  return { ...original, query: realQuery.fn };
});

const CWD = '/data/worktrees/run-1/a1';
const REPO_GIT = '/projects/app/.git';
const PRIVATE_GIT = '/projects/app/.git/worktrees/a1';
const PATHS = {
  tempDir: '/data/sandbox-tmp/run-1',
  denyRead: ['/home/owner/.ssh'],
  gitDirs: [PRIVATE_GIT, REPO_GIT],
};

function callbacks(): ManagedCallbacks & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    requestPermission: (r) => {
      asked.push(r.toolName);
      return Promise.resolve({ allow: true });
    },
  };
}

function spec(kind: AgentRoleKind, extra: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return {
    agentRunId: 'a1',
    kind,
    cwd: CWD,
    prompt: 'Do the step',
    model: null,
    ...(kind === 'lead' || kind === 'planner' || kind === 'reviewer'
      ? { leadTools: () => Promise.resolve('ok') }
      : {}),
    ...extra,
  };
}

const toolOpts = () => ({
  signal: new AbortController().signal,
  toolUseID: 'u1',
  requestId: 'req_1',
});

describe('which agents get the branch guard', () => {
  for (const kind of ['worker', 'tester'] as const) {
    it(`${kind}: the PreToolUse hook and the deny rules, without Full auto too`, () => {
      const o = buildOptions(spec(kind), callbacks(), new AbortController());
      expect(o.hooks?.PreToolUse?.[0]?.matcher).toBe('Bash');
      expect(o.disallowedTools).toEqual([...GIT_DENY_RULES]);
      expect(o.permissionMode).toBe('default');
    });

    it(`${kind}: kept in Full auto, before the Full auto rules`, () => {
      const s = spec(kind, { fullAuto: PATHS });
      const o = buildOptions(s, callbacks(), new AbortController());
      expect(o.permissionMode).toBe('auto');
      expect(o.hooks?.PreToolUse).toHaveLength(1);
      expect(o.disallowedTools).toEqual([...GIT_DENY_RULES, ...fullAutoDenyRules(CWD, PATHS)]);
    });
  }

  for (const kind of ['lead', 'planner', 'reviewer'] as const) {
    it(`${kind}: no hook (it has no shell at all)`, () => {
      const o = buildOptions(spec(kind), callbacks(), new AbortController());
      expect(o.hooks).toBeUndefined();
      expect(o.disallowedTools ?? []).not.toContain('Bash(git checkout:*)');
    });
  }

  it('a follow-up turn of the lead gets no hook', () => {
    const o = buildOptions(
      spec('lead', { followUp: { resumeSessionId: '11111111-1111-4111-8111-111111111111' } }),
      callbacks(),
      new AbortController(),
    );
    expect(o.hooks).toBeUndefined();
  });
});

describe('the gate denies a branch command without asking the owner', () => {
  it('in every mode: git checkout is denied, git status still asks', async () => {
    const cb = callbacks();
    const o = buildOptions(spec('worker'), cb, new AbortController());
    const use = o.canUseTool;
    if (use === undefined) throw new Error('no gate');
    const deny = await use('Bash', { command: 'git checkout -b feature/x dev' }, toolOpts());
    expect(deny).toMatchObject({ behavior: 'deny' });
    expect((deny as { message: string }).message).toContain('The app owns branches and commits');
    await expect(
      use('Bash', { command: 'git -C . commit -m x' }, toolOpts()),
    ).resolves.toMatchObject({ behavior: 'deny' });
    expect(cb.asked).toEqual([]);
    await expect(use('Bash', { command: 'git status' }, toolOpts())).resolves.toMatchObject({
      behavior: 'allow',
    });
    expect(cb.asked).toEqual(['Bash']);
  });
});

describe('Full auto: the repository git folders are not writable (F-1 §1b)', () => {
  it('denyWrite holds the worktree .git pointer, .claude and both git folders', () => {
    const sandbox = fullAutoSandbox(CWD, PATHS);
    expect(sandbox.filesystem?.denyWrite).toEqual([
      `${CWD}/.git`,
      `${CWD}/.claude`,
      PRIVATE_GIT,
      REPO_GIT,
    ]);
    // Writes stay limited to the worktree and the run's temp folder.
    expect(sandbox.filesystem?.allowWrite).toEqual([CWD, PATHS.tempDir]);
  });

  it('the file tools may not edit inside them either', () => {
    const rules = fullAutoDenyRules(CWD, PATHS);
    expect(rules).toContain(`Edit(/${REPO_GIT}/**)`);
    expect(rules).toContain(`Edit(/${PRIVATE_GIT}/**)`);
  });

  it('a relative path is never used; a spec without gitDirs keeps the old list', () => {
    const relative = fullAutoSandbox(CWD, { ...PATHS, gitDirs: ['.git'] });
    expect(relative.filesystem?.denyWrite).toEqual([`${CWD}/.git`, `${CWD}/.claude`]);
    const { gitDirs: _omit, ...old } = PATHS;
    expect(fullAutoSandbox(CWD, old).filesystem?.denyWrite).toEqual([
      `${CWD}/.git`,
      `${CWD}/.claude`,
    ]);
  });
});
