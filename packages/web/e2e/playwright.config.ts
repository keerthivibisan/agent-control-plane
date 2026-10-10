import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/*
 * P1-F task F5: end-to-end tests against the real server in DEMO mode, serving the built UI
 * (`pnpm --filter @acp/web test:e2e` builds it first). Demo mode only ever opens its own
 * `demo.sqlite` under a fresh temp ACP_DATA_DIR, so a run never touches the live database or any
 * Claude data. Not part of `pnpm check`: it needs a downloaded Chromium
 * (`pnpm --filter @acp/web exec playwright install chromium`). The config lives in e2e/ so the e2e
 * tsconfig (Node types) covers it for ESLint; the app tsconfig is Vite/DOM only.
 */

const PORT = Number(process.env.ACP_E2E_PORT ?? '7431');
// Set once in the main process; workers inherit the environment, so all of them agree.
const DATA_DIR = (process.env.ACP_E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'acp-e2e-')));

export default defineConfig({
  testDir: '.',
  // One demo server, one browser: the specs read the same replayed data.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --conditions=development --import tsx src/main.ts',
    cwd: '../../server',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      ACP_MODE: 'demo',
      ACP_PORT: String(PORT),
      ACP_DATA_DIR: DATA_DIR,
      ACP_POLL_INTERVAL_MS: '1000',
    },
  },
});
