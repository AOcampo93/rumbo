import { defineConfig } from 'vitest/config';

// Integration tests against a real PostgreSQL (PROJECT_PLAN §14.2): one
// container for the whole run (test/global-setup.ts), files one at a time
// because they share it.
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
