import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the built game runs from any folder or static host.
  base: './',
  build: {
    // three.js alone is ~600 kB minified; one chunk is fine for a prototype.
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
