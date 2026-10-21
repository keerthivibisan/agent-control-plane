import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { driveScenario } from './flow.js';
import { SCENARIO_IDS } from './scenarios.js';

/*
 * The WG-V real-run driver's `--dry-run` (the FAKE adapter; nothing is spawned): every scenario
 * runs to the owner's merge with every invariant holding, and the command line refuses what it
 * must. A real run is never started from here.
 */

const DRIVE = fileURLToPath(new URL('./drive.ts', import.meta.url));
const SERVER_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function runDrive(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--conditions=development', '--import', 'tsx', DRIVE, ...args],
      {
        cwd: SERVER_ROOT,
        env: { ...process.env, ACP_REAL_RUN: undefined, CI: undefined, ...env },
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

interface AgentLine {
  kind: string;
  nodeId: string | null;
  permissionMode: string | null;
  sandbox: { enabled: boolean } | null;
  followUp: boolean;
}

describe('the WG-V real-run driver, dry run (fake adapter)', { timeout: 180_000 }, () => {
  for (const id of SCENARIO_IDS) {
    it(`scenario ${id} reaches the owner's merge with every invariant holding`, async () => {
      const { ok, summary } = await driveScenario({ scenario: id, dryRun: true, limitMs: 120_000 });
      expect(summary['assertions']).toSatisfy((a: Record<string, boolean>) =>
        Object.values(a).every(Boolean),
      );
      expect(ok).toBe(true);
      const agents = summary['agents'] as AgentLine[];
      // The lead and reviewers: `default`, no sandbox.
      for (const a of agents.filter((x) => x.kind !== 'worker' && x.kind !== 'tester')) {
        expect([a.kind, a.permissionMode, a.sandbox]).toEqual([a.kind, 'default', null]);
      }
      const byNode = (node: string) => agents.filter((a) => a.nodeId === node && !a.followUp);
      const routes = summary['reviewRoutes'] as { decidedBy: Record<string, number> };
      const prompts = summary['prompts'] as {
        byModeKindTool: Record<string, number>;
        fullAutoAskedOwner: number;
      };
      expect(prompts.fullAutoAskedOwner).toBe(0);
      switch (id) {
        case 'a':
          expect(agents.some((a) => a.kind === 'reviewer')).toBe(false);
          expect(routes.decidedBy).toEqual({ lead: 1 });
          break;
        case 'b': {
          // The Full auto pool tightened to Auto edits: sandbox, but `default`.
          const pool = byNode('helpers');
          expect(pool.length).toBeGreaterThan(0);
          for (const a of pool) {
            expect(a.permissionMode).toBe('default');
            expect(a.sandbox?.enabled).toBe(true);
          }
          expect(byNode('review').length).toBe(1);
          break;
        }
        case 'c':
          expect(routes.decidedBy['reviewer']).toBe(1);
          expect(routes.decidedBy['lead']).toBe(1);
          expect(byNode('review').length).toBe(2);
          break;
        case 'mixed':
          expect(byNode('helpers').map((a) => [a.permissionMode, a.sandbox?.enabled])).toEqual([
            ['auto', true],
          ]);
          expect(byNode('frontend').map((a) => [a.permissionMode, a.sandbox])).toEqual([
            ['default', null],
          ]);
          expect(byNode('unit-tests').map((a) => [a.permissionMode, a.sandbox])).toEqual([
            ['default', null],
          ]);
          // The Manual helper asked for its own edit (allowed); the Auto edits tester's command
          // asked (denied); the Full auto pool's command never reached the owner.
          expect(prompts.byModeKindTool).toEqual({
            'manual:worker:Write:allow': 1,
            'auto-edits:tester:Bash:deny': 1,
          });
          break;
      }
      // Aggregates only: no temp path or id in the summary.
      const text = JSON.stringify(summary);
      expect(text).not.toMatch(/\/(tmp|var|private|Users)\//);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      expect(text).not.toMatch(/\b[0-9a-f]{40}\b/);
    });
  }

  it('the command line runs a dry run and refuses a real run without consent', async () => {
    const dry = await runDrive(['--scenario', 'a', '--dry-run']);
    expect(dry.code, dry.stderr).toBe(0);
    expect((JSON.parse(dry.stdout) as { ok: boolean; dryRun: boolean }).ok).toBe(true);

    for (const [args, env, says] of [
      [['--scenario', 'a'], {}, 'ACP_REAL_RUN=1'],
      [['--dry-run'], {}, '--scenario'],
      [['--scenario', 'z', '--dry-run'], {}, 'must be one of'],
      [['--scenario', 'a', '--dry-run'], { ACP_REAL_RUN: '1' }, 'choose one'],
      [['--scenario', 'a'], { ACP_REAL_RUN: '1', CI: 'true' }, 'never in CI'],
    ] as const) {
      const r = await runDrive([...args], env);
      expect([r.code, r.stdout]).toEqual([2, '']);
      expect(r.stderr).toContain(says);
    }
  });
});
