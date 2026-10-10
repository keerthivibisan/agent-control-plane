import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';
import { API_BASE, PROXY_ERROR_HEADER } from './src/lib/constants.ts';

/** Address of the local @acp/server (docs/development.md §5, `ACP_PORT` default). */
const API_TARGET = 'http://127.0.0.1:7420';

// `development` first: workspace packages (@acp/core) resolve to their TypeScript source, so the web
// build and tests never depend on a stale `dist` (docs/development.md §3).
const conditions = ['development', ...defaultClientConditions];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      [API_BASE]: {
        target: API_TARGET,
        changeOrigin: false,
        configure(proxy) {
          // Runs before Vite's own handler, which then sees the headers already sent.
          proxy.on('error', (_err, _req, res) => {
            if ('writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'content-type': 'text/plain', [PROXY_ERROR_HEADER]: '1' });
              res.end('upstream unreachable');
            }
          });
        },
      },
    },
  },
  // Served from 127.0.0.1 by the local server, so one ~1 MB bundle (React Flow + Recharts) is fine.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
});
