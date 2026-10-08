import { expect, type Page, type Request, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setup, until, withoutMap } from './helpers.ts';

// A route the user made can be edited and deleted where it is looked at before
// starting it: its detail (S03), and from My routes (S02) through the visible
// "Editar" button as well as the ⋯ menu. The API is mocked: route writes, the
// AI (off, so editing proves it asks it for nothing), runs and analytics.

interface Bundle {
  spec: { id: string; name: string };
}

const bundle = JSON.parse(
  readFileSync(new URL('./fixtures/e2e-ruta-de-usuario.json', import.meta.url), 'utf8'),
) as Bundle;
const ID = bundle.spec.id;
const NAME = bundle.spec.name;
const TOKEN = Buffer.alloc(32, 9).toString('base64url');

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

/** A PUT is saved, a DELETE is done. */
const answerWrites: WriteHandler = (request) =>
  request.method() === 'DELETE'
    ? { status: 204 }
    : {
        status: 200,
        json: {
          id: (request.postDataJSON() as { spec: { id: string } }).spec.id,
          updatedAt: '2026-10-08T10:00:00.000Z',
        },
      };

/** /runs and /analytics: recorded (to prove nothing here calls them) and refused. */
async function recordRunCalls(page: Page) {
  const calls: string[] = [];
  await page.route(/\/api\/v1\/(runs|analytics)/, (route) => {
    calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 503, json: { code: 'unavailable' } });
  });
  return calls;
}

/** The AI is off (503 ai_unavailable); what it was asked is returned. */
async function mockAiOff(page: Page) {
  const asked: string[] = [];
  await page.route(/\/api\/v1\/(suggest\/places|content\/generate)$/, (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 503, json: { code: 'ai_unavailable' } });
  });
  return asked;
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

/** The user's route, saved and uploaded, on this device. */
async function seedRoute(page: Page) {
  await page.goto('/');
  await seedMyRoutes(page, {
    [ID]: {
      id: ID,
      editToken: TOKEN,
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
}

const placeList = (page: Page) =>
  page.getByRole('list', { name: 'Lugares de la ruta' }).getByRole('listitem');

test.beforeEach(async ({ page }) => {
  await withoutMap(page);
});

test('the detail of an own route edits it (PUT) and the change shows when it is opened again', async ({
  page,
}) => {
  await setup(page);
  const runCalls = await recordRunCalls(page);
  const ai = await mockAiOff(page);
  const writes = await mockRouteApi(page, answerWrites);
  await seedRoute(page);

  await page.goto(`/routes/${ID}`);
  await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Eliminar ruta' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar ruta' }).click();

  // The creator opens on the route: rename it and save. The same id goes back with a PUT and its token.
  await expect(page).toHaveURL(/\/create\/details$/);
  const name = page.getByRole('textbox', { name: 'Nombre de la ruta' });
  await expect(name).toHaveValue(NAME);
  await name.fill('Paseo por el centro, versión 2');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/places$/);
  await expect(placeList(page)).toHaveCount(2);
  // Its places keep the sheets they were saved with: editing asks the AI for nothing.
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/content$/);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/review$/);
  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);
  await until(page, async () => writes.length > 0, 10);
  const put = writes[0] as Request;
  expect(put.method()).toBe('PUT');
  expect(new URL(put.url()).pathname).toBe(`/api/v1/routes/${ID}`);
  expect(put.headers()['x-edit-token']).toBe(TOKEN);
  expect((put.postDataJSON() as { spec: { id: string; name: string } }).spec).toMatchObject({
    id: ID,
    name: 'Paseo por el centro, versión 2',
  });
  expect(ai).toEqual([]);
  expect(runCalls).toEqual([]);

  // The detail shows the new name, from My routes.
  await page.getByRole('button', { name: 'Ver mis rutas' }).click();
  await expect(page).toHaveURL(/\/my-routes$/);
  await page.getByRole('link', { name: /Paseo por el centro, versión 2/ }).click();
  await expect(page).toHaveURL(new RegExp(`/routes/${ID}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Paseo por el centro, versión 2' }),
  ).toBeVisible();
});

test('the detail of an own route deletes it (DELETE) after asking, and leaves no dead end behind', async ({
  page,
}) => {
  await setup(page);
  await recordRunCalls(page);
  const writes = await mockRouteApi(page, answerWrites);
  await seedRoute(page);

  // Opened from My routes, like a user does.
  await page.goto('/my-routes');
  await page.getByRole('link', { name: new RegExp(NAME) }).click();
  await expect(page).toHaveURL(new RegExp(`/routes/${ID}$`));
  await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();

  // Cancelled: the dialog names the route, and nothing is deleted.
  await page.getByRole('button', { name: 'Eliminar ruta' }).click();
  const dialog = page.getByRole('alertdialog', { name: `¿Eliminar «${NAME}»?` });
  await expect(dialog).toContainText('Se borrará de este dispositivo y del servidor.');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/routes/${ID}$`));
  expect(writes).toHaveLength(0);

  // Confirmed: DELETE with the token, "Ruta eliminada", and My routes without the route.
  await page.getByRole('button', { name: 'Eliminar ruta' }).click();
  await dialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.getByText('Ruta eliminada')).toBeVisible();
  await expect(page).toHaveURL(/\/my-routes$/);
  await expect(page.getByRole('heading', { name: 'Crea tu primera ruta' })).toBeVisible();
  await expect(page.getByText('No encontramos esta ruta.')).toHaveCount(0);
  await until(page, async () => writes.length > 0, 10);
  const del = writes[0] as Request;
  expect(del.method()).toBe('DELETE');
  expect(new URL(del.url()).pathname).toBe(`/api/v1/routes/${ID}`);
  expect(del.headers()['x-edit-token']).toBe(TOKEN);

  // Back from there goes to what came before My routes, not to My routes again.
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test('a deleted route is gone for good: its address says so', async ({ page }) => {
  await setup(page);
  await recordRunCalls(page);
  await mockRouteApi(page, answerWrites);
  await seedRoute(page);
  await page.goto(`/routes/${ID}`);
  await page.getByRole('button', { name: 'Eliminar ruta' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Eliminar', exact: true })
    .click();
  await expect(page).toHaveURL(/\/my-routes$/);
  await page.goto(`/routes/${ID}`);
  await expect(page.getByText('No encontramos esta ruta.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar ruta' })).toHaveCount(0);
});

test('a curated route has neither action', async ({ page }) => {
  await setup(page);
  await recordRunCalls(page);
  await mockRouteApi(page, answerWrites);
  await page.goto('/routes/leiria-historica');
  await expect(page.getByRole('heading', { level: 1, name: 'Leiria histórica' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar ruta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar ruta' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Eliminar ruta' })).toHaveCount(0);
});

test('My routes has a visible "Editar" button on the card, besides the ⋯ menu', async ({
  page,
}) => {
  await setup(page);
  await recordRunCalls(page);
  await mockAiOff(page);
  await mockRouteApi(page, answerWrites);
  await seedRoute(page);
  await page.goto('/my-routes');
  await expect(page.getByRole('button', { name: `Opciones de ${NAME}` })).toBeVisible();
  await page.getByRole('button', { name: `Editar: ${NAME}` }).click();
  await expect(page).toHaveURL(/\/create\/details$/);
  await expect(page.getByRole('textbox', { name: 'Nombre de la ruta' })).toHaveValue(NAME);
});
