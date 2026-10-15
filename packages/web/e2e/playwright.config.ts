import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end tests against the real server, serving the built UI (`pnpm --filter @acp/web
 * test:e2e` builds it first). Two servers, each with its own fresh temp ACP_DATA_DIR, so a run never
 * touches the live database or any Claude data:
 *
 * - `demo` (P1-F task F5, demo.spec.ts): the server in DEMO mode on ACP_E2E_PORT (7431).
 * - `control` (P3-F, control.spec.ts): the control panel against a scripted fake managed adapter
 *   (packages/server/tests/verification/control/e2e-server.ts), demo mode, a throwaway git repo
 *   registered as "e2e-app", on ACP_E2E_CONTROL_PORT (7441) plus a test-only driver for the fake
 *   agents on the next port. Neither the Agent SDK nor `claude` ever runs.
 *
 * - `ticket` (P4-G, ticket.spec.ts): the ticket page on the demo server's built UI, with the ticket
 *   and run routes answered from synthetic fixtures (page.route) until P4-D serves them.
 *
 * Not part of `pnpm check`: it needs a downloaded Chromium
 * (`pnpm --filter @acp/web exec playwright install chromium`). The config lives in e2e/ so the e2e
 * tsconfig (Node types) covers it for ESLint; the app tsconfig is Vite/DOM only.
 */

const PORT = Number(process.env.ACP_E2E_PORT ?? '7431');
const CONTROL_PORT = Number(process.env.ACP_E2E_CONTROL_PORT ?? '7441');
const DRIVER_PORT = CONTROL_PORT + 1;
// Set once in the main process; workers inherit the environment, so all of them agree.
const DATA_DIR = (process.env.ACP_E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'acp-e2e-')));
const CONTROL_DATA_DIR = (process.env.ACP_E2E_CONTROL_DATA_DIR ??= mkdtempSync(
  join(tmpdir(), 'acp-e2e-control-'),
));
process.env.ACP_E2E_DRIVER_URL ??= `http://127.0.0.1:${DRIVER_PORT}`;

export default defineConfig({
  testDir: '.',
  // One browser at a time: the specs share each server's data.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'demo',
      testMatch: 'demo.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'ticket',
      testMatch: 'ticket.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'control',
      testMatch: 'control.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${CONTROL_PORT}` },
    },
  ],
  webServer: [
    {
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
    {
      command:
        'node --conditions=development --import tsx tests/verification/control/e2e-server.ts',
      cwd: '../../server',
      url: `http://127.0.0.1:${CONTROL_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        ACP_PORT: String(CONTROL_PORT),
        ACP_E2E_DRIVER_PORT: String(DRIVER_PORT),
        ACP_DATA_DIR: CONTROL_DATA_DIR,
      },
    },
  ],
});
