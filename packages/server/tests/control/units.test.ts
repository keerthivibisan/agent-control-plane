import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createCsrfToken, csrfTokenMatches } from '../../src/control/csrf.js';
import { managedAgentEnv } from '../../src/control/env.js';
import { createScheduler } from '../../src/scheduler.js';
import type { IngestionBatch, ObservationAdapter, RegisteredRoot } from '@acp/core';
import { observed, setupPipeline } from '../helpers.js';
import { setupControl } from './helpers.js';

describe('CSRF token', () => {
  it('is 64 random hex characters per start and compares in constant time', () => {
    const a = createCsrfToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(createCsrfToken()).not.toBe(a);
    expect(csrfTokenMatches(a, a)).toBe(true);
    expect(csrfTokenMatches(a, a.slice(0, 63))).toBe(false);
    expect(csrfTokenMatches(a, '')).toBe(false);
    expect(csrfTokenMatches(a, `${a}0`)).toBe(false);
  });
});

describe('managed agent environment (ADR-0012)', () => {
  it('drops every ACP_* and GIT_* variable and undefined values, keeps the rest', () => {
    expect(
      managedAgentEnv({
        PATH: '/usr/bin',
        HOME: '/home/tester',
        ANTHROPIC_API_KEY: 'k',
        ACP_HOOK_TOKEN: 'secret',
        ACP_DATA_DIR: '/data',
        acp_lower: 'x',
        GIT_DIR: '/elsewhere/.git',
        GIT_WORK_TREE: '/elsewhere',
        EMPTY: undefined,
      }),
    ).toEqual({ PATH: '/usr/bin', HOME: '/home/tester', ANTHROPIC_API_KEY: 'k' });
  });
});

describe('config: ACP_MANAGED, ACP_RUN_TIMEOUT_MS', () => {
  it('defaults to auto and a 2-hour run timeout; accepts on/off; rejects anything else', () => {
    const c = loadConfig({}, { homeDir: '/home/tester' });
    expect(c.managed).toBe('auto');
    expect(c.runTimeoutMs).toBe(7_200_000);
    expect(loadConfig({ ACP_MANAGED: 'on' }, { homeDir: '/h' }).managed).toBe('on');
    expect(loadConfig({ ACP_MANAGED: 'off' }, { homeDir: '/h' }).managed).toBe('off');
    expect(() => loadConfig({ ACP_MANAGED: 'yes' }, { homeDir: '/h' })).toThrow(/ACP_MANAGED/);
    expect(() => loadConfig({ ACP_RUN_TIMEOUT_MS: '0' }, { homeDir: '/h' })).toThrow(
      /ACP_RUN_TIMEOUT_MS/,
    );
  });
});

describe('active worktrees as extra roots', () => {
  it('the control service lists active worktrees under their run project and hides them from discovery', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    s.fake.lead().started();
    const worker = await s.startWorker();
    const path = s.worktree(runId, worker.id);
    expect(s.control.extraRoots()).toEqual([{ projectId: s.project.id, rootPath: path }]);
    expect(s.control.isManagedPath(`${path}/src`)).toBe(true);
    expect(s.control.isManagedPath(s.repo)).toBe(false);
  });

  it('project discovery never offers a managed worktree as a new project', async () => {
    const { createSystemService } = await import('../../src/services/system.js');
    const base = setupPipeline();
    const adapter = {
      provider: 'claude-code',
      discoverCandidates: () =>
        Promise.resolve([
          {
            provider: 'claude-code',
            cwd: '/data/worktrees/r/a',
            sessionCount: 1,
            lastSeenAt: null,
          },
          { provider: 'claude-code', cwd: '/work/other', sessionCount: 2, lastSeenAt: null },
        ]),
    } as unknown as ObservationAdapter;
    const system = createSystemService({
      adapters: [adapter],
      repos: base.repos,
      queries: base.queries,
      isManagedPath: (cwd: string) => cwd.startsWith('/data/worktrees/'),
    } as unknown as Parameters<typeof createSystemService>[0]);
    expect((await system.candidates()).map((c) => c.cwd)).toEqual(['/work/other']);
  });

  it('the scheduler polls extra roots alongside projects', async () => {
    const base = setupPipeline();
    base.repos.projects.insert({ name: 'p', rootPath: '/work/p' });
    const seen: RegisteredRoot[][] = [];
    const adapter = {
      provider: 'claude-code',
      poll: (roots: readonly RegisteredRoot[]) => {
        seen.push([...roots]);
        return (async function* (): AsyncGenerator<IngestionBatch> {})();
      },
    } as unknown as ObservationAdapter;
    const scheduler = createScheduler({
      adapters: [adapter],
      repos: base.repos,
      pipeline: base.pipeline,
      logger: { log() {} },
      now: () => new Date(),
      intervalMs: 60_000,
      extraRoots: () => [{ projectId: 'proj-x', rootPath: '/data/worktrees/r/a' }],
    });
    await scheduler.pollNow();
    expect(seen[0]?.map((r) => r.rootPath)).toEqual(['/work/p', '/data/worktrees/r/a']);
  });

  it('the pipeline assigns a session in a worktree to its run project', async () => {
    const { createPipeline } = await import('../../src/pipeline/ingest.js');
    const base = setupPipeline();
    const project = base.repos.projects.insert({ name: 'p', rootPath: '/work/p' });
    const pipeline = createPipeline({
      db: base.db,
      repos: base.repos,
      logger: { log() {} },
      now: () => new Date(),
      publish: () => {},
      extraRoots: () => [{ projectId: project.id, rootPath: '/data/worktrees/r/a' }],
    });
    pipeline.ingestEvents([
      observed({ dedupKey: 'w1', sessionId: 'worker-session' }, '/data/worktrees/r/a/src'),
    ]);
    const session = base.repos.sessions.getByKey({
      provider: 'claude-code',
      providerSessionId: 'worker-session',
      providerAgentId: null,
    });
    expect(session?.projectId).toBe(project.id);
  });
});
