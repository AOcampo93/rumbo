import { expect, type Page, type Request, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openSimulation, setup, until, visible, walkAndVisit, withoutMap } from './helpers.ts';

// PROJECT_PLAN §16 phase 6 (DoD: create a route, simulate it and walk it from
// start to finish), plus saving offline, editing and deleting from Mis rutas,
// the autosaved draft and a trial that forces simulation; and phase 7 (DoD: a
// route with suggested places and AI cards that stay hidden until the arrival,
// where the card shows its trivia). The API is mocked: place search, the AI
// guide, route writes, runs and analytics. Unless a test says otherwise the AI
// is off (503 ai_unavailable), so the places keep their basic sheet.

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

/** What POST /suggest/places answers: the PLACES, in walking order, each with why to go. */
const SUGGESTION = {
  title: 'Leiria en una mañana',
  summary: 'Del castillo al río, pasando por la catedral.',
  places: PLACES.map((place, index) => ({
    key: `wikidata:${place.qid}`,
    name: place.name,
    description: place.description,
    position: place.position,
    category: place.category,
    externalId: place.qid,
    distanceMeters: 300 + index * 250,
    storable: true,
    teaser: `Motivo para ir a ${place.name}.`,
  })),
};

/** The card POST /content/generate would write: everything in it is a spoiler. */
const cardFor = (name: string) => ({
  locale: 'es',
  title: `Ficha secreta de ${name}`,
  subtitle: `Subtítulo oculto de ${name}`,
  summary: `Dato secreto sobre ${name}: se fundó mucho antes de lo que parece.`,
  facts: [`Hecho oculto de ${name}`],
  images: [],
  tip: `Consejo oculto de ${name}`,
  quiz: {
    question: `¿Pregunta sobre ${name}?`,
    options: ['La respuesta buena', 'Una falsa', 'Otra falsa'],
    correctIndex: 0,
    explanation: 'Porque sí.',
  },
  sources: [
    { title: 'Leiria en Wikipedia', url: 'https://es.wikipedia.org/wiki/Leiria' },
    { title: 'Visite Leiria', url: 'https://www.visiteleiria.pt/' },
  ],
  generated: {
    by: 'ai',
    model: 'claude-sonnet-5-5',
    promptVersion: 'card-1',
    at: '2026-10-08T10:00:00.000Z',
  },
  status: 'approved',
});

interface AiAsked {
  suggests: Array<Record<string, unknown>>;
  cards: Array<Record<string, unknown>>;
}

/**
 * The AI guide. `off` is a server without an AI key (503 ai_unavailable, so
 * every place keeps its basic sheet); otherwise it suggests the PLACES and
 * writes a card for each place it is asked about. Returns what it was asked.
 */
async function mockAi(page: Page, options: { off?: boolean } = {}): Promise<AiAsked> {
  const asked: AiAsked = { suggests: [], cards: [] };
  await page.route(/\/api\/v1\/suggest\/places$/, (route) => {
    asked.suggests.push(route.request().postDataJSON() as Record<string, unknown>);
    return options.off
      ? route.fulfill({ status: 503, json: { code: 'ai_unavailable' } })
      : route.fulfill({ json: SUGGESTION });
  });
  await page.route(/\/api\/v1\/content\/generate$/, (route) => {
    const body = route.request().postDataJSON() as { name: string };
    asked.cards.push(body);
    return options.off
      ? route.fulfill({ status: 503, json: { code: 'ai_unavailable' } })
      : route.fulfill({
          json: { content: cardFor(body.name), grounding: 'wikipedia', cached: false },
        });
  });
  return asked;
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

/**
 * C2 → C3 → C4 with the AI off: step 3 can't prepare any card, and the user
 * either takes the basic cards for all ("Usar fichas básicas") or just goes on.
 */
async function continueToReview(page: Page, { basic = true } = {}) {
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/content$/);
  if (basic) await page.getByRole('button', { name: 'Usar fichas básicas', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/review$/);
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
  await mockAi(page, { off: true });
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

  // C3: the AI is off, so the user takes the basic cards and goes on to C4.
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/content$/);
  await expect(page.getByText('La IA no está disponible ahora.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Usar fichas básicas', exact: true }).click();
  await expect(page.getByText('Ficha básica: nombre y dirección')).toHaveCount(3);
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // C4 → "Probar ruta": the unsaved route in simulation, back to C4 at the end,
  // without a single call to /runs or /analytics.
  await expect(page).toHaveURL(/\/create\/review$/);
  await expect(
    page.getByText('Sin fichas con IA: cada lugar mostrará su nombre y dirección.'),
  ).toBeVisible();
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
  await continueToReview(page);
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
  const ai = await mockAi(page, { off: true });
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
  // Its places keep the basic sheets they were saved with: editing asks the AI for nothing.
  await continueToReview(page, { basic: false });
  expect(ai.cards).toEqual([]);
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
  // Step 3 never blocks: cards that failed just mean basic sheets.
  await continueToReview(page, { basic: false });
  await page.getByRole('button', { name: 'Probar ruta' }).click();
  await expect(page).toHaveURL(/\/run$/);
  await expect(page.getByText('Modo simulación: tu ubicación es simulada')).toBeVisible();
  await page.getByRole('button', { name: 'Volver al editor' }).click();
  await until(page, async () => page.url().endsWith('/create/review'), 10);
  await expect(page.getByText('Prueba terminada')).toBeVisible();
  expect(runCalls).toEqual([]);
});

test('the AI guide: suggested places get cards that stay hidden until the arrival, where they ask their trivia', async ({
  page,
  context,
}) => {
  test.setTimeout(480_000);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 39.7436, longitude: -8.8071 });
  await setup(page);
  await recordRunCalls(page);
  const writes = await mockRouteApi(page, savedAnswer);
  const ai = await mockAi(page);

  // C1: a name, two interests, the language the cards will be in and the
  // device's position as the area (the suggestions look around it).
  await page.goto('/create');
  await expect(page).toHaveURL(/\/create\/details$/);
  await page.getByRole('textbox', { name: 'Nombre de la ruta' }).fill('Mi paseo');
  await page.getByRole('button', { name: 'Historia' }).click();
  await page.getByRole('button', { name: 'Gastronomía' }).click();
  await expect(page.getByRole('button', { name: 'Historia' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Arte' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Las fichas se generarán en español.')).toBeVisible();
  await page.getByRole('button', { name: 'Usar mi ubicación' }).click();
  await expect(page.getByText('Tu ubicación')).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/places$/);

  // C2: "Sugerir lugares" with 3 h, keep two of the three, and take the
  // suggested title.
  await page.getByRole('button', { name: 'Sugerir lugares', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Sugerir lugares' });
  await expect(sheet.getByRole('radio', { name: '2 h' })).toBeChecked();
  await expect(sheet.getByRole('button', { name: 'Historia' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await sheet.getByRole('radio', { name: '3 h' }).click();
  await sheet.getByRole('button', { name: 'Sugerir', exact: true }).click();
  await expect(sheet.getByText('Motivo para ir a Castelo de Leiria.')).toBeVisible();
  expect(ai.suggests).toEqual([
    {
      near: { lat: 39.744, lng: -8.807 },
      locale: 'es',
      interests: ['history', 'food'],
      minutes: 180,
      activity: 'walk',
      exclude: [],
    },
  ]);
  await expect(sheet.getByRole('checkbox')).toHaveCount(3);
  await sheet.getByRole('button', { name: 'Usar el título sugerido' }).click();
  await expect(sheet.getByRole('button', { name: 'Título aplicado' })).toBeDisabled();
  await sheet.getByRole('checkbox', { name: 'Museu de Leiria' }).uncheck();
  await sheet.getByRole('button', { name: 'Añadir 2 lugares' }).click();
  await expect(sheet).toBeHidden();
  await expect(placeList(page)).toHaveCount(2);
  await expect(placeList(page).nth(0)).toContainText('Castelo de Leiria');
  await expect(placeList(page).nth(1)).toContainText('Sé de Leiria');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // C3: the cards are prepared two at a time and only their state shows.
  await expect(page).toHaveURL(/\/create\/content$/);
  await expect(page.getByText('2 de 2 fichas listas')).toBeVisible();
  const rows = page.getByRole('list', { name: 'Fichas de los lugares' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Castelo de Leiria');
  await expect(rows.nth(0)).toContainText('Ficha lista · 2 fuentes');
  await expect(rows.nth(1)).toContainText('Ficha lista · 2 fuentes');
  expect(ai.cards).toEqual([
    {
      name: 'Castelo de Leiria',
      position: PLACES[0]?.position,
      locale: 'es',
      category: 'monument',
      externalId: 'Q2969701',
      interests: ['history', 'food'],
      custom: false,
    },
    expect.objectContaining({ name: 'Sé de Leiria', externalId: 'Q1638383' }),
  ]);
  for (const spoiler of [
    /secreto/,
    /oculto/,
    /Leiria en Wikipedia/,
    /Visite Leiria/,
    /respuesta buena/,
  ]) {
    await expect(page.getByText(spoiler)).toHaveCount(0);
  }

  // "Ver ficha" asks first; only after agreeing does the card show.
  await page.getByRole('button', { name: 'Ver la ficha de Castelo de Leiria' }).click();
  const confirm = page.getByRole('alertdialog', { name: '¿Ver la ficha?' });
  await expect(confirm).toContainText('Te adelantará lo que descubrirás al llegar.');
  await expect(page.getByText(/secreto/)).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Mejor no' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText(/secreto/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver la ficha de Sé de Leiria' }).click();
  await page
    .getByRole('alertdialog', { name: '¿Ver la ficha?' })
    .getByRole('button', { name: 'Ver ficha', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Ficha secreta de Sé de Leiria' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pregunta rápida' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByText(/secreto/)).toHaveCount(0);

  // C4 counts the cards; the route is saved with them.
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/review$/);
  await expect(page.getByText('2 fichas con IA', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Leiria en una mañana' })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);
  await until(page, async () => writes.length > 0, 10);
  const post = writes[0] as Request;
  expect(post.method()).toBe('POST');
  const body = post.postDataJSON() as {
    spec: {
      id: string;
      name: string;
      summary: string;
      locale: string;
      meta: { interests: string[] };
      points: { name: string; contentRef: string }[];
      actions: Record<string, { type: string; params?: { contentRef?: string } }>;
    };
    contents: Record<string, { es: { id: string; title: string; generated: { by: string } } }>;
  };
  expect(body.spec).toMatchObject({
    name: 'Leiria en una mañana',
    summary: 'Del castillo al río, pasando por la catedral.',
    locale: 'es',
    meta: { interests: ['history', 'food'] },
  });
  expect(body.spec.points.map((point) => point.name)).toEqual([
    'Castelo de Leiria',
    'Sé de Leiria',
  ]);
  const refs = body.spec.points.map((point) => point.contentRef);
  expect(refs.every((ref) => /^card-[a-z0-9]{10}$/.test(ref))).toBe(true);
  expect(Object.keys(body.contents).sort()).toEqual([...refs].sort());
  expect(Object.values(body.spec.actions).filter((a) => a.type === 'ai_template')).toHaveLength(2);
  expect(body.contents[refs[0] as string]?.es).toMatchObject({
    id: refs[0],
    title: 'Ficha secreta de Castelo de Leiria',
    generated: { by: 'ai' },
  });

  // Walk it: at the first arrival the card shows, with its trivia.
  await page.getByRole('button', { name: 'Iniciar ahora' }).click();
  await expect(page).toHaveURL(new RegExp(`/routes/${body.spec.id}/prepare$`));
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();
  await expect(page).toHaveURL(/\/run$/);
  await openSimulation(page, '20×');
  await page.getByRole('button', { name: 'Caminar al siguiente punto' }).click();
  const trivia = page.getByRole('heading', { name: 'Pregunta rápida' });
  await until(page, visible(trivia), 600, 2);
  await expect(
    page.getByRole('heading', { name: 'Ficha secreta de Castelo de Leiria' }),
  ).toBeVisible();
  await expect(page.getByText('¿Pregunta sobre Castelo de Leiria?')).toBeVisible();
  await page.getByRole('button', { name: 'La respuesta buena' }).click();
  await expect(page.getByText('¡Correcto! +10 pts')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar ruta' }).click();
  await expect(trivia).toBeHidden();

  // The second place, then the summary.
  await walkAndVisit(page);
  await until(page, async () => page.url().endsWith('/run/summary'), 30);
  await expect(page.getByRole('heading', { name: '¡Ruta completada!' })).toBeVisible();
});

test('a place with its own question: it travels with the route, shows on arrival and scores', async ({
  page,
}) => {
  test.setTimeout(480_000);
  await setup(page);
  await recordRunCalls(page);
  const writes = await mockRouteApi(page, savedAnswer);

  // C2: the cathedral only greets the user with a notice; the castle asks a
  // question of its own (it is the user who writes it, so the editor shows it).
  await fillDetails(page, 'Ruta con pregunta propia');
  await addPlace(page, PLACES[1] as Place);
  await addPlace(page, PLACES[0] as Place);
  await page.getByRole('button', { name: 'Opciones de Sé de Leiria' }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  const editor = page.getByRole('dialog', { name: 'Editar lugar' });
  await expect(editor.getByRole('group', { name: 'Al llegar' })).toBeVisible();
  await expect(editor.getByRole('radio', { name: 'Ficha del lugar' })).toBeChecked();
  await editor.getByRole('radio', { name: 'Solo un aviso' }).check();
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(editor).toBeHidden();

  await page.getByRole('button', { name: 'Opciones de Castelo de Leiria' }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  await editor.getByRole('radio', { name: 'Tu propia pregunta' }).check();
  // An unfinished question doesn't save.
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(editor.getByText('Escribe la pregunta.')).toBeVisible();
  await expect(editor).toBeVisible();
  await editor
    .getByRole('textbox', { name: 'Pregunta', exact: true })
    .fill('¿Quién conquistó el castillo?');
  await editor.getByRole('textbox', { name: 'Respuesta 1' }).fill('Afonso Henriques');
  await editor.getByRole('textbox', { name: 'Respuesta 2' }).fill('Dinis I');
  await editor.getByRole('textbox', { name: 'Explicación (opcional)' }).fill('Lo tomó en 1135.');
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(editor).toBeHidden();

  // C3 has no card to prepare: both places say what they show. C4 counts them.
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/content$/);
  await expect(
    page.getByText('Ningún lugar usa ficha con IA, así que no hay nada que preparar.'),
  ).toBeVisible();
  const rows = page.getByRole('list', { name: 'Fichas de los lugares' }).getByRole('listitem');
  await expect(rows.nth(0)).toContainText('Solo un aviso al llegar');
  await expect(rows.nth(1)).toContainText('Tu pregunta: «¿Quién conquistó el castillo?»');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/review$/);
  await expect(page.getByText('Al llegar: 1 pregunta propia · 1 aviso')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);

  // The route is sent with the notice and the question as its own actions.
  await until(page, async () => writes.length > 0, 10);
  const post = writes[0] as Request;
  const body = post.postDataJSON() as {
    spec: {
      id: string;
      points: { name: string; contentRef?: string; triggers: { onEnter: string } }[];
      actions: Record<string, { type: string; params?: Record<string, unknown> }>;
    };
    contents: object;
  };
  const onEnter = body.spec.points.map((point) => body.spec.actions[point.triggers.onEnter]);
  expect(body.spec.points.map((point) => point.name)).toEqual([
    'Sé de Leiria',
    'Castelo de Leiria',
  ]);
  expect(onEnter).toEqual([
    { type: 'toast', params: { messageKey: 'run.arrivedAt' } },
    {
      type: 'quiz',
      params: {
        question: '¿Quién conquistó el castillo?',
        options: ['Afonso Henriques', 'Dinis I'],
        correctIndex: 0,
        points: 10,
        explanation: 'Lo tomó en 1135.',
      },
    },
  ]);
  expect(body.spec.points.some((point) => 'contentRef' in point)).toBe(false);
  expect(body.contents).toEqual({});

  // Walk it. The first arrival is only a notice: no sheet, and the route goes on.
  await page.getByRole('button', { name: 'Iniciar ahora' }).click();
  await expect(page).toHaveURL(new RegExp(`/routes/${body.spec.id}/prepare$`));
  await page.getByRole('button', { name: 'Empezar', exact: true }).click();
  await expect(page).toHaveURL(/\/run$/);
  await openSimulation(page, '20×');
  await page.getByRole('button', { name: 'Caminar al siguiente punto' }).click();
  await until(page, visible(page.getByText('Llegaste a Sé de Leiria')), 600, 2);
  await expect(page.getByRole('button', { name: 'Continuar ruta' })).toHaveCount(0);

  // The second arrival asks the user's question; a right answer scores 10.
  await page.getByRole('button', { name: 'Caminar al siguiente punto' }).click();
  const answer = page.getByRole('radio', { name: 'Afonso Henriques' });
  await until(page, visible(answer), 600, 2);
  await expect(page.getByText('Pregunta rápida · +10 pts')).toBeVisible();
  await expect(page.getByText('¿Quién conquistó el castillo?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar ruta' })).toBeDisabled();
  await answer.click();
  await expect(page.getByText('¡Correcto!')).toBeVisible();
  await expect(page.getByText('Lo tomó en 1135.')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar ruta' }).click();

  await until(page, async () => page.url().endsWith('/run/summary'), 30);
  await expect(page.getByRole('heading', { name: '¡Ruta completada!' })).toBeVisible();
  await expect(page.getByText('10 pts', { exact: true })).toBeVisible();
});
