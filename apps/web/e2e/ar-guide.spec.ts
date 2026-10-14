import { expect, test } from '@playwright/test';
import {
  fixture,
  openSimulation,
  setup,
  startRoute,
  until,
  visible,
  withoutMap,
} from './helpers.ts';

// Version 2 prototype: a place whose arrival is the AR guide. The sheet explains the activity,
// opens the AR page in another window (the run stays alive here) and the route goes on.

test.beforeEach(async ({ page }) => {
  await withoutMap(page);
});

async function arrive(
  page: import('@playwright/test').Page,
  id = 'e2e-guia-ra',
  heading = 'Habla con el artesano',
) {
  const route = fixture(id);
  await setup(page, {}, [route]);
  await startRoute(page, route.spec.id);
  await openSimulation(page, '1×');
  await page.getByRole('button', { name: 'Caminar al siguiente punto' }).click();
  const title = page.getByRole('heading', { name: heading });
  await until(page, visible(title), 600, 2);
}

test('arriving explains the AR guide, opens it in another window and the route goes on', async ({
  page,
  context,
}) => {
  await arrive(page);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Cómo funciona' })).toBeVisible();
  await expect(sheet.getByRole('listitem')).toHaveText([
    /Se abre la cámara/,
    /Toca para colocarlo/,
    /Mantén pulsado para hablar/,
    /Vuelve a la ruta/,
  ]);

  const [arPage] = await Promise.all([
    context.waitForEvent('page'),
    sheet.getByRole('button', { name: 'Empezar' }).click(),
  ]);
  await arPage.waitForLoadState('domcontentloaded');
  expect(arPage.url()).toMatch(/\/ra_test\/\?scene=artesano&lang=es&from=route$/);
  await arPage.close();

  await expect(sheet.getByText('El artesano te espera en otra ventana')).toBeVisible();
  await sheet.getByRole('button', { name: 'Continuar ruta' }).click();
  await until(page, async () => page.url().endsWith('/run/summary'), 30);
});

test('"Ahora no" leaves the AR guide for later and the route goes on', async ({ page }) => {
  await arrive(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Ahora no' }).click();
  await until(page, async () => page.url().endsWith('/run/summary'), 30);
});

test('a place can open the assault scene instead of the craftsman', async ({ page, context }) => {
  await arrive(page, 'e2e-guia-ra-asalto', 'Interrumpe la batalla');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('listitem')).toHaveText([
    /Se abre la cámara/,
    /Toca para colocar la escena/,
    /Acércate a uno y toca «Hablar»/,
    /Vuelve a la ruta/,
  ]);
  const [arPage] = await Promise.all([
    context.waitForEvent('page'),
    sheet.getByRole('button', { name: 'Empezar' }).click(),
  ]);
  await arPage.waitForLoadState('domcontentloaded');
  expect(arPage.url()).toMatch(/\/ra_test\/\?scene=asalto_1140&lang=es&from=route$/);
  await arPage.close();
  await expect(sheet.getByText('Los soldados te esperan en otra ventana')).toBeVisible();
});
