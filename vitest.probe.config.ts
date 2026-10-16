import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['probe/**/*.test.ts'], silent: false, testTimeout: 120000 },
});
