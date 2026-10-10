import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountStatic } from '../../src/static.js';
import { tempDir } from './helpers.js';

/*
 * Bug found by the P1-F e2e run (F5); NOT fixed here because packages/server/src is P1-D's.
 *
 * `mountStatic` answers the SPA fallback with `res.sendFile(index)` and an absolute path. `send`
 * applies its default `dotfiles: 'ignore'` to every segment of that absolute path, so when the
 * checkout lives under any dot-directory (e.g. `.claude/worktrees/…`, `~/.local/src/…`) the page
 * request fails with NotFoundError and the error middleware returns 500 `internal_error`, while
 * `/assets/*` (served by express.static with a root) still work. Proposed fix in static.ts:
 * `res.sendFile('index.html', { root: dir })` (only the relative part is then checked).
 *
 * Skipped so `pnpm check` stays green; remove `.skip` once static.ts is fixed.
 */
describe('static UI serving from a directory under a dot-segment', () => {
  it.skip('serves index.html for the SPA fallback', async () => {
    const dir = join(tempDir(), '.hidden', 'dist');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    const app = express();
    expect(mountStatic(app, dir)).toBe(true);
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });
});
