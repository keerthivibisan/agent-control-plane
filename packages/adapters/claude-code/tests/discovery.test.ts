import { chmod, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiagnosticsCollector } from '../src/diagnostics.js';
import { listSources, PEEK_BYTES, peekFirstCwd, toCandidates } from '../src/discovery.js';
import {
  jsonl,
  makeTempDir,
  put,
  PROJECT_DIR,
  SID_1,
  SID_2,
  SID_3,
  SID_4,
  SID_5,
} from './helpers/temp-claude-dir.js';

const user = (cwd: string) => ({ type: 'user', uuid: 'u1', cwd, message: { content: 'x' } });

/** Lays out allowed files next to every denied kind of file (fixture scenario 14). */
async function deniedLayout() {
  const root = await makeTempDir();
  const p = `projects/${PROJECT_DIR}`;
  const allowed = [
    await put(root, `${p}/${SID_1}.jsonl`, jsonl(user('/home/user/project'))),
    await put(root, `${p}/${SID_1}/subagents/agent-a1.jsonl`, jsonl(user('/home/user/project'))),
    await put(root, `${p}/${SID_1}/subagents/agent-a1.meta.json`, '{"agentType":"Explore"}'),
  ];
  const denied = [
    await put(root, `sessions/${SID_2}.json`, '{"token":"peer"}'),
    await put(root, `sessions/peer.key`, 'KEY'),
    await put(root, 'foo.key', 'KEY'),
    await put(root, 'settings.json', '{}'),
    await put(root, 'settings.local.json', '{}'),
    await put(root, 'history.jsonl', jsonl(user('/home/user/project'))),
    await put(root, `${p}/settings.json`, '{}'),
    await put(root, `${p}/history.jsonl`, jsonl(user('/home/user/project'))),
    await put(root, `${p}/custom-title.json`, '{}'),
    await put(root, `${p}/memory/MEMORY.md`, '# notes'),
    await put(root, `${p}/memory/${SID_2}.jsonl`, jsonl(user('/home/user/project'))),
    await put(root, `${p}/${SID_1}/tool-results/${SID_2}.jsonl`, jsonl(user('/x'))),
    await put(root, `${p}/${SID_1}/custom-title.json`, '{}'),
    await put(root, `${p}/${SID_2}.jsonl.orphaned-1700000000`, jsonl(user('/x'))),
    await put(root, `${p}/${SID_2}.superseded-1700000000.jsonl`, jsonl(user('/x'))),
    await put(root, `${p}/${SID_1}/subagents/agent-a2.orphaned-1.jsonl`, jsonl(user('/x'))),
  ];
  // Symlink escapes: one points outside projects/, one at a denied file inside projects/.
  const outside = await put(
    root,
    `../${path.basename(root)}-outside/${SID_3}.jsonl`,
    jsonl(user('/x')),
  );
  await symlink(outside, path.join(root, `${p}/${SID_3}.jsonl`));
  await symlink(
    path.join(root, `${p}/${SID_1}/tool-results/${SID_2}.jsonl`),
    path.join(root, `${p}/${SID_4}.jsonl`),
  );
  // A symlinked project directory is not traversed.
  const linkedDir = path.dirname(
    await put(root, `../${path.basename(root)}-linked/${SID_5}.jsonl`, jsonl(user('/x'))),
  );
  await symlink(linkedDir, path.join(root, 'projects/-linked'));
  return { root, allowed, denied };
}

describe('listSources (C2 allowlist and discovery)', () => {
  it('returns only allowlisted files and reports symlink escapes', async () => {
    const { root, allowed } = await deniedLayout();
    const diagnostics = new DiagnosticsCollector();
    const sources = await listSources(root, 1024 * 1024, diagnostics);
    expect(sources.map((s) => s.path)).toEqual([...allowed].sort());
    expect(sources.map((s) => s.kind)).toEqual([
      'transcript',
      'subagent-transcript',
      'subagent-meta',
    ]);
    expect(sources[1]).toMatchObject({ sessionId: SID_1, agentId: 'a1', projectDir: PROJECT_DIR });
    expect(diagnostics.snapshot().fileIssues).toEqual([
      { path: `projects/${PROJECT_DIR}/${SID_3}.jsonl`, reason: 'outside-projects', detail: null },
      { path: `projects/${PROJECT_DIR}/${SID_4}.jsonl`, reason: 'symlink-mismatch', detail: null },
    ]);
  });

  it('never opens denied files (they are unreadable here, yet no I/O error is reported)', async () => {
    const { root, denied } = await deniedLayout();
    for (const f of denied) await chmod(f, 0o000);
    const diagnostics = new DiagnosticsCollector();
    const sources = await listSources(root, 1024 * 1024, diagnostics);
    expect(sources).toHaveLength(3);
    expect(diagnostics.snapshot().fileIssues.filter((i) => i.reason === 'io-error')).toEqual([]);
    for (const f of denied) await chmod(f, 0o600);
  });

  it('skips files over the size cap and reports them', async () => {
    const root = await makeTempDir();
    await put(root, `projects/${PROJECT_DIR}/${SID_1}.jsonl`, 'x'.repeat(200));
    await put(root, `projects/${PROJECT_DIR}/${SID_2}.jsonl`, 'x'.repeat(50));
    const diagnostics = new DiagnosticsCollector();
    const sources = await listSources(root, 100, diagnostics);
    expect(sources.map((s) => s.sessionId)).toEqual([SID_2]);
    expect(diagnostics.snapshot().fileIssues).toEqual([
      {
        path: `projects/${PROJECT_DIR}/${SID_1}.jsonl`,
        reason: 'size-cap',
        detail: '200 > 100 bytes',
      },
    ]);
  });

  it('returns nothing when there is no projects directory', async () => {
    const root = await makeTempDir();
    const diagnostics = new DiagnosticsCollector();
    expect(await listSources(root, 100, diagnostics)).toEqual([]);
    expect(diagnostics.snapshot().fileIssues).toEqual([]);
  });
});

describe('peekFirstCwd', () => {
  it('returns the first cwd of an envelope record and never reads other record types', async () => {
    const root = await makeTempDir();
    const file = await put(
      root,
      't.jsonl',
      jsonl(
        { type: 'file-history-snapshot', cwd: '/not/read' },
        { type: 'bridge-session', cwd: '/not/read/either', accountUuid: 'x' },
        { type: 'user', message: {} },
        user('/home/user/project'),
        user('/home/user/elsewhere'),
      ),
    );
    expect((await peekFirstCwd(file)).cwd).toBe('/home/user/project');
  });

  it('reads at most 64 KiB and ignores a partial line', async () => {
    const root = await makeTempDir();
    const filler = JSON.stringify({ type: 'progress', data: 'x'.repeat(PEEK_BYTES) });
    const late = await put(
      root,
      'late.jsonl',
      `${filler}\n${JSON.stringify(user('/home/user/a'))}\n`,
    );
    expect((await peekFirstCwd(late)).cwd).toBeNull();
    const partial = await put(root, 'partial.jsonl', JSON.stringify(user('/home/user/a')));
    expect((await peekFirstCwd(partial)).cwd).toBeNull();
    const relative = await put(root, 'relative.jsonl', jsonl(user('relative/path')));
    expect((await peekFirstCwd(relative)).cwd).toBeNull();
  });
});

describe('toCandidates', () => {
  it('reports cwds outside registered roots, grouped and sorted', () => {
    const t1 = Date.parse('2026-10-01T00:00:00Z');
    const t2 = Date.parse('2026-10-02T00:00:00Z');
    const roots = [{ projectId: 'p', rootPath: '/home/user/repo' }];
    expect(
      toCandidates(
        [
          { cwd: '/home/user/repo/packages/a', mtimeMs: t1 },
          { cwd: '/home/user/repo-evil', mtimeMs: t1 },
          { cwd: '/home/user/repo-evil', mtimeMs: t2 },
          { cwd: '/home/user/other', mtimeMs: t1 },
          { cwd: null, mtimeMs: t2 },
        ],
        roots,
      ),
    ).toEqual([
      {
        provider: 'claude-code',
        cwd: '/home/user/other',
        sessionCount: 1,
        lastSeenAt: '2026-10-01T00:00:00.000Z',
      },
      {
        provider: 'claude-code',
        cwd: '/home/user/repo-evil',
        sessionCount: 2,
        lastSeenAt: '2026-10-02T00:00:00.000Z',
      },
    ]);
  });
});
