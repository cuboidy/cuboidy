import { defineConfig } from 'vitest/config';

// Unit tests for the editor's pure modules (lib/). Component and
// interaction coverage lives in the Playwright suite (e2e/) — this
// config deliberately only picks up test/**, so `npm test` stays fast
// and needs no browser. Node environment: everything under test here is
// DOM-free by construction.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
