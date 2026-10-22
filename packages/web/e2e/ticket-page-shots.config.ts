import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

/*
 * The ticket page pictures (ticket-page-shots.spec.ts, v0.3.0 D-B), kept out of the main e2e
 * config so the normal suite never runs them. Like the design pictures, it reuses only the main
 * config's demo server (DEMO mode, a fresh temp ACP_DATA_DIR, ACP_E2E_PORT). Run with
 * ACP_TICKET_SHOTS=<folder> after `pnpm --filter @acp/web build`:
 * `pnpm --filter @acp/web exec playwright test -c e2e/ticket-page-shots.config.ts`.
 */

const PORT = Number(process.env.ACP_E2E_PORT ?? '7431');
const servers = Array.isArray(base.webServer) ? base.webServer : [];
const demo = servers.find((s) => s.env?.['ACP_MODE'] === 'demo');
if (demo === undefined) throw new Error('the main e2e config has no demo server');

export default defineConfig({
  ...base,
  projects: [
    {
      name: 'ticket-shots',
      testMatch: 'ticket-page-shots.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
  ],
  webServer: [demo],
});
