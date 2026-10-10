import { defineConfig } from 'vitest/config';

// Resolve workspace packages (@acp/core, @acp/db) to their TypeScript source through the
// `development` export condition, so tests never depend on a stale or missing dist
// (docs/development.md §3).
//
// Only `development` is listed. The other packages also list `import`/`module`, but vitest forwards
// these conditions to Node itself, and `import` makes a CommonJS `require('is-promise')` (a router
// dependency) resolve to its ESM entry, which breaks Express with "isPromise is not a function".
const conditions = ['development'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
