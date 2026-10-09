import { expect, type Page, test } from '@playwright/test';
import { setup } from './helpers.ts';

// PROJECT_PLAN §14.2 and the course requirements (§2.1): the Explore map has
// 20+ markers of more than one kind, popups and a filter.

test('the Explore map shows 20+ markers with popups and a filter', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Mapa' }).click();
  await expect(page.locator('.arcgis[data-ready]')).toBeVisible({ timeout: 60_000 });

  const markers = page.getByRole('list', { name: 'Marcadores del mapa' }).getByRole('listitem');
  expect(await markers.count()).toBeGreaterThanOrEqual(20);

  // A marker's popup, reached from the keyboard list (same as a tap).
  await page.getByRole('button', { name: 'Castelo de Leiria' }).focus();
  await page.keyboard.press('Enter');
  const viewRoute = page.getByRole('button', { name: 'Ver ruta' });
  await expect(viewRoute).toBeVisible();
  await expect(page.getByText('Monumento', { exact: true })).toBeVisible();
  await viewRoute.click();
  await expect(page).toHaveURL(/\/routes\/leiria-historica$/);

  // The filter: points of interest off leaves the route's 12 points.
  await page.goBack();
  await page.getByRole('radio', { name: 'Mapa' }).click();
  await page.getByRole('button', { name: 'Filtrar el mapa' }).click();
  await page.getByRole('switch', { name: 'Lugares de interés' }).click();
  await expect(page.getByText(/^12 de \d+ marcadores$/)).toBeVisible();
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(markers).toHaveCount(12);
});

/** The page's `document`, as far as the map's centre needs it. */
interface PageDocument {
  querySelector(selector: 'arcgis-map'): {
    view: { center: { latitude: number; longitude: number } };
  };
}

/** The map's centre, to two decimals (about 1 km). */
const mapCenter = (page: Page) =>
  page.evaluate(() => {
    const { document } = globalThis as unknown as { document: PageDocument };
    const { latitude, longitude } = document.querySelector('arcgis-map').view.center;
    return { lat: Math.round(latitude * 100) / 100, lng: Math.round(longitude * 100) / 100 };
  });

test.describe('with the location allowed', () => {
  // Porto: far from the Leiria routes the map opens on.
  test.use({
    geolocation: { latitude: 41.1496, longitude: -8.6109 },
    permissions: ['geolocation'],
  });

  test('"Mi ubicación" centres the Explore map on the user, wherever they are', async ({
    page,
  }) => {
    await setup(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    // Rumbo isn't tied to one city: the header names none.
    await expect(page.getByRole('heading', { name: 'Leiria histórica' })).toBeVisible();
    await expect(page.getByText('Leiria', { exact: true })).toHaveCount(0);

    await page.getByRole('radio', { name: 'Mapa' }).click();
    await expect(page.locator('.arcgis[data-ready]')).toBeVisible({ timeout: 60_000 });
    expect(await mapCenter(page)).not.toEqual({ lat: 41.15, lng: -8.61 });
    await page.getByRole('button', { name: 'Mi ubicación' }).click();
    await expect
      .poll(() => mapCenter(page), { timeout: 15_000 })
      .toEqual({
        lat: 41.15,
        lng: -8.61,
      });
  });
});

test('"Mi ubicación" says how to fix it when the location is not allowed', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Mapa' }).click();
  await expect(page.locator('.arcgis[data-ready]')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Mi ubicación' }).click();
  await expect(
    page.getByText('No podemos ver tu ubicación. Activa el permiso de ubicación en el navegador.'),
  ).toBeVisible();
});
