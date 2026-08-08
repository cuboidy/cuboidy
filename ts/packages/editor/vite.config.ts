import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config kept minimal: React plugin is the only non-default. The
// editor is shipped as a static site (no SSR, no API routes), so the
// Vite defaults (ESM, code-split, hashed asset URLs) work as-is.
export default defineConfig({
  plugins: [react()],
  // Relative base so the built site can be hosted at any subpath
  // (e.g. cuboidy.com/editor/, username.github.io/cuboidy/, or a
  // contributor's `vite preview` on localhost).
  base: './',
});
