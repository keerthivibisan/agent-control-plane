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
 * - `review-loop-live` (RL-V, review-loop-live.spec.ts): the workspace e2e server again, on its
 *   own ports (ACP_E2E_LOOP_PORT, default ACP_E2E_CONTROL_PORT + 20, and the next port for its
 *   driver) and data dir, starting review-loop ticket runs (ACP_E2E_REVIEW_LOOP=1).
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
// --- R-V (redesign verification): the workspace server, a live-mode server over an empty temp
// Claude dir with the scripted fake adapter and no project (workspace.spec.ts creates one).
const WORKSPACE_PORT = Number(process.env.ACP_E2E_WORKSPACE_PORT ?? String(CONTROL_PORT + 10));
const WORKSPACE_DRIVER_PORT = WORKSPACE_PORT + 1;
const WORKSPACE_DATA_DIR = (process.env.ACP_E2E_WORKSPACE_DATA_DIR ??= mkdtempSync(
  join(tmpdir(), 'acp-e2e-workspace-'),
));
process.env.ACP_E2E_WORKSPACE_DRIVER_URL ??= `http://127.0.0.1:${WORKSPACE_DRIVER_PORT}`;
// --- end R-V
// --- RL-V: a second workspace server that starts review-loop ticket runs (ADR-0021).
const LOOP_PORT = Number(process.env.ACP_E2E_LOOP_PORT ?? String(CONTROL_PORT + 20));
const LOOP_DRIVER_PORT = LOOP_PORT + 1;
const LOOP_DATA_DIR = (process.env.ACP_E2E_LOOP_DATA_DIR ??= mkdtempSync(
  join(tmpdir(), 'acp-e2e-loop-'),
));
process.env.ACP_E2E_LOOP_DRIVER_URL ??= `http://127.0.0.1:${LOOP_DRIVER_PORT}`;
// --- end RL-V

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
      // v0.3.0 C-B (ADR-0026): Comments, Conversation and attachments, routes from fixtures.
      name: 'ticket-activity',
      testMatch: 'ticket-activity.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      // Redesign R-A: the project-first shell (and its screenshots) on the demo server.
      name: 'shell',
      testMatch: 'shell.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      // Redesign R-E: the Harness page with synthetic harness and check routes (page.route).
      name: 'harness',
      testMatch: 'harness.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      // v0.3.0 H-D (ADR-0027): the Checks blocks in the editor and the Harness page's setup.
      name: 'harness-blocks',
      testMatch: 'harness-blocks.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      // Redesign R-F: the project Tokens page (and its screenshots) on the demo server.
      name: 'tokens',
      testMatch: 'tokens.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      // Redesign R-B: the Workflow page (and its screenshots), workflow routes from fixtures.
      name: 'workflow',
      testMatch: 'workflow.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      // Redesign R-D: the Skills & Agents page (and its screenshots) on the demo server.
      name: 'skills',
      testMatch: 'skills.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'control',
      testMatch: 'control.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${CONTROL_PORT}` },
    },
    {
      // RL-D (ADR-0021): the review loop on the demo server's built UI, routes from fixtures.
      name: 'review-loop',
      testMatch: 'review-loop.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      // v0.3.0 S-B (ADR-0024): session names and the run summary card, routes from fixtures.
      name: 'session-names',
      testMatch: 'session-names.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      // v0.3.0 G-C (ADR-0025 §6): the shared diff viewer in the review loop's cards, routes from
      // fixtures, Shiki for real.
      name: 'diff-viewer',
      testMatch: 'diff-viewer.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      // v0.3.0 D-A: the review pages (Files changed, line comments, Review changes), routes from
      // fixtures, the owner's decisions captured.
      name: 'review-page',
      testMatch: 'review-page.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      // v0.3.0 G-B (ADR-0025): branching strategies and GitHub, routes from fixtures.
      name: 'github',
      testMatch: 'github.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    // --- R-V: every page of the new UI on the demo server (navigation, redirects, screenshots).
    {
      name: 'pages',
      testMatch: 'pages.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    // --- R-V: P4-H's deferred owner flow on the real routes, agents scripted by the driver.
    {
      name: 'workspace',
      testMatch: 'workspace.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${WORKSPACE_PORT}` },
    },
    // WG-D: the Workflow page's graph editor against the real routes, on the workspace server.
    {
      name: 'workflow-live',
      testMatch: 'workflow-live.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${WORKSPACE_PORT}` },
    },
    // --- end R-V
    // --- RL-V: the review loop's owner flow on the real routes, agents scripted by the driver.
    {
      name: 'review-loop-live',
      testMatch: 'review-loop-live.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${LOOP_PORT}` },
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
    // --- R-V: the workspace server (packages/server/tests/verification/redesign/e2e-server.ts).
    {
      command:
        'node --conditions=development --import tsx tests/verification/redesign/e2e-server.ts',
      cwd: '../../server',
      url: `http://127.0.0.1:${WORKSPACE_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        ACP_PORT: String(WORKSPACE_PORT),
        ACP_E2E_DRIVER_PORT: String(WORKSPACE_DRIVER_PORT),
        ACP_DATA_DIR: WORKSPACE_DATA_DIR,
      },
    },
    // --- end R-V
    // --- RL-V: the same server, serving review-loop ticket runs.
    {
      command:
        'node --conditions=development --import tsx tests/verification/redesign/e2e-server.ts',
      cwd: '../../server',
      url: `http://127.0.0.1:${LOOP_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        ACP_PORT: String(LOOP_PORT),
        ACP_E2E_DRIVER_PORT: String(LOOP_DRIVER_PORT),
        ACP_DATA_DIR: LOOP_DATA_DIR,
        ACP_E2E_REVIEW_LOOP: '1',
      },
    },
  ],
});
