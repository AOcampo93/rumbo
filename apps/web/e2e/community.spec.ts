import { expect, type Page, type Request, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { type Bundle, fixture, setup, until, visible, withoutMap } from './helpers.ts';

// Routes for the community (phase 7.2, ADR 0004). A route created with
// "Publicar para la comunidad" goes to the API public, its detail says so and
// "Dejar de publicar" takes it back; and with the location allowed, Explore
// lists the community's routes near the user under "De la comunidad, cerca de
// ti", the detail of one labels it and "Reportar ruta" sends the report. The
// API is mocked: place search, the AI (off), route writes and reads, reports.

// ------------------------------------------------------------------ a route made with the creator

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
];

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** /geo/suggest and /geo/resolve answer from PLACES, like the API would. */
async function mockGeo(page: Page) {
  await page.route(/\/api\/v1\/geo\/suggest\?/, (route) => {
    const q = fold(new URL(route.request().url()).searchParams.get('q') ?? '');
    return route.fulfill({
      json: PLACES.filter((place) => fold(place.name).includes(q)).map((place) => ({
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

/** The AI is off (503 ai_unavailable): every place keeps its basic sheet. */
async function mockAiOff(page: Page) {
  await page.route(/\/api\/v1\/(suggest\/places|content\/generate)$/, (route) =>
    route.fulfill({ status: 503, json: { code: 'ai_unavailable' } }),
  );
}

/** /runs and /analytics: refused, they are not what these tests are about. */
async function refuseRunCalls(page: Page) {
  await page.route(/\/api\/v1\/(runs|analytics)/, (route) =>
    route.fulfill({ status: 503, json: { code: 'unavailable' } }),
  );
}

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
}

/** C2 → C3 (the AI is off: the basic sheets for all) → C4. */
async function continueToReview(page: Page) {
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/content$/);
  await page.getByRole('button', { name: 'Usar fichas básicas', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/review$/);
}

interface OwnerApi {
  /** Route writes seen (POST, PUT, DELETE). */
  writes: Request[];
  /** GET /routes/:id/status requests seen. */
  statuses: Request[];
}

/**
 * The route endpoints for a user who writes routes: the list is empty (the
 * app falls back to the bundled curated routes), a write is accepted and
 * answered as the API does (id, updatedAt, visibility, moderation), and the
 * status of a published route is "visible".
 */
async function mockOwnerApi(page: Page): Promise<OwnerApi> {
  const api: OwnerApi = { writes: [], statuses: [] };
  await page.route(/\/api\/v1\/routes(\/[^/?]+)?(\?.*)?$/, (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return new URL(request.url()).pathname === '/api/v1/routes'
        ? route.fulfill({ json: [] })
        : route.fulfill({ status: 404, json: { code: 'route_not_found' } });
    }
    api.writes.push(request);
    const body = request.postDataJSON() as { spec: { id: string }; visibility?: string } | null;
    return route.fulfill({
      status: request.method() === 'POST' ? 201 : 200,
      json: {
        id: body?.spec.id,
        updatedAt: '2026-10-09T10:00:00.000Z',
        visibility: body?.visibility ?? 'private',
        moderation: 'visible',
      },
    });
  });
  await page.route(/\/api\/v1\/routes\/[^/]+\/status$/, (route) => {
    api.statuses.push(route.request());
    return route.fulfill({
      json: {
        visibility: 'public',
        moderation: 'visible',
        publishedAt: '2026-10-09T10:00:00.000Z',
      },
    });
  });
  return api;
}

test('a route created with "Publicar para la comunidad" goes to the API public, says so, and is taken back with a PUT', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await withoutMap(page);
  await mockGeo(page);
  await mockAiOff(page);
  await refuseRunCalls(page);
  await setup(page);
  const api = await mockOwnerApi(page);

  await fillDetails(page, 'Leiria en una mañana');
  for (const place of PLACES) await addPlace(page, place);
  await continueToReview(page);

  // C4: the switch starts off, says what publishing means, and warns when it is on.
  const toggle = page.getByRole('switch', { name: 'Publicar para la comunidad' });
  await expect(toggle).not.toBeChecked();
  await expect(
    page.getByText('Quien use Rumbo cerca podrá verla y recorrerla, sin saber quién la creó.'),
  ).toBeVisible();
  await expect(page.getByText('Lo verán desconocidos')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(
    page.getByText('Lo verán desconocidos: no incluyas tu casa ni datos personales.'),
  ).toBeVisible();

  // Saving: a POST with the route public, and the last screen says it is published.
  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);
  await until(page, async () => api.writes.length > 0, 10);
  const post = api.writes[0] as Request;
  expect(post.method()).toBe('POST');
  const created = post.postDataJSON() as {
    spec: { id: string; name: string; source: string };
    visibility: string;
  };
  expect(created.visibility).toBe('public');
  expect(created.spec).toMatchObject({ name: 'Leiria en una mañana', source: 'user' });
  await expect(page.getByText('Publicada para la comunidad.')).toBeVisible();
  const token = post.headers()['x-edit-token'];

  // Mis rutas labels it, and its detail says who sees it.
  await page.getByRole('button', { name: 'Ver mis rutas' }).click();
  await expect(page).toHaveURL(/\/my-routes$/);
  await expect(page.getByText('Publicada', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Leiria en una mañana/ }).click();
  await expect(page).toHaveURL(new RegExp(`/routes/${created.spec.id}$`));
  await expect(page.getByText('Publicada: la ven quienes usen Rumbo cerca.')).toBeVisible();
  // The API is asked once, with the route's token, whether it was hidden or taken down.
  await expect.poll(() => api.statuses.length).toBe(1);
  expect(new URL((api.statuses[0] as Request).url()).pathname).toBe(
    `/api/v1/routes/${created.spec.id}/status`,
  );
  expect((api.statuses[0] as Request).headers()['x-edit-token']).toBe(token);

  // "Dejar de publicar": the toast, the new state, and a PUT with the route private.
  await page.getByRole('button', { name: 'Dejar de publicar' }).click();
  await expect(page.getByText('Ahora solo tú ves esta ruta')).toBeVisible();
  await expect(page.getByText('Privada: solo tú la ves.')).toBeVisible();
  await until(page, async () => api.writes.length > 1, 10);
  const put = api.writes[1] as Request;
  expect(put.method()).toBe('PUT');
  expect(new URL(put.url()).pathname).toBe(`/api/v1/routes/${created.spec.id}`);
  expect(put.headers()['x-edit-token']).toBe(token);
  expect((put.postDataJSON() as { visibility: string }).visibility).toBe('private');
  await expect(page.getByRole('button', { name: 'Publicar', exact: true })).toBeVisible();
  // Taking it back asked nothing more of the API's status.
  expect(api.statuses).toHaveLength(1);
});

// ------------------------------------------------------------------ a route of the community, near the user

const LEIRIA = JSON.parse(
  readFileSync(new URL('../../../data/routes/leiria-historica.json', import.meta.url), 'utf8'),
) as Bundle;
const OWN = fixture('e2e-ruta-de-usuario') as Bundle & { spec: { id: string; name: string } };
const COMMUNITY_ID = 'passeio-da-comunidade-e2e0001';
// Someone else's route, made in Portuguese, with a spot near the user's.
const COMMUNITY = {
  ...OWN,
  spec: { ...OWN.spec, id: COMMUNITY_ID, name: 'Passeio da comunidade', locale: 'pt' },
};

test.describe('with the location allowed near Leiria', () => {
  test.use({
    geolocation: { latitude: 39.7436, longitude: -8.8071 },
    permissions: ['geolocation'],
  });

  test('Explore lists the community routes near the user, the detail labels one and a report is sent', async ({
    page,
  }) => {
    await withoutMap(page);
    await refuseRunCalls(page);
    await setup(page, {}, [LEIRIA]);
    const nearRequests: string[] = [];
    const reports: Request[] = [];
    // GET /routes?near=…: the curated route and the community's, nearest first.
    await page.route(/\/api\/v1\/routes\?near=/, (route) => {
      nearRequests.push(route.request().url());
      return route.fulfill({
        json: [{ id: LEIRIA.spec.id }, { id: COMMUNITY_ID }],
      });
    });
    await page.route(new RegExp(`/api/v1/routes/${COMMUNITY_ID}$`), (route) =>
      route.fulfill({ json: COMMUNITY }),
    );
    await page.route(new RegExp(`/api/v1/routes/${COMMUNITY_ID}/reports$`), (route) => {
      reports.push(route.request());
      return route.fulfill({ status: 201, json: { received: true } });
    });

    // The permission is already granted: Explore reads the position by itself and asks for the
    // routes around it, rounded to about 110 m.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'De la comunidad, cerca de ti' })).toBeVisible();
    expect(nearRequests).toHaveLength(1);
    expect(new URL(nearRequests[0] as string).searchParams.get('near')).toBe('39.744,-8.807');
    // The curated route first; then, under the heading, the community's with its label.
    await expect(page.getByRole('heading', { level: 2, name: 'Leiria histórica' })).toBeVisible();
    const community = page.getByRole('region', { name: 'De la comunidad, cerca de ti' });
    const card = community.getByRole('link', { name: /Passeio da comunidade/ });
    await expect(card).toBeVisible();
    await expect(card).toContainText('De la comunidad');
    // Nothing to invite the user to: the position is known.
    await expect(
      page.getByText('Toca «Mi ubicación» para ver las rutas de la comunidad'),
    ).toHaveCount(0);

    // Its detail: the label, the language it is in, and a discreet "Reportar ruta" at the end.
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/routes/${COMMUNITY_ID}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Passeio da comunidade' }),
    ).toBeVisible();
    await expect(page.locator('.detail__shared')).toHaveText('De la comunidad');
    await expect(page.getByText('Esta ruta está en portugués.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar ruta' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Iniciar ruta' })).toBeVisible();

    // Reporting: a reason from the list, "Enviar", and the thanks.
    await page.getByRole('button', { name: 'Reportar ruta' }).click();
    const sheet = page.getByRole('dialog', { name: 'Reportar ruta' });
    await expect(sheet.getByRole('radio')).toHaveCount(6);
    await expect(sheet.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    await sheet.getByRole('radio', { name: 'Lugar peligroso o de acceso prohibido' }).check();
    await sheet.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText('Gracias. La revisaremos.')).toBeVisible();
    await expect(sheet).toBeHidden();
    expect(reports).toHaveLength(1);
    const report = reports[0] as Request;
    expect(report.method()).toBe('POST');
    expect(report.postDataJSON()).toEqual({ reason: 'dangerous' });
    expect(report.headers()['x-device-id']).toMatch(/^[0-9a-f-]{36}$/);
    // The device remembers: it isn't offered again, not even after the page is opened anew.
    await expect(page.getByRole('button', { name: 'Reportar ruta' })).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Passeio da comunidade' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reportar ruta' })).toHaveCount(0);
  });
});
