import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

/*
 * The README screenshots (readme-screenshots.spec.ts), kept out of the main e2e config so the
 * normal suite never runs them. It reuses the main config's demo server (DEMO mode, a fresh temp
 * ACP_DATA_DIR, ACP_E2E_PORT) and nothing else: no Claude data, no managed agents. Run with
 * ACP_README_SHOTS=1 (BUILD.md, "README screenshots"); without it the spec skips.
 */

const PORT = Number(process.env.ACP_E2E_PORT ?? '7431');
const servers = Array.isArray(base.webServer) ? base.webServer : [];
const demo = servers.find((s) => s.env?.['ACP_MODE'] === 'demo');
if (demo === undefined) throw new Error('the main e2e config has no demo server');

export default defineConfig({
  ...base,
  projects: [
    {
      name: 'readme',
      testMatch: 'readme-screenshots.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
  ],
  webServer: [demo],
});
