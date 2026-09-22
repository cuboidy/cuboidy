import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // No DOM and no WebGL: building the Object3D tree for a model uploads
    // nothing to a GPU, so the part of this package worth a test runs in
    // plain node.
    environment: 'node',
  },
});
