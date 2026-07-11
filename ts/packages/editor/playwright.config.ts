import { defineConfig } from '@playwright/test';

// E2E harness for the editor (audit D-1: the editor previously had no
// automated tests). Boots the vite dev server on a dedicated port so a
// developer's own `npm run dev` (5173) is never disturbed.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // The suite drives ONE shared dev server; tests within a file run
  // serially (they share no state — each test opens a fresh page).
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5199',
  },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
