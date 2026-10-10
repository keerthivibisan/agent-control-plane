import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionSummaryDtoSchema, pageSchema } from '@acp/core/api';
import { startServer } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import { tempDir } from './helpers.js';

describe('startServer (demo mode smoke test)', () => {
  it('serves demo data and the built UI on loopback, and refuses live mode without an adapter', async () => {
    const dataDir = tempDir();
    const webDir = tempDir();
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>acp</title>');
    writeFileSync(join(webDir, 'assets', 'a.js'), 'console.log(1)');

    const config = loadConfig({ ACP_MODE: 'demo', ACP_DATA_DIR: dataDir });
    const server = await startServer({
      config,
      logger: silentLogger,
      port: 0,
      staticDir: webDir,
      now: () => new Date('2026-10-10T13:00:00.000Z'),
      demoBaseTime: new Date('2026-10-10T08:20:00.000Z'),
    });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const health = (await (await fetch(`${base}/api/health`)).json()) as { mode: string };
      expect(health.mode).toBe('demo');

      // The first poll runs asynchronously after listen.
      let count = 0;
      for (let i = 0; i < 100 && count < 6; i++) {
        const page = pageSchema(SessionSummaryDtoSchema).parse(
          await (await fetch(`${base}/api/sessions?limit=200`)).json(),
        );
        count = page.items.length;
        if (count < 6) await new Promise((r) => setTimeout(r, 20));
      }
      expect(count).toBe(6);

      expect((await fetch(`${base}/`)).status).toBe(200);
      expect(await (await fetch(`${base}/sessions/abc`)).text()).toContain('<title>acp</title>');
      expect((await fetch(`${base}/assets/a.js`)).status).toBe(200);
      expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    } finally {
      await server.close();
    }

    const live = loadConfig({ ACP_MODE: 'live', ACP_DATA_DIR: dataDir });
    await expect(startServer({ config: live, logger: silentLogger, port: 0 })).rejects.toThrow(
      /Claude Code adapter/,
    );
  });
});
