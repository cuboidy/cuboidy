import { defineConfig } from '@playwright/test';

// E2E harness for the workspace. Its own port so it never collides with
// the editor's suite (5199) or a developer's `npm run dev` (5173).
//
// E2E carries more weight here than unit tests would: the thing worth
// proving is that a real folder of models loads and DRAWS, and a 3D view
// can typecheck perfectly while rendering nothing at all.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // The suite drives ONE shared dev server; tests within a file run
  // serially (they share no state — each test opens a fresh page).
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5198',
  },
  webServer: {
    command: 'npm run dev -- --port 5198 --strictPort',
    url: 'http://localhost:5198',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
