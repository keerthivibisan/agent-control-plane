import { describe, expect, it } from 'vitest';
import {
  CodexProfileError,
  codexArgs,
  codexEnv,
  profileOverrides,
  tomlString,
} from '../src/config.js';
import { codexModes, profileFilesystem, tempDirOf } from '../src/modes.js';
import type { CodexProfile } from '../src/modes.js';
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

describe('tomlString', () => {
  it('quotes plain paths, spaces, single quotes and unicode as they are', () => {
    expect(tomlString('/a b/c')).toBe('"/a b/c"');
    expect(tomlString("/it's")).toBe('"/it\'s"');
    expect(tomlString('/home/zoë/日本/🙂')).toBe('"/home/zoë/日本/🙂"');
  });

  it('escapes backslashes and double quotes', () => {
    expect(tomlString('/a"b')).toBe('"/a\\"b"');
    expect(tomlString('/a\\b')).toBe('"/a\\\\b"');
    expect(tomlString('/a\\"=deny, "x')).toBe('"/a\\\\\\"=deny, \\"x"');
  });

  it.each(['/a\nb', '/a\rb', '/a\tb', '/a\u0000b', '/a\u001bb', '/a\u007fb', '/a\u0085b'])(
    'refuses a control character (%j)',
    (text) => {
      expect(() => tomlString(text)).toThrow(CodexProfileError);
    },
  );

  it('refuses a lone surrogate', () => {
    expect(() => tomlString('/a\ud800b')).toThrow(CodexProfileError);
  });
});

describe('codexArgs with a profile', () => {
  const profile: CodexProfile = {
    id: 'acp-write',
    extends: ':workspace',
    filesystem: { '/home/u/.ssh': 'deny', ':slash_tmp': 'deny', '/w t/"q"': 'write' },
  };

  it('appends extends, the filesystem table and default_permissions after the fixed args', () => {
    const args = codexArgs(profile);
    expect(args.slice(0, codexArgs().length)).toEqual(codexArgs());
    expect(args.slice(codexArgs().length)).toEqual([
      '-c',
      'permissions.acp-write.extends=":workspace"',
      '-c',
      'permissions.acp-write.filesystem={"/home/u/.ssh"="deny", ":slash_tmp"="deny", "/w t/\\"q\\""="write"}',
      '-c',
      'default_permissions="acp-write"',
    ]);
  });

  it('refuses a relative path, an unknown special key form, a control character or a bad id', () => {
    const bad = (change: Partial<CodexProfile>) => () =>
      profileOverrides({ ...profile, ...change });
    expect(bad({ filesystem: { 'rel/path': 'deny' } })).toThrow(CodexProfileError);
    expect(bad({ filesystem: { ':TMP"': 'deny' } })).toThrow(CodexProfileError);
    expect(bad({ filesystem: { '/a\nb': 'deny' } })).toThrow(CodexProfileError);
    expect(bad({ id: 'acp write' as CodexProfile['id'] })).toThrow(CodexProfileError);
  });
});

describe('codexModes', () => {
  const cwd = '/synthetic/wt';
  const readOnly = { [':slash_tmp']: 'deny', [':tmpdir']: 'deny', [cwd]: 'read' };
  const workspace = {
    [':slash_tmp']: 'deny',
    [':tmpdir']: 'deny',
    [`${cwd}/.git`]: 'read',
    [cwd]: 'write',
  };

  it.each(['lead', 'planner', 'reviewer', 'assistant', 'researcher'] as const)(
    '%s is read-only and never asks',
    (kind) => {
      expect(codexModes(makeSpec({ kind, cwd }))).toEqual({
        approvalPolicy: 'never',
        profile: { id: 'acp-read', extends: ':read-only', filesystem: readOnly },
      });
    },
  );

  it('ADR-0037 §3: a researcher stays read-only and never asks, whatever its approval mode', () => {
    for (const approvalMode of ['manual', 'auto-edits', 'auto', 'full-auto'] as const) {
      const spec = makeSpec({ kind: 'researcher', cwd, approvalMode });
      expect(codexModes(spec)).toEqual({
        approvalPolicy: 'never',
        profile: { id: 'acp-read', extends: ':read-only', filesystem: readOnly },
      });
    }
  });

  it('a follow-up is read-only and never asks, even for a worker', () => {
    const spec = makeSpec({ kind: 'worker', cwd, followUp: { resumeSessionId: 't' } });
    expect(codexModes({ ...spec, approvalMode: 'auto' })).toEqual({
      approvalPolicy: 'never',
      profile: { id: 'acp-read', extends: ':read-only', filesystem: readOnly },
    });
  });

  it.each(['worker', 'tester'] as const)(
    '%s: manual and absent extend :read-only, on-request',
    (kind) => {
      const expected = {
        approvalPolicy: 'on-request',
        profile: { id: 'acp-read', extends: ':read-only', filesystem: readOnly },
      };
      expect(codexModes(makeSpec({ kind, cwd }))).toEqual(expected);
      expect(codexModes(makeSpec({ kind, cwd, approvalMode: 'manual' }))).toEqual(expected);
    },
  );

  it('auto-edits extends :workspace with untrusted', () => {
    expect(codexModes(makeSpec({ kind: 'worker', cwd, approvalMode: 'auto-edits' }))).toEqual({
      approvalPolicy: 'untrusted',
      profile: { id: 'acp-write', extends: ':workspace', filesystem: workspace },
    });
  });

  it('auto extends :workspace with on-request', () => {
    const modes = codexModes(makeSpec({ kind: 'tester', cwd, approvalMode: 'auto' }));
    expect(modes.approvalPolicy).toBe('on-request');
    expect(modes.profile).toMatchObject({ id: 'acp-write', extends: ':workspace' });
  });

  it('full auto extends :workspace with never', () => {
    const fullAuto = { tempDir: '/synthetic/tmp-run', denyRead: [] };
    const modes = codexModes(
      makeSpec({ kind: 'worker', cwd, approvalMode: 'full-auto', fullAuto }),
    );
    expect(modes.approvalPolicy).toBe('never');
    expect(modes.profile).toMatchObject({ id: 'acp-write', extends: ':workspace' });
  });

  it('a full-auto mode without its Full auto spec is read as auto, never unprotected', () => {
    const modes = codexModes(makeSpec({ kind: 'worker', cwd, approvalMode: 'full-auto' }));
    expect(modes.approvalPolicy).toBe('on-request');
    expect(modes.profile.extends).toBe(':workspace');
  });
});

describe('profileFilesystem', () => {
  const cwd = '/data/worktrees/wt';
  const fullAuto = {
    tempDir: '/data/sandbox-tmp/run-1',
    denyRead: ['/home/u/.ssh', '/data'],
    gitDirs: ['/repo/.git/worktrees/wt', '/repo/.git'],
  };

  it('denies every deny list and /tmp, then re-opens git dirs, read-only dirs, the folder and the temp folder', () => {
    const entries = profileFilesystem(
      {
        kind: 'worker',
        cwd,
        fullAuto,
        denyRead: ['/home/u/.codex', '/data'],
        readOnlyDirs: ['/data/runs/r/att'],
      },
      ':workspace',
      ['/tmp', '/var/folders/x/T'],
    );
    expect(Object.entries(entries)).toEqual([
      ['/home/u/.codex', 'deny'],
      ['/data', 'deny'],
      ['/home/u/.ssh', 'deny'],
      [':slash_tmp', 'deny'],
      ['/tmp', 'deny'],
      ['/var/folders/x/T', 'deny'],
      ['/repo/.git/worktrees/wt', 'read'],
      ['/repo/.git', 'read'],
      ['/data/runs/r/att', 'read'],
      [`${cwd}/.git`, 'read'],
      [cwd, 'write'],
      ['/data/sandbox-tmp/run-1', 'write'],
    ]);
    // TMPDIR is the run temp folder here, so `:tmpdir` would deny the folder that must be writable.
    expect(':tmpdir' in entries).toBe(false);
  });

  it('without a run temp folder denies :tmpdir and leaves the host folders to it', () => {
    const entries = profileFilesystem({ kind: 'worker', cwd }, ':read-only', ['/var/folders/x/T']);
    expect(entries).toEqual({ ':slash_tmp': 'deny', ':tmpdir': 'deny', [cwd]: 'read' });
  });

  it('takes the tightened sandbox paths like Full auto ones', () => {
    const entries = profileFilesystem({ kind: 'tester', cwd, sandbox: fullAuto }, ':read-only');
    expect(entries).toMatchObject({
      '/home/u/.ssh': 'deny',
      '/data': 'deny',
      '/repo/.git': 'read',
      [cwd]: 'read',
      '/data/sandbox-tmp/run-1': 'write',
    });
  });

  it('never loosens a deny of the exact same path', () => {
    const entries = profileFilesystem(
      {
        kind: 'worker',
        cwd,
        denyRead: [cwd, '/repo/.git'],
        fullAuto: { ...fullAuto, denyRead: [] },
      },
      ':workspace',
    );
    expect(entries[cwd]).toBe('deny');
    expect(entries['/repo/.git']).toBe('deny');
  });

  // AR-6: the Full auto temp folder is write access, so only an editing role may get it, whatever
  // its arrows say (ADR-0037 §1). The server never sets it for others; this is the adapter's own
  // line of defence.
  it.each(['planner', 'researcher', 'reviewer', 'lead'] as const)(
    'gives a %s no writable temp folder even when it carries Full auto or sandbox paths',
    (kind) => {
      for (const paths of [{ fullAuto }, { sandbox: fullAuto }]) {
        const entries = profileFilesystem({ kind, cwd, ...paths }, ':read-only', [
          '/var/folders/x/T',
        ]);
        expect(entries['/data/sandbox-tmp/run-1']).toBeUndefined();
        expect(Object.values(entries)).not.toContain('write');
        expect(entries[':tmpdir']).toBe('deny');
        expect(entries['/home/u/.ssh']).toBe('deny');
        expect(tempDirOf({ kind, ...paths })).toBeNull();
        const modes = codexModes(makeSpec({ kind, cwd, approvalMode: 'full-auto', ...paths }));
        expect(modes.approvalPolicy).toBe('never');
        expect(modes.profile.extends).toBe(':read-only');
        expect(Object.values(modes.profile.filesystem)).not.toContain('write');
      }
    },
  );

  it.each(['worker', 'tester'] as const)('keeps the temp folder writable for a %s', (kind) => {
    expect(tempDirOf({ kind, fullAuto })).toBe('/data/sandbox-tmp/run-1');
    expect(profileFilesystem({ kind, cwd, fullAuto }, ':workspace')).toMatchObject({
      '/data/sandbox-tmp/run-1': 'write',
    });
  });
});
