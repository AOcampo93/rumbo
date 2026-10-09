import { expect, type Locator, type Page, type Request, test } from '@playwright/test';
import { setup, until, visible, withoutMap } from './helpers.ts';

// Route covers (PROJECT_PLAN §16 phase 7.3, ADR 0005): C4's "Portada" card
// uploads a photo of the phone (scaled on the device) or picks one of the
// photos of the places' cards, the cover travels with the route and shows on
// its card, and a route without one wears the illustration of its first
// interest. The API is mocked: place search, the AI guide, the photo upload,
// route writes, runs and analytics.

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

/** The photos of the places on Wikimedia Commons, as their cards carry them (credit and licence included). */
const PHOTOS: Record<string, Array<Record<string, string>>> = {
  'Castelo de Leiria': [
    {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Castelo.jpg/800px-Castelo.jpg',
      alt: 'Fachada del castillo',
      credit: 'Autor del castillo',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Castelo.jpg',
    },
  ],
  'Sé de Leiria': [
    {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Se.jpg/800px-Se.jpg',
      alt: 'La catedral al atardecer',
      credit: 'Autora de la catedral',
      license: 'CC0',
    },
  ],
};

/** The id the mocked POST /media gives every photo (22 base64url characters). */
const PHOTO_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

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

/** The card POST /content/generate would write for a place, with the photos of PHOTOS. */
const cardFor = (name: string) => ({
  locale: 'es',
  title: `Ficha de ${name}`,
  summary: `Dato sobre ${name}: se fundó mucho antes de lo que parece.`,
  facts: [`Hecho de ${name}`],
  images: PHOTOS[name] ?? [],
  sources: [{ title: 'Leiria en Wikipedia', url: 'https://es.wikipedia.org/wiki/Leiria' }],
  generated: {
    by: 'ai',
    model: 'claude-sonnet-5-5',
    promptVersion: 'card-1',
    at: '2026-10-08T10:00:00.000Z',
  },
  status: 'approved',
});

/** The AI guide: off (every place keeps its basic sheet) or writing a card, with photos, for each place. */
async function mockAi(page: Page, { off = false } = {}) {
  await page.route(/\/api\/v1\/suggest\/places$/, (route) =>
    route.fulfill({ status: 503, json: { code: 'ai_unavailable' } }),
  );
  await page.route(/\/api\/v1\/content\/generate$/, (route) => {
    const body = route.request().postDataJSON() as { name: string };
    return off
      ? route.fulfill({ status: 503, json: { code: 'ai_unavailable' } })
      : route.fulfill({
          json: { content: cardFor(body.name), grounding: 'wikipedia', cached: false },
        });
  });
}

/** Every /api/v1/routes call: user routes are never read back, and writes are saved. Returns the writes. */
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
      status: request.method() === 'POST' ? 201 : 200,
      json: {
        id: (request.postDataJSON() as { spec: { id: string } }).spec.id,
        updatedAt: '2026-10-08T10:00:00.000Z',
      },
    });
  });
  return writes;
}

/** /runs and /analytics: refused, and nothing here may call them. */
async function refuseRunCalls(page: Page) {
  await page.route(/\/api\/v1\/(runs|analytics)/, (route) =>
    route.fulfill({ status: 503, json: { code: 'unavailable' } }),
  );
}

interface Upload {
  contentType: string | undefined;
  deviceId: string | undefined;
  bytes: Buffer;
}

/**
 * POST /media stores the photo under PHOTO_ID and says where it is; GET of that
 * address serves `photo` (what the cards on screen load). Returns the uploads.
 */
async function mockMedia(page: Page, photo: Buffer) {
  const uploads: Upload[] = [];
  await page.route('**/api/v1/media', (route) => {
    const request = route.request();
    const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
    uploads.push({
      contentType: request.headers()['content-type'],
      deviceId: request.headers()['x-device-id'],
      bytes,
    });
    const url = `${new URL(request.url()).origin}/api/v1/media/${PHOTO_ID}.jpg`;
    return route.fulfill({
      status: 201,
      json: { id: PHOTO_ID, url, width: 1600, height: 1200, bytes: bytes.length },
    });
  });
  await page.route('**/api/v1/media/*.jpg', (route) =>
    route.fulfill({ contentType: 'image/jpeg', body: photo }),
  );
  // The photos of the cards, from Wikimedia, are the same picture here.
  await page.route('https://upload.wikimedia.org/**', (route) =>
    route.fulfill({ contentType: 'image/jpeg', body: photo }),
  );
  return uploads;
}

/** The bits of a canvas used in the page (e2e files are type-checked without the DOM lib). */
interface PageCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): {
    fillStyle: string;
    fillRect(x: number, y: number, width: number, height: number): void;
  } | null;
  toDataURL(type: string, quality: number): string;
}

/** A JPEG of this size, drawn by the browser (two colours, so it is no flat file). */
async function jpegOf(page: Page, width: number, height: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    (size) => {
      const { document } = globalThis as unknown as {
        document: { createElement(tag: 'canvas'): PageCanvas };
      };
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('The page has no canvas');
      context.fillStyle = '#1e4fa3';
      context.fillRect(0, 0, size.width, size.height);
      context.fillStyle = '#c4491f';
      context.fillRect(0, 0, size.width / 2, size.height / 2);
      return canvas.toDataURL('image/jpeg', 0.9);
    },
    { width, height },
  );
  return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
}

/** The size of a JPEG, from its start-of-frame marker. */
function jpegSize(jpeg: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset + 9 < jpeg.length) {
    if (jpeg[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = jpeg[offset + 1] as number;
    // SOF0 to SOF15, but not DHT (C4), JPG (C8) or DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: jpeg.readUInt16BE(offset + 5), width: jpeg.readUInt16BE(offset + 7) };
    }
    offset += 2 + jpeg.readUInt16BE(offset + 2);
  }
  throw new Error('That is not a JPEG');
}

/**
 * The same JPEG with an EXIF segment saying how a viewer must turn it (6: a quarter turn
 * clockwise, the way a phone held upright stores its photos), placed first, like a camera does.
 */
function withOrientation(jpeg: Buffer, orientation: number): Buffer {
  const exif = Buffer.from(
    [
      'ffe1 0022', // APP1, 34 bytes counting its own length
      '457869660000', // "Exif\0\0"
      '4d4d 002a 00000008', // big-endian TIFF header, first IFD at offset 8
      '0001', // one entry:
      `0112 0003 00000001 ${orientation.toString(16).padStart(4, '0')} 0000`, // Orientation
      '00000000', // no other IFD
    ]
      .join('')
      .replaceAll(' ', ''),
    'hex',
  );
  return Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
}

const placeList = (page: Page) =>
  page.getByRole('list', { name: 'Lugares de la ruta' }).getByRole('listitem');

/** C1: a name (and the interests, if any), the rest as it comes, then on to C2. */
async function fillDetails(page: Page, name: string, interests: string[] = []) {
  await page.goto('/create');
  await expect(page).toHaveURL(/\/create\/details$/);
  await page.getByRole('textbox', { name: 'Nombre de la ruta' }).fill(name);
  for (const interest of interests) await page.getByRole('button', { name: interest }).click();
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

/** C2 → C3 → C4. With the AI off the user takes the basic cards; with it on, the cards get ready first. */
async function continueToReview(page: Page, { ai = false } = {}) {
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/content$/);
  if (ai) await expect(page.getByText('2 de 2 fichas listas')).toBeVisible();
  else await page.getByRole('button', { name: 'Usar fichas básicas', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/\/create\/review$/);
}

/** The cover as the C4 card previews it, and as the cards of the route show it. */
const preview = (page: Page) => page.locator('.cover-card__preview');

/** The width and height of a box, to prove the cover keeps its 16:9 whatever is in it. */
async function sizeOf(box: Locator) {
  const rect = await box.boundingBox();
  if (!rect) throw new Error('The cover is not on screen');
  return { width: Math.round(rect.width), height: Math.round(rect.height) };
}

interface Posted {
  spec: {
    id: string;
    name: string;
    locale: string;
    meta?: { interests: string[] };
    coverImage?: Record<string, unknown>;
  };
  contents: Record<string, { es: { images: Array<Record<string, unknown>> } }>;
}
const bodyOf = (request: Request) => request.postDataJSON() as Posted;

test.beforeEach(async ({ page }) => {
  await withoutMap(page);
  await mockGeo(page);
});

test('a photo of the phone becomes the cover: scaled on the device, saved with the route and shown on its card', async ({
  page,
}) => {
  await setup(page);
  await refuseRunCalls(page);
  await mockAi(page, { off: true });
  const writes = await mockRouteApi(page);
  await fillDetails(page, 'Mi paseo con foto');
  const photo = await jpegOf(page, 2400, 1800);
  const uploads = await mockMedia(page, await jpegOf(page, 640, 360));
  for (const place of PLACES) await addPlace(page, place);
  await continueToReview(page);

  // C4: no photo yet, so the card says what stands in for it; it has the box it will keep.
  await expect(page.getByRole('heading', { name: 'Portada' })).toBeVisible();
  await expect(preview(page)).toHaveAttribute('data-cover', 'pattern');
  await expect(
    page.getByText('Sin foto, la ruta usa el patrón de azulejos de Rumbo.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar portada' })).toHaveCount(0);
  const before = await sizeOf(preview(page));
  expect(Math.abs(before.width / before.height - 16 / 9)).toBeLessThan(0.02);

  // The phone's picker is a file input: the photo is sent right away.
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(preview(page)).toHaveAttribute('data-cover', 'photo');
  const cover = preview(page).getByRole('img', { name: 'Mi paseo con foto' });
  const url = `${new URL(page.url()).origin}/api/v1/media/${PHOTO_ID}.jpg`;
  await expect(cover).toHaveAttribute('src', url);
  await expect(page.getByRole('button', { name: 'Quitar portada' })).toBeVisible();
  // Nothing moved when the photo arrived.
  expect(await sizeOf(preview(page))).toEqual(before);

  // One upload: a JPEG of at most 1600 px on its longest side, with the device id.
  expect(uploads).toHaveLength(1);
  const sent = uploads[0] as Upload;
  expect(sent.contentType).toBe('image/jpeg');
  expect(sent.deviceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(jpegSize(photo)).toEqual({ width: 2400, height: 1800 });
  expect(jpegSize(sent.bytes)).toEqual({ width: 1600, height: 1200 });
  expect(sent.bytes.length).toBeLessThan(photo.length * 2);
  expect(writes).toHaveLength(0);

  // Saved: the route carries the address and an alt text made from its name.
  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);
  await until(page, async () => writes.length > 0, 10);
  const post = bodyOf(writes[0] as Request);
  expect(post.spec.coverImage).toEqual({ url, alt: { es: 'Mi paseo con foto' } });

  // The last screen and My routes show the photo on the card of the route.
  const done = page.locator('[data-cover]');
  await expect(done).toHaveAttribute('data-cover', 'photo');
  await page.getByRole('button', { name: 'Ver mis rutas' }).click();
  await expect(page).toHaveURL(/\/my-routes$/);
  const card = page.getByRole('link', { name: /Mi paseo con foto/ });
  const image = card.locator('img');
  await expect(image).toHaveAttribute('src', url);
  await expect(image).toHaveAttribute('alt', 'Mi paseo con foto');
  await expect
    .poll(() =>
      image.evaluate((element) => (element as unknown as { naturalWidth: number }).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(card.locator('[data-cover]')).toHaveAttribute('data-cover', 'photo');
});

test('a photo taken in portrait is uploaded upright, scaled and without its metadata', async ({
  page,
}) => {
  await setup(page);
  await refuseRunCalls(page);
  await mockAi(page, { off: true });
  await mockRouteApi(page);
  await fillDetails(page, 'Foto vertical');
  // As a phone stores it: 2400 × 1800 pixels and a note that says "turn it a quarter".
  const sideways = withOrientation(await jpegOf(page, 2400, 1800), 6);
  expect(jpegSize(sideways)).toEqual({ width: 2400, height: 1800 });
  expect(sideways.includes(Buffer.from('Exif'))).toBe(true);
  const uploads = await mockMedia(page, await jpegOf(page, 640, 360));
  for (const place of PLACES) await addPlace(page, place);
  await continueToReview(page);

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'IMG_0002.jpg', mimeType: 'image/jpeg', buffer: sideways });
  await expect(preview(page)).toHaveAttribute('data-cover', 'photo');

  // What leaves the phone is the photo as it looks: 1800 × 2400 scaled to fit 1600, and no EXIF at all.
  expect(uploads).toHaveLength(1);
  const sent = (uploads[0] as Upload).bytes;
  expect(jpegSize(sent)).toEqual({ width: 1200, height: 1600 });
  expect(sent.includes(Buffer.from('Exif'))).toBe(false);
});

test('a photo of one of the places becomes the cover, exactly as its card has it', async ({
  page,
}) => {
  await setup(page);
  await refuseRunCalls(page);
  await mockAi(page);
  const writes = await mockRouteApi(page);
  await fillDetails(page, 'Leiria con fichas');
  const uploads = await mockMedia(page, await jpegOf(page, 640, 360));
  for (const place of PLACES) await addPlace(page, place);
  await continueToReview(page, { ai: true });

  // The sheet lists the photos of the cards, with the place and the credit of each.
  await expect(page.getByText('2 fichas con IA', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Elegir de tus lugares' }).click();
  const sheet = page.getByRole('dialog', { name: 'Fotos de tus lugares' });
  await expect(sheet.getByRole('button')).toHaveCount(3);
  await expect(sheet.getByText('Foto: Autor del castillo / CC BY-SA 4.0')).toBeVisible();
  await expect(sheet.getByText('Foto: Autora de la catedral / CC0')).toBeVisible();
  await sheet.getByRole('button', { name: /Sé de Leiria/ }).click();
  await expect(sheet).toBeHidden();

  // It is the cover; the licence's credit shows under the preview.
  await expect(preview(page)).toHaveAttribute('data-cover', 'photo');
  const cathedral = (PHOTOS['Sé de Leiria'] ?? [])[0] ?? {};
  await expect(
    preview(page).getByRole('img', { name: 'La catedral al atardecer' }),
  ).toHaveAttribute('src', cathedral['url'] ?? '');
  await expect(page.getByText('Foto: Autora de la catedral / CC0')).toBeVisible();

  // Removing it brings the stand-in back; choosing again, the photo.
  await page.getByRole('button', { name: 'Quitar portada' }).click();
  await expect(preview(page)).toHaveAttribute('data-cover', 'pattern');
  await expect(page.getByRole('button', { name: 'Quitar portada' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Elegir de tus lugares' }).click();
  await sheet.getByRole('button', { name: /Castelo de Leiria/ }).click();
  await expect(preview(page).getByRole('img', { name: 'Fachada del castillo' })).toBeVisible();

  // The route is saved with that photo, the very object its card holds, and no upload happened.
  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);
  await until(page, async () => writes.length > 0, 10);
  const post = bodyOf(writes[0] as Request);
  const castle = (PHOTOS['Castelo de Leiria'] ?? [])[0];
  expect(post.spec.coverImage).toEqual(castle);
  const shipped = Object.values(post.contents).flatMap((card) => card.es.images);
  expect(shipped).toContainEqual(post.spec.coverImage);
  expect(uploads).toHaveLength(0);
});

test('a route without a cover wears the illustration of its first interest, and a curated one its photo', async ({
  page,
}) => {
  await setup(page);
  await refuseRunCalls(page);
  await mockAi(page, { off: true });
  const writes = await mockRouteApi(page);
  await fillDetails(page, 'Leiria histórica y sabrosa', ['Gastronomía', 'Historia']);
  for (const place of PLACES) await addPlace(page, place);
  await continueToReview(page);

  // C4: the interests come in the app's order, so history is the first.
  await expect(preview(page)).toHaveAttribute('data-cover', 'illustration');
  await expect(preview(page)).toHaveAttribute('data-interest', 'history');
  await expect(page.getByText('Sin foto, la ruta usa esta ilustración.')).toBeVisible();
  // Decorative: a screen reader finds no picture there.
  await expect(preview(page).locator('svg.cover__art')).toHaveAttribute('aria-hidden', 'true');
  await expect(preview(page).getByRole('img')).toHaveCount(0);

  await page.getByRole('button', { name: 'Guardar ruta' }).click();
  await expect(page).toHaveURL(/\/create\/done$/);
  await until(page, async () => writes.length > 0, 10);
  const post = bodyOf(writes[0] as Request);
  expect(post.spec.coverImage).toBeUndefined();
  expect(post.spec.meta?.interests).toEqual(['history', 'food']);

  // The card of the route, on the last screen and in My routes.
  await expect(page.locator('[data-cover="illustration"][data-interest="history"]')).toBeVisible();
  await page.getByRole('button', { name: 'Ver mis rutas' }).click();
  const card = page.getByRole('link', { name: /Leiria histórica y sabrosa/ });
  await expect(card.locator('[data-cover="illustration"]')).toHaveAttribute(
    'data-interest',
    'history',
  );
  // Its badges and its title are still what the card is called by.
  await expect(card.getByText('Creada por ti')).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Leiria histórica y sabrosa' })).toBeVisible();

  // Explore: the curated route has a cover photo of its own (the castle, from Wikimedia, served
  // here by the test), which wins over its interests' illustration.
  const castle = await jpegOf(page, 160, 90);
  await page.route('https://upload.wikimedia.org/**', (route) =>
    route.fulfill({ contentType: 'image/jpeg', body: castle }),
  );
  await page.goto('/');
  await expect(page.locator('a[href="/routes/leiria-historica"] [data-cover]')).toHaveAttribute(
    'data-cover',
    'photo',
  );
  await expect(page.locator(`a[href="/routes/${post.spec.id}"] [data-cover]`)).toHaveAttribute(
    'data-interest',
    'history',
  );
});
