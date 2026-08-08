import { defineConfig } from 'vitest/config';

// Unit tests for the workspace's pure modules (lib/). Anything that has
// to actually render, or to load a real folder, is in the Playwright
// suite (e2e/) — this
// config deliberately only picks up test/**, so `npm test` stays fast
// and needs no browser. Node environment: everything under test here is
// DOM-free by construction.
//
// No `@cuboidy/core` alias, and there used not to be one either: core's
// package `main` now points at its SOURCE, so every consumer — vite, vitest
// and tsc — resolves it the same way with no configuration at all. It used
// to point at a hand-built `dist/`, which needed the same alias repeated in
// seven places, and the seventh would have been whoever added the next one.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
