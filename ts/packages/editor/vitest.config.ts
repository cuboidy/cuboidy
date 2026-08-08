import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for the editor's pure modules (lib/). Component and
// interaction coverage lives in the Playwright suite (e2e/) — this
// config deliberately only picks up test/**, so `npm test` stays fast
// and needs no browser. Node environment: everything under test here is
// DOM-free by construction.
export default defineConfig({
  // Same alias as vite.config.ts. A vitest config does NOT inherit it —
  // vitest reads THIS file when it exists — so without the repeat the tests
  // resolve `@cuboidy/core` to its hand-built `dist/` and quietly check a
  // stale copy of core. That is the third place this had to be said; the
  // runtime and tsc were the other two.
  resolve: {
    alias: {
      '@cuboidy/core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
