import { createHash } from 'node:crypto';
import { contentHashInput, type GeneratedCard } from '@rumbo/api-contract';
import { buildRouteSpec } from '@rumbo/route-builder';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aiContents, routes } from '../src/db/schema.js';
import { scripted, wikimedia } from './ai-fakes.js';
import { DEVICE, resetDatabase, setupApi, TOKEN } from './helpers.js';

// The cards of a user route (PROJECT_PLAN §12, security): only cards the AI
// pipeline generated can be saved, found again by the SHA-256 of their text.

const ROUTE_ID = 'leiria-com-fichas-abc123defg';
const owner = { 'x-edit-token': TOKEN, 'x-device-id': DEVICE };

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => {
  api = await setupApi({}, { ai: scripted().ai, grounding: wikimedia() });
});
afterAll(() => api.close());
beforeEach(() => resetDatabase(api.database));

/** A route of two places whose first has a card named `ref`; the bundle carries `cards`. */
function routeWith(cards: Record<string, GeneratedCard>, ref = 'card-castelo') {
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
    { source: 'user', id: ROUTE_ID },
  );
  return {
    spec,
    contents: Object.fromEntries(
      Object.entries(cards).map(([key, card]) => [key, { es: { ...card, id: key } }]),
    ),
  };
}

const post = (bundle: unknown) =>
  api.app.inject({
    method: 'POST',
    url: '/api/v1/routes',
    payload: bundle as object,
    headers: owner,
  });
const put = (bundle: unknown) =>
  api.app.inject({
    method: 'PUT',
    url: `/api/v1/routes/${ROUTE_ID}`,
    payload: bundle as object,
    headers: { 'x-edit-token': TOKEN },
  });

/** The card as the pipeline stores it. */
async function generated(overrides: Partial<GeneratedCard> = {}): Promise<GeneratedCard> {
  const card: GeneratedCard = {
    locale: 'es',
    title: 'Castillo de Leiría',
    summary: 'Un castillo medieval sobre el río Lis.',
    facts: ['Monumento Nacional desde 1910.'],
    images: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/1/10/CASTELO_DE_LEIRIA.jpg',
        alt: 'Castillo de Leiría',
        credit: 'JMFH4778',
        license: 'CC BY-SA 3.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:CASTELO_DE_LEIRIA.jpg',
      },
    ],
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
    ...overrides,
  };
  await api.db.insert(aiContents).values({
    cacheKey: `Q2969701:es:card-1:${card.title}`,
    content: card,
    contentHash: createHash('sha256').update(contentHashInput(card)).digest('hex'),
    grounding: 'wikipedia',
  });
  return card;
}

describe('POST and PUT /api/v1/routes with cards', () => {
  it('store a route whose card the server generated, and give it back whole', async () => {
    const card = await generated();
    const bundle = routeWith({ 'card-castelo': card });
    const created = await post(bundle);
    expect(created.statusCode).toBe(201);
    const read = await api.app.inject({
      method: 'GET',
      url: `/api/v1/routes/${ROUTE_ID}`,
      headers: { 'x-edit-token': TOKEN },
    });
    expect(read.json().contents).toEqual({
      'card-castelo': { es: { ...card, id: 'card-castelo' } },
    });
    // The same card on an update; the id it is stored under is the client's to choose.
    expect((await put(bundle)).statusCode).toBe(200);
    const renamed = routeWith({ 'card-otro': card }, 'card-otro');
    expect((await put(renamed)).statusCode).toBe(200);
  });

  it('refuse a card that was not generated, 422 unverified_content, and store nothing', async () => {
    const real = await generated();
    const forged = { ...real, summary: 'Un castillo donde se esconde un tesoro.' };
    const res = await post(routeWith({ 'card-castelo': forged }));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      code: 'unverified_content',
      details: [{ path: 'contents.card-castelo.es', message: 'Not a card this server generated' }],
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await api.db.select().from(routes).where(eq(routes.id, ROUTE_ID))).toEqual([]);
  });

  it("refuse any change to a generated card: a fact, the sources, a photo's author, the time", async () => {
    const real = await generated();
    const changes: Array<Partial<GeneratedCard>> = [
      { title: 'Otro título' },
      { facts: [...real.facts, 'Un dato inventado.'] },
      { sources: [...real.sources, { title: 'Mi web', url: 'https://example.org/' }] },
      { images: real.images.map((image) => ({ ...image, credit: 'Someone else' })) },
      {
        generated: {
          ...(real.generated as object),
          at: '2026-10-09T12:00:00.000Z',
        } as GeneratedCard['generated'],
      },
      { status: 'draft' },
    ];
    for (const change of changes) {
      const res = await post(routeWith({ 'card-castelo': { ...real, ...change } }));
      expect(res.statusCode, JSON.stringify(change)).toBe(422);
      expect(res.json().code).toBe('unverified_content');
    }
  });

  it('list only the cards that are not generated ones', async () => {
    const real = await generated();
    const { spec } = routeWith({});
    const withTwo = {
      ...routeWith({ 'card-castelo': real, 'card-se': { ...real, title: 'Una Sé inventada' } }),
      spec: {
        ...spec,
        actions: {
          ...spec.actions,
          content_se: { type: 'ai_template', params: { contentRef: 'card-se' } },
        },
        points: spec.points.map((point) =>
          point.name === 'Sé de Leiria'
            ? { ...point, contentRef: 'card-se', triggers: { onEnter: 'content_se' } }
            : point,
        ),
      },
    };
    const res = await post(withTwo);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'unverified_content',
      details: [{ path: 'contents.card-se.es' }],
    });
  });

  it('check an update as well: the stored route stays as it was', async () => {
    const real = await generated();
    await post(routeWith({ 'card-castelo': real }));
    const res = await put(routeWith({ 'card-castelo': { ...real, summary: 'Nuevo texto.' } }));
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('unverified_content');
    const read = await api.app.inject({
      method: 'GET',
      url: `/api/v1/routes/${ROUTE_ID}`,
      headers: { 'x-edit-token': TOKEN },
    });
    expect(read.json().contents['card-castelo'].es.summary).toBe(real.summary);
  });

  it("look at a card's images first: a photo from anywhere but Wikimedia is invalid_route", async () => {
    const real = await generated();
    const elsewhere = {
      ...real,
      images: real.images.map((image) => ({ ...image, url: 'https://evil.example/tracker.png' })),
    };
    const res = await post(routeWith({ 'card-castelo': elsewhere }));
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('invalid_route');
  });

  it('find a card by its text, not by the time it was asked or the id it is stored under', async () => {
    const card = await generated();
    // The same card in another route, under another id.
    const res = await post(routeWith({ 'ficha-1': { ...card } }, 'ficha-1'));
    expect(res.statusCode).toBe(201);
  });

  it('keep taking routes without cards', async () => {
    // An ai_template action with no card to show is the route's mistake, not a missing proof.
    const missing = await post(routeWith({}, 'card-sin-ficha'));
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe('invalid_route');
    const { spec } = buildRouteSpec(
      {
        name: 'Sin fichas',
        locale: 'es',
        mode: 'free',
        activity: 'walk',
        places: [{ tempId: 'a', name: 'Sé de Leiria', position: { lat: 39.7441, lng: -8.8077 } }],
      },
      { source: 'user', id: 'sin-fichas-abc123defg' },
    );
    expect((await post({ spec, contents: {} })).statusCode).toBe(201);
  });
});
