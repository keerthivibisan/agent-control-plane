// Synthetic temp git repo only (R-G, for R-E's Harness page history).
import { describe, expect, it } from 'vitest';
import { CheckRunDtoSchema } from '@acp/core/api';
import { expectError } from '../control/helpers.js';
import { PASSING_WHEN_FIXED, setupBoard } from './helpers.js';

describe('GET /api/projects/:id/harness/checks (main-branch history)', () => {
  it('lists past "Run checks now" results, newest first, and is empty before any run', async () => {
    const s = await setupBoard({ files: { 'README.md': 'x\n', ...PASSING_WHEN_FIXED } });
    const path = `/api/projects/${s.project.id}/harness/checks`;
    const empty = await s.get(path);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    expect((await s.post(path, {})).status).toBe(200);
    s.clock.now = new Date(s.clock.now.getTime() + 60_000);
    expect((await s.post(path, {})).status).toBe(200);

    const res = await s.get(path);
    expect(res.status).toBe(200);
    const runs = CheckRunDtoSchema.array().parse(res.body);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.runId === null && r.checkId === 'test')).toBe(true);
    expect(runs[0]?.startedAt.localeCompare(runs[1]?.startedAt ?? '')).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('is 404 for an unknown project', async () => {
    const s = await setupBoard();
    expectError(await s.get('/api/projects/nope/harness/checks'), 404, 'not_found');
  });
});
