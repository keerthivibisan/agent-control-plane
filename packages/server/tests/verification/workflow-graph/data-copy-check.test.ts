import { spawn } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tempFolders } from './harness.js';
import { buildV010DataDir, type V010Fixture } from './v010-fixture.js';

/*
 * The data-copy check script (data-copy-check.ts) on a SYNTHETIC copy: the v0.1.0-shaped data dir
 * the upgrade test uses. It runs as the coordinator will run it (a child `node --import tsx`), and
 * the test checks the aggregate output's shape, that it found everything, and that nothing it
 * printed names a project, ticket, plan, path or id. Plus its refusals. Never the owner's data.
 */

const SCRIPT = fileURLToPath(new URL('./data-copy-check.ts', import.meta.url));
const SERVER_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function runScript(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--conditions=development', '--import', 'tsx', SCRIPT, ...args],
      {
        cwd: SERVER_ROOT,
        env: { ...process.env, ACP_CLAUDE_DIR: undefined, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const folders = tempFolders();
let fx: V010Fixture;

beforeAll(async () => {
  fx = await buildV010DataDir((prefix) => folders.make(prefix));
}, 240_000);

afterAll(() => folders.removeAll());

describe(
  'data-copy check on a synthetic copy (RESUME.md Step 4b item 4)',
  { timeout: 120_000 },
  () => {
    it('checks every project, ticket and run, read-only, and prints aggregates only', async () => {
      const res = await runScript(['--data-dir', fx.dataDir, '--port', '0']);
      expect(res.stderr).toBe('');
      expect(res.code).toBe(0);
      const out = JSON.parse(res.stdout) as {
        ok: boolean;
        assertions: Record<string, boolean>;
        counts: { projects: number; tickets: number; runs: number };
        workflowGraphs: {
          stored: Record<string, number>;
          errorIssues: number;
          warningIssues: number;
        };
        checks: Record<string, { total: number; passed: number; failed: number }>;
        agentStartsAttempted: number;
        tablesChanged: Record<string, unknown>;
        v010Readers: { after: { unreadable: Record<string, number> } };
      };
      expect(out.ok).toBe(true);
      expect(Object.values(out.assertions).every(Boolean)).toBe(true);
      expect(out.counts).toEqual({
        projects: fx.projects.length,
        tickets: fx.tickets.length,
        runs: fx.runs.length,
      });
      expect(out.workflowGraphs).toMatchObject({ stored: { v1: 26, default: 3 }, errorIssues: 0 });
      expect(out.workflowGraphs.warningIssues).toBeGreaterThan(0);
      expect(Object.keys(out.checks).sort()).toEqual(
        [
          'agents',
          'board',
          'health',
          'projects',
          'run',
          'run-workflow-graph',
          'run-workflow-v1',
          'runs',
          'setup',
          'skills',
          'ticket',
          'tickets',
          'workflow-graph',
          'workflow-v1',
        ].sort(),
      );
      for (const c of Object.values(out.checks)) expect(c.failed).toBe(0);
      expect(out.checks['run']?.total).toBe(fx.runs.length);
      expect(out.agentStartsAttempted).toBe(0);
      // The restart recovery of the run in flight, and the default setup of the one project
      // without one; nothing else.
      expect(Object.keys(out.tablesChanged).sort()).toEqual(['agent_runs', 'project_setup']);
      expect(Object.values(out.v010Readers.after.unreadable).every((n) => n === 0)).toBe(true);

      // Nothing that names or locates the owner's data.
      const secrets = [
        ...fx.projects.flatMap((p) => [p.id, p.name, p.rootPath]),
        ...fx.runs.map((r) => r.id),
        ...fx.tickets.map((t) => t.id),
        'Synthetic',
        'ticket with options',
        fx.dataDir,
        fx.parentDir,
        '/tmp',
        '/var/folders',
        '/Users/',
      ];
      for (const s of secrets) expect(res.stdout.includes(s), s).toBe(false);
    });

    it('refuses the live data folder (also through a link), the owner’s ports and a used Claude dir', async () => {
      const home = folders.make('acp-wgv-copy-test-home-');
      const live = join(home, '.agent-control-plane');
      mkdirSync(live);
      writeFileSync(join(live, 'acp.sqlite'), '');
      const link = join(home, 'link-to-live');
      symlinkSync(live, link);
      for (const dir of [live, link, home]) {
        const r = await runScript(['--data-dir', dir, '--port', '0'], { HOME: home });
        expect([r.code, r.stderr]).toEqual([2, expect.stringContaining('live data folder')]);
        expect(r.stdout).toBe('');
      }
      for (const port of ['7420', '5173']) {
        const r = await runScript(['--data-dir', fx.dataDir, '--port', port]);
        expect([r.code, r.stderr]).toEqual([2, expect.stringContaining('owner’s app')]);
      }
      const used = folders.make('acp-wgv-copy-test-claude-');
      writeFileSync(join(used, 'x'), '');
      const r = await runScript(['--data-dir', fx.dataDir, '--port', '0'], {
        ACP_CLAUDE_DIR: used,
      });
      expect([r.code, r.stderr]).toEqual([2, expect.stringContaining('must be empty')]);
      const missing = await runScript(['--port', '0']);
      expect(missing.code).toBe(2);
    });
  },
);
