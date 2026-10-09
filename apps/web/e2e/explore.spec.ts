import { expect, type Page, test } from '@playwright/test';
import { setup } from './helpers.ts';

// PROJECT_PLAN §14.2 and the course requirements (§2.1): the Explore map has
// 20+ markers of more than one kind, popups and a filter; and it opens where
// the user is (phase 7.2: on the routes around them, or on them). Phase 7.3
// (ADR 0005): a second view draws the routes as lines, coloured by activity,
// and the filter works by origin and interest instead of by route.

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
  // The popup names the activity of the route, whose colour the pin has.
  await expect(page.locator('.rmb-popup__chip', { hasText: 'A pie' })).toBeVisible();
  await viewRoute.click();
  await expect(page).toHaveURL(/\/routes\/leiria-historica$/);

  // The filter: no route is listed in it, and the points of interest off leave the route's 12 points.
  await page.goBack();
  await page.getByRole('radio', { name: 'Mapa' }).click();
  await page.getByRole('button', { name: 'Filtrar el mapa' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('switch')).toHaveCount(1);
  await expect(sheet.getByRole('switch', { name: 'Leiria histórica' })).toHaveCount(0);
  await sheet.getByRole('switch', { name: 'Lugares de interés' }).click();
  await expect(page.getByText(/^12 de \d+ marcadores$/)).toBeVisible();
  // A category narrows the pins: five of the route's points are churches.
  await sheet.getByRole('button', { name: 'Iglesia' }).click();
  await expect(page.getByText(/^5 de \d+ marcadores$/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Mostrar todo' }).click();
  await expect(page.getByText(/^(\d+) de \1 marcadores$/)).toBeVisible();
  await sheet.getByRole('switch', { name: 'Lugares de interés' }).click();
  await expect(page.getByText(/^12 de \d+ marcadores$/)).toBeVisible();
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(markers).toHaveCount(12);
});

/** What the tests read from the map's view, without the SDK's types. */
interface GraphicLike {
  attributes: { id?: string; line?: string; hit?: boolean };
  geometry: { paths?: number[][][]; longitude?: number; latitude?: number };
  symbol: { width?: number; style?: string; color?: { r: number; g: number; b: number } };
}
interface MapElement {
  view: {
    center: {
      latitude: number;
      longitude: number;
      clone(): { longitude: number; latitude: number };
    };
    zoom: number;
    toScreen(point: unknown): { x: number; y: number } | null;
    popup: { visible: boolean } | null;
    map: { layers: { items: Array<{ title: string; graphics: { items: GraphicLike[] } }> } };
  };
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}
interface MapDocument {
  querySelector(selector: 'arcgis-map'): MapElement;
}

/** The strokes the map draws for the routes, with the colour, style and width each has. */
const strokes = (page: Page) =>
  page.evaluate(() => {
    const { document } = globalThis as unknown as { document: MapDocument };
    const layer = document
      .querySelector('arcgis-map')
      .view.map.layers.items.find((item) => item.title === 'lines');
    const hex = (value: number) => value.toString(16).padStart(2, '0');
    return (layer?.graphics.items ?? [])
      .filter((graphic) => {
        // Not the invisible strip to tap, nor the white casing under the stroke.
        const color = graphic.symbol.color;
        return !graphic.attributes.hit && !(color?.r === 255 && color.g === 255 && color.b === 255);
      })
      .map((graphic) => ({
        id: graphic.attributes.line,
        color: `#${hex(graphic.symbol.color?.r ?? 0)}${hex(graphic.symbol.color?.g ?? 0)}${hex(graphic.symbol.color?.b ?? 0)}`,
        style: graphic.symbol.style,
        width: graphic.symbol.width ?? 0,
      }));
  });

/**
 * A spot on a route's line and another one 12 px off it, on the page (px),
 * chosen as far from every pin as the line allows (`clearance`): a tap there
 * can only be on the line, or on the strip around it, never on a pin.
 */
const spotsOnLine = (page: Page, routeId: string) =>
  page.evaluate((id) => {
    const { document } = globalThis as unknown as { document: MapDocument };
    const element = document.querySelector('arcgis-map');
    const layer = element.view.map.layers.items.find((item) => item.title === 'lines');
    const path = layer?.graphics.items.find((graphic) => graphic.attributes.line === id)?.geometry
      .paths?.[0];
    const box = element.getBoundingClientRect();
    // The pins are the route's vertices (it has no drawn path).
    const pins = (path ?? []).flatMap(([lng, lat]) => {
      const point = element.view.center.clone();
      point.longitude = lng ?? 0;
      point.latitude = lat ?? 0;
      const screen = element.view.toScreen(point);
      return screen ? [{ x: screen.x + box.left, y: screen.y + box.top }] : [];
    });
    // Far from the map's buttons, its switch and the legend and card below.
    const inside = (p: { x: number; y: number }) =>
      p.x > box.left + 20 &&
      p.x < box.left + box.width - 20 &&
      p.y > box.top + 70 &&
      p.y < box.top + box.height - 230;
    const clearance = (p: { x: number; y: number }) =>
      Math.min(...pins.map((pin) => Math.hypot(p.x - pin.x, p.y - pin.y)));
    let best: {
      on: { x: number; y: number };
      off: { x: number; y: number };
      clearance: number;
    } | null = null;
    for (let index = 1; index < pins.length; index += 1) {
      const from = pins[index - 1];
      const to = pins[index];
      if (!from || !to) continue;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const ux = (to.x - from.x) / length;
      const uy = (to.y - from.y) / length;
      for (let at = 8; at < length - 8; at += 4) {
        const on = { x: from.x + ux * at, y: from.y + uy * at };
        for (const side of [1, -1]) {
          const off = { x: on.x - uy * 12 * side, y: on.y + ux * 12 * side };
          if (!inside(on) || !inside(off)) continue;
          const room = Math.min(clearance(on), clearance(off));
          if (!best || room > best.clearance) best = { on, off, clearance: room };
        }
      }
    }
    return best;
  }, routeId);

/** Where, on the page, a pin of a route is (px). */
const pinOf = (page: Page, routeId: string) =>
  page.evaluate((id) => {
    const { document } = globalThis as unknown as { document: MapDocument };
    const element = document.querySelector('arcgis-map');
    const layer = element.view.map.layers.items.find((item) => item.title === 'points');
    const geometry = layer?.graphics.items.find((graphic) =>
      graphic.attributes.id?.startsWith(`${id}/`),
    )?.geometry;
    if (geometry?.longitude === undefined || geometry.latitude === undefined) return null;
    const point = element.view.center.clone();
    point.longitude = geometry.longitude;
    point.latitude = geometry.latitude;
    const screen = element.view.toScreen(point);
    const box = element.getBoundingClientRect();
    return screen ? { x: screen.x + box.left, y: screen.y + box.top } : null;
  }, routeId);

const popupOpen = (page: Page) =>
  page.evaluate(() => {
    const { document } = globalThis as unknown as { document: MapDocument };
    return document.querySelector('arcgis-map').view.popup?.visible === true;
  });

/** The map's top-right area, below its buttons: no route goes through it. */
const emptyPart = async (page: Page) => {
  const box = await page.locator('arcgis-map').boundingBox();
  if (!box) throw new Error('The map has no box');
  return { x: box.x + box.width * 0.9, y: box.y + box.height * 0.45 };
};

async function openRoutesView(page: Page) {
  await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('radio', { name: 'Mapa' }).click();
  await expect(page.locator('.arcgis[data-ready]')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('radio', { name: 'Rutas' }).click();
}

// ADR 0005, decision 2: the routes view colours by activity, and the line style
// says it too (walk: solid), so colour is not the only cue.
test('the Rutas view lists the curated route as a route and highlights it when it is chosen', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Mapa' }).click();
  await expect(page.locator('.arcgis[data-ready]')).toBeVisible({ timeout: 60_000 });

  // The map opens on the points, with no list of routes.
  await expect(page.getByRole('radio', { name: 'Puntos' })).toBeChecked();
  await expect(page.getByRole('list', { name: 'Rutas del mapa' })).toHaveCount(0);
  expect(await strokes(page)).toEqual([]);
  // The legend has the activity and the points of interest, and no route's name.
  const legend = page.getByRole('list', { name: 'Leyenda' });
  await expect(legend.getByRole('listitem')).toHaveText(['A pie', 'Lugares de interés']);

  await page.getByRole('radio', { name: 'Rutas' }).click();
  await expect(page.getByRole('radio', { name: 'Rutas' })).toBeChecked();
  // The curated route is the one route of the list; the markers and the points of interest are gone from it.
  const routes = page.getByRole('list', { name: 'Rutas del mapa' }).getByRole('listitem');
  await expect(routes).toHaveText(['Leiria histórica']);
  await expect(page.getByRole('list', { name: 'Marcadores del mapa' })).toHaveCount(0);
  // The map draws it: a solid line in the colour of walking, under its pins.
  await expect.poll(() => strokes(page)).toHaveLength(1);
  const [normal] = await strokes(page);
  expect(normal).toMatchObject({ id: 'leiria-historica', color: '#1e4fa3', style: 'solid' });
  // The legend now shows the line.
  await expect(legend.getByRole('listitem')).toHaveText(['A pie']);
  const card = page.getByRole('status').filter({ hasText: 'Leiria histórica' });
  await expect(card).toHaveCount(0);

  // Choosing it from the keyboard list highlights it: a card names it and the line gets thicker.
  await page.getByRole('button', { name: 'Leiria histórica' }).focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeVisible();
  await expect(card.getByText('A pie', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await strokes(page))[0]?.width ?? 0)
    .toBeGreaterThan(normal?.width ?? 0);
  // Nothing is faded when only one route is there; the way into it is the card's button.
  await page.getByRole('button', { name: 'Leiria histórica' }).blur();
  await card.getByRole('button', { name: 'Ver ruta' }).click();
  await expect(page).toHaveURL(/\/routes\/leiria-historica$/);
});

test('in the Rutas view a tap on the line, near it or on a pin picks the route and one elsewhere lets it go', async ({
  page,
}) => {
  await openRoutesView(page);
  await expect.poll(() => strokes(page)).toHaveLength(1);
  const card = page.getByRole('status').filter({ hasText: 'Leiria histórica' });
  const spots = await spotsOnLine(page, 'leiria-historica');
  const pin = await pinOf(page, 'leiria-historica');
  const away = await emptyPart(page);
  // The spots are well clear of every pin (a pin is 36 px wide), so only the line can pick the route there.
  expect(spots?.clearance ?? 0).toBeGreaterThan(36);
  expect(pin).not.toBeNull();

  // On the line, and a finger's width off it.
  for (const spot of [spots?.on, spots?.off]) {
    await page.mouse.click(spot?.x ?? 0, spot?.y ?? 0);
    await expect(card).toBeVisible();
    await page.mouse.click(away.x, away.y);
    await expect(card).toHaveCount(0);
  }
  // On a pin: the route is picked and no popup opens (the pins have none in this view).
  await page.mouse.click(pin?.x ?? 0, pin?.y ?? 0);
  await expect(card).toBeVisible();
  expect(await popupOpen(page)).toBe(false);
  // The close button lets go as well.
  await card.getByRole('button', { name: 'Cerrar' }).click();
  await expect(card).toHaveCount(0);
});

test('the choice of the view is remembered, and the Puntos view still has its popups', async ({
  page,
}) => {
  await openRoutesView(page);
  await expect(page.getByRole('radio', { name: 'Rutas' })).toBeChecked();
  await page.reload();
  await expect(page.locator('.arcgis[data-ready]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('radio', { name: 'Rutas' })).toBeChecked();
  await expect.poll(() => strokes(page)).toHaveLength(1);

  await page.getByRole('radio', { name: 'Puntos' }).click();
  await expect(page.getByRole('radio', { name: 'Puntos' })).toBeChecked();
  expect(await strokes(page)).toEqual([]);
  const pin = await pinOf(page, 'leiria-historica');
  await page.mouse.click(pin?.x ?? 0, pin?.y ?? 0);
  await expect.poll(() => popupOpen(page)).toBe(true);
});

/** The map's centre, to two decimals (about 1 km). */
const mapCenter = (page: Page) =>
  page.evaluate(() => {
    const { document } = globalThis as unknown as { document: MapDocument };
    const { latitude, longitude } = document.querySelector('arcgis-map').view.center;
    return { lat: Math.round(latitude * 100) / 100, lng: Math.round(longitude * 100) / 100 };
  });

/** The map's zoom level, to one decimal. */
const mapZoom = (page: Page) =>
  page.evaluate(() => {
    const { document } = globalThis as unknown as { document: MapDocument };
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
