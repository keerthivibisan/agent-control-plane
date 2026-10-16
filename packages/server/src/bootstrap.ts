import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createClaudeCodeAdapter, createManagedClaudeCode } from '@acp/adapter-claude-code';
import { createDemoAdapter } from '@acp/adapter-demo';
import type { ManagedExecutionAdapter, ObservationAdapter } from '@acp/core';
import {
  createQueries,
  createRepositories,
  createWorkspaceRepositories,
  openDatabase,
} from '@acp/db';
import { createApp } from './app.js';
import { createCheckService } from './board/checks.js';
import { createProjectHarness } from './board/harness.js';
import { createBoardService } from './board/service.js';
import { createWorkflowService } from './workflow/service.js';
import { createTokensService } from './tokens/service.js';
import type { ServerConfig } from './config.js';
import { HttpError } from './errors.js';
import { ensureHookToken } from './hooks/token.js';
import { createLogger, errorFields, type Logger } from './logger.js';
import { createNotifier } from './notifier.js';
import { createPipeline } from './pipeline/ingest.js';
import { createScheduler } from './scheduler.js';
import { createServices } from './services/index.js';
import { managedAgentEnv } from './control/env.js';
import {
  createControlService,
  type ControlService,
  type ControlWorkspaceHooks,
} from './control/service.js';
import { createCheckRunner, createMainChecks, type CheckRunner } from './harness/index.js';
import { createGitRunner, createWorkspaceManager, type GitRunner } from './workspace/index.js';

/** The demo projects live only in the separate demo database (AGENTS.md §3.9). */
const DEMO_PROJECTS = [
  { name: 'demo-api', rootPath: '/home/user/demo-api' },
  { name: 'demo-web', rootPath: '/home/user/demo-web' },
];
/** Demo records become visible as their fixture time passes; start part-way in so there is data. */
const DEMO_HEAD_START_MS = 20 * 60 * 1000;

export interface StartOptions {
  config: ServerConfig;
  logger?: Logger;
  /** Overrides `config.port` (tests use 0 for an ephemeral port). */
  port?: number;
  /** Built web UI to serve; omitted means API only. */
  staticDir?: string;
  now?: () => Date;
  /** Demo fixtures start `DEMO_HEAD_START_MS` before this instant. */
  demoBaseTime?: Date;
  /** Tests only: fixture roots like `/home/user/project` do not exist on the test machine. */
  normalizeRoot?: (rootPath: string) => Promise<string>;
  /**
   * A managed adapter to use instead of the Agent SDK (tests and the P3-F e2e inject a scripted
   * fake). With one injected, managed execution defaults to on in demo mode too.
   */
  managedAdapter?: ManagedExecutionAdapter;
  /** Tests: git for the workspace manager (isolated from the user's git config). */
  git?: GitRunner;
  /** Tests and the e2e: the harness check runner (default: the real one, ADR-0017). */
  checkRunner?: CheckRunner;
  /** Tests: control-service timing overrides. */
  control?: { approvalTimeoutMs?: number; sweepIntervalMs?: number | null; cancelGraceMs?: number };
}

export interface RunningServer {
  port: number;
  /** Whether the control-panel routes are on. */
  managed: boolean;
  close(): Promise<void>;
}

function packageVersion(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const version = (parsed as { version?: unknown }).version;
  return typeof version === 'string' ? version : '0.0.0';
}

/** Live: the root must be an existing directory; store its canonical path. */
async function normalizeLiveRoot(rootPath: string): Promise<string> {
  try {
    const real = await realpath(rootPath);
    if (!(await stat(real)).isDirectory()) {
      throw new HttpError(400, 'invalid_root', 'Root path is not a directory');
    }
    return real;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_root', 'Root path does not exist or is not readable');
  }
}

/**
 * Managed execution (Phase 3): an injected adapter (tests, e2e) is used whenever managed is not
 * `off`. Otherwise the Agent SDK adapter runs only in live mode, never in demo mode, with the
 * filtered environment (no ACP_* or GIT_* variables; ADR-0012).
 */
function resolveManagedAdapter(
  config: ServerConfig,
  injected: ManagedExecutionAdapter | undefined,
): ManagedExecutionAdapter | undefined {
  if (config.managed === 'off') return undefined;
  if (injected !== undefined) return injected;
  if (config.mode === 'demo') return undefined;
  return createManagedClaudeCode({ env: managedAgentEnv(process.env) });
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const { config } = options;
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => new Date());

  const adapters: ObservationAdapter[] = [];
  if (config.mode === 'demo') {
    // Demo data is replayed from fixtures into its own file, rebuilt on every start.
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(`${config.databasePath}${suffix}`, { force: true });
    const base = (options.demoBaseTime ?? now()).getTime() - DEMO_HEAD_START_MS;
    adapters.push(createDemoAdapter({ baseTime: new Date(base), now }));
  } else {
    // Read-only: only allowlisted files under <claudeDir>/projects inside registered roots.
    adapters.push(createClaudeCodeAdapter({ claudeDir: config.claudeDir, now }));
  }

  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const db = openDatabase(config.databasePath);
  const repos = createRepositories(db);
  const queries = createQueries(db);
  if (config.mode === 'demo') {
    for (const p of DEMO_PROJECTS) {
      if (repos.projects.getByRootPath(p.rootPath) === undefined) repos.projects.insert(p);
    }
  }

  const notifier = createNotifier();
  // Set below; the pipeline and scheduler only call it once polling starts.
  const controlRef: { current?: ControlService } = {};
  const extraRoots = () => controlRef.current?.extraRoots() ?? [];
  const pipeline = createPipeline({
    db,
    repos,
    logger,
    now,
    publish: (n) => notifier.publish(n),
    extraRoots,
  });
  const scheduler = createScheduler({
    adapters,
    repos,
    pipeline,
    logger,
    now,
    intervalMs: config.pollIntervalMs,
    extraRoots,
  });

  const managedAdapter = resolveManagedAdapter(config, options.managedAdapter);
  const git = options.git ?? createGitRunner();
  // Filled in by the board service below; the control service reads it at call time.
  const workspaceHooks: ControlWorkspaceHooks = {};
  const controlService = createControlService({
    db,
    repos,
    adapter: managedAdapter,
    workspaces: createWorkspaceManager({ dataDir: config.dataDir, git, logger }),
    git,
    dataDir: config.dataDir,
    enabled: managedAdapter !== undefined,
    logger,
    now,
    publish: (n) => notifier.publish(n),
    runTimeoutMs: config.runTimeoutMs,
    flushIngestion: () => scheduler.pollNow(),
    workspace: workspaceHooks,
    ...options.control,
  });
  controlRef.current = controlService;
  logger.log('info', 'managed agents', { enabled: controlService.enabled });
  const requestPoll = () => {
    void scheduler.pollNow();
  };
  const hookState = { receivedAny: false };
  const token = await ensureHookToken(config.hookTokenPath);

  const services = createServices({
    db,
    repos,
    queries,
    adapters,
    now,
    thresholds: config.statusThresholds,
    mode: config.mode,
    version: packageVersion(),
    hookReceiverUrl: `http://${config.host}:${options.port ?? config.port}/api/hooks/claude-code`,
    hookState,
    claudeDir: config.claudeDir,
    ingestionStats: () => ({ pipeline: pipeline.counters(), scheduler: scheduler.stats() }),
    normalizeRoot:
      options.normalizeRoot ??
      (config.mode === 'demo' ? (p) => Promise.resolve(p) : normalizeLiveRoot),
    publish: (n) => notifier.publish(n),
    requestPoll,
    isManagedPath: (cwd) => controlService.isManagedPath(cwd),
  });
  // Phase 4 board: one shared check runner for the whole server (ADR-0017: one check at a time).
  const workspaceRepos = createWorkspaceRepositories(db, { now });
  const projectHarness = createProjectHarness({ repos, workspace: workspaceRepos, now, logger });
  const checkRunner = options.checkRunner ?? createCheckRunner({ logger, now });
  const mainChecks = createMainChecks({
    dataDir: config.dataDir,
    runner: checkRunner,
    git,
    now,
    logger,
  });
  const checks = createCheckService({
    repos,
    workspace: workspaceRepos,
    control: controlService,
    runner: checkRunner,
    mainChecks,
    harness: projectHarness,
    publish: (n) => notifier.publish(n),
    logger,
  });
  const board = createBoardService({
    db,
    repos,
    queries,
    projects: services.projects,
    control: controlService,
    harness: projectHarness,
    checks,
    git,
    now,
    publish: (n) => notifier.publish(n),
    logger,
  });
  Object.assign(workspaceHooks, board.controlHooks());
  const workflow = createWorkflowService({
    db,
    repos,
    setupFor: (projectId) => board.getSetup(projectId),
    now,
    publish: (n) => notifier.publish(n),
  });

  const app = createApp({
    config,
    logger,
    services,
    stream: { repos, notifier },
    hooks: {
      token,
      adapter: adapters.find((a) => a.provider === 'claude-code'),
      pipeline,
      hookState,
      requestPoll,
      logger,
      now,
    },
    control: controlService,
    board,
    workflow,
    tokens: createTokensService({ db }),
    ...(options.staticDir !== undefined && { staticDir: options.staticDir }),
  });
  await controlService.start();
  try {
    // Temporary main-branch checkouts a crash left behind (P4-C handoff).
    const removed = await mainChecks.cleanupOrphans();
    logger.log('info', 'orphan check checkouts cleaned', { removed });
  } catch (error) {
    logger.log('warn', 'orphan check checkout cleanup failed', errorFields(error));
  }

  let server: Server;
  try {
    server = await new Promise<Server>((resolve, reject) => {
      const s = app.listen(options.port ?? config.port, config.host, () => resolve(s));
      s.once('error', reject);
    });
  } catch (error) {
    await checks.close();
    await controlService.close();
    db.close();
    throw error;
  }
  scheduler.start();
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;
  logger.log('info', 'server listening', { host: config.host, port, mode: config.mode });

  return {
    port,
    managed: controlService.enabled,
    async close() {
      // Stop accepting requests first so no hook can request a poll while the scheduler drains.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await scheduler.stop();
      // A running check is stopped; agents are aborted without recording anything, and the next
      // start marks them NEEDS_REVIEW.
      await checks.close();
      await controlService.close();
      db.close();
    },
  };
}
