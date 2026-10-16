import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CandidateRootDtoSchema,
  CapabilitiesDtoSchema,
  HealthDtoSchema,
  SessionDetailDtoSchema,
  SessionSummaryDtoSchema,
  pageSchema,
} from '@acp/core/api';
import { startServer } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import { tempDir } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('../../../test-fixtures/claude-code', import.meta.url));

describe('startServer (demo mode smoke test)', () => {
  it('serves demo data and the built UI on loopback,', async () => {
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
  });
});

describe('startServer (live mode over Claude Code fixtures)', () => {
  it('ingests a registered project from a temp claudeDir: sessions, subagent edge, usage', async () => {
    const claudeDir = tempDir();
    cpSync(join(FIXTURES, '03-subagent-with-meta', 'projects'), join(claudeDir, 'projects'), {
      recursive: true,
    });
    const config = loadConfig({
      ACP_MODE: 'live',
      ACP_DATA_DIR: tempDir(),
      ACP_CLAUDE_DIR: claudeDir,
      ACP_POLL_INTERVAL_MS: '60000',
    });
    const server = await startServer({
      config,
      logger: silentLogger,
      port: 0,
      // The fixture's cwd is /home/user/project, which does not exist here.
      normalizeRoot: (p) => Promise.resolve(p),
    });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const health = HealthDtoSchema.parse(await (await fetch(`${base}/api/health`)).json());
      expect(health.mode).toBe('live');

      // Nothing is ingested before a project is registered; the cwd is only a candidate.
      const candidates = CandidateRootDtoSchema.array().parse(
        await (await fetch(`${base}/api/discovery/candidates`)).json(),
      );
      expect(candidates.map((c) => c.cwd)).toEqual(['/home/user/project']);

      // Mutations need the CSRF token whenever the control panel is mounted (P4-H finding).
      const { token } = (await (await fetch(`${base}/api/control/token`)).json()) as {
        token: string;
      };
      const created = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-acp-csrf': token },
        body: JSON.stringify({ name: 'project', rootPath: '/home/user/project' }),
      });
      expect(created.status).toBe(201);

      let page = pageSchema(SessionSummaryDtoSchema).parse({
        items: [],
        page: { nextCursor: null },
      });
      for (let i = 0; i < 100 && page.items.length < 2; i++) {
        await new Promise((r) => setTimeout(r, 20));
        page = pageSchema(SessionSummaryDtoSchema).parse(
          await (await fetch(`${base}/api/sessions?limit=200`)).json(),
        );
      }
      expect(page.items.map((s) => s.provider)).toEqual(['claude-code', 'claude-code']);
      const child = page.items.find((s) => s.providerAgentId !== null)!;
      const detail = SessionDetailDtoSchema.parse(
        await (await fetch(`${base}/api/sessions/${child.id}`)).json(),
      );
      expect(detail.parent).toMatchObject({ state: 'known', kind: 'subagent' });

      const caps = CapabilitiesDtoSchema.parse(
        await (await fetch(`${base}/api/capabilities`)).json(),
      );
      expect(caps.mode).toBe('live');
      expect(caps.providers[0]?.provider).toBe('claude-code');
      expect(caps.providers[0]?.limitations.length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });
});
