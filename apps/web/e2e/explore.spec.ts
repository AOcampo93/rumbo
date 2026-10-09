import { expect, type Page, test } from '@playwright/test';
import { setup } from './helpers.ts';

// PROJECT_PLAN §14.2 and the course requirements (§2.1): the Explore map has
// 20+ markers of more than one kind, popups and a filter; and it opens where
// the user is (phase 7.2: on the routes around them, or on them).

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

/** The page's `document`, as far as the map's camera needs it. */
interface PageDocument {
  querySelector(selector: 'arcgis-map'): {
    view: { center: { latitude: number; longitude: number }; zoom: number };
  };
}

/** The map's centre, to two decimals (about 1 km). */
const mapCenter = (page: Page) =>
  page.evaluate(() => {
    const { document } = globalThis as unknown as { document: PageDocument };
    const { latitude, longitude } = document.querySelector('arcgis-map').view.center;
    return { lat: Math.round(latitude * 100) / 100, lng: Math.round(longitude * 100) / 100 };
  });

/** The map's zoom level, to one decimal. */
const mapZoom = (page: Page) =>
  page.evaluate(() => {
    const { document } = globalThis as unknown as { document: PageDocument };
    return Math.round(document.querySelector('arcgis-map').view.zoom * 10) / 10;
  });

// Porto: far from the Leiria routes the map opens on.
const PORTO = { latitude: 41.1496, longitude: -8.6109 };

test.describe('with the location allowed', () => {
  test.use({ geolocation: PORTO });

  test('"Mi ubicación" centres the Explore map on the user, wherever they are', async ({
    page,
    context,
  }) => {
    await setup(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    // Rumbo isn't tied to one city: the header names none.
    await expect(page.getByRole('heading', { name: 'Leiria histórica' })).toBeVisible();
    await expect(page.getByText('Leiria', { exact: true })).toHaveCount(0);

    // The browser hasn't been asked yet: nothing reads the position until the tap.
    await page.getByRole('radio', { name: 'Mapa' }).click();
    await expect(page.locator('.arcgis[data-ready]')).toBeVisible({ timeout: 60_000 });
    expect(await mapCenter(page)).not.toEqual({ lat: 41.15, lng: -8.61 });
    // The user says yes at the tap.
    await context.grantPermissions(['geolocation']);
    await page.getByRole('button', { name: 'Mi ubicación' }).click();
    await expect
      .poll(() => mapCenter(page), { timeout: 15_000 })
      .toEqual({
        lat: 41.15,
        lng: -8.61,
      });
  });
});

test.describe('with the location already allowed', () => {
  test.use({ geolocation: PORTO, permissions: ['geolocation'] });

  test('the Explore map opens on the user, with no tap, when no route is around them', async ({
    page,
  }) => {
    await setup(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // The routes around Porto: the curated one (Leiria, 120 km away) and none of the community's.
    const nearRequests: string[] = [];
    await page.route(/\/api\/v1\/routes\?near=/, (route) => {
      nearRequests.push(route.request().url());
      return route.fulfill({ json: [{ id: 'leiria-historica' }] });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Leiria histórica' })).toBeVisible();
    // The position is read by itself, and the API gets it rounded to about 110 m.
    await expect(page.getByText('Aún no hay rutas de la comunidad cerca de ti.')).toBeVisible();
    expect(nearRequests).toHaveLength(1);
    expect(new URL(nearRequests[0] as string).searchParams.get('near')).toBe('41.150,-8.611');
    await expect(page.getByText('Toca «Mi ubicación» para ver las rutas')).toHaveCount(0);

    await page.getByRole('radio', { name: 'Mapa' }).click();
    await expect(page.locator('.arcgis[data-ready]')).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => mapCenter(page), { timeout: 15_000 })
      .toEqual({ lat: 41.15, lng: -8.61 });
    // A neighbourhood, not a close-up of the user (zoom 14).
    await expect.poll(() => mapZoom(page), { timeout: 15_000 }).toBeCloseTo(14, 0);
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
