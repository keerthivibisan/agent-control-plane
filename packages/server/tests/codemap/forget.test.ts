// Synthetic temp repositories only (ADR-0036 RM-2): a removed project's builds write nothing.
import { describe, expect, it } from 'vitest';
import { CodeMapBuildCancelled } from '../../src/codemap/errors.js';
import { setupCodeMap, type CodeMapSetup } from './setup.js';

function rows(s: CodeMapSetup, table: string): number {
  return s.db.connection.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
}

describe('code map forget (ADR-0036)', () => {
  it('a running build drops its result unwritten, and a queued one never starts', async () => {
    const ref: { s?: CodeMapSetup } = {};
    const s = setupCodeMap({
      // The project is removed while the build reads its files.
      onParse: () => ref.s?.service.forget(ref.s.projectId),
    });
    ref.s = s;
    const first = s.commit({ 'a.ts': 'export const a = 1;\n' });
    const running = s.service.ensureForCommit(s.projectId, first);
    const second = s.commit({ 'b.ts': 'export const b = 2;\n' });
    const queued = s.service.ensureForCommit(s.projectId, second);

    await expect(running).rejects.toBeInstanceOf(CodeMapBuildCancelled);
    await expect(queued).rejects.toBeInstanceOf(CodeMapBuildCancelled);
    await s.service.idle();
    // Nothing written: no blobs, no manifest, and no failure recorded either.
    expect(rows(s, 'code_map_blobs')).toBe(0);
    expect(rows(s, 'code_map_manifests')).toBe(0);
    expect(s.parsed).toEqual(['a.ts']);
    expect(s.logs.some((l) => l.includes('code map build dropped'))).toBe(true);
  });

  it('a build started after forget runs normally', async () => {
    const s = setupCodeMap();
    s.service.forget(s.projectId);
    const commit = s.commit({ 'a.ts': 'export const a = 1;\n' });
    expect((await s.service.ensureForCommit(s.projectId, commit)).commit).toBe(commit);
  });
});
