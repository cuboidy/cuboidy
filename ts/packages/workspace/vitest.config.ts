import { defineConfig } from 'vitest/config';

// Unit tests for the workspace's pure modules (lib/). Anything that has
// to actually render, or to load a real folder, is in the Playwright
// suite (e2e/) — this config picks up test/** only, so `npm test` stays
// fast and needs no browser. Node environment: what is tested here is
// DOM-free by construction.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
