import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ManagedAgentEvent, ManagedAgentSpec, PermissionRequest } from '@acp/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createManagedCodex,
  ManagedAgentEndedError,
  ManagedFollowUpSendError,
  NOT_ANSWERING,
  NOT_INSTALLED,
  NOT_SIGNED_IN,
  REWORK_NEW_SESSION_NOTE,
} from '../src/adapter.js';
import { usageEvent } from '../src/events.js';
import { toolInputSchema } from '../src/lead-tools.js';
import { unwrapShellCommand } from '../src/summary.js';
import {
  collect,
  FakeAppServer,
  makeSpec,
  RpcFailure,
  settle,
  tempRepo,
  watch,
} from './helpers/fake-app-server.js';

/* Every scenario runs against the synthetic in-memory app-server; the real codex never runs. */

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const dir = tempRepo();
  repos.push(dir);
  return dir;
}

function setup(spec: ManagedAgentSpec, decide = vi.fn()) {
  const server = new FakeAppServer();
  const spawn = vi.fn(() => server);
  // Temp roots are injected empty so a scratch repository counts as a safe location.
  const adapter = createManagedCodex({ spawn, env: { HOME: '/home/synthetic' }, tmpRoots: [] });
  const requestPermission = vi.fn((request: PermissionRequest) =>
    Promise.resolve(decide(request) ?? { allow: true as const }),
  );
  const handle = adapter.start(spec, { requestPermission });
  return { server, spawn, adapter, handle, requestPermission };
}

const worker = (overrides: Partial<ManagedAgentSpec> = {}) =>
  makeSpec({ kind: 'worker', cwd: repo(), approvalMode: 'manual', ...overrides });

describe('start', () => {
  it('handshakes, starts a thread with the role settings, then the first turn', async () => {
    const leadTools = vi.fn(() => Promise.resolve('ok'));
    const { server, handle, spawn } = setup(
      makeSpec({ model: 'model-x', effort: 'low', context: 'Project notes.', leadTools }),
    );
    const w = watch(handle.events);
    await settle();
    expect(spawn).toHaveBeenCalledWith({
      bin: 'codex',
      cwd: '/synthetic/project',
      env: { HOME: '/home/synthetic' },
    });
    expect(server.sent.slice(0, 2).map((m) => m.method)).toEqual(['initialize', 'initialized']);
    expect(server.sent[0]?.params).toMatchObject({ capabilities: { experimentalApi: true } });
    const start = server.requests('thread/start')[0]?.params ?? {};
    expect(start).toMatchObject({
      model: 'model-x',
      cwd: '/synthetic/project',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      approvalsReviewer: 'user',
      ephemeral: false,
    });
    expect(String(start['developerInstructions'])).toContain('Project notes.');
    const tools = start['dynamicTools'] as { name: string; inputSchema: object }[];
    expect(tools.map((t) => t.name)).toContain('start_agent');
    expect(tools.map((t) => t.name)).not.toContain('post_review');
    const turn = server.requests('turn/start')[0]?.params ?? {};
    expect(turn).toMatchObject({
      threadId: 'thr-synthetic',
      input: [{ type: 'text', text: 'Synthetic task.', text_elements: [] }],
      effort: 'low',
    });
    expect(turn['sandboxPolicy']).toBeUndefined();
    expect(w.seen[0]).toEqual({
      type: 'started',
      providerSessionId: 'thr-synthetic',
      model: 'model-synthetic',
    });
    handle.abort();
  });

  it('omits the model for the provider default and gives tools only with a handler', async () => {
    const { server, handle } = setup(makeSpec({ kind: 'planner' }));
    await settle();
    const start = server.requests('thread/start')[0]?.params ?? {};
    expect('model' in start).toBe(false);
    expect('dynamicTools' in start).toBe(false);
    handle.abort();
  });

  it('a writing agent passes its sandbox policy on every turn and its temp folder as TMPDIR', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'acp-run-tmp-'));
    repos.push(tempDir);
    const fullAuto = { tempDir, denyRead: [] };
    const spec = worker({ approvalMode: 'full-auto', fullAuto });
    const { server, handle, spawn } = setup(spec);
    await settle();
    expect(spawn.mock.calls[0]).toEqual([
      { bin: 'codex', cwd: spec.cwd, env: { HOME: '/home/synthetic', TMPDIR: tempDir } },
    ]);
    expect(server.requests('thread/start')[0]?.params).toMatchObject({
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
    });
    expect(server.requests('turn/start')[0]?.params?.['sandboxPolicy']).toEqual({
      type: 'workspaceWrite',
      writableRoots: [spec.cwd, tempDir],
      networkAccess: false,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    });
    handle.abort();
  });

  it('an unsafe git location ends at once with unsafe-git-location and spawns nothing', async () => {
    const server = new FakeAppServer();
    const spawn = vi.fn(() => server);
    const cwd = repo();
    // The scratch repository lies under the OS temp folder, which is a writable root here.
    const adapter = createManagedCodex({ spawn, tmpRoots: [os.tmpdir()] });
    const handle = adapter.start(makeSpec({ kind: 'worker', cwd }), {
      requestPermission: vi.fn(),
    });
    expect(await collect(handle.events)).toEqual([
      { type: 'finished', outcome: 'error', reportedCostUsd: null, failure: 'unsafe-git-location' },
    ]);
    expect(spawn).not.toHaveBeenCalled();
    await expect(handle.send('more')).rejects.toBeInstanceOf(ManagedAgentEndedError);
  });

  it('a missing codex ends with provider-unavailable', async () => {
    const { server, handle } = setup(makeSpec());
    server.exit({ code: null, signal: null, spawnError: 'not-found' });
    expect(await collect(handle.events)).toEqual([
      {
        type: 'finished',
        outcome: 'error',
        reportedCostUsd: null,
        failure: 'provider-unavailable',
      },
    ]);
  });

  it('a process exit mid-run ends with error', async () => {
    const { server, handle } = setup(makeSpec());
    const w = watch(handle.events);
    await settle();
    server.exit({ code: 1, signal: null, spawnError: null });
    await w.done;
    expect(w.seen.at(-1)).toEqual({ type: 'finished', outcome: 'error', reportedCostUsd: null });
  });
});

describe('approvals', () => {
  it('a command approval asks the owner with the unwrapped command as Bash', async () => {
    const { server, handle, requestPermission } = setup(worker());
    await settle();
    const reply = await server.request('item/commandExecution/requestApproval', {
      threadId: 'thr-synthetic',
      turnId: 'turn-1',
      itemId: 'item-7',
      command: "/bin/zsh -lc 'pnpm test --filter x'",
      cwd: '/synthetic',
    });
    expect(reply.result).toEqual({ decision: 'accept' });
    expect(requestPermission).toHaveBeenCalledWith({
      agentRunId: 'run-agent-1',
      toolName: 'Bash',
      toolUseId: 'item-7',
      summary: 'Run pnpm test --filter x',
      input: { command: 'pnpm test --filter x' },
    });
    handle.abort();
  });

  it('a denied, rejected or timed-out request is a decline', async () => {
    const decide = vi
      .fn()
      .mockReturnValueOnce({ allow: false, message: 'no' })
      .mockImplementationOnce(() => {
        throw new Error('timeout');
      });
    const { server, handle } = setup(worker(), decide);
    await settle();
    const ask = () =>
      server.request('item/commandExecution/requestApproval', { itemId: 'i', command: 'ls -la' });
    expect((await ask()).result).toEqual({ decision: 'decline' });
    expect((await ask()).result).toEqual({ decision: 'decline' });
    handle.abort();
  });

  it('a git write is declined without asking the owner, with an activity line', async () => {
    const { server, handle, requestPermission } = setup(worker());
    const w = watch(handle.events);
    await settle();
    for (const command of [
      "/bin/bash -lc 'git checkout -b feature/x'",
      'git commit -m wip',
      "zsh -lc 'git status && git push origin HEAD'",
    ]) {
      const reply = await server.request('item/commandExecution/requestApproval', {
        itemId: 'i',
        command,
      });
      expect(reply.result).toEqual({ decision: 'decline' });
    }
    expect(requestPermission).not.toHaveBeenCalled();
    expect(w.seen.filter((e) => e.type === 'activity').map((e) => e.summary)).toEqual([
      'Refused git checkout: the app owns branches',
      'Refused git commit: the app owns branches',
      'Refused git push: the app owns branches',
    ]);
    handle.abort();
  });

  it('a file change asks the owner as Edit, with a short reason', async () => {
    const { server, handle, requestPermission } = setup(worker());
    await settle();
    const reply = await server.request('item/fileChange/requestApproval', {
      itemId: 'item-9',
      reason: 'needs write access',
    });
    expect(reply.result).toEqual({ decision: 'accept' });
    expect(requestPermission).toHaveBeenCalledWith({
      agentRunId: 'run-agent-1',
      toolName: 'Edit',
      toolUseId: 'item-9',
      summary: 'Edit files: needs write access',
      input: {},
    });
    handle.abort();
  });

  it('a reading role never asks the owner', async () => {
    const { server, handle, requestPermission } = setup(makeSpec({ kind: 'reviewer' }));
    await settle();
    const reply = await server.request('item/commandExecution/requestApproval', {
      itemId: 'i',
      command: 'touch x',
    });
    expect(reply.result).toEqual({ decision: 'decline' });
    expect(requestPermission).not.toHaveBeenCalled();
    handle.abort();
  });

  it('other and unknown server requests are refused', async () => {
    const { server, handle, requestPermission } = setup(worker());
    await settle();
    expect((await server.request('item/permissions/requestApproval', {})).result).toEqual({
      permissions: {},
      scope: 'turn',
    });
    expect((await server.request('item/tool/requestUserInput', {})).result).toEqual({
      answers: {},
    });
    expect((await server.request('mcpServer/elicitation/request', {})).result).toMatchObject({
      action: 'decline',
    });
    expect((await server.request('execCommandApproval', {})).result).toMatchObject({
      decision: { denied: {} },
    });
    expect((await server.request('something/new', {})).error?.code).toBe(-32601);
    expect(requestPermission).not.toHaveBeenCalled();
    handle.abort();
  });
});

describe('lead tools', () => {
  it('a dynamic tool call reaches the handler; a throw is success:false, redacted', async () => {
    const leadTools = vi
      .fn()
      .mockResolvedValueOnce('Plan saved.')
      .mockRejectedValueOnce(new Error('refused: token sk-ant-api03-SYNTHETICSECRET0000000000'));
    const { server, handle } = setup(makeSpec({ kind: 'planner', leadTools }));
    await settle();
    const call = () =>
      server.request('item/tool/call', {
        threadId: 'thr-synthetic',
        turnId: 'turn-1',
        callId: 'c1',
        namespace: null,
        tool: 'submit_plan',
        arguments: { summary: 's', steps: [] },
      });
    expect((await call()).result).toEqual({
      contentItems: [{ type: 'inputText', text: 'Plan saved.' }],
      success: true,
    });
    expect(leadTools).toHaveBeenCalledWith('submit_plan', { summary: 's', steps: [] });
    const failed = (await call()).result as { success: boolean; contentItems: { text: string }[] };
    expect(failed.success).toBe(false);
    expect(failed.contentItems[0]?.text).not.toContain('SYNTHETICSECRET');
    handle.abort();
  });

  it('a tool the role was not offered is success:false and never reaches the handler', async () => {
    const leadTools = vi.fn();
    const { server, handle } = setup(makeSpec({ kind: 'planner', leadTools }));
    await settle();
    for (const tool of ['start_agent', 'not_a_tool']) {
      const reply = await server.request('item/tool/call', {
        callId: 'c',
        namespace: null,
        tool,
        arguments: {},
      });
      expect((reply.result as { success: boolean }).success).toBe(false);
    }
    expect(leadTools).not.toHaveBeenCalled();
    handle.abort();
  });

  it('tool schemas refuse unknown properties and carry no $schema key', () => {
    const schema = toolInputSchema('report_work');
    expect(schema['additionalProperties']).toBe(false);
    expect('$schema' in schema).toBe(false);
  });
});

describe('events', () => {
  const usage = (turnId: string, total: number, last: Record<string, number>) => ({
    threadId: 'thr-synthetic',
    turnId,
    tokenUsage: { total: { totalTokens: total }, last, modelContextWindow: null },
  });

  it('maps usage from last, keyed by thread, turn and cumulative total', () => {
    expect(
      usageEvent(
        usage('turn-1', 11200, {
          totalTokens: 11200,
          inputTokens: 11074,
          cachedInputTokens: 10624,
          cacheWriteInputTokens: 0,
          outputTokens: 126,
          reasoningOutputTokens: 20,
        }),
      ),
    ).toEqual({
      type: 'usage',
      messageId: 'thr-synthetic:turn-1:11200',
      tokens: { input: 450, cacheRead: 10624, cacheCreation: 0, output: 126 },
    });
  });

  it('a missing field is null, never 0, and no total means no record', () => {
    expect(usageEvent(usage('turn-1', 50, { inputTokens: 40, outputTokens: 10 }))).toEqual({
      type: 'usage',
      messageId: 'thr-synthetic:turn-1:50',
      tokens: { input: null, cacheRead: null, cacheCreation: null, output: 10 },
    });
    expect(
      usageEvent({
        threadId: 't',
        turnId: 'u',
        tokenUsage: { total: {}, last: { outputTokens: 1 } },
      }),
    ).toBeNull();
  });

  it('the usage replayed after a resume carries the same message id', async () => {
    const { server, handle } = setup(
      makeSpec({ kind: 'lead', followUp: { resumeSessionId: 'thr-synthetic' } }),
    );
    const w = watch(handle.events);
    await settle();
    const note = usage('turn-9', 900, {
      inputTokens: 800,
      cachedInputTokens: 700,
      outputTokens: 5,
    });
    server.notify('thread/tokenUsage/updated', note);
    server.notify('thread/tokenUsage/updated', note);
    await settle();
    const ids = w.seen.flatMap((e) => (e.type === 'usage' ? [e.messageId] : []));
    expect(ids).toEqual(['thr-synthetic:turn-9:900', 'thr-synthetic:turn-9:900']);
    handle.abort();
  });

  it('a lead streams lead-text and activity; a worker emits activity but no text', async () => {
    const lead = setup(makeSpec());
    const wLead = watch(lead.handle.events);
    const helper = setup(worker());
    const wHelper = watch(helper.handle.events);
    await settle();
    for (const server of [lead.server, helper.server]) {
      server.notify('item/started', {
        threadId: 'thr-synthetic',
        turnId: 'turn-1',
        item: { type: 'commandExecution', id: 'i1', command: "/bin/zsh -lc 'git status --short'" },
      });
      server.notify('item/started', {
        item: { type: 'fileChange', id: 'i2', changes: [{ path: 'a.ts' }, { path: 'b.ts' }] },
      });
      server.notify('item/started', {
        item: { type: 'dynamicToolCall', id: 'i3', tool: 'submit_plan', arguments: {} },
      });
      server.notify('item/completed', {
        item: { type: 'agentMessage', id: 'i4', text: 'Synthetic reply to the owner.' },
      });
    }
    await settle();
    const kinds = (seen: ManagedAgentEvent[]) =>
      seen.filter((e) => e.type === 'activity' || e.type === 'lead-text');
    expect(kinds(wLead.seen)).toEqual([
      { type: 'activity', summary: 'Run git status' },
      { type: 'activity', summary: 'Edit 2 files' },
      { type: 'activity', summary: 'Submitted the plan' },
      { type: 'lead-text', text: 'Synthetic reply to the owner.' },
    ]);
    expect(kinds(wHelper.seen).map((e) => e.type)).toEqual(['activity', 'activity', 'activity']);
    lead.handle.abort();
    helper.handle.abort();
  });
});

describe('turns', () => {
  it('a worker finishes after its turn with nothing queued', async () => {
    const { server, handle } = setup(worker());
    const w = watch(handle.events);
    await settle();
    server.completeTurn('turn-1');
    await w.done;
    expect(w.seen.at(-1)).toEqual({ type: 'finished', outcome: 'success', reportedCostUsd: null });
    expect(server.closed).toBe(true);
  });

  it('a failed turn finishes a worker with error', async () => {
    const { server, handle } = setup(worker());
    const w = watch(handle.events);
    await settle();
    server.completeTurn('turn-1', 'failed');
    await w.done;
    expect(w.seen.at(-1)).toMatchObject({ type: 'finished', outcome: 'error' });
  });

  it('the lead stays open after a turn; send then starts a new turn', async () => {
    const { server, handle } = setup(makeSpec());
    const w = watch(handle.events);
    await settle();
    server.completeTurn('turn-1');
    await settle();
    expect(w.seen.some((e) => e.type === 'finished')).toBe(false);
    await handle.send('Owner follow-up.');
    expect(server.requests('turn/steer')).toHaveLength(0);
    expect(server.requests('turn/start')).toHaveLength(2);
    expect(server.requests('turn/start')[1]?.params?.['input']).toEqual([
      { type: 'text', text: 'Owner follow-up.', text_elements: [] },
    ]);
    handle.abort();
  });

  it('send during a turn steers it with the expected turn id', async () => {
    const { server, handle } = setup(worker());
    await settle();
    await handle.send('Also check the docs.');
    expect(server.requests('turn/steer')[0]?.params).toEqual({
      threadId: 'thr-synthetic',
      input: [{ type: 'text', text: 'Also check the docs.', text_elements: [] }],
      expectedTurnId: 'turn-1',
    });
    expect(server.requests('turn/start')).toHaveLength(1);
    handle.abort();
  });

  it('a steer that misses the ended turn falls back to a new turn and the worker goes on', async () => {
    const { server, handle } = setup(worker());
    const w = watch(handle.events);
    await settle();
    let releaseSteer: () => void = () => undefined;
    server.handlers['turn/steer'] = () =>
      new Promise((_, reject) => {
        releaseSteer = () => reject(new RpcFailure(-32000, 'no active turn'));
      });
    const sending = handle.send('One more thing.');
    await settle();
    server.completeTurn('turn-1');
    await settle();
    expect(w.seen.some((e) => e.type === 'finished')).toBe(false);
    releaseSteer();
    await sending;
    expect(server.requests('turn/start')).toHaveLength(2);
    server.completeTurn('turn-2');
    await w.done;
    expect(w.seen.at(-1)).toMatchObject({ type: 'finished', outcome: 'success' });
  });

  it('interrupt sends turn/interrupt for the active turn', async () => {
    const { server, handle } = setup(worker());
    const w = watch(handle.events);
    await settle();
    await handle.interrupt();
    expect(server.requests('turn/interrupt')[0]?.params).toEqual({
      threadId: 'thr-synthetic',
      turnId: 'turn-1',
    });
    server.completeTurn('turn-1', 'interrupted');
    await w.done;
    expect(w.seen.at(-1)).toMatchObject({ type: 'finished', outcome: 'cancelled' });
  });

  it('abort gives exactly one cancelled and closes the process', async () => {
    const { server, handle } = setup(makeSpec());
    const w = watch(handle.events);
    await settle();
    handle.abort();
    handle.abort();
    server.completeTurn('turn-1');
    await w.done;
    expect(w.seen.filter((e) => e.type === 'finished')).toEqual([
      { type: 'finished', outcome: 'cancelled', reportedCostUsd: null },
    ]);
    expect(server.closed).toBe(true);
    await expect(handle.send('late')).rejects.toBeInstanceOf(ManagedAgentEndedError);
  });
});

describe('resume', () => {
  it('a follow-up resumes its thread, with no tools, and ends after one turn', async () => {
    const leadTools = vi.fn();
    const { server, handle } = setup(
      makeSpec({ followUp: { resumeSessionId: 'thr-old' }, leadTools }),
    );
    const w = watch(handle.events);
    await settle();
    expect(server.requests('thread/start')).toHaveLength(0);
    const resume = server.requests('thread/resume')[0]?.params ?? {};
    expect(resume).toMatchObject({
      threadId: 'thr-old',
      sandbox: 'read-only',
      approvalPolicy: 'never',
    });
    expect('dynamicTools' in resume).toBe(false);
    expect(w.seen[0]).toMatchObject({ type: 'started', providerSessionId: 'thr-old' });
    await expect(handle.send('x')).rejects.toBeInstanceOf(ManagedFollowUpSendError);
    server.completeTurn('turn-1');
    await w.done;
    expect(w.seen.at(-1)).toMatchObject({ type: 'finished', outcome: 'success' });
  });

  it('a rework whose thread is gone starts a new thread with the note', async () => {
    const spec = worker({ rework: { resumeSessionId: 'thr-gone' } });
    const server = new FakeAppServer();
    server.handlers['thread/resume'] = () => {
      throw new RpcFailure(-32000, 'thread not found');
    };
    const adapter = createManagedCodex({ spawn: () => server, tmpRoots: [] });
    const handle = adapter.start(spec, { requestPermission: vi.fn() });
    await settle();
    expect(server.requests('thread/start')).toHaveLength(1);
    const text = (server.requests('turn/start')[0]?.params?.['input'] as { text: string }[])[0];
    expect(text?.text.startsWith(REWORK_NEW_SESSION_NOTE)).toBe(true);
    handle.abort();
  });
});

describe('checkAvailable', () => {
  const check = (server: FakeAppServer | (() => never)) =>
    createManagedCodex({
      spawn: typeof server === 'function' ? server : () => server,
      availabilityTimeoutMs: 1000,
    }).checkAvailable?.();

  it('is ok when an account type is present, and closes the process', async () => {
    const server = new FakeAppServer();
    await expect(check(server)).resolves.toEqual({ ok: true });
    expect(server.requests('account/read')).toHaveLength(1);
    expect(server.closed).toBe(true);
  });

  it('says to sign in when there is no account', async () => {
    const server = new FakeAppServer();
    server.handlers['account/read'] = () => ({ account: null, requiresOpenaiAuth: true });
    await expect(check(server)).resolves.toEqual({ ok: false, reason: NOT_SIGNED_IN });
  });

  it('says Codex is not installed on ENOENT', async () => {
    const server = new FakeAppServer();
    server.handlers['initialize'] = () => new Promise(() => undefined);
    const result = check(server);
    server.exit({ code: null, signal: null, spawnError: 'not-found' });
    await expect(result).resolves.toEqual({ ok: false, reason: NOT_INSTALLED });
  });

  it('a spawn that throws is not installed; a silent server is not answering', async () => {
    await expect(
      check(() => {
        throw new Error('spawn failed');
      }),
    ).resolves.toEqual({ ok: false, reason: NOT_INSTALLED });
    const server = new FakeAppServer();
    server.handlers['initialize'] = () => new Promise(() => undefined);
    const quick = createManagedCodex({ spawn: () => server, availabilityTimeoutMs: 10 });
    await expect(quick.checkAvailable?.()).resolves.toEqual({ ok: false, reason: NOT_ANSWERING });
  });
});

describe('unwrapShellCommand', () => {
  it.each([
    ["/bin/zsh -lc 'git status'", 'git status'],
    ["bash -c 'echo '\\''hi'\\'''", "echo 'hi'"],
    ['sh -lc "echo \\"x\\""', 'echo "x"'],
    ['pnpm test', 'pnpm test'],
  ])('%s gives %s', (input, expected) => {
    expect(unwrapShellCommand(input)).toBe(expected);
  });
});
