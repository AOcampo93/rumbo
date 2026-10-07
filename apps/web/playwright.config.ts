import { defineConfig } from '@playwright/test';

// End-to-end tests of PROJECT_PLAN §14.2 against the production build
// (`pnpm build` first). Simulation mode and Playwright's clock make the walks
// fast and deterministic.
const PORT = 4173;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 390, height: 844 },
    locale: 'es-ES',
    // page.route() must see every request (the API is mocked in some tests).
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    // Local runs use the installed Chrome; CI installs Playwright's Chromium.
    ...(CI ? {} : { channel: 'chrome' }),
    // The map is WebGL: software rendering where there is no GPU (CI).
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
