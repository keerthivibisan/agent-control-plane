import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApprovalMode, ManagedAgentSpec, PermissionRequest } from '@acp/core';
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
    expect(offered).toEqual(['report_work', 'ask_lead']);
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
