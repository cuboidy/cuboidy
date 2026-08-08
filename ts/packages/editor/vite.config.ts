import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config kept minimal: React plugin is the only non-default. The
// editor is shipped as a static site (no SSR, no API routes), so the
// Vite defaults (ESM, code-split, hashed asset URLs) work as-is.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Read core from SOURCE, the way `@cuboidy/ui` already is (its
      // package `main` is `src/index.ts`). core's `main` points at
      // `dist/`, which only the CLIs need and which nothing rebuilds
      // automatically — so before this alias the editor silently ran
      // whatever core happened to be compiled last. A fix could land in
      // `src`, pass every test, and still be invisible in the running app;
      // that cost a full debugging round on the translucency work, where
      // the editor and `cuboidy-snap` disagreed only because one of them
      // was months of edits behind the other.
      '@cuboidy/core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url),
      ),
    },
  },
  // Relative base so the built site can be hosted at any subpath
  // (e.g. cuboidy.com/editor/, username.github.io/cuboidy/, or a
  // contributor's `vite preview` on localhost).
  base: './',
});
