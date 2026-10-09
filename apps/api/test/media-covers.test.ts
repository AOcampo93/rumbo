import { createHash, randomBytes } from 'node:crypto';
import { contentHashInput, type GeneratedCard } from '@rumbo/api-contract';
import { buildRouteSpec } from '@rumbo/route-builder';
import type { MediaRef, RouteSpec } from '@rumbo/route-spec';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aiContents, media, routes } from '../src/db/schema.js';
import { seedCuratedRoutes } from '../src/db/seed.js';
import { UNUSED_PHOTO_HOURS, runMediaCleanup } from '../src/media/cleanup.js';
import { type Api, create, owner, read, replace, routeRow, stranger } from './community-helpers.js';
import {
  CURATED,
  DEVICE,
  OTHER_DEVICE,
  OTHER_TOKEN,
  resetDatabase,
  setupApi,
  TOKEN,
  userRoute,
} from './helpers.js';
import { download, insertPhoto, photoRow, storePhoto } from './media-helpers.js';
import { ADMIN_TOKEN } from './push-fakes.js';

// A route's cover (phase 7.3, ADR 0005): the user's own photo, which the
// server checks and attaches in the same transaction that writes the route,
// or one of the photos of the route's own cards.

const ID = 'leiria-a-pe-abc123defg';
const OTHER_ID = 'outra-rota-abc123defg';
const ORIGIN = 'https://rumbo.arturoocampo.com';
const HOUR = 3_600_000;

let api: Api;
beforeAll(async () => {
  api = await setupApi({ adminToken: ADMIN_TOKEN });
});
afterAll(() => api.close());
beforeEach(async () => {
  await resetDatabase(api.database);
  await seedCuratedRoutes(api.db, CURATED);
});

/** The route of `userRoute()` with this cover. */
const covered = (url: string | undefined, id = ID): RouteSpec => ({
  ...userRoute(id),
  ...(url ? { coverImage: { url, alt: 'Una mañana en Leiria' } } : {}),
});
const refused = (path = 'spec.coverImage') => ({
  code: 'unverified_content',
  details: [{ path, message: expect.any(String) }],
});
const photoUrl = (id: string, origin = ORIGIN) => `${origin}/api/v1/media/${id}.jpg`;

/** PUT /routes/:id with the owner's token, for routes that carry cards. */
const putBundle = (id: string, spec: RouteSpec, contents: object) =>
  api.app.inject({
    method: 'PUT',
    url: `/api/v1/routes/${id}`,
    headers: { 'x-edit-token': TOKEN },
    payload: { spec, contents },
  });

/** What the server keeps of a photo: the route it belongs to and since when nobody uses it. */
async function stateOf(id: string) {
  const row = await photoRow(api, id);
  return row ? { routeId: row.routeId, unused: row.unusedSince !== null } : undefined;
}

describe('a route whose cover is a photo of its own', () => {
  it('is stored with the photo attached to it (POST)', async () => {
    const photo = await storePhoto(api);
    expect(await stateOf(photo.id)).toEqual({ routeId: null, unused: false });

    const res = await create(api, ID, { spec: covered(photo.url) });
    expect(res.statusCode, res.body).toBe(201);
    expect(await stateOf(photo.id)).toEqual({ routeId: ID, unused: false });
    const stored = await routeRow(api, ID);
    expect(stored?.coverImage).toEqual({ url: photo.url, alt: 'Una mañana en Leiria' });
    expect((await read(api, ID, { 'x-edit-token': TOKEN })).json().spec.coverImage).toEqual({
      url: photo.url,
      alt: 'Una mañana en Leiria',
    });
  });

  it('is stored with the photo attached to it (PUT of a route that had none)', async () => {
    expect((await create(api, ID)).statusCode).toBe(201);
    const photo = await storePhoto(api);
    const res = await replace(api, ID, { spec: covered(photo.url) });
    expect(res.statusCode, res.body).toBe(200);
    expect(await stateOf(photo.id)).toEqual({ routeId: ID, unused: false });
  });

  it('keeps the photo when the same cover is sent again, by a PUT or a POST repeated by its owner', async () => {
    const photo = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(photo.url) })).statusCode).toBe(201);
    expect((await replace(api, ID, { spec: covered(photo.url) })).statusCode).toBe(200);
    expect((await create(api, ID, { spec: covered(photo.url) })).statusCode).toBe(200);
    expect(await stateOf(photo.id)).toEqual({ routeId: ID, unused: false });
    expect(await api.db.select().from(media)).toHaveLength(1);
  });

  it('may be private or public: the photo belongs to the route either way', async () => {
    const photo = await storePhoto(api);
    const res = await create(api, ID, { spec: covered(photo.url), visibility: 'public' });
    expect(res.statusCode).toBe(201);
    expect((await stateOf(photo.id))?.routeId).toBe(ID);
  });

  it('may not claim a credit or a licence for it: that is invalid_route, and the photo stays free', async () => {
    const photo = await storePhoto(api);
    const spec = {
      ...covered(photo.url),
      coverImage: { url: photo.url, alt: 'x', credit: 'Yo', license: 'CC0' },
    };
    const res = await create(api, ID, { spec });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('invalid_route');
    expect(res.json().details.map((detail: { path: string }) => detail.path)).toEqual([
      'spec.coverImage.credit',
      'spec.coverImage.license',
    ]);
    expect(await stateOf(photo.id)).toEqual({ routeId: null, unused: false });
    expect(await routeRow(api, ID)).toBeUndefined();
  });

  it('may not be an address from anywhere else: invalid_route, as before this phase', async () => {
    const res = await create(api, ID, { spec: covered('https://example.com/pixel.png') });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('invalid_route');
  });
});

describe('the photo has to be the route owner’s, from this server, and free', () => {
  it.each([
    ['another origin', (id: string) => photoUrl(id, 'https://evil.example')],
    ['the same host in http', (id: string) => photoUrl(id, 'http://rumbo.arturoocampo.com')],
    ['the same host on another port', (id: string) => photoUrl(id, `${ORIGIN}:8443`)],
    ['the same host in capitals', (id: string) => photoUrl(id, 'https://RUMBO.arturoocampo.com')],
    ['a host that only starts like it', (id: string) => photoUrl(id, `${ORIGIN}.evil.example`)],
    [
      'the right host as a subdomain',
      (id: string) => photoUrl(id, 'https://x.rumbo.arturoocampo.com'),
    ],
  ])(
    'refuses a photo at %s, even one that exists: 422 unverified_content',
    async (_name, address) => {
      const photo = await storePhoto(api);
      const post = await create(api, ID, { spec: covered(address(photo.id)) });
      expect(post.statusCode).toBe(422);
      expect(post.json()).toEqual(refused());
      expect(post.headers['cache-control']).toBe('no-store');
      expect(await routeRow(api, ID)).toBeUndefined();

      expect((await create(api, ID)).statusCode).toBe(201);
      const put = await replace(api, ID, { spec: covered(address(photo.id)) });
      expect(put.statusCode).toBe(422);
      expect(put.json()).toEqual(refused());
      expect(await stateOf(photo.id)).toEqual({ routeId: null, unused: false });
    },
  );

  it('refuses a photo that does not exist, or no longer does', async () => {
    const unknown = photoUrl(randomBytes(16).toString('base64url'));
    const post = await create(api, ID, { spec: covered(unknown) });
    expect(post.statusCode).toBe(422);
    expect(post.json()).toEqual(refused());
    expect(await routeRow(api, ID)).toBeUndefined();

    const gone = await storePhoto(api);
    await api.db.delete(media).where(eq(media.id, gone.id));
    expect((await create(api, ID, { spec: covered(gone.url) })).statusCode).toBe(422);
  });

  it('refuses another device’s photo, on a POST and on a PUT', async () => {
    const theirs = await storePhoto(api, { 'x-device-id': OTHER_DEVICE });
    const post = await create(api, ID, { spec: covered(theirs.url) });
    expect(post.statusCode).toBe(422);
    expect(post.json()).toEqual(refused());
    expect(await routeRow(api, ID)).toBeUndefined();

    expect((await create(api, ID)).statusCode).toBe(201);
    const put = await replace(api, ID, { spec: covered(theirs.url) });
    expect(put.statusCode).toBe(422);
    expect(put.json()).toEqual(refused());
    expect(await stateOf(theirs.id)).toEqual({ routeId: null, unused: false });

    // Their own device is another matter.
    const res = await create(api, OTHER_ID, {
      spec: covered(theirs.url, OTHER_ID),
      headers: stranger,
    });
    expect(res.statusCode).toBe(201);
    expect((await stateOf(theirs.id))?.routeId).toBe(OTHER_ID);
  });

  it('knows the owner of a PUT as the route’s, not as whoever sends the header', async () => {
    const mine = await storePhoto(api);
    const theirs = await storePhoto(api, { 'x-device-id': OTHER_DEVICE });
    expect((await create(api, ID)).statusCode).toBe(201);
    // The owner's token with another device's header: the photo of the stored owner is what counts.
    const asThem = await replace(api, ID, {
      spec: covered(theirs.url),
      headers: { 'x-edit-token': TOKEN, 'x-device-id': OTHER_DEVICE },
    });
    expect(asThem.statusCode).toBe(422);
    const noHeader = await replace(api, ID, { spec: covered(mine.url) });
    expect(noHeader.statusCode).toBe(200);
    const lying = await replace(api, ID, {
      spec: covered(mine.url),
      headers: { 'x-edit-token': TOKEN, 'x-device-id': OTHER_DEVICE },
    });
    expect(lying.statusCode).toBe(200);
    expect(await stateOf(mine.id)).toEqual({ routeId: ID, unused: false });
  });

  it('compares devices as the database does: a header in capitals is the same device', async () => {
    const photo = await storePhoto(api, { 'x-device-id': DEVICE.toUpperCase() });
    expect((await photoRow(api, photo.id))?.deviceId).toBe(DEVICE);
    const res = await create(api, ID, {
      spec: covered(photo.url),
      headers: { 'x-edit-token': TOKEN, 'x-device-id': DEVICE.toUpperCase() },
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('refuses a photo that another route uses, and leaves that route its photo', async () => {
    const photo = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(photo.url) })).statusCode).toBe(201);

    const post = await create(api, OTHER_ID, { spec: covered(photo.url, OTHER_ID) });
    expect(post.statusCode).toBe(422);
    expect(post.json()).toEqual(refused());
    expect(await routeRow(api, OTHER_ID)).toBeUndefined();

    expect((await create(api, OTHER_ID)).statusCode).toBe(201);
    const put = await replace(api, OTHER_ID, { spec: covered(photo.url, OTHER_ID) });
    expect(put.statusCode).toBe(422);
    expect(put.json()).toEqual(refused());
    expect((await routeRow(api, OTHER_ID))?.coverImage).toBeNull();
    expect(await stateOf(photo.id)).toEqual({ routeId: ID, unused: false });
  });

  it('gives a photo claimed by two routes at once to one of them', async () => {
    const photo = await storePhoto(api);
    const answers = await Promise.all([
      create(api, ID, { spec: covered(photo.url) }),
      create(api, OTHER_ID, { spec: covered(photo.url, OTHER_ID) }),
    ]);
    expect(answers.map((res) => res.statusCode).sort()).toEqual([201, 422]);
    const winner = answers[0]?.statusCode === 201 ? ID : OTHER_ID;
    const loser = winner === ID ? OTHER_ID : ID;
    expect(await stateOf(photo.id)).toEqual({ routeId: winner, unused: false });
    expect(await routeRow(api, loser)).toBeUndefined();
  });

  it('undoes the whole write when the photo is refused: the route stays as it was', async () => {
    const first = await storePhoto(api);
    const spec = covered(first.url);
    expect((await create(api, ID, { spec })).statusCode).toBe(201);
    const before = await routeRow(api, ID);

    const taken = await storePhoto(api);
    expect((await create(api, OTHER_ID, { spec: covered(taken.url, OTHER_ID) })).statusCode).toBe(
      201,
    );
    const changed = { ...covered(taken.url), name: 'Leiria renomeada' };
    const res = await replace(api, ID, { spec: changed });
    expect(res.statusCode).toBe(422);
    const after = await routeRow(api, ID);
    expect(after?.spec).toEqual(before?.spec);
    expect(after?.name).toBe(before?.name);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(await stateOf(first.id)).toEqual({ routeId: ID, unused: false });
    expect(await stateOf(taken.id)).toEqual({ routeId: OTHER_ID, unused: false });
  });

  it('does not tell a photo that is somebody else’s from one that does not exist', async () => {
    const theirs = await storePhoto(api, { 'x-device-id': OTHER_DEVICE });
    const a = await create(api, ID, { spec: covered(theirs.url) });
    const b = await create(api, ID, {
      spec: covered(photoUrl(randomBytes(16).toString('base64url'))),
    });
    expect(a.body).toBe(b.body);
  });

  it('checks a stranger’s write after the route’s own rules: wrong token 403, taken id 409', async () => {
    const photo = await storePhoto(api);
    expect((await create(api, ID)).statusCode).toBe(201);
    const wrong = await replace(api, ID, {
      spec: covered(photo.url),
      headers: { 'x-edit-token': OTHER_TOKEN },
    });
    expect(wrong.statusCode).toBe(403);
    const taken = await create(api, ID, { spec: covered(photo.url), headers: stranger });
    expect(taken.statusCode).toBe(409);
    expect(await stateOf(photo.id)).toEqual({ routeId: null, unused: false });
  });
});

describe('changing a route’s cover', () => {
  it('releases the photo it had and attaches the new one', async () => {
    const a = await storePhoto(api);
    const b = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(a.url) })).statusCode).toBe(201);
    const before = Date.now();
    expect((await replace(api, ID, { spec: covered(b.url) })).statusCode).toBe(200);

    expect(await stateOf(b.id)).toEqual({ routeId: ID, unused: false });
    expect(await stateOf(a.id)).toEqual({ routeId: null, unused: true });
    const released = (await photoRow(api, a.id))?.unusedSince as Date;
    expect(released.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(released.getTime()).toBeLessThanOrEqual(Date.now());
    // Released, not deleted: it is still served until the cleanup comes.
    expect((await download(api, `${a.id}.jpg`)).statusCode).toBe(200);
  });

  it('releases the photo when the cover is taken away or becomes a card’s photo', async () => {
    const a = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(a.url) })).statusCode).toBe(201);
    expect((await replace(api, ID, { spec: covered(undefined) })).statusCode).toBe(200);
    expect(await stateOf(a.id)).toEqual({ routeId: null, unused: true });
    expect((await routeRow(api, ID))?.coverImage).toBeNull();

    // Another time, to a card's photo.
    const b = await storePhoto(api);
    expect((await replace(api, ID, { spec: covered(b.url) })).statusCode).toBe(200);
    expect(await stateOf(b.id)).toEqual({ routeId: ID, unused: false });
    const { spec, contents } = await routeWithCard(CARD_PHOTO);
    const res = await putBundle(ID, spec, contents);
    expect(res.statusCode, res.body).toBe(200);
    expect(await stateOf(b.id)).toEqual({ routeId: null, unused: true });
    expect((await routeRow(api, ID))?.coverImage).toEqual(CARD_PHOTO);
  });

  it('lets a released photo come back within the day, and counts its unused time again from the next release', async () => {
    const a = await storePhoto(api);
    const b = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(a.url) })).statusCode).toBe(201);
    expect((await replace(api, ID, { spec: covered(b.url) })).statusCode).toBe(200);
    expect((await replace(api, ID, { spec: covered(a.url) })).statusCode).toBe(200);
    expect(await stateOf(a.id)).toEqual({ routeId: ID, unused: false });
    expect(await stateOf(b.id)).toEqual({ routeId: null, unused: true });
  });

  it('cannot bring back a photo the cleanup deleted', async () => {
    const a = await storePhoto(api);
    const b = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(a.url) })).statusCode).toBe(201);
    expect((await replace(api, ID, { spec: covered(b.url) })).statusCode).toBe(200);
    const later = () => Date.now() + (UNUSED_PHOTO_HOURS + 1) * HOUR;
    expect(await runMediaCleanup({ database: () => api.database, log: noLog, now: later })).toBe(1);
    expect(await photoRow(api, a.id)).toBeUndefined();
    const back = await replace(api, ID, { spec: covered(a.url) });
    expect(back.statusCode).toBe(422);
    expect(back.json()).toEqual(refused());
    expect(await stateOf(b.id)).toEqual({ routeId: ID, unused: false });
  });

  it('releases every other photo the route has, and only its own', async () => {
    const a = await storePhoto(api);
    const b = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(a.url) })).statusCode).toBe(201);
    // A route can't end up with two, but if it did, the next write puts it right.
    const extra = await insertPhoto(api, { routeId: ID });
    const otherRoutes = await storePhoto(api);
    expect(
      (await create(api, OTHER_ID, { spec: covered(otherRoutes.url, OTHER_ID) })).statusCode,
    ).toBe(201);

    expect((await replace(api, ID, { spec: covered(b.url) })).statusCode).toBe(200);
    expect(await stateOf(a.id)).toEqual({ routeId: null, unused: true });
    expect(await stateOf(extra)).toEqual({ routeId: null, unused: true });
    expect(await stateOf(b.id)).toEqual({ routeId: ID, unused: false });
    expect(await stateOf(otherRoutes.id)).toEqual({ routeId: OTHER_ID, unused: false });
  });

  it('keeps the photo it had when the write is refused (another token)', async () => {
    const a = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(a.url) })).statusCode).toBe(201);
    const res = await replace(api, ID, {
      spec: covered(undefined),
      headers: { 'x-edit-token': OTHER_TOKEN },
    });
    expect(res.statusCode).toBe(403);
    expect(await stateOf(a.id)).toEqual({ routeId: ID, unused: false });
  });
});

describe('a card’s photo as the cover', () => {
  it('needs nothing of the photos table: 201, and it releases a photo of its own', async () => {
    const { spec, contents } = await routeWithCard(CARD_PHOTO);
    const res = await api.app.inject({
      method: 'POST',
      url: '/api/v1/routes',
      headers: owner,
      payload: { spec, contents },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((await routeRow(api, spec.id))?.coverImage).toEqual(CARD_PHOTO);
    expect(await api.db.select().from(media)).toEqual([]);
  });

  it.each([
    [
      'another photo of Wikimedia',
      { ...CARD_PHOTO, url: 'https://upload.wikimedia.org/wikipedia/commons/9/99/Otra.jpg' },
    ],
    ['the card’s photo with another author', { ...CARD_PHOTO, credit: 'Someone else' }],
    ['the card’s photo without its licence', { ...CARD_PHOTO, license: undefined }],
  ])(
    'is refused when it is not exactly one of the route’s cards’ photos: %s',
    async (_name, cover) => {
      const { spec, contents } = await routeWithCard(JSON.parse(JSON.stringify(cover)) as MediaRef);
      const res = await api.app.inject({
        method: 'POST',
        url: '/api/v1/routes',
        headers: owner,
        payload: { spec, contents },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('invalid_route');
      expect(res.json().details).toMatchObject([{ path: 'spec.coverImage' }]);
      expect(await routeRow(api, spec.id)).toBeUndefined();
    },
  );
});

describe('deleting a route', () => {
  it('leaves its photo unattached, for the cleanup to delete a day later', async () => {
    const photo = await storePhoto(api);
    const other = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(photo.url) })).statusCode).toBe(201);
    expect((await create(api, OTHER_ID, { spec: covered(other.url, OTHER_ID) })).statusCode).toBe(
      201,
    );

    const before = Date.now();
    const res = await api.app.inject({
      method: 'DELETE',
      url: `/api/v1/routes/${ID}`,
      headers: { 'x-edit-token': TOKEN },
    });
    expect(res.statusCode).toBe(204);
    expect(await routeRow(api, ID)).toBeUndefined();
    expect(await stateOf(photo.id)).toEqual({ routeId: null, unused: true });
    expect(((await photoRow(api, photo.id))?.unusedSince as Date).getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    // The other route keeps its photo.
    expect(await stateOf(other.id)).toEqual({ routeId: OTHER_ID, unused: false });
    // For the day it stays, the address still works.
    expect((await download(api, `${photo.id}.jpg`)).statusCode).toBe(200);

    const inAnHour = () => Date.now() + HOUR;
    const tomorrow = () => Date.now() + (UNUSED_PHOTO_HOURS + 1) * HOUR;
    expect(await runMediaCleanup({ database: () => api.database, log: noLog, now: inAnHour })).toBe(
      0,
    );
    expect(await runMediaCleanup({ database: () => api.database, log: noLog, now: tomorrow })).toBe(
      1,
    );
    expect(await photoRow(api, photo.id)).toBeUndefined();
    expect(await photoRow(api, other.id)).toBeDefined();
  });

  it('keeps the photo of a route that was not deleted: wrong token, curated route', async () => {
    const photo = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(photo.url) })).statusCode).toBe(201);
    const wrong = await api.app.inject({
      method: 'DELETE',
      url: `/api/v1/routes/${ID}`,
      headers: { 'x-edit-token': OTHER_TOKEN },
    });
    expect(wrong.statusCode).toBe(403);
    expect(await stateOf(photo.id)).toEqual({ routeId: ID, unused: false });
  });

  it('is what the database does by itself too: a route that goes leaves its photos without a route', async () => {
    const photo = await storePhoto(api);
    expect((await create(api, ID, { spec: covered(photo.url) })).statusCode).toBe(201);
    await api.db.delete(routes).where(eq(routes.id, ID));
    // Never released: the cleanup counts its day from the upload.
    expect(await stateOf(photo.id)).toEqual({ routeId: null, unused: false });
  });
});

describe('a photo the operator deleted', () => {
  it('leaves the route with a cover that answers 404, which its owner may keep saving but nobody may take', async () => {
    const photo = await storePhoto(api);
    expect(
      (await create(api, ID, { spec: covered(photo.url), visibility: 'public' })).statusCode,
    ).toBe(201);
    const deleted = await api.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/media/${photo.id}`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(deleted.statusCode).toBe(204);

    // The route is as it was: the web shows an illustration for a cover it can't load.
    expect((await routeRow(api, ID))?.coverImage).toEqual({
      url: photo.url,
      alt: 'Una mañana en Leiria',
    });
    expect((await read(api, ID)).json().spec.coverImage.url).toBe(photo.url);
    expect((await download(api, `${photo.id}.jpg`)).statusCode).toBe(404);

    // Saving it again with the same cover is fine (its owner didn't delete it), and it is
    // still gone; another route can't take that address.
    expect((await replace(api, ID, { spec: covered(photo.url) })).statusCode).toBe(200);
    expect((await download(api, `${photo.id}.jpg`)).statusCode).toBe(404);
    const taken = await create(api, OTHER_ID, { spec: covered(photo.url, OTHER_ID) });
    expect(taken.statusCode).toBe(422);
    expect(taken.json()).toEqual(refused());
    // Once the owner drops it, it can't come back.
    expect((await replace(api, ID, { spec: covered(undefined) })).statusCode).toBe(200);
    const back = await replace(api, ID, { spec: covered(photo.url) });
    expect(back.statusCode).toBe(422);
    expect(back.json()).toEqual(refused());
  });
});

// ---------------------------------------------------------------------------

const noLog = { info: () => {}, error: () => {}, warn: () => {} } as unknown as Parameters<
  typeof runMediaCleanup
>[0]['log'];

/** A photo as Wikimedia cards carry them. */
const CARD_PHOTO = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/1/10/CASTELO_DE_LEIRIA.jpg',
  alt: 'Castillo de Leiría',
  credit: 'JMFH4778',
  license: 'CC BY-SA 3.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:CASTELO_DE_LEIRIA.jpg',
};

/**
 * A route of two places whose first has an AI card with CARD_PHOTO, stored the
 * way the pipeline stores it, and `cover` as the route's cover if it has one.
 */
async function routeWithCard(cover?: MediaRef): Promise<{ spec: RouteSpec; contents: object }> {
  const ref = 'card-castelo';
  const card: GeneratedCard = {
    locale: 'es',
    title: 'Castillo de Leiría',
    summary: 'Un castillo medieval sobre el río Lis.',
    facts: ['Monumento Nacional desde 1910.'],
    images: [CARD_PHOTO],
    sources: [
      {
        title: 'Castelo de Leiria - Wikipedia',
        url: 'https://pt.wikipedia.org/wiki/Castelo_de_Leiria',
      },
    ],
    generated: {
      by: 'ai',
      model: 'test-model',
      promptVersion: 'card-1',
      at: '2026-10-08T12:00:00.000Z',
    },
    status: 'approved',
  };
  await api.db.insert(aiContents).values({
    cacheKey: `Q2969701:es:card-1:${card.title}`,
    content: card,
    contentHash: createHash('sha256').update(contentHashInput(card)).digest('hex'),
    grounding: 'wikipedia',
  });
  const { spec } = buildRouteSpec(
    {
      name: 'Leiria com fichas',
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [
        {
          tempId: 'a',
          name: 'Castelo de Leiria',
          position: { lat: 39.747, lng: -8.81 },
          externalId: 'Q2969701',
          contentRef: ref,
        },
        { tempId: 'b', name: 'Sé de Leiria', position: { lat: 39.7441, lng: -8.8077 } },
      ],
    },
    { source: 'user', id: ID },
  );
  return {
    spec: { ...spec, ...(cover ? { coverImage: cover } : {}) },
    contents: { [ref]: { es: { ...card, id: ref } } },
  };
}
