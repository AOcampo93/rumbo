import { defineConfig } from 'vitest/config';

// Same bar as the engine (docs/PROJECT_PLAN.md §16): `pnpm test` fails below it.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
