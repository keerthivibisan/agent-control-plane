import { fileURLToPath } from 'node:url';
import { startServer } from './bootstrap.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger, errorFields } from './logger.js';

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
  // A ConfigError names variables and rules, never their values. Any other message can quote an
  // absolute path (data dir, database file), so only its class and code are logged.
  logger.log(
    'error',
    'failed to start',
    error instanceof ConfigError ? { message: error.message } : errorFields(error),
  );
  process.exit(1);
}
