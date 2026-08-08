import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for the workspace's pure modules (lib/). Anything that has
// to actually render, or to load a real folder, is in the Playwright
// suite (e2e/) — this config picks up test/** only, so `npm test` stays
// fast and needs no browser. Node environment: what is tested here is
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
