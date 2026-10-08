import { expect, type Page, type Request, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openSimulation, setup, until, visible, walkAndVisit, withoutMap } from './helpers.ts';

// PROJECT_PLAN §16 phase 6 (DoD: create a route, simulate it and walk it from
// start to finish), plus saving offline, editing and deleting from Mis rutas,
// the autosaved draft and a trial that forces simulation. The API is mocked:
// place search, route writes, runs and analytics.

interface Place {
  qid: string;
  name: string;
  description: string;
  address: string;
  category: string;
  position: { lat: number; lng: number };
}

// Far enough apart (more than 500 m) that no two zones overlap.
const PLACES: Place[] = [
  {
    qid: 'Q2969701',
    name: 'Castelo de Leiria',
    description: 'castillo medieval en Leiria',
    address: 'Leiria, Pousos, Barreira e Cortes',
    category: 'monument',
    position: { lat: 39.747, lng: -8.81 },
  },
  {
    qid: 'Q1638383',
    name: 'Sé de Leiria',
    description: 'catedral de Leiria',
    address: 'Largo da Sé, Leiria',
    category: 'church',
    position: { lat: 39.743, lng: -8.8066 },
  },
  {
    qid: 'Q10331797',
    name: 'Museu de Leiria',
    description: 'museo en Leiria',
    address: 'Rua Tenente Valadim, Leiria',
    category: 'museum',
    position: { lat: 39.7488, lng: -8.8012 },
  },
];

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** /geo/suggest and /geo/resolve answer from PLACES, like the API would. */
async function mockGeo(page: Page) {
  await page.route(/\/api\/v1\/geo\/suggest\?/, (route) => {
    const q = fold(new URL(route.request().url()).searchParams.get('q') ?? '');
    const found = PLACES.filter((place) => fold(place.name).includes(q));
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
    const place = PLACES.find((item) => `wikidata:${item.qid}` === key);
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

type WriteHandler = (request: Request) => { status: number; json?: unknown } | 'abort';

/**
 * Every /api/v1/routes call: the list is empty (the app falls back to the
 * bundled curated routes), user routes are never read back, and writes go to
 * `onWrite`. Returns the writes it saw.
 */
async function mockRouteApi(page: Page, onWrite: WriteHandler) {
  const writes: Request[] = [];
  await page.route(/\/api\/v1\/routes(\/[^/?]+)?(\?.*)?$/, (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return new URL(request.url()).pathname === '/api/v1/routes'
        ? route.fulfill({ json: [] })
        : route.fulfill({ status: 404, json: { code: 'route_not_found' } });
    }
    writes.push(request);
    const answer = onWrite(request);
    if (answer === 'abort') return route.abort('internetdisconnected');
    return answer.json === undefined
      ? route.fulfill({ status: answer.status })
      : route.fulfill({ status: answer.status, json: answer.json });
  });
  return writes;
}

/** /runs and /analytics: recorded (to prove a trial never calls them) and refused. */
async function recordRunCalls(page: Page) {
  const calls: string[] = [];
  await page.route(/\/api\/v1\/(runs|analytics)/, (route) => {
    calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 503, json: { code: 'unavailable' } });
  });
  return calls;
}

const savedAnswer = (request: Request) => ({
  status: request.method() === 'POST' ? 201 : 200,
  json: {
    id: (request.postDataJSON() as { spec: { id: string } }).spec.id,
    updatedAt: '2026-10-08T10:00:00.000Z',
  },
});

const placeList = (page: Page) =>
  page.getByRole('list', { name: 'Lugares de la ruta' }).getByRole('listitem');

/** C1: a name, the rest as it comes (Libre, A pie), then on to C2. */
async function fillDetails(page: Page, name: string) {
  await page.goto('/create');
  await expect(page).toHaveURL(/\/create\/details$/);
  await page.getByRole('textbox', { name: 'Nombre de la ruta' }).fill(name);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/places$/);
}

/** C2: types the first letters, waits for the suggestion and picks it. */
async function addPlace(page: Page, place: Place) {
  const before = await placeList(page).count();
  await page.getByRole('combobox', { name: 'Buscar un lugar' }).fill(place.name.slice(0, 5));
  const option = page.getByRole('option', { name: new RegExp(place.name) });
  await until(page, visible(option), 10);
  await option.click();
  await until(page, async () => (await placeList(page).count()) === before + 1, 10);
  await expect(placeList(page).nth(before)).toContainText(place.name);
}

async function placeNames(page: Page) {
  return Promise.all(
    PLACES.map(async (_, i) => (await placeList(page).nth(i).textContent()) ?? ''),
  ).then((texts) =>
    texts.map((text) => PLACES.find((place) => text.includes(place.name))?.name ?? '?'),
  );
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

test.beforeEach(async ({ page }) => {
  await withoutMap(page);
  await mockGeo(page);
});

test('creates a route, tests it in simulation, saves it and walks it to the summary', async ({
  page,
}) => {
  test.setTimeout(480_000);
  await setup(page);
  const runCalls = await recordRunCalls(page);
  const writes = await mockRouteApi(page, savedAnswer);

  // C1 and C2: three places from the search, the first one moved down and
  // the museum's arrival radius widened.
  await fillDetails(page, 'Leiria en una mañana');
  for (const place of PLACES) await addPlace(page, place);
  await expect(page.getByText('3 lugares', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Opciones de Castelo de Leiria' }).click();
  await page.getByRole('menuitem', { name: 'Bajar' }).click();
  await until(page, async () => (await placeNames(page))[1] === 'Castelo de Leiria', 5);
  expect(await placeNames(page)).toEqual(['Sé de Leiria', 'Castelo de Leiria', 'Museu de Leiria']);
  await page.getByRole('button', { name: 'Opciones de Museu de Leiria' }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  await page.getByRole('slider', { name: 'Radio de llegada' }).fill('60');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(placeList(page).nth(2)).toContainText('60 m');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // C4 → "Probar ruta": the unsaved route in simulation, back to C4 at the end,
  // without a single call to /runs or /analytics.
  await expect(page).toHaveURL(/\/create\/review$/);
  await expect(page.getByText('Las zonas no se solapan')).toBeVisible();
  await page.getByRole('button', { name: 'Probar ruta' }).click();
  await expect(page).toHaveURL(/\/run$/);
  await expect(page.getByText('Modo simulación: tu ubicación es simulada')).toBeVisible();
  await openSimulation(page, '20×');
  for (let i = 0; i < PLACES.length; i++) await walkAndVisit(page);
  await until(page, async () => page.url().endsWith('/create/review'), 30);
  await expect(page.getByText('Prueba completada: 3 de 3 lugares')).toBeVisible();
  expect(runCalls).toEqual([]);
  expect(writes).toHaveLength(0);

  // Save: one POST with the edit token, the device id and the built route.
  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);
  await expect(page.getByRole('heading', { name: 'Tu ruta está lista' })).toBeVisible();
  await until(page, async () => writes.length > 0, 10);
  const post = writes[0] as Request;
  expect(post.method()).toBe('POST');
  const headers = post.headers();
  expect(headers['x-edit-token']).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(headers['x-device-id']).toMatch(/^[0-9a-f-]{36}$/);
  const body = post.postDataJSON() as {
    spec: { id: string; source: string; points: { name: string; radius?: number }[] };
    contents: object;
  };
  expect(body.spec.source).toBe('user');
  expect(body.spec.points.map((point) => point.name)).toEqual([
    'Sé de Leiria',
    'Castelo de Leiria',
    'Museu de Leiria',
  ]);
  expect(body.spec.points[2]?.radius).toBe(60);
  expect(body.contents).toEqual({});
  await expect(page.getByText('Guardada. Puedes recorrerla cuando quieras.')).toBeVisible();

  // Then walk it for real (in simulation) from the start to the summary.
  await page.getByRole('button', { name: 'Iniciar ahora' }).click();
  await expect(page).toHaveURL(new RegExp(`/routes/${body.spec.id}/prepare$`));
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();
  await expect(page).toHaveURL(/\/run$/);
  await openSimulation(page, '20×');
  for (let i = 0; i < PLACES.length; i++) await walkAndVisit(page);
  await until(page, async () => page.url().endsWith('/run/summary'), 30);
  await expect(page.getByRole('heading', { name: '¡Ruta completada!' })).toBeVisible();
  await expect(page.getByText('3/3')).toBeVisible();
});

test('without a connection the route is saved on the device and waits in Mis rutas', async ({
  page,
}) => {
  await setup(page);
  await recordRunCalls(page);
  const writes = await mockRouteApi(page, () => 'abort');
  await fillDetails(page, 'Ruta sin conexión');
  await addPlace(page, PLACES[0] as Place);
  await addPlace(page, PLACES[1] as Place);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);
  await expect(
    page.getByText('Guardada en este dispositivo. La subiremos cuando vuelva la conexión.'),
  ).toBeVisible();
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Ver mis rutas' }).click();
  await expect(page).toHaveURL(/\/my-routes$/);
  await expect(page.getByText('Ruta sin conexión')).toBeVisible();
  await expect(page.getByText('Solo en este dispositivo · se subirá al conectar')).toBeVisible();
});

test('a route from Mis rutas can be edited (PUT) and deleted (DELETE)', async ({ page }) => {
  await setup(page);
  await recordRunCalls(page);
  const writes = await mockRouteApi(page, (request) =>
    request.method() === 'DELETE' ? { status: 204 } : savedAnswer(request),
  );
  const bundle = JSON.parse(
    readFileSync(new URL('./fixtures/e2e-ruta-de-usuario.json', import.meta.url), 'utf8'),
  ) as { spec: { id: string; name: string } };
  const token = Buffer.alloc(32, 9).toString('base64url');
  await page.goto('/');
  await seedMyRoutes(page, {
    [bundle.spec.id]: {
      id: bundle.spec.id,
      editToken: token,
      bundle,
      rev: 1,
      sync: 'synced',
      remote: 'yes',
      failures: 0,
      createdAt: '2026-10-08T09:00:00.000Z',
      updatedAt: '2026-10-08T09:00:00.000Z',
      syncedAt: '2026-10-08T09:00:00.000Z',
    },
  });
  await page.goto('/my-routes');
  await expect(page.getByText(bundle.spec.name)).toBeVisible();

  // Edit: rename it and save; the same id goes back with a PUT and its token.
  await page.getByRole('button', { name: `Opciones de ${bundle.spec.name}` }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  await expect(page).toHaveURL(/\/create\/details$/);
  const name = page.getByRole('textbox', { name: 'Nombre de la ruta' });
  await expect(name).toHaveValue(bundle.spec.name);
  await name.fill('Paseo por el centro, versión 2');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(placeList(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);
  await until(page, async () => writes.length > 0, 10);
  const put = writes[0] as Request;
  expect(put.method()).toBe('PUT');
  expect(new URL(put.url()).pathname).toBe(`/api/v1/routes/${bundle.spec.id}`);
  expect(put.headers()['x-edit-token']).toBe(token);
  expect((put.postDataJSON() as { spec: { id: string; name: string } }).spec).toMatchObject({
    id: bundle.spec.id,
    name: 'Paseo por el centro, versión 2',
  });

  // Delete it from Mis rutas: confirm, DELETE with the token, empty list.
  await page.getByRole('button', { name: 'Ver mis rutas' }).click();
  await expect(page.getByText('Paseo por el centro, versión 2')).toBeVisible();
  await page.getByRole('button', { name: 'Opciones de Paseo por el centro, versión 2' }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByText('Ruta eliminada')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Crea tu primera ruta' })).toBeVisible();
  await until(page, async () => writes.length > 1, 10);
  const del = writes[1] as Request;
  expect(del.method()).toBe('DELETE');
  expect(del.headers()['x-edit-token']).toBe(token);
});

test('the draft survives a reload', async ({ page }) => {
  await setup(page);
  await recordRunCalls(page);
  await mockRouteApi(page, savedAnswer);
  await fillDetails(page, 'Borrador que se queda');
  await addPlace(page, PLACES[0] as Place);
  await addPlace(page, PLACES[2] as Place);
  // Past the autosave's debounce.
  await page.clock.runFor(1000);
  await page.reload();
  await expect(page).toHaveURL(/\/create\/places$/);
  await expect(placeList(page)).toHaveCount(2);
  await expect(placeList(page).nth(1)).toContainText('Museu de Leiria');
});

test('"Probar ruta" always simulates, even with simulation mode off', async ({ page }) => {
  test.setTimeout(240_000);
  await setup(page, { simulation: false });
  const runCalls = await recordRunCalls(page);
  await mockRouteApi(page, savedAnswer);
  await fillDetails(page, 'Prueba en simulación');
  await addPlace(page, PLACES[1] as Place);
  await addPlace(page, PLACES[2] as Place);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Probar ruta' }).click();
  await expect(page).toHaveURL(/\/run$/);
  await expect(page.getByText('Modo simulación: tu ubicación es simulada')).toBeVisible();
  await page.getByRole('button', { name: 'Volver al editor' }).click();
  await until(page, async () => page.url().endsWith('/create/review'), 10);
  await expect(page.getByText('Prueba terminada')).toBeVisible();
  expect(runCalls).toEqual([]);
});
