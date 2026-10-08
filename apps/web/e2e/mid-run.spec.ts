import { expect, type Page, type Request, test } from '@playwright/test';
import {
  openSimulation,
  setup,
  startRoute,
  until,
  visible,
  walkAndVisit,
  withoutMap,
} from './helpers.ts';

// Editing the route of a run that is under way: the user adds and removes
// places in the middle of the walk and what was already visited stays
// visited. The route is one of the device's own, seeded in the registry; the
// API is mocked (place search, route writes, the AI off, runs and analytics).

interface Place {
  id: string;
  qid: string;
  name: string;
  description: string;
  address: string;
  category: string;
  position: { lat: number; lng: number };
}

// More than 500 m apart, so no two zones overlap; the walk goes Castelo → Sé → Jardim.
const CASTELO: Place = {
  id: 'castelo-de-leiria',
  qid: 'Q2969701',
  name: 'Castelo de Leiria',
  description: 'castillo medieval en Leiria',
  address: 'Leiria, Pousos, Barreira e Cortes',
  category: 'monument',
  position: { lat: 39.747, lng: -8.81 },
};
const SE: Place = {
  id: 'se-de-leiria',
  qid: 'Q1638383',
  name: 'Sé de Leiria',
  description: 'catedral de Leiria',
  address: 'Largo da Sé, Leiria',
  category: 'church',
  position: { lat: 39.743, lng: -8.8066 },
};
const MUSEU: Place = {
  id: 'museu-de-leiria',
  qid: 'Q10331797',
  name: 'Museu de Leiria',
  description: 'museo en Leiria',
  address: 'Rua Tenente Valadim, Leiria',
  category: 'museum',
  position: { lat: 39.7488, lng: -8.8012 },
};
const JARDIM: Place = {
  id: 'jardim-luis-de-camoes',
  qid: 'Q5996417',
  name: 'Jardim Luís de Camões',
  description: 'jardín público de Leiria',
  address: 'Avenida dos Combatentes, Leiria',
  category: 'nature',
  position: { lat: 39.7417, lng: -8.8049 },
};

const ROUTE_ID = 'paseo-a-medias-e2e0000003';
const TOKEN = Buffer.alloc(32, 7).toString('base64url');
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The route as buildRouteSpec writes it: every place opens its basic sheet (name and address). */
function ownRoute(places: Place[]) {
  const decision = (preset: string) => ({ type: 'decision', params: { preset } });
  return {
    spec: {
      specVersion: 1,
      id: ROUTE_ID,
      name: 'Paseo a medias',
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      source: 'user',
      points: places.map((place, index) => ({
        id: place.id,
        name: place.name,
        position: place.position,
        order: index + 1,
        category: place.category,
        triggers: { onEnter: `content_${place.id}` },
        meta: { address: place.address, externalId: place.qid },
      })),
      actions: {
        ...Object.fromEntries(
          places.map((place) => [
            `content_${place.id}`,
            { type: 'info_sheet', params: { title: place.name, body: place.address } },
          ]),
        ),
        decision_deviation: decision('deviation'),
        decision_idle: decision('idle'),
        decision_out_of_order: decision('out_of_order'),
        decision_timeout: decision('timeout'),
      },
      triggers: {
        onDeviation: 'decision_deviation',
        onIdle: 'decision_idle',
        onOutOfOrder: 'decision_out_of_order',
        onTimeout: 'decision_timeout',
      },
    },
    contents: {},
  };
}

/** /geo/suggest and /geo/resolve answer from these places, like the API would. */
async function mockGeo(page: Page, places: Place[]) {
  await page.route(/\/api\/v1\/geo\/suggest\?/, (route) => {
    const q = fold(new URL(route.request().url()).searchParams.get('q') ?? '');
    const found = places.filter((place) => fold(place.name).includes(q));
    return route.fulfill({
      json: found.map((place) => ({
        key: `wikidata:${place.qid}`,
        name: place.name,
        description: place.description,
        position: place.position,
        category: place.category,
        externalId: place.qid,
        storable: true,
      })),
    });
  });
  await page.route(/\/api\/v1\/geo\/resolve\?/, (route) => {
    const key = new URL(route.request().url()).searchParams.get('key');
    const place = places.find((item) => `wikidata:${item.qid}` === key);
    if (!place) return route.fulfill({ status: 404, json: { code: 'place_not_found' } });
    return route.fulfill({
      json: {
        key,
        name: place.name,
        address: place.address,
        position: place.position,
        category: place.category,
        externalId: place.qid,
        storable: true,
      },
    });
  });
}

/** The AI is off (503 ai_unavailable): the places keep their basic sheets. */
async function mockAiOff(page: Page) {
  await page.route(/\/api\/v1\/(suggest\/places|content\/generate)$/, (route) =>
    route.fulfill({ status: 503, json: { code: 'ai_unavailable' } }),
  );
}

/** Route writes are answered as saved and recorded; reads find nothing (user routes are never read back). */
async function mockRouteApi(page: Page) {
  const writes: Request[] = [];
  await page.route(/\/api\/v1\/routes(\/[^/?]+)?(\?.*)?$/, (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return new URL(request.url()).pathname === '/api/v1/routes'
        ? route.fulfill({ json: [] })
        : route.fulfill({ status: 404, json: { code: 'route_not_found' } });
    }
    writes.push(request);
    return route.fulfill({
      status: 200,
      json: {
        id: (request.postDataJSON() as { spec: { id: string } }).spec.id,
        updatedAt: '2026-10-08T10:00:00.000Z',
      },
    });
  });
  return writes;
}

/** The bits of IndexedDB used in the page (e2e files are type-checked without the DOM lib). */
interface PageIndexedDb {
  open(name: string): {
    result: {
      createObjectStore(name: string): void;
      transaction(
        store: string,
        mode: 'readwrite',
      ): {
        objectStore(name: string): { put(value: unknown, key: string): void };
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        error: unknown;
      };
      close(): void;
    };
    error: unknown;
    onupgradeneeded: (() => void) | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
  };
}

/** Writes the device's route registry (idb-keyval: database "rumbo", store "kv"). */
async function seedMyRoutes(page: Page, records: Record<string, unknown>) {
  await page.evaluate(
    async (registry) => {
      const { indexedDB } = globalThis as unknown as { indexedDB: PageIndexedDb };
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('rumbo');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(registry, 'routes:mine');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { v: 1, records },
  );
}

const placeList = (page: Page) =>
  page.getByRole('list', { name: 'Lugares de la ruta' }).getByRole('listitem');

/** The stops of the run screen's panel (the HUD names them too, so look only inside it). */
const stops = (page: Page) => page.locator('.run__list');

test.beforeEach(async ({ page }) => {
  await withoutMap(page);
  await mockGeo(page, [CASTELO, SE, MUSEU, JARDIM]);
  await mockAiOff(page);
  // Runs and analytics: nobody answers.
  await page.route(/\/api\/v1\/(runs|analytics)/, (route) =>
    route.fulfill({ status: 503, json: { code: 'unavailable' } }),
  );
});

test('adding and removing places in the middle of a run keeps what was visited', async ({
  page,
}) => {
  test.setTimeout(480_000);
  await setup(page);
  const writes = await mockRouteApi(page);

  // The device has one of its own routes: Castelo → Sé → Museu.
  await page.goto('/');
  await seedMyRoutes(page, {
    [ROUTE_ID]: {
      id: ROUTE_ID,
      editToken: TOKEN,
      bundle: ownRoute([CASTELO, SE, MUSEU]),
      rev: 1,
      sync: 'synced',
      remote: 'yes',
      failures: 0,
      createdAt: '2026-10-08T09:00:00.000Z',
      updatedAt: '2026-10-08T09:00:00.000Z',
      syncedAt: '2026-10-08T09:00:00.000Z',
    },
  });

  // Walk it in simulation and visit the first place.
  await startRoute(page, ROUTE_ID);
  await openSimulation(page, '20×');
  await walkAndVisit(page);
  await expect(page.getByText('1 de 3', { exact: true })).toBeVisible();

  // The list of stops: the visited one can be looked at again (nothing is scored),
  // and the route can be edited.
  await page.getByRole('button', { name: 'Puntos', exact: true }).click();
  await expect(stops(page)).toContainText('Visitado a las');
  await page.getByRole('button', { name: 'Ver la ficha de Castelo de Leiria' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Castelo de Leiria' })).toBeVisible();
  await expect(sheet.getByText(CASTELO.address)).toBeVisible();
  await expect(sheet.getByText('Llegaste · Punto')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('1 de 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ver la ficha de (Sé|Museu)/ })).toHaveCount(0);

  // "Editar ruta" opens the creator on the places: no "¿Salir del mapa?", the run stays.
  await page.getByRole('button', { name: 'Editar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/places$/);
  await expect(placeList(page)).toHaveCount(3);

  // Remove a place that is still pending, and add another through the place search.
  await page.getByRole('button', { name: 'Opciones de Museu de Leiria' }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  await expect(placeList(page)).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Buscar un lugar' }).fill('Jardim');
  const option = page.getByRole('option', { name: new RegExp(JARDIM.name) });
  await until(page, visible(option), 10);
  await option.click();
  await until(page, async () => (await placeList(page).count()) === 3, 10);
  await expect(placeList(page).nth(2)).toContainText(JARDIM.name);

  // On to the cards (the AI is off: the new place takes the basic one) and to saving.
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/content$/);
  await page.getByRole('button', { name: 'Usar fichas básicas', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/review$/);
  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);

  // Saved with a PUT and the route's token, and the points that stayed kept their ids.
  await until(page, async () => writes.length > 0, 10);
  const put = writes[0] as Request;
  expect(put.method()).toBe('PUT');
  expect(new URL(put.url()).pathname).toBe(`/api/v1/routes/${ROUTE_ID}`);
  expect(put.headers()['x-edit-token']).toBe(TOKEN);
  const body = put.postDataJSON() as {
    spec: { id: string; points: { id: string; name: string }[] };
  };
  expect(body.spec.id).toBe(ROUTE_ID);
  expect(body.spec.points.map((point) => point.name)).toEqual([CASTELO.name, SE.name, JARDIM.name]);
  expect(body.spec.points.slice(0, 2).map((point) => point.id)).toEqual([CASTELO.id, SE.id]);

  // The run took the changes: the toast says so, and the button leads back to it.
  await expect(page.getByText('Ruta actualizada: lo que ya visitaste se mantiene')).toBeVisible();
  await expect(page.getByText('Tu recorrido en curso ya usa estos cambios.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar ahora' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Volver al recorrido' }).click();
  await expect(page).toHaveURL(/\/run$/);

  // Still one visited of three; the visited place is still visited and the new one is on the list.
  await expect(page.getByText('1 de 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Puntos', exact: true }).click();
  await expect(stops(page)).toContainText(CASTELO.name);
  await expect(stops(page)).toContainText('Visitado a las');
  await expect(stops(page)).toContainText(SE.name);
  await expect(stops(page)).toContainText(JARDIM.name);
  await expect(stops(page)).not.toContainText(MUSEU.name);
  await page.getByRole('button', { name: 'Puntos', exact: true }).click();

  // Then walk to the end: the second place and the new one, and the summary counts all three.
  await openSimulation(page, '20×');
  await walkAndVisit(page);
  await expect(page.getByText('2 de 3', { exact: true })).toBeVisible();
  await walkAndVisit(page);
  await until(page, async () => page.url().endsWith('/run/summary'), 30);
  await expect(page.getByRole('heading', { name: '¡Ruta completada!' })).toBeVisible();
  await expect(page.getByText('3/3')).toBeVisible();
});

test('removing the last place left to visit finishes the run', async ({ page }) => {
  test.setTimeout(480_000);
  await setup(page);
  await mockRouteApi(page);
  await page.goto('/');
  await seedMyRoutes(page, {
    [ROUTE_ID]: {
      id: ROUTE_ID,
      editToken: TOKEN,
      bundle: ownRoute([CASTELO, SE, MUSEU]),
      rev: 1,
      sync: 'synced',
      remote: 'yes',
      failures: 0,
      createdAt: '2026-10-08T09:00:00.000Z',
      updatedAt: '2026-10-08T09:00:00.000Z',
      syncedAt: '2026-10-08T09:00:00.000Z',
    },
  });
  await startRoute(page, ROUTE_ID);
  await openSimulation(page, '20×');
  await walkAndVisit(page);
  await walkAndVisit(page);
  await expect(page.getByText('2 de 3', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Puntos', exact: true }).click();
  await page.getByRole('button', { name: 'Editar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/places$/);
  await page.getByRole('button', { name: 'Opciones de Museu de Leiria' }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  await expect(placeList(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/content$/);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/review$/);
  await page.getByRole('button', { name: 'Guardar ruta' }).click();

  // Nothing is left to visit: the run is over and its summary is the next screen.
  await until(page, async () => page.url().endsWith('/run/summary'), 30);
  await expect(page.getByRole('heading', { name: '¡Ruta completada!' })).toBeVisible();
  await expect(page.getByText('2/2')).toBeVisible();
});
