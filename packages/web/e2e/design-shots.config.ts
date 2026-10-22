import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

/*
 * The design checkpoint pictures (design-shots.spec.ts, v0.3.0 D-0), kept out of the main e2e
 * config so the normal suite never runs them. Like the README pictures, it reuses only the main
 * config's demo server (DEMO mode, a fresh temp ACP_DATA_DIR, ACP_E2E_PORT). Run with
 * ACP_DESIGN_SHOTS=<folder> (and ACP_DESIGN_TAG=<prefix>) after `pnpm --filter @acp/web build`:
 * `pnpm --filter @acp/web exec playwright test -c e2e/design-shots.config.ts`.
 */

const PORT = Number(process.env.ACP_E2E_PORT ?? '7431');
const servers = Array.isArray(base.webServer) ? base.webServer : [];
const demo = servers.find((s) => s.env?.['ACP_MODE'] === 'demo');
if (demo === undefined) throw new Error('the main e2e config has no demo server');

export default defineConfig({
  ...base,
  projects: [
    {
      name: 'design',
      testMatch: 'design-shots.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
  ],
  webServer: [demo],
});
