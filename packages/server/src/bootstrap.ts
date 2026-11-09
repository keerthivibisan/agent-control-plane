import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createClaudeCodeAdapter, createManagedClaudeCode } from '@acp/adapter-claude-code';
import { createManagedCodex } from '@acp/adapter-codex';
import { createDemoAdapter } from '@acp/adapter-demo';
import type { ManagedExecutionAdapter, ManagedProviderId, ObservationAdapter } from '@acp/core';
import {
  createQueries,
  createCodeMapRepositories,
  createRepositories,
  createHarnessRepositories,
  createReviewLoopRepositories,
  createWorkspaceRepositories,
  openDatabase,
} from '@acp/db';
import { createApp } from './app.js';
import { createCheckService } from './board/checks.js';
import { createProjectHarness } from './board/harness.js';
import { createBoardService } from './board/service.js';
import { createWorkflowService } from './workflow/service.js';
import { createTokensService } from './tokens/service.js';
import { createCodeMapService } from './codemap/service.js';
import { createAgentsService, createSkillsService } from './skills/index.js';
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
import { createCodeHostService, type CliRunner } from './code-host/index.js';
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
  /**
   * Several injected managed adapters (tests of mixed-provider runs, ADR-0031): each is registered
   * under its own `provider`, after `managedAdapter`. Either one injected replaces the real ones.
   */
  managedAdapters?: readonly ManagedExecutionAdapter[];
  /** Tests: git for the workspace manager (isolated from the user's git config). */
  git?: GitRunner;
  /** Tests and the e2e: the harness check runner (default: the real one, ADR-0017). */
  checkRunner?: CheckRunner;
  /** Tests: control-service timing overrides. */
  control?: { approvalTimeoutMs?: number; sweepIntervalMs?: number | null; cancelGraceMs?: number };
  /**
   * Tests only: start ticket runs without the review loop (ADR-0021), as runs started before it
   * did, so the verification of that legacy flow keeps running against the real composition.
   */
  board?: { legacyTicketRuns?: boolean };
  /**
   * Tests and the e2e (ADR-0025): the code host CLI runner or command (a fake `gh`), so nothing
   * reaches GitHub. Default: the real `gh` on the PATH, run only on the owner's request.
   */
  codeHost?: { cli?: CliRunner; ghCommand?: string };
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

/** The managed adapters by provider (ADR-0031 §2): one per provider, never a fallback. */
export type ManagedAdapterRegistry = ReadonlyMap<ManagedProviderId, ManagedExecutionAdapter>;

/**
 * Managed execution (Phase 3, ADR-0031): injected adapters (tests, e2e) are used whenever managed
 * is not `off`, each under its own provider. Otherwise the real adapters run only in live mode,
 * never in demo mode: the Agent SDK with the filtered environment (no ACP_* or GIT_* variables;
 * ADR-0012), and Codex's app-server, whose adapter filters the environment the same way.
 */
export function resolveManagedAdapters(
  config: ServerConfig,
  injected: { single?: ManagedExecutionAdapter; many?: readonly ManagedExecutionAdapter[] },
): ManagedAdapterRegistry {
  const registry = new Map<ManagedProviderId, ManagedExecutionAdapter>();
  if (config.managed === 'off') return registry;
  const given = [
    ...(injected.single !== undefined ? [injected.single] : []),
    ...(injected.many ?? []),
  ];
  if (given.length > 0) {
    for (const adapter of given) registry.set(adapter.provider, adapter);
    return registry;
  }
  if (config.mode === 'demo') return registry;
  registry.set('claude-code', createManagedClaudeCode({ env: managedAgentEnv(process.env) }));
  registry.set('codex', createManagedCodex({ env: process.env, bin: config.codexBin }));
  return registry;
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

  const managedAdapters = resolveManagedAdapters(config, {
    ...(options.managedAdapter !== undefined && { single: options.managedAdapter }),
    ...(options.managedAdapters !== undefined && { many: options.managedAdapters }),
  });
  const git = options.git ?? createGitRunner();
  // Filled in by the board service below; the control service reads it at call time.
  const workspaceHooks: ControlWorkspaceHooks = {};
  const workspaceManager = createWorkspaceManager({ dataDir: config.dataDir, git, logger });
  // ADR-0025: GitHub through the owner's `gh` login; pushes with the same git runner.
  const codeHost = createCodeHostService({
    git,
    logger,
    ...(options.codeHost?.cli !== undefined && { cli: options.codeHost.cli }),
    ...(options.codeHost?.ghCommand !== undefined && { ghCommand: options.codeHost.ghCommand }),
  });
  // ADR-0034: built on the owner's refresh (CM-1) and, for a ticket run's base commit, when the
  // run starts (CM-2: the control service calls ensureForCommit; agents read the map).
  const codeMap = createCodeMapService({
    repo: createCodeMapRepositories(db).codeMap,
    projectOf: (projectId) => repos.projects.getById(projectId),
    git,
    logger,
    now,
  });
  const controlService = createControlService({
    db,
    repos,
    adapters: managedAdapters,
    workspaces: workspaceManager,
    git,
    dataDir: config.dataDir,
    homeDir: config.homeDir,
    claudeDir: config.claudeDir,
    codexHome: config.codexHome,
    enabled: managedAdapters.size > 0,
    logger,
    now,
    publish: (n) => notifier.publish(n),
    runTimeoutMs: config.runTimeoutMs,
    flushIngestion: () => scheduler.pollNow(),
    // ADR-0032 §5: managed usage of a provider ACP does not observe (Codex) is ingested here.
    ingestManaged: (events) => {
      pipeline.ingestEvents(events);
    },
    workspace: workspaceHooks,
    codeHost,
    // CM-5: with ACP_CODE_MAP=off the runs get no map source; `code_map` then refuses.
    ...(config.codeMap === 'on' && { codeMap }),
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
    managedProviders: () => controlService.providerAvailability(),
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
    reviewLoop: createReviewLoopRepositories(db, { now }),
    harnessRepos: createHarnessRepositories(db, { now }),
    checkouts: workspaceManager,
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
    ticketBranches: workspaceManager,
    codeHost,
    now,
    publish: (n) => notifier.publish(n),
    logger,
    ...(options.board?.legacyTicketRuns === true && { legacyTicketRuns: true }),
  });
  Object.assign(workspaceHooks, board.controlHooks());
  const workflow = createWorkflowService({
    db,
    repos,
    setupFor: (projectId) => board.getSetup(projectId),
    now,
    publish: (n) => notifier.publish(n),
  });
  // Project skills (ADR-0018): "used by" and the delete guard follow the project's workflow graph
  // (ADR-0023), or its version 1 workflow when it has no graph yet.
  const skills = createSkillsService({
    git,
    now,
    logger,
    workflowOf: (projectId) => workflow.effective(projectId),
  });
  // Agent files (ADR-0018 amendment): a file a node uses can't be deleted either.
  const agents = createAgentsService({
    git,
    logger,
    workflowOf: (projectId) => workflow.effective(projectId),
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
    codeMap,
    skills: { skills, projectOf: (projectId) => repos.projects.getById(projectId) },
    agents: { agents, projectOf: (projectId) => repos.projects.getById(projectId) },
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
