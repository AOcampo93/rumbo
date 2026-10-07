import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';

// Shared steps of the e2e tests: settings, the mocked API, starting a route
// and moving Playwright's clock until something happens.

export interface Bundle {
  spec: { id: string };
}

export const fixture = (name: string): Bundle =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Bundle;

/** A returning user in simulation mode, unless the test says otherwise. */
export async function setup(page: Page, settings: Record<string, unknown> = {}, routes?: Bundle[]) {
  if (process.env.E2E_DEBUG) {
    page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`.slice(0, 400)));
    page.on('pageerror', (e) => console.log(`[pageerror] ${String(e)}`.slice(0, 400)));
  }
  await page.clock.install();
  await page.addInitScript(
    (value) => {
      if (!localStorage.getItem('rumbo.settings')) localStorage.setItem('rumbo.settings', value);
    },
    JSON.stringify({
      locale: 'es',
      onboarded: true,
      simulation: true,
      analyticsConsent: false,
      ...settings,
    }),
  );
  if (routes) await mockRoutes(page, routes);
}

/** The API of phase 5, mocked: the app prefers it over the bundled routes. */
export async function mockRoutes(page: Page, bundles: Bundle[]) {
  await page.route('**/api/v1/routes', (route) =>
    route.fulfill({ json: bundles.map((b) => ({ id: b.spec.id })) }),
  );
  await page.route('**/api/v1/routes/*', (route) => {
    const id = decodeURIComponent(route.request().url().split('/').pop() ?? '');
    const bundle = bundles.find((b) => b.spec.id === id);
    return bundle
      ? route.fulfill({ json: bundle })
      : route.fulfill({ status: 404, json: { code: 'not_found' } });
  });
}

/**
 * Runs the page's clock in steps until `check` passes (timers, ticks and
 * frames fire). Each step also lets a little real time pass: lazy views and
 * the map still load over the network, which the fake clock can't speed up.
 */
export async function until(page: Page, check: () => Promise<boolean>, seconds = 300, step = 1) {
  for (let elapsed = 0; elapsed <= seconds; elapsed += step) {
    if (await check()) return;
    await page.clock.runFor(step * 1000);
    await page.waitForTimeout(30);
  }
  throw new Error(`Nothing happened after ${seconds} simulated seconds`);
}

export const visible = (locator: Locator) => () => locator.isVisible();

export async function startRoute(page: Page, routeId: string, startLabel = 'Empezar') {
  await page.goto(`/routes/${routeId}/prepare`);
  await page.getByRole('button', { name: startLabel, exact: true }).click();
  await expect(page).toHaveURL(/\/run$/);
}

/** Opens the purple simulation panel (DESIGN SimControls). */
export async function openSimulation(page: Page, speed: '1×' | '5×' | '20×' = '1×') {
  const panel = page.getByRole('region', { name: 'Simulación' });
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Simulación' }).click();
  await panel.getByRole('radio', { name: speed }).click();
  return panel;
}

/** Walks to the HUD's target and closes its card ("Continuar ruta"). */
export async function walkAndVisit(page: Page) {
  await page.getByRole('button', { name: 'Caminar al siguiente punto' }).click();
  const proceed = page.getByRole('button', { name: 'Continuar ruta' });
  await until(page, visible(proceed), 600, 2);
  await proceed.click();
  await expect(proceed).toBeHidden();
}
