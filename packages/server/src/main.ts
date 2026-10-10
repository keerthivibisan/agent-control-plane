import { fileURLToPath } from 'node:url';
import { startServer } from './bootstrap.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger();

try {
  const config = loadConfig(process.env);
  const server = await startServer({
    config,
    logger,
    // packages/web/dist, relative to src/ in development and dist/ when built.
    staticDir: fileURLToPath(new URL('../../web/dist', import.meta.url)),
  });
  const shutdown = (signal: string) => {
    logger.log('info', 'shutting down', { signal });
    void server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
} catch (error) {
  const message =
    error instanceof ConfigError || error instanceof Error ? error.message : 'unknown error';
  logger.log('error', 'failed to start', { message });
  process.exit(1);
}
