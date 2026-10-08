import 'fake-indexeddb/auto';
import { contentHashInput, type GeneratedCard } from '@rumbo/api-contract';
import { validateRouteBundle } from '@rumbo/route-spec';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { getMyRoute, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { type CreatorDraft, useCreatorStore } from '../src/stores/creator.ts';
import { useUiStore } from '../src/stores/ui.ts';
import { apiError, card, castle, cathedral, generated, json, river } from './create-fixtures.ts';

// The AI guide in the creator's draft (design §4): cards asked for two at a
// time, shipped with the route exactly as the API made them, kept in the
// draft across reloads and edits, and never in the way when the AI cannot
// answer.

interface Call {
  url: string;
  body: { name: string; locale: string; externalId?: string; custom: boolean; interests: string[] };
}

let creator: ReturnType<typeof useCreatorStore> | null = null;
let calls: Call[] = [];
/** The card the fake API made for each place, by name. */
const made = new Map<string, GeneratedCard>();

type Respond = (call: Call, signal: AbortSignal | undefined) => Response | Promise<Response>;

/** The AI endpoint answers with `respond`; anything else (the route upload) is unavailable. */
function serve(respond: Respond = answerWithCard): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/content/generate')) return new Response(null, { status: 503 });
      const call: Call = { url, body: JSON.parse(init?.body as string) };
      calls.push(call);
      return respond(call, init?.signal ?? undefined);
    }),
  );
}

/** A card of its own for each place. */
function answerWithCard(call: Call): Response {
  const response = generated({ title: `Ficha de ${call.body.name}` });
  made.set(call.body.name, response.content);
  return json(response);
}

/** Requests that wait until the test lets them go (and say whether they were given up). */
function hold() {
  const held: Array<{
    name: string;
    signal: AbortSignal | undefined;
    finish: (response?: Response) => void;
  }> = [];
  serve(
    (call, signal) =>
      new Promise<Response>((resolve) => {
        held.push({
          name: call.body.name,
          signal,
          finish: (response) => resolve(response ?? answerWithCard(call)),
        });
      }),
  );
  return held;
}

async function open(): Promise<ReturnType<typeof useCreatorStore>> {
  creator?.$dispose();
  setActivePinia(createPinia());
  creator = useCreatorStore();
  await creator.ready;
  return creator;
}

/** A named draft with the castle and the cathedral. */
async function started() {
  const store = await open();
  await store.ensureDraft();
  await store.update({ name: 'Leiria numa manhã', interests: ['history', 'food'] });
  await store.addPlace({ ...castle, tempId: 'castle' });
  await store.addPlace({ ...cathedral, tempId: 'cathedral' });
  return store;
}

const ids = (store: ReturnType<typeof useCreatorStore>) =>
  (store.draft?.places ?? []).map((place) => place.tempId);

function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
}

beforeEach(async () => {
  applyLocale('es');
  made.clear();
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

describe('preparing the cards', () => {
  it('asks two at a time, in list order, and gives each ready card its contentRef', async () => {
    const held = hold();
    const store = await started();
    await store.addPlace({ ...river, tempId: 'river' });
    expect(store.cardStats).toMatchObject({ total: 3, pending: 3 });

    const done = store.generateMissing();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(held.map((request) => request.name)).toEqual(['Castelo de Leiria', 'Sé de Leiria']);
    expect(ids(store).map((id) => store.cardOf(id).status)).toEqual([
      'generating',
      'generating',
      'pending',
    ]);
    expect(store.cardStats).toMatchObject({ generating: 2, pending: 1, ready: 0 });

    held[0]?.finish();
    await vi.waitFor(() => expect(held).toHaveLength(3));
    expect(store.cardOf('castle').status).toBe('ready');
    held[1]?.finish();
    held[2]?.finish();
    await done;

    expect(store.cardStats).toMatchObject({ total: 3, ready: 3, pending: 0, generating: 0 });
    const refs = store.draft?.places.map((place) => place.contentRef) ?? [];
    expect(refs.every((ref) => /^card-[a-z0-9]{10}$/.test(ref ?? ''))).toBe(true);
    expect(new Set(refs).size).toBe(3);
    expect(store.cardOf('river').grounding).toBe('wikipedia');
  });

  it("asks in the route's language, with the interests, and a Wikidata id only when it has one", async () => {
    const store = await started();
    await store.addPlace({ ...river, tempId: 'river' });
    // The app's language changes after the draft started: the route keeps its own.
    i18n.global.locale.value = 'en';
    await store.generateMissing();
    expect(calls.map((call) => call.body)).toEqual([
      expect.objectContaining({
        name: 'Castelo de Leiria',
        locale: 'es',
        externalId: 'Q1023767',
        custom: false,
        interests: ['history', 'food'],
      }),
      expect.objectContaining({ name: 'Sé de Leiria', externalId: 'Q2422093', custom: false }),
      expect.objectContaining({ name: 'Rio Lis', custom: true }),
    ]);
    expect(calls[2]?.body).not.toHaveProperty('externalId');
  });

  it('ships the ready cards with the route exactly as the API made them', async () => {
    const store = await started();
    await store.generateMissing();
    const built = store.build();
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const refs = store.draft?.places.map((place) => place.contentRef ?? '') ?? [];
    expect(Object.keys(built.contents).sort()).toEqual([...refs].sort());
    for (const [index, ref] of refs.entries()) {
      const name = store.draft?.places[index]?.name ?? '';
      const shipped = built.contents[ref]?.es;
      expect(shipped).toMatchObject({ id: ref, locale: 'es', title: `Ficha de ${name}` });
      // The API recognises its cards by this hash: nothing may change.
      expect(contentHashInput(shipped!)).toBe(contentHashInput(made.get(name)!));
      expect(built.spec.points[index]?.contentRef).toBe(ref);
      expect(built.spec.actions[`content_${built.spec.points[index]?.id}`]).toEqual({
        type: 'ai_template',
        params: { contentRef: ref },
      });
    }
    expect(validateRouteBundle({ spec: built.spec, contents: built.contents }).ok).toBe(true);

    const id = await store.save();
    const saved = await getMyRoute(id);
    expect(Object.keys(saved?.bundle.contents ?? {}).sort()).toEqual([...refs].sort());
  });

  it('gives up the cards on their way when the draft goes away (saved, deleted, data cleared)', async () => {
    const held = hold();
    const store = await started();
    const done = store.generateMissing();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(held.map((request) => request.signal?.aborted)).toEqual([false, false]);
    store.stopAutosave();
    expect(held.map((request) => request.signal?.aborted)).toEqual([true, true]);
    await done;
    // Nothing new is asked for once it stopped.
    expect(held).toHaveLength(2);
  });

  it('keeps the interests and the suggested summary in the route', async () => {
    const store = await started();
    await store.update({ summary: `  ${'x'.repeat(300)}\n` });
    expect(store.draft?.summary).toBe('x'.repeat(280));
    const built = store.build();
    expect(built.ok && built.spec.summary).toBe('x'.repeat(280));
    expect(built.ok && built.spec.meta).toEqual({ interests: ['history', 'food'] });
  });

  it('ships a basic sheet for a place without a ready card, and asks only once', async () => {
    const store = await started();
    await store.setBasicCard('cathedral');
    await store.generateMissing();
    expect(calls.map((call) => call.body.name)).toEqual(['Castelo de Leiria']);
    await store.generateMissing();
    expect(calls).toHaveLength(1);

    const built = store.build();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.contents)).toHaveLength(1);
    expect(built.spec.points[1]?.contentRef).toBeUndefined();
    expect(Object.values(built.spec.actions).map((action) => action.type)).toContain('info_sheet');
    expect(store.cardStats).toMatchObject({ ready: 1, basic: 1 });
  });
});

describe('when the AI cannot answer', () => {
  it('offline it says so without asking, and asks when the connection is back', async () => {
    const store = await started();
    setOnline(false);
    await store.generateMissing();
    expect(calls).toHaveLength(0);
    expect(store.cardOf('castle')).toEqual({ status: 'error', error: 'offline' });
    expect(store.cardOf('cathedral')).toEqual({ status: 'error', error: 'offline' });
    // Waiting for the connection is not a choice: step 3 still has them to prepare.
    expect(store.cardsToPrepare).toHaveLength(2);

    setOnline(true);
    await store.generateMissing();
    expect(calls).toHaveLength(2);
    expect(store.cardStats).toMatchObject({ ready: 2, error: 0 });
  });

  it("stops asking when the day's budget is spent and lets the user take the basic cards", async () => {
    serve(() => apiError('ai_budget_exceeded', 429));
    const store = await started();
    await store.addPlace({ ...river, tempId: 'river' });
    await store.addPlace({ name: 'Museu de Leiria', position: { lat: 39.7488, lng: -8.8012 } });
    await store.generateMissing();

    // Two were already on their way; the rest never left.
    expect(calls).toHaveLength(2);
    expect(store.cardStats).toMatchObject({ total: 4, error: 4 });
    expect(ids(store).map((id) => store.cardOf(id).error)).toEqual(
      Array(4).fill('ai_budget_exceeded'),
    );
    expect(store.cardsToPrepare).toHaveLength(0);

    expect(await store.setBasicForFailed()).toBe(4);
    expect(store.cardStats).toMatchObject({ basic: 4, error: 0 });
    const built = store.build();
    expect(built.ok && built.contents).toEqual({});
  });

  it('a card that failed can be tried again or made basic, and the others go on', async () => {
    let failing = true;
    serve((call) =>
      failing && call.body.name === 'Sé de Leiria'
        ? apiError('generation_failed', 502)
        : answerWithCard(call),
    );
    const store = await started();
    await store.generateMissing();
    expect(store.cardOf('castle').status).toBe('ready');
    expect(store.cardOf('cathedral')).toEqual({ status: 'error', error: 'failed' });
    // A plain failure is not a reason to stop asking for the others.
    expect(store.cardsToPrepare).toHaveLength(0);

    failing = false;
    await store.regenerateCard('cathedral');
    await store.cardsIdle();
    expect(store.cardOf('cathedral').status).toBe('ready');

    failing = true;
    await store.regenerateCard('cathedral');
    await store.cardsIdle();
    // Ready cards survive a failed regeneration (and the user is told).
    expect(store.cardOf('cathedral').status).toBe('ready');
    expect(useUiStore().toasts[0]?.message).toEqual({ key: 'create.content.refreshFailed' });
    expect(store.isRefreshing('cathedral')).toBe(false);

    await store.setBasicCard('cathedral');
    expect(store.cardOf('cathedral')).toEqual({ status: 'basic' });
    expect(store.draft?.places[1]?.contentRef).toBeUndefined();
  });

  it('keeps the old card shipping while a new one is on its way', async () => {
    const store = await started();
    await store.generateMissing();
    // The first cards may come from the API's cache; "Regenerar" asks for a new one.
    expect(calls.map((call) => (call.body as { fresh?: boolean }).fresh)).toEqual([
      undefined,
      undefined,
    ]);
    const before = store.build();
    const held = hold();
    await store.regenerateCard('castle');
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(calls.at(-1)?.body).toMatchObject({ fresh: true });
    expect(store.isRefreshing('castle')).toBe(true);
    expect(store.cardStats.ready).toBe(2);
    const during = store.build();
    expect(during.ok && Object.keys(during.contents)).toEqual(
      before.ok ? Object.keys(before.contents) : [],
    );
    held[0]?.finish();
    await store.cardsIdle();
    expect(store.isRefreshing('castle')).toBe(false);
    expect(store.cardOf('castle').status).toBe('ready');
  });
});

describe('places and their cards', () => {
  it('removing a place drops its card, and Undo brings both back', async () => {
    const store = await started();
    await store.generateMissing();
    const ref = store.draft?.places[0]?.contentRef;
    const removed = await store.removePlace('castle');
    expect(removed?.card?.status).toBe('ready');
    expect(store.draft?.cards['castle']).toBeUndefined();
    expect(store.cardStats).toMatchObject({ total: 1, ready: 1 });

    expect(await store.restorePlace(removed!.place, removed!.index, removed!.card)).toBe(true);
    expect(store.cardOf('castle').status).toBe('ready');
    expect(store.draft?.places[0]?.contentRef).toBe(ref);
    expect(store.cardStats).toMatchObject({ total: 2, ready: 2 });
  });

  it("a point of the user's own needs a new card when it is renamed; a Wikidata place does not", async () => {
    const store = await started();
    await store.addPlace({ ...river, tempId: 'river' });
    await store.generateMissing();
    expect(store.cardStats.ready).toBe(3);

    await store.updatePlace('castle', { name: 'O Castelo' });
    expect(store.cardOf('castle').status).toBe('ready');
    await store.updatePlace('river', { radius: 60 });
    expect(store.cardOf('river').status).toBe('ready');
    await store.updatePlace('river', { name: 'Rio Lis (jardim)' });
    expect(store.cardOf('river').status).toBe('pending');
    expect(store.draft?.places[2]?.contentRef).toBeUndefined();
    expect(store.cardsToPrepare.map((place) => place.tempId)).toEqual(['river']);
  });

  it('ignores a card that arrives after its place or its draft is gone', async () => {
    const held = hold();
    const store = await started();
    const done = store.generateMissing();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    await store.removePlace('castle');
    held[0]?.finish();
    held[1]?.finish();
    await done;
    expect(store.draft?.cards['castle']).toBeUndefined();
    expect(store.cardStats).toMatchObject({ total: 1, ready: 1 });

    const second = hold();
    await store.discard();
    await store.startNew();
    await store.addPlace({ ...river, tempId: 'castle' });
    const again = store.generateMissing();
    await vi.waitFor(() => expect(second).toHaveLength(1));
    // The draft changes under the request: its answer belongs to nobody.
    await store.discard();
    second[0]?.finish();
    await again;
    expect(store.draft).toBeNull();
  });
});

describe('the draft keeps them', () => {
  it('stores ready and basic cards across a reload, and makes the rest pending again', async () => {
    let store = await started();
    await store.addPlace({ ...river, tempId: 'river' });
    await store.generateMissing();
    await store.setBasicCard('river');
    const held = hold();
    await store.regenerateCard('cathedral');
    // One more on its way when the page closes: it is not stored as done.
    await store.addPlace({
      name: 'Museu',
      position: { lat: 39.7488, lng: -8.8012 },
      tempId: 'museum',
    });
    void store.generateMissing();
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0));
    await store.flush();

    store = await open();
    expect(store.cardStats).toMatchObject({ ready: 2, basic: 1, pending: 1, total: 4 });
    expect(store.cardOf('castle').content?.title).toBe('Ficha de Castelo de Leiria');
    expect(store.cardOf('museum')).toEqual({ status: 'pending' });
    // Cards to prepare: the next visit to step 3 picks them up.
    expect(store.resumeStep).toBe('content');
    held.forEach((request) => request.finish());
  });

  it('forgets errors on reload, resumes at the review once every card has been decided', async () => {
    serve(() => apiError('ai_budget_exceeded', 429));
    let store = await started();
    await store.generateMissing();
    expect(store.cardStats.error).toBe(2);
    await store.flush();
    store = await open();
    expect(store.cardStats).toMatchObject({ pending: 2, error: 0 });
    expect(store.resumeStep).toBe('content');

    await store.setBasicCard('castle');
    await store.setBasicCard('cathedral');
    expect(store.resumeStep).toBe('review');
  });

  it('repairs a broken stored card and keeps the original aside', async () => {
    const store = await started();
    await store.generateMissing();
    await store.flush();
    const stored = (await db.get<CreatorDraft>(KEYS.creatorDraft))!;
    const raw = {
      ...stored,
      cards: {
        castle: { ...stored.cards['castle'], content: { title: 7 } },
        cathedral: stored.cards['cathedral'],
        gone: { status: 'basic' },
      },
      interests: ['history', 'sports', 'food'],
    };
    await db.set(KEYS.creatorDraft, raw);
    const reopened = await open();
    expect(reopened.draft?.cards['castle']).toBeUndefined();
    expect(reopened.cardOf('cathedral').status).toBe('ready');
    expect(reopened.draft?.cards['gone']).toBeUndefined();
    expect(reopened.draft?.interests).toEqual(['history', 'food']);
    expect(await db.get(KEYS.creatorDraftBackup)).toEqual(raw);
  });

  it('reads a draft from before phase 7 without cards', async () => {
    const store = await started();
    await store.flush();
    const stored = (await db.get<Record<string, unknown>>(KEYS.creatorDraft))!;
    delete stored['cards'];
    await db.set(KEYS.creatorDraft, stored);
    const reopened = await open();
    expect(reopened.draft?.cards).toEqual({});
    expect(await db.get(KEYS.creatorDraftBackup)).toBeUndefined();
  });
});

describe('editing a saved route', () => {
  it('brings its cards back untouched and saves them again under the same refs', async () => {
    let store = await started();
    await store.update({ summary: 'Del castillo a la catedral.' });
    await store.generateMissing();
    await store.setBasicCard('cathedral');
    const id = await store.save();
    const first = await getMyRoute(id);
    const castleRef = first?.bundle.spec.points[0]?.contentRef;
    expect(Object.keys(first?.bundle.contents ?? {})).toEqual([castleRef]);

    store = await open();
    expect(await store.loadForEdit(id)).toBe(true);
    expect(store.draft).toMatchObject({
      locale: 'es',
      summary: 'Del castillo a la catedral.',
      interests: ['history', 'food'],
    });
    const [first_, second] = store.draft?.places ?? [];
    expect(store.cardOf(first_!.tempId).status).toBe('ready');
    expect(store.cardOf(first_!.tempId).grounding).toBe('wikipedia');
    // The place that had the basic sheet stays basic: opening the creator spends nothing.
    expect(store.cardOf(second!.tempId)).toEqual({ status: 'basic' });
    expect(store.resumeStep).toBe('review');
    expect(calls).toHaveLength(2);

    await store.updatePlace(first_!.tempId, { radius: 55 });
    expect(await store.save()).toBe(id);
    const after = await getMyRoute(id);
    const shipped = after?.bundle.contents[castleRef!]?.es;
    expect(shipped).toEqual(first?.bundle.contents[castleRef!]?.es);
    expect(contentHashInput(shipped!)).toBe(contentHashInput(made.get('Castelo de Leiria')!));
    expect(after?.bundle.spec.points[0]?.contentRef).toBe(castleRef);
    expect(card().sources).toHaveLength(2);
  });

  it('infers where an old card came from, and drops interests it does not know', async () => {
    const store = await started();
    await store.update({ interests: ['art'] });
    serve((call) => {
      const response = generated(
        call.body.name === 'Castelo de Leiria'
          ? { sources: [{ title: 'Leiria', url: 'https://example.org/leiria' }] }
          : { sources: [] },
        'web',
      );
      return json(response);
    });
    await store.generateMissing();
    expect(store.cardOf('castle').grounding).toBe('web');
    const id = await store.save();

    const reopened = await open();
    await reopened.loadForEdit(id);
    const [a, b] = reopened.draft?.places ?? [];
    expect(reopened.cardOf(a!.tempId).grounding).toBe('web');
    expect(reopened.cardOf(b!.tempId).grounding).toBe('none');
    expect(reopened.draft?.interests).toEqual(['art']);
  });
});
