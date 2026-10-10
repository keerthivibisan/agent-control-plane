import { defineConfig } from 'vitest/config';

// Resolve workspace packages (@acp/core) to their TypeScript source through the `development`
// export condition, so tests never depend on a stale or missing dist (docs/development.md §3).
const conditions = ['development', 'module', 'node', 'import', 'default'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
