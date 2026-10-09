import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      include: ['test/**/*.test.ts'],
      // Room for a slow CI runner (the default is 5 s); a test that really hangs still fails.
      testTimeout: 15_000,
    },
  }),
);
