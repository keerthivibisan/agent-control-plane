import { describe, expect, it } from 'vitest';
import { codexArgs, codexEnv } from '../src/config.js';
import { codexModes } from '../src/modes.js';
import { makeSpec } from './helpers/fake-app-server.js';

describe('codexArgs', () => {
  it('is exactly the CX-1 verified argument list', () => {
    expect(codexArgs()).toEqual([
      'app-server',
      ...[
        'hooks',
        'multi_agent',
        'plugins',
        'apps',
        'remote_plugin',
        'goals',
        'memories',
        'image_generation',
        'browser_use',
        'computer_use',
        'guardian_approval',
        'tool_suggest',
        'skill_mcp_dependency_install',
        'daemon_auto_start',
        'in_app_browser',
      ].flatMap((f) => ['--disable', f]),
      '-c',
      'project_doc_max_bytes=0',
      '-c',
      'mcp_servers={}',
      '-c',
      'web_search="disabled"',
    ]);
  });
});

describe('codexEnv', () => {
  it('drops ACP_* and GIT_* variables and keeps the rest', () => {
    expect(
      codexEnv({
        HOME: '/home/synthetic',
        PATH: '/usr/bin',
        ACP_HOOK_TOKEN: 'secret',
        acp_data_dir: '/x',
        GIT_DIR: '/elsewhere',
        UNSET: undefined,
      }),
    ).toEqual({ HOME: '/home/synthetic', PATH: '/usr/bin' });
  });
});

describe('codexModes', () => {
  const cwd = '/synthetic/wt';
  const write = (extra: object) => ({
    sandbox: 'workspace-write',
    sandboxPolicy: {
      type: 'workspaceWrite',
      networkAccess: false,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
      ...extra,
    },
  });

  it.each(['lead', 'planner', 'reviewer'] as const)('%s is read-only and never asks', (kind) => {
    expect(codexModes(makeSpec({ kind, cwd }))).toEqual({
      sandbox: 'read-only',
      approvalPolicy: 'never',
      sandboxPolicy: null,
    });
  });

  it('a follow-up is read-only and never asks, even for a worker', () => {
    const spec = makeSpec({ kind: 'worker', cwd, followUp: { resumeSessionId: 't' } });
    expect(codexModes({ ...spec, approvalMode: 'auto' })).toEqual({
      sandbox: 'read-only',
      approvalPolicy: 'never',
      sandboxPolicy: null,
    });
  });

  it.each(['worker', 'tester'] as const)(
    '%s: manual and absent are read-only, on-request',
    (kind) => {
      const expected = { sandbox: 'read-only', approvalPolicy: 'on-request', sandboxPolicy: null };
      expect(codexModes(makeSpec({ kind, cwd }))).toEqual(expected);
      expect(codexModes(makeSpec({ kind, cwd, approvalMode: 'manual' }))).toEqual(expected);
    },
  );

  it('auto-edits is workspace-write with untrusted', () => {
    expect(codexModes(makeSpec({ kind: 'worker', cwd, approvalMode: 'auto-edits' }))).toEqual({
      approvalPolicy: 'untrusted',
      ...write({ writableRoots: [cwd] }),
    });
  });

  it('auto is workspace-write with on-request, with the tightened temp folder writable', () => {
    const sandbox = { tempDir: '/synthetic/tmp-run', denyRead: [] };
    expect(codexModes(makeSpec({ kind: 'tester', cwd, approvalMode: 'auto', sandbox }))).toEqual({
      approvalPolicy: 'on-request',
      ...write({ writableRoots: [cwd, '/synthetic/tmp-run'] }),
    });
  });

  it('full auto is workspace-write with never, its temp folder writable', () => {
    const fullAuto = { tempDir: '/synthetic/tmp-run', denyRead: [] };
    expect(
      codexModes(makeSpec({ kind: 'worker', cwd, approvalMode: 'full-auto', fullAuto })),
    ).toEqual({
      approvalPolicy: 'never',
      ...write({ writableRoots: [cwd, '/synthetic/tmp-run'] }),
    });
  });

  it('a full-auto mode without its Full auto spec is read as auto, never unprotected', () => {
    expect(codexModes(makeSpec({ kind: 'worker', cwd, approvalMode: 'full-auto' }))).toEqual({
      approvalPolicy: 'on-request',
      ...write({ writableRoots: [cwd] }),
    });
  });
});
