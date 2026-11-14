import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ASSISTANT_TOOL_NAMES,
  LEAD_TOOL_NAMES,
  compileWorkflow,
  workflowTemplateV3,
} from '@acp/core';
import type {
  AgentRoleKind,
  ApprovalMode,
  ManagedAgentSpec,
  PermissionRequest,
  WorkflowGraphV3,
} from '@acp/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManagedCodex } from '../src/adapter.js';
import { codexArgs } from '../src/config.js';
import { codexModes } from '../src/modes.js';
import { collect, FakeAppServer, makeSpec, settle, tempRepo } from './helpers/fake-app-server.js';

/*
 * CX-7: the adversarial suite on the Codex path (docs/testing/adversarial.md, "Codex"). A hostile
 * or confused Codex agent, played by the synthetic in-memory app-server, asks for what F-1 and
 * ADR-0022 forbid; each case asserts a refusal by the adapter's OWN layers, before the server's
 * gate or the owner ever sees it (`requestPermission` is a spy that would allow everything).
 * The real codex never runs; every id, path and name is made up.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const dir = tempRepo();
  dirs.push(dir);
  return dir;
}

function runTemp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'acp-codex-adv-tmp-'));
  dirs.push(dir);
  return dir;
}

/** A writing agent (worker or tester) in each approval mode, Full auto with its protection. */
const MODES: readonly ApprovalMode[] = ['manual', 'auto-edits', 'auto', 'full-auto'];
const WRITERS = ['worker', 'tester'] as const;

function writer(
  kind: (typeof WRITERS)[number],
  mode: ApprovalMode,
  overrides: Partial<ManagedAgentSpec> = {},
): ManagedAgentSpec {
  return makeSpec({
    kind,
    cwd: repo(),
    approvalMode: mode,
    denyRead: ['/home/synthetic/.codex'],
    ...(mode === 'full-auto'
      ? { fullAuto: { tempDir: runTemp(), denyRead: ['/home/synthetic/.ssh'] } }
      : {}),
    ...overrides,
  });
}

/** Starts an agent on a fresh fake app-server; temp roots empty so a scratch repo is "safe". */
function start(spec: ManagedAgentSpec, tmpRoots: readonly string[] = []) {
  const server = new FakeAppServer();
  const spawn = vi.fn(() => server);
  const adapter = createManagedCodex({ spawn, env: { HOME: '/home/synthetic' }, tmpRoots });
  // The owner's side allows everything: only the adapter's own layers can refuse.
  const requestPermission = vi.fn((_request: PermissionRequest) =>
    Promise.resolve({ allow: true as const }),
  );
  const handle = adapter.start(spec, { requestPermission });
  return { server, spawn, handle, requestPermission };
}

const commandApproval = (server: FakeAppServer, command: string) =>
  server.request('item/commandExecution/requestApproval', {
    threadId: 'thr-synthetic',
    turnId: 'turn-1',
    itemId: 'item-adv',
    command,
    cwd: '/synthetic',
  });

const sandboxUnavailable = {
  type: 'finished',
  outcome: 'error',
  reportedCostUsd: null,
  failure: 'sandbox-unavailable',
};

/** CX-7 C1: the git writes a Codex worker or tester may ask to run as an escalation. */
const HOSTILE_GIT: readonly string[] = [
  'git commit -m x',
  'git checkout -b evil',
  'git switch -c x',
  'git branch x',
  'git reset --hard',
  'git push origin HEAD',
  'git update-ref refs/heads/main HEAD',
  'git update-ref',
  'npm test && git commit -am x',
  '/bin/bash -lc "git commit -m x"',
  "/bin/zsh -lc 'git checkout -b evil'",
  'GIT_DIR=x git commit',
  'GIT_DIR=x GIT_WORK_TREE=. git commit -m x',
];

describe('CX-7 C1: hostile git commands are declined without asking the owner', () => {
  for (const kind of WRITERS) {
    for (const mode of MODES) {
      it(`${kind}, ${mode}: every git write is declined and requestPermission is never called`, async () => {
        const { server, handle, requestPermission } = start(writer(kind, mode));
        await settle();
        for (const command of HOSTILE_GIT) {
          const reply = await commandApproval(server, command);
          expect(reply.result, command).toEqual({ decision: 'decline' });
        }
        expect(requestPermission).not.toHaveBeenCalled();
        // Control: an ordinary command still reaches the gate, so the guard does not over-block.
        expect((await commandApproval(server, 'pnpm test')).result).toEqual({
          decision: 'accept',
        });
        expect(requestPermission).toHaveBeenCalledTimes(1);
        handle.abort();
      });
    }
  }
});

describe('CX-7 C2: a writing agent whose repository is under a temp root never starts', () => {
  for (const kind of WRITERS) {
    for (const mode of MODES) {
      it(`${kind}, ${mode}: ends unsafe-git-location and spawns nothing`, async () => {
        // The scratch repository lies under the OS temp folder, counted as writable here.
        const { spawn, handle, requestPermission } = start(writer(kind, mode), [os.tmpdir()]);
        expect(await collect(handle.events)).toEqual([
          {
            type: 'finished',
            outcome: 'error',
            reportedCostUsd: null,
            failure: 'unsafe-git-location',
          },
        ]);
        expect(spawn).not.toHaveBeenCalled();
        expect(requestPermission).not.toHaveBeenCalled();
      });
    }
  }
});

describe('CX-7 C3: profile paths cannot inject TOML', () => {
  const injected: [string, Partial<ManagedAgentSpec>][] = [
    ['a newline in a deny path', { denyRead: ['/home/synthetic/a\n[permissions.x]'] }],
    ['a carriage return in a deny path', { denyRead: ['/home/synthetic/a\r"=write'] }],
    ['a NUL in a deny path', { denyRead: ['/home/synthetic/a\u0000b'] }],
    ['an escape in a read-only folder', { readOnlyDirs: ['/synthetic/ref\u001b[0m'] }],
    [
      'a newline in a Full auto deny path',
      {
        approvalMode: 'full-auto',
        fullAuto: { tempDir: '/synthetic/tmp', denyRead: ['/home/synthetic/x\ny'] },
      },
    ],
    ['a newline in the folder itself', { cwd: '/synthetic/project\ndefault_permissions="x"' }],
  ];
  for (const [title, overrides] of injected) {
    it(`${title} ends sandbox-unavailable before spawn`, async () => {
      // A reading lead skips the git-location check, so only the profile can refuse.
      const { spawn, handle } = start(makeSpec({ kind: 'lead', ...overrides }));
      expect(await collect(handle.events)).toEqual([sandboxUnavailable]);
      expect(spawn).not.toHaveBeenCalled();
    });
  }

  it('a path with `"]`, `=` or `\\` is quoted, not injected: the exact -c string', async () => {
    const hostile = ['/home/synthetic/a"]b\\c', '/home/synthetic/x"="write", "/'];
    const spec = makeSpec({ kind: 'lead', cwd: '/synthetic/project', denyRead: hostile });
    const { spawn, handle } = start(spec);
    await settle();
    expect(spawn).toHaveBeenCalledTimes(1);
    const args = (spawn.mock.calls[0] as unknown as [{ args: string[] }])[0].args;
    expect(args).toEqual(codexArgs(codexModes(spec).profile));
    expect(args.slice(-6)).toEqual([
      '-c',
      'permissions.acp-read.extends=":read-only"',
      '-c',
      'permissions.acp-read.filesystem={"/home/synthetic/a\\"]b\\\\c"="deny", ' +
        '"/home/synthetic/x\\"=\\"write\\", \\"/"="deny", ":slash_tmp"="deny", ' +
        '":tmpdir"="deny", "/synthetic/project"="read"}',
      '-c',
      'default_permissions="acp-read"',
    ]);
    handle.abort();
  });
});

describe('CX-7 C4: a thread not under ACP profile fails closed', () => {
  const reported: [string, unknown][] = [
    ['the built-in :workspace', { id: ':workspace', extends: null }],
    ['the other ACP profile', { id: 'acp-write', extends: ':workspace' }],
    ['no profile at all', null],
    ['a missing field', undefined],
  ];
  for (const [title, profile] of reported) {
    it(`thread/start reporting ${title} ends sandbox-unavailable with no turn`, async () => {
      const spec = writer('worker', 'manual');
      const server = new FakeAppServer();
      server.handlers['thread/start'] = () => ({
        thread: { id: 'thr-synthetic' },
        model: 'model-synthetic',
        ...(profile === undefined ? {} : { activePermissionProfile: profile }),
      });
      const adapter = createManagedCodex({ spawn: () => server, tmpRoots: [] });
      const handle = adapter.start(spec, { requestPermission: vi.fn() });
      expect(await collect(handle.events)).toEqual([sandboxUnavailable]);
      expect(server.requests('thread/start')[0]?.params?.['permissions']).toBe('acp-read');
      expect(server.requests('turn/start')).toHaveLength(0);
      expect(server.closed).toBe(true);
    });
  }
});

describe('CX-7 C5: a read-only Codex role never asks the owner', () => {
  const readers: [string, Partial<ManagedAgentSpec>][] = [
    ['lead', { kind: 'lead' }],
    ['planner', { kind: 'planner' }],
    ['reviewer', { kind: 'reviewer' }],
    ['change reviewer', { kind: 'reviewer', reviewScope: 'change' }],
    ['a follow-up turn', { kind: 'lead', followUp: { resumeSessionId: 'thr-lead' } }],
    // ADR-0035 §6: the project assistant.
    ['the project assistant', { kind: 'assistant' }],
    // ADR-0037 §3: the researcher.
    ['a researcher', { kind: 'researcher' }],
  ];
  for (const [title, overrides] of readers) {
    it(`${title}: command and file-change approvals are declined`, async () => {
      const { server, handle, requestPermission } = start(makeSpec(overrides));
      await settle();
      for (const command of ['touch notes.md', 'rm -rf src', 'git commit -m x']) {
        expect((await commandApproval(server, command)).result).toEqual({ decision: 'decline' });
      }
      const edit = await server.request('item/fileChange/requestApproval', {
        itemId: 'i',
        reason: 'write a file',
      });
      expect(edit.result).toEqual({ decision: 'decline' });
      expect(requestPermission).not.toHaveBeenCalled();
      handle.abort();
    });
  }
});

describe('CX-7 C6: a Codex worker cannot call lead-only tools', () => {
  it('an unoffered or namespaced dynamic tool call is success:false and never reaches the engine', async () => {
    const leadTools = vi.fn(() => Promise.resolve('ok'));
    const { server, handle } = start(writer('worker', 'auto', { leadTools }));
    await settle();
    const offered = (
      server.requests('thread/start')[0]?.params?.['dynamicTools'] as { name: string }[]
    ).map((t) => t.name);
    expect(offered).toEqual(['report_work', 'ask_lead', 'code_map']);
    const call = (tool: string, namespace: string | null = null) =>
      server.request('item/tool/call', { callId: 'c', namespace, tool, arguments: {} });
    for (const tool of [
      'start_agent',
      'merge_change',
      'message_agent',
      'request_review',
      'submit_plan',
      'discard_change',
      'get_review_findings',
    ]) {
      expect((await call(tool)).result, tool).toMatchObject({ success: false });
    }
    // A namespaced spelling of an offered tool is not that tool.
    expect((await call('report_work', 'acp')).result).toMatchObject({ success: false });
    expect(leadTools).not.toHaveBeenCalled();
    handle.abort();
  });
});

describe('ADR-0038 §1: the Codex tester and report_test_results', () => {
  it('offers report_test_results with its schema and passes a call to the engine', async () => {
    const leadTools = vi.fn(() => Promise.resolve('recorded'));
    const { server, handle } = start(makeSpec({ kind: 'tester', cwd: repo(), leadTools }));
    await settle();
    const thread = server.requests('thread/start')[0]?.params ?? {};
    const tools = thread['dynamicTools'] as {
      name: string;
      inputSchema: Record<string, unknown>;
    }[];
    expect(tools.map((t) => t.name)).toEqual([
      'report_test_results',
      'report_work',
      'ask_lead',
      'code_map',
    ]);
    const schema = tools[0]?.inputSchema ?? {};
    expect(Object.keys(schema['properties'] as Record<string, unknown>)).toEqual([
      'status',
      'failed',
      'summary',
    ]);
    expect(schema['additionalProperties']).toBe(false);
    const input = {
      status: 'failed',
      failed: [{ test: 'adds', file: 'src/a.test.ts', message: 'expected 2' }],
      summary: '1 failed.',
    };
    const call = (tool: string, args: object, namespace: string | null = null) =>
      server.request('item/tool/call', { callId: 'c', namespace, tool, arguments: args });
    expect((await call('report_test_results', input)).result).toMatchObject({ success: true });
    expect(leadTools).toHaveBeenCalledWith('report_test_results', input);
    // A namespaced spelling is not the tool.
    expect((await call('report_test_results', input, 'acp')).result).toMatchObject({
      success: false,
    });
    handle.abort();
  });

  it('adversarial: no other role is offered report_test_results, and its call is success:false', async () => {
    for (const kind of ['worker', 'reviewer', 'planner', 'researcher', 'lead'] as const) {
      const leadTools = vi.fn(() => Promise.resolve('ok'));
      const { server, handle } = start(makeSpec({ kind, cwd: repo(), leadTools }));
      await settle();
      const thread = server.requests('thread/start')[0]?.params ?? {};
      const offered = (thread['dynamicTools'] as { name: string }[]).map((t) => t.name);
      expect(offered, kind).not.toContain('report_test_results');
      const result = await server.request('item/tool/call', {
        callId: 'c',
        namespace: null,
        tool: 'report_test_results',
        arguments: { status: 'passed', failed: [], summary: 'ok' },
      });
      expect(result.result, kind).toMatchObject({ success: false });
      expect(leadTools).not.toHaveBeenCalled();
      handle.abort();
    }
  });
});

describe('ADR-0037 §3: the Codex researcher', () => {
  it('runs read-only, offers report_findings, ask_lead and code_map, and its instructions', async () => {
    const leadTools = vi.fn(() => Promise.resolve('recorded'));
    const spec = makeSpec({ kind: 'researcher', cwd: repo(), leadTools });
    expect(codexModes(spec)).toMatchObject({
      approvalPolicy: 'never',
      profile: { id: 'acp-read', extends: ':read-only' },
    });
    const { server, handle } = start(spec);
    await settle();
    const thread = server.requests('thread/start')[0]?.params ?? {};
    const offered = (thread['dynamicTools'] as { name: string }[]).map((t) => t.name);
    expect(offered).toEqual(['report_findings', 'ask_lead', 'code_map']);
    expect(String(thread['developerInstructions'])).toContain(
      'Finish with exactly one report_findings call',
    );
    const call = (tool: string, args: object = {}) =>
      server.request('item/tool/call', { callId: 'c', namespace: null, tool, arguments: args });
    expect(
      (await call('report_findings', { findings: 'src/a.ts parses it.' })).result,
    ).toMatchObject({ success: true });
    expect(leadTools).toHaveBeenCalledWith('report_findings', { findings: 'src/a.ts parses it.' });
    handle.abort();
  });

  it('adversarial: merge_change, start_agent and every other tool are success:false; writes declined', async () => {
    const leadTools = vi.fn(() => Promise.resolve('ok'));
    const { server, handle, requestPermission } = start(
      makeSpec({ kind: 'researcher', cwd: repo(), leadTools }),
    );
    await settle();
    const call = (tool: string, namespace: string | null = null) =>
      server.request('item/tool/call', { callId: 'c', namespace, tool, arguments: {} });
    const own = ['report_findings', 'ask_lead', 'code_map'];
    const forbidden = LEAD_TOOL_NAMES.filter((n) => !own.includes(n));
    expect(forbidden).toEqual(expect.arrayContaining(['merge_change', 'start_agent']));
    for (const tool of forbidden) {
      expect((await call(tool)).result, tool).toMatchObject({ success: false });
    }
    expect((await call('report_findings', 'acp')).result).toMatchObject({ success: false });
    expect(leadTools).not.toHaveBeenCalled();
    for (const command of ['touch notes.md', 'rm -rf src', 'git commit -m x']) {
      expect((await commandApproval(server, command)).result).toEqual({ decision: 'decline' });
    }
    const edit = await server.request('item/fileChange/requestApproval', {
      itemId: 'i',
      reason: 'write a file',
    });
    expect(edit.result).toEqual({ decision: 'decline' });
    expect(requestPermission).not.toHaveBeenCalled();
    handle.abort();
  });
});

describe('ADR-0035: the Codex project assistant', () => {
  it('runs read-only with the deny list, its own tools only, its instructions and an open input', async () => {
    const leadTools = vi.fn(() => Promise.resolve('two tickets open'));
    const spec = makeSpec({
      kind: 'assistant',
      cwd: repo(),
      denyRead: ['/home/synthetic/.codex'],
      leadTools,
    });
    expect(codexModes(spec)).toMatchObject({
      approvalPolicy: 'never',
      profile: { id: 'acp-read', extends: ':read-only' },
    });
    expect(codexModes(spec).profile.filesystem['/home/synthetic/.codex']).toBe('deny');
    const { server, handle } = start(spec);
    await settle();
    const thread = server.requests('thread/start')[0]?.params ?? {};
    const offered = (thread['dynamicTools'] as { name: string }[]).map((t) => t.name);
    expect(offered).toEqual([
      'ticket_status',
      'project_info',
      'propose_skill',
      'propose_agent',
      'code_map',
    ]);
    expect(String(thread['developerInstructions'])).toContain(
      'You are the project assistant for this project',
    );
    const call = (tool: string, args: object = {}) =>
      server.request('item/tool/call', { callId: 'c', namespace: null, tool, arguments: args });
    for (const tool of ['start_agent', 'message_agent', 'stop_agent', 'merge_change']) {
      expect((await call(tool)).result, tool).toMatchObject({ success: false });
    }
    expect(leadTools).not.toHaveBeenCalled();
    expect((await call('ticket_status')).result).toMatchObject({ success: true });
    expect(leadTools).toHaveBeenCalledWith('ticket_status', {});
    // Its input stays open after a turn, like the lead's chat.
    server.completeTurn('turn-1');
    await settle();
    await handle.send('And WEB-12?');
    expect(server.requests('turn/start')).toHaveLength(2);
    handle.abort();
  });

  it('A6: every lead, helper and reviewer tool, or a namespaced assistant tool, is success:false', async () => {
    const leadTools = vi.fn(() => Promise.resolve('ok'));
    const spec = makeSpec({ kind: 'assistant', cwd: repo(), leadTools });
    const { server, handle, requestPermission } = start(spec);
    await settle();
    const call = (tool: string, namespace: string | null = null) =>
      server.request('item/tool/call', { callId: 'c', namespace, tool, arguments: {} });
    const forbidden = LEAD_TOOL_NAMES.filter((n) => !ASSISTANT_TOOL_NAMES.includes(n));
    expect(forbidden).toEqual(expect.arrayContaining(['ask_lead', 'message_agent', 'start_agent']));
    for (const tool of forbidden) {
      expect((await call(tool)).result, tool).toMatchObject({ success: false });
    }
    expect((await call('propose_skill', 'acp')).result).toMatchObject({ success: false });
    expect(leadTools).not.toHaveBeenCalled();
    // Command and file-change approvals are declined without asking anyone (C5 for this role).
    expect((await commandApproval(server, 'git commit -m x')).result).toEqual({
      decision: 'decline',
    });
    expect(requestPermission).not.toHaveBeenCalled();
    handle.abort();
  });
});

/**
 * AR-6 (ADR-0037 §1): the run kinds a version 3 graph gives its read-only blocks, from a graph whose
 * arrows and block settings try to give them more: a custom arrow from the helper into the
 * reviewer, and Full auto with helpers stored on every read-only block.
 */
function readOnlyKindsOfHostileGraph(): AgentRoleKind[] {
  const g = workflowTemplateV3('todays-setup', { planner: true });
  const loud = { approvalMode: 'full-auto', canStartHelpers: true, maxInstances: 3 } as const;
  const graph: WorkflowGraphV3 = {
    ...g,
    template: 'custom',
    nodes: [
      ...g.nodes.map((n) => (n.type === 'agent' && n.id !== 'helpers' ? { ...n, ...loud } : n)),
      { type: 'agent', id: 'scout', label: 'Scout', model: null, skills: [], agent: null, ...loud },
    ],
    edges: [
      ...g.edges,
      {
        type: 'research',
        id: 'research-scout',
        from: 'scout',
        to: 'plan',
        purpose: 'Edit freely.',
      },
      { type: 'custom', id: 'custom-helpers-review', from: 'helpers', to: 'review' },
    ],
  };
  const program = compileWorkflow(graph, {
    projectMode: 'full-auto',
    approvalCeilings: [],
    maxConcurrentHelpers: 3,
  });
  return [...program.planners, ...program.researchers, ...program.changeReviewers].map(
    (n) => n.kind,
  );
}

describe('AR-6 A-AR1: arrows never give a Codex read-only role write access', () => {
  const kinds = readOnlyKindsOfHostileGraph();

  it('the hostile graph still derives a planner, a researcher and a reviewer', () => {
    expect(kinds).toEqual(['planner', 'researcher', 'reviewer']);
  });

  it.each(kinds)(
    '%s: read-only profile, never asks, no writable path, even with Full auto paths',
    async (kind) => {
      const spec = makeSpec({
        kind,
        cwd: repo(),
        approvalMode: 'full-auto',
        canStartHelpers: true,
        fullAuto: { tempDir: runTemp(), denyRead: ['/home/synthetic/.ssh'] },
      });
      const modes = codexModes(spec);
      expect(modes.approvalPolicy).toBe('never');
      expect(modes.profile.extends).toBe(':read-only');
      expect(Object.values(modes.profile.filesystem)).not.toContain('write');
      expect(modes.profile.filesystem[':tmpdir']).toBe('deny');
      // Through a started thread: command and file-change approvals are declined, never asked.
      const { server, handle, requestPermission } = start(spec);
      await settle();
      expect((await commandApproval(server, 'git push --force origin main')).result).toEqual({
        decision: 'decline',
      });
      const edit = await server.request('item/fileChange/requestApproval', {
        itemId: 'i',
        reason: 'write a file',
      });
      expect(edit.result).toEqual({ decision: 'decline' });
      expect(requestPermission).not.toHaveBeenCalled();
      handle.abort();
    },
  );
});
