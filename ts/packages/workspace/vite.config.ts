import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config kept minimal: React plugin is the only non-default. The
// workspace is shipped as a static site (no SSR, no API routes), so the
// Vite defaults (ESM, code-split, hashed asset URLs) work as-is.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Same reason as the editor's: core's package `main` is the hand-built
    // `dist/`, so without this the app runs a stale copy of core. See
    // ../editor/vite.config.ts.
    alias: {
      '@cuboidy/core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url),
      ),
    },
  },
  // Relative base so the built site can be hosted at any subpath
  // (e.g. cuboidy.com/workspace/, username.github.io/cuboidy/, or a
  // contributor's `vite preview` on localhost).
  base: './',
});
