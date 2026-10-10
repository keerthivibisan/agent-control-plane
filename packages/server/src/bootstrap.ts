import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createClaudeCodeAdapter } from '@acp/adapter-claude-code';
import { createDemoAdapter } from '@acp/adapter-demo';
import type { ObservationAdapter } from '@acp/core';
import { createQueries, createRepositories, openDatabase } from '@acp/db';
import { createApp } from './app.js';
import type { ServerConfig } from './config.js';
import { HttpError } from './errors.js';
import { ensureHookToken } from './hooks/token.js';
import { createLogger, type Logger } from './logger.js';
import { createNotifier } from './notifier.js';
import { createPipeline } from './pipeline/ingest.js';
import { createScheduler } from './scheduler.js';
import { createServices } from './services/index.js';

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
}

export interface RunningServer {
  port: number;
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
  const pipeline = createPipeline({ db, repos, logger, now, publish: (n) => notifier.publish(n) });
  const scheduler = createScheduler({
    adapters,
    repos,
    pipeline,
    logger,
    now,
    intervalMs: config.pollIntervalMs,
  });
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
    normalizeRoot:
      options.normalizeRoot ??
      (config.mode === 'demo' ? (p) => Promise.resolve(p) : normalizeLiveRoot),
    publish: (n) => notifier.publish(n),
    requestPoll,
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
    ...(options.staticDir !== undefined && { staticDir: options.staticDir }),
  });

  let server: Server;
  try {
    server = await new Promise<Server>((resolve, reject) => {
      const s = app.listen(options.port ?? config.port, config.host, () => resolve(s));
      s.once('error', reject);
    });
  } catch (error) {
    db.close();
    throw error;
  }
  scheduler.start();
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;
  logger.log('info', 'server listening', { host: config.host, port, mode: config.mode });

  return {
    port,
    async close() {
      // Stop accepting requests first so no hook can request a poll while the scheduler drains.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await scheduler.stop();
      db.close();
    },
  };
}
