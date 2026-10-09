import 'fake-indexeddb/auto';
import { checkUserRoute, type GeneratedCard } from '@rumbo/api-contract';
import { type MediaRef, validateRouteBundle } from '@rumbo/route-spec';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale } from '../src/i18n/index.ts';
import { getMyRoute, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { type CreatorDraft, useCreatorStore } from '../src/stores/creator.ts';
import { castle, cathedral, generated, json, river } from './create-fixtures.ts';

// The route's cover in the creator's draft (phase 7.3, ADR 0005): the user's
// own photo (kept by its address; the alt text follows the route's name) or a
// photo of one of the ready cards (kept exactly as the card has it, and only
// shipped while a ready card still has it). It is stored with the draft, read
// back when a saved route is edited, and never sent in a form the server would
// refuse: checkUserRoute is the server's rule, so the tests build against it.

/** The address of a photo this server stores (22 base64url characters and `.jpg`). */
const OWN = 'https://rumbo.test/api/v1/media/AAAAAAAAAAAAAAAAAAAAAA.jpg';
const OTHER_OWN = 'https://rumbo.test/api/v1/media/BBBBBBBBBBBBBBBBBBBBBB.jpg';

const photo = (name: string, overrides: Partial<MediaRef> = {}): MediaRef => ({
  url: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}.jpg/800px-${name}.jpg`,
  alt: `Foto de ${name}`,
  credit: `Autor de ${name}`,
  license: 'CC BY-SA 4.0',
  sourceUrl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
  ...overrides,
});
const CASTLE_PHOTO = photo('Castelo');
const CATHEDRAL_PHOTO = photo('Se');
const RIVER_PHOTO = photo('Lis');

let creator: ReturnType<typeof useCreatorStore> | null = null;
/** The photos the fake API gives each place's card, by name. */
let photos: Record<string, MediaRef[]> = {};
let asked: string[] = [];

/** The AI endpoint answers with a card carrying the photos of `photos`; the route upload is unavailable. */
function serve(): void {
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/content/generate')) return new Response(null, { status: 503 });
      const body = JSON.parse(init?.body as string) as { name: string };
      asked.push(body.name);
      return json(generated({ title: `Ficha de ${body.name}`, images: photos[body.name] ?? [] }));
    }),
  );
}

async function open(): Promise<ReturnType<typeof useCreatorStore>> {
  creator?.$dispose();
  setActivePinia(createPinia());
  creator = useCreatorStore();
  await creator.ready;
  return creator;
}

/** A named draft with the castle and the cathedral, their cards ready (with photos). */
async function started() {
  const store = await open();
  await store.ensureDraft();
  await store.update({ name: 'Leiria numa manhã' });
  await store.addPlace({ ...castle, tempId: 'castle' });
  await store.addPlace({ ...cathedral, tempId: 'cathedral' });
  await store.generateMissing();
  return store;
}

/** The route as the API would be sent it: ok only if the server's own rule for user routes is. */
function built(store: ReturnType<typeof useCreatorStore>) {
  const result = store.build();
  if (!result.ok) throw new Error('the draft is not a valid route');
  const bundle = { spec: result.spec, contents: result.contents };
  expect(validateRouteBundle(bundle).ok).toBe(true);
  expect(checkUserRoute(bundle)).toEqual([]);
  return result;
}

const stored = () => db.get<CreatorDraft>(KEYS.creatorDraft);

beforeEach(async () => {
  applyLocale('es');
  photos = {
    'Castelo de Leiria': [CASTLE_PHOTO],
    'Sé de Leiria': [CATHEDRAL_PHOTO],
    'Rio Lis': [RIVER_PHOTO],
  };
  serve();
  await Promise.all([
    db.del(KEYS.creatorDraft),
    db.del(KEYS.creatorDraftBackup),
    db.del(KEYS.myRoutes),
  ]);
});

afterEach(async () => {
  creator?.$dispose();
  creator = null;
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the cover in the draft', () => {
  it('starts without one', async () => {
    const store = await started();
    expect(store.draft?.cover).toBeUndefined();
    expect(store.coverImage).toBeNull();
    expect(built(store).spec.coverImage).toBeUndefined();
  });

  it("keeps the user's own photo by its address only, and it comes back after a reload", async () => {
    let store = await started();
    expect(await store.setCover({ type: 'own', url: OWN })).toBe(true);
    expect(store.draft?.cover).toEqual({ type: 'own', url: OWN });
    await store.flush();
    expect((await stored())?.cover).toEqual({ type: 'own', url: OWN });

    store = await open();
    expect(store.draft?.cover).toEqual({ type: 'own', url: OWN });
    expect(store.coverImage).toEqual({ url: OWN, alt: { es: 'Leiria numa manhã' } });
  });

  it("keeps a place's photo exactly as the card has it, and it comes back after a reload", async () => {
    let store = await started();
    await store.setCover({ type: 'card', image: CASTLE_PHOTO });
    await store.flush();
    expect((await stored())?.cover).toEqual({ type: 'card', image: CASTLE_PHOTO });

    store = await open();
    expect(store.draft?.cover).toEqual({ type: 'card', image: CASTLE_PHOTO });
    // The cards are in the draft too, so the photo is still the cover.
    expect(store.coverImage).toEqual(CASTLE_PHOTO);
  });

  it('copies the photo it is given: the card and the draft never share an object', async () => {
    const store = await started();
    const chosen = store.coverChoices[0]?.image as MediaRef;
    await store.setCover({ type: 'card', image: chosen });
    expect(store.draft?.cover).toEqual({ type: 'card', image: chosen });
    const kept = store.draft?.cover;
    expect(kept?.type === 'card' && kept.image).not.toBe(chosen);
  });

  it("refuses an own photo that is not one of the server's", async () => {
    const store = await started();
    for (const url of [
      'https://elsewhere.test/photo.jpg',
      `${OWN}?x=1`,
      'https://rumbo.test/api/v1/media/short.jpg',
      'javascript:alert(1)',
    ]) {
      expect(await store.setCover({ type: 'own', url })).toBe(false);
    }
    expect(store.draft?.cover).toBeUndefined();
  });

  it('removes it, and changing it replaces it', async () => {
    const store = await started();
    await store.setCover({ type: 'own', url: OWN });
    await store.setCover({ type: 'own', url: OTHER_OWN });
    expect(store.draft?.cover).toEqual({ type: 'own', url: OTHER_OWN });
    await store.setCover({ type: 'card', image: CASTLE_PHOTO });
    expect(store.draft?.cover?.type).toBe('card');
    expect(await store.setCover(null)).toBe(true);
    expect(store.draft?.cover).toBeUndefined();
    expect(store.coverImage).toBeNull();
    await store.flush();
    expect((await stored())?.cover).toBeUndefined();
  });

  it('has no cover to set before there is a draft', async () => {
    const store = await open();
    expect(await store.setCover({ type: 'own', url: OWN })).toBe(false);
    expect(await store.setCover(null)).toBe(false);
  });

  it('reads a draft from before covers as one without a cover, with nothing to repair', async () => {
    const raw = {
      v: 1,
      rev: 5,
      tabId: 'other-tab',
      editingId: null,
      idSuffix: 'abcdefghij',
      locale: 'es',
      name: 'Ruta antigua',
      mode: 'free',
      activity: 'walk',
      timeLimitMinutes: null,
      area: null,
      places: [{ ...castle, tempId: 'p1' }],
      updatedAt: '2026-10-08T09:00:00.000Z',
    };
    await db.set(KEYS.creatorDraft, raw);
    const store = await open();
    expect(store.draft).toMatchObject({ name: 'Ruta antigua' });
    expect(store.draft?.cover).toBeUndefined();
    expect(store.coverImage).toBeNull();
    expect(await db.get(KEYS.creatorDraftBackup)).toBeUndefined();
  });

  it.each([
    ["an own photo that is not the server's", { type: 'own', url: 'https://elsewhere.test/a.jpg' }],
    ['a photo of a card that is not a photo', { type: 'card', image: { url: 'nope' } }],
    ['a kind it does not know', { type: 'sticker', url: OWN }],
    ['something that is not a cover', 'portada.jpg'],
  ])('drops %s, keeping the original aside', async (_name, cover) => {
    const raw = {
      v: 1,
      rev: 5,
      tabId: 'other-tab',
      editingId: null,
      idSuffix: 'abcdefghij',
      locale: 'es',
      name: 'Ruta',
      mode: 'free',
      activity: 'walk',
      timeLimitMinutes: null,
      area: null,
      places: [{ ...castle, tempId: 'p1' }],
      cover,
      updatedAt: '2026-10-08T09:00:00.000Z',
    };
    await db.set(KEYS.creatorDraft, raw);
    const store = await open();
    expect(store.draft).toMatchObject({ name: 'Ruta' });
    expect(store.draft?.cover).toBeUndefined();
    expect(await db.get(KEYS.creatorDraftBackup)).toEqual(raw);
  });
});

describe('building the route with an own photo', () => {
  it("gets its alt from the route's name, in the route's language", async () => {
    const store = await started();
    await store.setCover({ type: 'own', url: OWN });
    const result = built(store);
    expect(result.spec.coverImage).toEqual({ url: OWN, alt: { es: 'Leiria numa manhã' } });
    expect(result.normalized.coverImage).toEqual({ url: OWN, alt: { es: 'Leiria numa manhã' } });
    // Nothing but url and alt: the server refuses credit or licence on an own photo.
    expect(Object.keys(result.spec.coverImage ?? {}).sort()).toEqual(['alt', 'url']);
    // The draft kept only the address.
    expect(store.draft?.cover).toEqual({ type: 'own', url: OWN });
  });

  it('follows the name when the route is renamed', async () => {
    const store = await started();
    await store.setCover({ type: 'own', url: OWN });
    await store.update({ name: '  Leiria,\tde noche  ' });
    expect(built(store).spec.coverImage).toEqual({ url: OWN, alt: { es: 'Leiria, de noche' } });
  });

  it("uses the route's own language, not the app's now", async () => {
    const store = await started();
    await store.setCover({ type: 'own', url: OWN });
    applyLocale('en');
    expect(built(store).spec.coverImage?.alt).toEqual({ es: 'Leiria numa manhã' });
  });

  it('is ignored by a route whose name is not there yet (it cannot be built anyway)', async () => {
    const store = await started();
    await store.setCover({ type: 'own', url: OWN });
    await store.update({ name: '   ' });
    expect(store.coverImage).toBeNull();
    expect(store.build().ok).toBe(false);
  });

  it('is saved with the route and sent with it', async () => {
    const store = await started();
    await store.setCover({ type: 'own', url: OWN });
    const id = await store.save();
    const record = await getMyRoute(id);
    expect(record?.bundle.spec.coverImage).toEqual({
      url: OWN,
      alt: { es: 'Leiria numa manhã' },
    });
  });
});

describe('building the route with a photo of a place', () => {
  it("ships exactly the card's photo, credit and licence included, and the card that has it", async () => {
    const store = await started();
    await store.setCover({ type: 'card', image: CATHEDRAL_PHOTO });
    const result = built(store);
    expect(result.spec.coverImage).toEqual(CATHEDRAL_PHOTO);
    const refs = store.draft?.places.map((place) => place.contentRef) ?? [];
    const images = refs.flatMap((ref) =>
      Object.values(result.contents[ref as string] ?? {}).flatMap((card) => card?.images ?? []),
    );
    expect(images).toContainEqual(result.spec.coverImage);
    expect(result.spec.coverImage).not.toBe(CATHEDRAL_PHOTO);
  });

  it('is saved with the route, and read back as the same cover when the route is edited', async () => {
    const store = await started();
    await store.setCover({ type: 'card', image: CASTLE_PHOTO });
    const id = await store.save();
    expect((await getMyRoute(id))?.bundle.spec.coverImage).toEqual(CASTLE_PHOTO);

    const again = await open();
    expect(await again.loadForEdit(id)).toBe(true);
    expect(again.draft?.cover).toEqual({ type: 'card', image: CASTLE_PHOTO });
    expect(again.coverImage).toEqual(CASTLE_PHOTO);
    expect(built(again).spec.coverImage).toEqual(CASTLE_PHOTO);
  });

  describe('drops the cover rather than send what the server would refuse', () => {
    async function withCastleCover() {
      const store = await started();
      await store.setCover({ type: 'card', image: CASTLE_PHOTO });
      expect(built(store).spec.coverImage).toEqual(CASTLE_PHOTO);
      return store;
    }

    it('when its card is regenerated with other photos', async () => {
      const store = await withCastleCover();
      photos['Castelo de Leiria'] = [photo('Castelo-otra')];
      await store.regenerateCard('castle');
      await store.cardsIdle();
      expect(store.cardOf('castle').status).toBe('ready');
      expect(store.coverImage).toBeNull();
      expect(built(store).spec.coverImage).toBeUndefined();
    });

    it('when the same photo comes back with another credit', async () => {
      const store = await withCastleCover();
      photos['Castelo de Leiria'] = [{ ...CASTLE_PHOTO, credit: 'Otra persona' }];
      await store.regenerateCard('castle');
      await store.cardsIdle();
      expect(built(store).spec.coverImage).toBeUndefined();
    });

    it('when its card is regenerated with the same photos, the cover stays', async () => {
      const store = await withCastleCover();
      await store.regenerateCard('castle');
      await store.cardsIdle();
      expect(built(store).spec.coverImage).toEqual(CASTLE_PHOTO);
    });

    it('when its place is removed', async () => {
      const store = await withCastleCover();
      await store.addPlace({ ...river, tempId: 'river' });
      await store.generateMissing();
      await store.removePlace('castle');
      expect(store.coverImage).toBeNull();
      expect(built(store).spec.coverImage).toBeUndefined();
    });

    it('when the basic card is chosen for its place', async () => {
      const store = await withCastleCover();
      await store.setBasicCard('castle');
      expect(store.coverImage).toBeNull();
      expect(built(store).spec.coverImage).toBeUndefined();
    });

    it('when its place shows something else on arrival, which has no card', async () => {
      const store = await withCastleCover();
      await store.updatePlace('castle', { arrival: { type: 'check' } });
      expect(built(store).spec.coverImage).toBeUndefined();
    });

    it('but keeps the choice in the draft, so a card that has the photo again brings it back', async () => {
      const store = await withCastleCover();
      await store.setBasicCard('castle');
      expect(store.draft?.cover).toEqual({ type: 'card', image: CASTLE_PHOTO });
      await store.regenerateCard('castle');
      await store.cardsIdle();
      expect(built(store).spec.coverImage).toEqual(CASTLE_PHOTO);
    });
  });

  it('never ships a photo the draft only claims: a cover that no card ever had', async () => {
    const store = await started();
    await store.setCover({ type: 'card', image: photo('Inventada') });
    expect(store.coverImage).toBeNull();
    expect(built(store).spec.coverImage).toBeUndefined();
  });
});

describe('editing a saved route', () => {
  it('takes its own photo as the cover, by its address, with the alt made again from the name', async () => {
    const first = await started();
    await first.setCover({ type: 'own', url: OWN });
    const id = await first.save();

    const store = await open();
    expect(await store.loadForEdit(id)).toBe(true);
    expect(store.draft?.cover).toEqual({ type: 'own', url: OWN });
    await store.update({ name: 'Leiria de tarde' });
    expect(built(store).spec.coverImage).toEqual({ url: OWN, alt: { es: 'Leiria de tarde' } });
  });

  it('has no cover to take when the route had none', async () => {
    const first = await started();
    const id = await first.save();
    const store = await open();
    await store.loadForEdit(id);
    expect(store.draft?.cover).toBeUndefined();
    expect(store.coverImage).toBeNull();
  });

  it('keeps the cover while the route is edited, and the new one replaces it', async () => {
    const first = await started();
    await first.setCover({ type: 'own', url: OWN });
    const id = await first.save();

    const store = await open();
    await store.loadForEdit(id);
    await store.setCover({ type: 'own', url: OTHER_OWN });
    await store.save();
    expect((await getMyRoute(id))?.bundle.spec.coverImage?.url).toBe(OTHER_OWN);

    const next = await open();
    await next.loadForEdit(id);
    await next.setCover(null);
    await next.save();
    expect((await getMyRoute(id))?.bundle.spec.coverImage).toBeUndefined();
  });
});

describe('the photos "Elegir de tus lugares" offers', () => {
  it('lists the photos of the ready cards, in route order, with the place of each', async () => {
    photos['Castelo de Leiria'] = [CASTLE_PHOTO, photo('Castelo-2')];
    const store = await started();
    expect(
      store.coverChoices.map((choice) => [choice.tempId, choice.place, choice.image.url]),
    ).toEqual([
      ['castle', 'Castelo de Leiria', CASTLE_PHOTO.url],
      ['castle', 'Castelo de Leiria', photo('Castelo-2').url],
      ['cathedral', 'Sé de Leiria', CATHEDRAL_PHOTO.url],
    ]);
    expect(store.coverChoices[0]?.image).toEqual(CASTLE_PHOTO);
  });

  it('lists a photo that two cards share once', async () => {
    photos['Sé de Leiria'] = [CASTLE_PHOTO, CATHEDRAL_PHOTO];
    const store = await started();
    expect(store.coverChoices.map((choice) => choice.image.url)).toEqual([
      CASTLE_PHOTO.url,
      CATHEDRAL_PHOTO.url,
    ]);
  });

  it('leaves out the cards that do not ship: basic, failing, waiting or of a place that shows something else', async () => {
    const store = await started();
    await store.addPlace({ ...river, tempId: 'river' });
    expect(store.coverChoices).toHaveLength(2);
    await store.setBasicCard('castle');
    expect(store.coverChoices.map((choice) => choice.tempId)).toEqual(['cathedral']);
    await store.updatePlace('cathedral', { arrival: { type: 'check' } });
    expect(store.coverChoices).toEqual([]);
  });

  it('is empty when the cards have no photos, or there is no draft', async () => {
    photos = {};
    const store = await started();
    expect(store.coverChoices).toEqual([]);
    const empty = await open();
    expect(empty.coverChoices).toEqual([]);
  });

  it('offers copies: changing one never reaches the card', async () => {
    const store = await started();
    const offered = store.coverChoices[0]?.image as MediaRef;
    (offered as { credit?: string }).credit = 'Tampered';
    const card = store.cardOf('castle').content as GeneratedCard;
    expect(card.images[0]?.credit).toBe('Autor de Castelo');
  });
});
