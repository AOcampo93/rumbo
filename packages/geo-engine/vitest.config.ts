import { defineConfig } from 'vitest/config';

// The engine's Definition of Done (docs/PROJECT_PLAN.md §16, phase 2) asks for
// at least 90 % coverage, so `pnpm test` fails below it.
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
