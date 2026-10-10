import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountStatic } from '../src/static.js';
import { tempDir } from './helpers.js';

describe('mountStatic', () => {
  it('serves the SPA fallback when the web build lives under a dot-directory', async () => {
    const dir = join(tempDir(), '.hidden', 'web', 'dist');
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>acp</title>');
    writeFileSync(join(dir, 'assets', 'a.js'), 'console.log(1)');
    const app = express();
    expect(mountStatic(app, dir)).toBe(true);

    const page = await request(app).get('/sessions/abc');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<title>acp</title>');
    expect((await request(app).get('/assets/a.js')).status).toBe(200);
  });
});
