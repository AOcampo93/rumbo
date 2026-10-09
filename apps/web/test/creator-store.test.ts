import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/i18n/index.ts';
import {
  type AnalyticsEvent,
  clearAnalytics,
  initAnalytics,
  stopAnalytics,
} from '../src/services/analytics.ts';
import { getMyRoute, type MyRouteRecord, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCatalogStore } from '../src/stores/catalog.ts';
import { type CreatorDraft, useCreatorStore } from '../src/stores/creator.ts';
import { useUiStore } from '../src/stores/ui.ts';

// The creator's draft (design §4.3): it survives reloads and broken storage,
// saves in a safe order, and never comes back once the route is saved.

const castle = {
  name: 'Castelo de Leiria',
  position: { lat: 39.7473, lng: -8.8077 },
  address: 'Rua do Castelo, Leiria',
  externalId: 'Q1023767',
  category: 'monument' as const,
};
const cathedral = {
  name: 'Sé de Leiria',
  position: { lat: 39.7436, lng: -8.8072 },
  externalId: 'Q2422093',
  category: 'church' as const,
};

let creator: ReturnType<typeof useCreatorStore> | null = null;

/** The store as a fresh page load would create it. */
async function open(): Promise<ReturnType<typeof useCreatorStore>> {
  creator?.$dispose();
  setActivePinia(createPinia());
  creator = useCreatorStore();
  await creator.ready;
  return creator;
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

const storedDraft = () => db.get<CreatorDraft>(KEYS.creatorDraft);

beforeEach(async () => {
  i18n.global.locale.value = 'pt';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  await Promise.all([
    db.del(KEYS.creatorDraft),
    db.del(KEYS.creatorDraftBackup),
    db.del(KEYS.myRoutes),
  ]);
});

afterEach(async () => {
  creator?.$dispose();
  creator = null;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the draft', () => {
  it('starts empty, in the app language, with its own id suffix', async () => {
    const store = await open();
    expect(store.draft).toBeNull();
    await store.ensureDraft();
    expect(store.draft).toMatchObject({
      v: 1,
      editingId: null,
      locale: 'pt',
      name: '',
      places: [],
    });
    expect(store.draft?.idSuffix).toMatch(/^[a-z0-9]{10}$/);
    expect(store.resumeStep).toBe('details');
    expect(store.hasContent).toBe(false);
  });

  it('is stored 300 ms after a change, and right away when the page is hidden', async () => {
    const store = await open();
    await store.ensureDraft();
    await store.update({ name: 'Leiria numa manhã' });
    await vi.waitFor(async () => expect((await storedDraft())?.name).toBe('Leiria numa manhã'));
    const first = await storedDraft();
    expect(first?.rev).toBeGreaterThan(0);

    await store.addPlace(castle);
    setVisibility('hidden');
    await vi.waitFor(async () => expect((await storedDraft())?.places).toHaveLength(1));
    expect((await storedDraft())?.rev).toBeGreaterThan(first?.rev ?? 0);
  });

  it('comes back after a reload, at the first step with something missing', async () => {
    let store = await open();
    await store.ensureDraft();
    await store.update({ name: 'Leiria numa manhã' });
    await store.addPlace(castle);
    await store.flush();
    store = await open();
    expect(store.draft).toMatchObject({ name: 'Leiria numa manhã', places: [castle] });
    expect(store.recovered).toBe(true);
    expect(store.resumeStep).toBe('places');
    await store.addPlace(cathedral);
    // Two places and no card looked at yet: the cards are next.
    expect(store.resumeStep).toBe('content');
  });

  it('keeps a draft it cannot read aside and starts fresh', async () => {
    const broken = { v: 7, whatever: true };
    await db.set(KEYS.creatorDraft, broken);
    const store = await open();
    expect(store.draft).toBeNull();
    expect(await db.get(KEYS.creatorDraftBackup)).toEqual(broken);
  });

  it('repairs what it can field by field, keeping the original aside', async () => {
    const raw = {
      v: 1,
      rev: 5,
      tabId: 'other-tab',
      editingId: null,
      idSuffix: 'abcdefghij',
      locale: 'es',
      name: 'Ruta',
      mode: 'walkabout',
      activity: 'walk',
      timeLimitMinutes: null,
      area: null,
      places: [
        { ...castle, tempId: 'p1' },
        { tempId: 'p2', name: 'Sin posición' },
      ],
      updatedAt: '2026-10-08T09:00:00.000Z',
    };
    await db.set(KEYS.creatorDraft, raw);
    const store = await open();
    expect(store.draft).toMatchObject({ mode: 'free', name: 'Ruta', locale: 'es' });
    expect(store.draft?.places.map((place) => place.tempId)).toEqual(['p1']);
    expect(await db.get(KEYS.creatorDraftBackup)).toEqual(raw);
  });

  it('says so when it cannot be stored', async () => {
    const store = await open();
    await store.ensureDraft();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    await store.update({ name: 'Sin espacio' });
    await store.flush();
    expect(store.storageOff).toBe(true);
  });

  it('takes the newer draft another tab stored meanwhile', async () => {
    const store = await open();
    await store.ensureDraft();
    await store.update({ name: 'Esta pestaña' });
    await store.flush();
    const mine = await storedDraft();
    await db.set(KEYS.creatorDraft, {
      ...mine,
      name: 'La otra pestaña',
      tabId: 'other-tab',
      rev: (mine?.rev ?? 0) + 10,
    });
    setVisibility('visible');
    await vi.waitFor(() => expect(store.draft?.name).toBe('La otra pestaña'));
  });
});

describe('places', () => {
  it('adds each place once, removes it and puts it back where it was', async () => {
    const store = await open();
    await store.ensureDraft();
    expect(await store.addPlace(castle)).toBe(true);
    expect(await store.addPlace(castle)).toBe(false);
    expect(await store.addPlace({ ...cathedral, name: `  ${'x'.repeat(100)}‮ ` })).toBe(true);
    expect(store.draft?.places[1]?.name).toBe('x'.repeat(80));
    expect(await store.addPlace({ ...castle, externalId: 'Q3', tempId: 'mine' })).toBe(true);

    const removed = await store.removePlace(store.draft?.places[0]?.tempId ?? '');
    expect(removed?.index).toBe(0);
    expect(store.draft?.places).toHaveLength(2);
    expect(await store.restorePlace(removed!.place, removed!.index)).toBe(true);
    expect(store.draft?.places[0]?.externalId).toBe('Q1023767');

    expect(await store.movePlace(0, 2)).toBe(true);
    expect(store.draft?.places.map((place) => place.externalId)).toEqual([
      'Q2422093',
      'Q3',
      'Q1023767',
    ]);
    expect(await store.updatePlace('mine', { radius: 25, required: false })).toBe(true);
    expect(store.draft?.places[1]).toMatchObject({ tempId: 'mine', radius: 25, required: false });
  });

  it('flags zones that overlap', async () => {
    const store = await open();
    await store.ensureDraft();
    await store.addPlace({ ...castle, tempId: 'a' });
    await store.addPlace({ ...cathedral, tempId: 'b', position: { lat: 39.7474, lng: -8.8077 } });
    expect(store.overlaps).toHaveLength(1);
    expect([...store.overlapIds].sort()).toEqual(['a', 'b']);
  });
});

describe('saving', () => {
  async function readyToSave() {
    const store = await open();
    await store.ensureDraft();
    await store.update({ name: 'Leiria numa manhã', mode: 'challenge', timeLimitMinutes: 90 });
    await store.addPlace(castle);
    await store.addPlace(cathedral);
    return store;
  }

  it('builds the route with the draft id suffix and the time limit in seconds', async () => {
    const store = await readyToSave();
    const built = store.build();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.spec.id).toBe(`leiria-numa-manha-${store.draft?.idSuffix}`);
    expect(built.spec.settings?.timeLimit).toBe(5400);
    expect(built.normalized.points).toHaveLength(2);
  });

  it('saves, hands the route to the catalog, then forgets the draft for good', async () => {
    const store = await readyToSave();
    const catalog = useCatalogStore();
    const id = await store.save();
    expect(store.savedId).toBe(id);
    expect(store.draft).toBeNull();
    expect(catalog.byId(id)?.mine?.sync).toBeDefined();
    expect(await getMyRoute(id)).toMatchObject({ rev: 1, bundle: { spec: { id } } });
    // Nothing stores the draft again: no pending autosave, no flush on hide.
    setVisibility('hidden');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await storedDraft()).toBeUndefined();
  });

  it('keeps the draft when the device cannot store the route', async () => {
    const store = await readyToSave();
    await db.set(KEYS.myRoutes, { v: 2 });
    await expect(store.save()).rejects.toThrow();
    expect(store.draft?.name).toBe('Leiria numa manhã');
    expect(store.saving).toBe(false);
    expect(store.savedId).toBeNull();
  });

  it('edits a saved route under the same id and point ids', async () => {
    let store = await readyToSave();
    const id = await store.save();
    const before = (await getMyRoute(id)) as MyRouteRecord;
    store = await open();
    expect(await store.loadForEdit(id)).toBe(true);
    expect(store.draft).toMatchObject({
      editingId: id,
      name: 'Leiria numa manhã',
      timeLimitMinutes: 90,
    });
    expect(store.draft?.places.map((place) => place.pointId)).toEqual(
      before.bundle.spec.points.map((point) => point.id),
    );
    // Opening it again resumes the same draft.
    await store.update({ name: 'Leiria à tarde' });
    expect(await store.loadForEdit(id)).toBe(true);
    expect(store.draft?.name).toBe('Leiria à tarde');
    await store.movePlace(0, 1);
    expect(await store.save()).toBe(id);
    const after = (await getMyRoute(id)) as MyRouteRecord;
    expect(after).toMatchObject({ rev: 2, editToken: before.editToken });
    expect(after.bundle.spec.name).toBe('Leiria à tarde');
    expect(after.bundle.spec.points.map((point) => point.id)).toEqual(
      [...before.bundle.spec.points].reverse().map((point) => point.id),
    );
  });

  it('starts a new draft (and says why) for a route that is gone', async () => {
    const store = await open();
    expect(await store.loadForEdit('no-such-route-0000000000')).toBe(false);
    expect(store.draft).toMatchObject({ editingId: null, name: '' });
    expect(useUiStore().toasts[0]?.message).toEqual({ key: 'route.notFound' });
  });

  it('drops the draft of a route that was deleted', async () => {
    let store = await readyToSave();
    const id = await store.save();
    store = await open();
    await store.loadForEdit(id);
    await store.discardIfEditing('another-route');
    expect(store.draft).not.toBeNull();
    await store.discardIfEditing(id);
    expect(store.draft).toBeNull();
    expect(await storedDraft()).toBeUndefined();
  });
});

describe('publishing for the community (phase 7.2)', () => {
  async function readyToSave() {
    const store = await open();
    await store.ensureDraft();
    await store.update({ name: 'Leiria numa manhã' });
    await store.addPlace(castle);
    await store.addPlace(cathedral);
    return store;
  }

  const analyticsNames = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return ((await db.get<AnalyticsEvent[]>(KEYS.analyticsQueue)) ?? []).map((event) => event.name);
  };

  beforeEach(async () => {
    await initAnalytics(() => true);
    clearAnalytics();
  });

  afterEach(() => stopAnalytics());

  it('is off in a new draft, and stays as the user left it after a reload', async () => {
    let store = await open();
    await store.ensureDraft();
    expect(store.draft?.publish).toBe(false);
    await store.update({ publish: true });
    await store.flush();
    expect((await storedDraft())?.publish).toBe(true);
    store = await open();
    expect(store.draft?.publish).toBe(true);
    expect(await db.get(KEYS.creatorDraftBackup)).toBeUndefined();
  });

  it('reads a draft from before it as not published, with nothing to repair', async () => {
    await db.set(KEYS.creatorDraft, {
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
    });
    const store = await open();
    expect(store.draft).toMatchObject({ name: 'Ruta antigua', publish: false });
    expect(await db.get(KEYS.creatorDraftBackup)).toBeUndefined();
  });

  it('repairs a value that is not a yes or a no, keeping the original aside', async () => {
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
      places: [],
      publish: 'sí',
      updatedAt: '2026-10-08T09:00:00.000Z',
    };
    await db.set(KEYS.creatorDraft, raw);
    const store = await open();
    expect(store.draft?.publish).toBe(false);
    expect(await db.get(KEYS.creatorDraftBackup)).toEqual(raw);
  });

  it('saves a new route private unless the switch is on, and counts the publication', async () => {
    let store = await readyToSave();
    const privateId = await store.save();
    expect(await getMyRoute(privateId)).toMatchObject({ visibility: 'private' });
    expect(await analyticsNames()).not.toContain('route_published');

    store = await readyToSave();
    await store.update({ publish: true });
    const publicId = await store.save();
    expect(await getMyRoute(publicId)).toMatchObject({ visibility: 'public', rev: 1 });
    const names = await analyticsNames();
    expect(names.filter((name) => name === 'route_published')).toHaveLength(1);
    expect(names.filter((name) => name === 'route_created')).toHaveLength(2);
    // Nothing that tells which route it was.
    const events = (await db.get<AnalyticsEvent[]>(KEYS.analyticsQueue)) ?? [];
    expect(events.find((event) => event.name === 'route_published')?.props).toEqual({});
  });

  it('opens an edit with the visibility the route has, and saves the new choice', async () => {
    let store = await readyToSave();
    await store.update({ publish: true });
    const id = await store.save();
    clearAnalytics();

    store = await open();
    expect(await store.loadForEdit(id)).toBe(true);
    expect(store.draft?.publish).toBe(true);
    // Saving it as it is neither publishes nor takes it back.
    await store.update({ name: 'Leiria à tarde' });
    await store.save();
    expect(await getMyRoute(id)).toMatchObject({ visibility: 'public', rev: 2 });
    expect(await analyticsNames()).toEqual([]);

    // Switching it off takes the route back.
    store = await open();
    await store.loadForEdit(id);
    await store.update({ publish: false });
    await store.save();
    expect(await getMyRoute(id)).toMatchObject({ visibility: 'private', rev: 3, sync: 'pending' });
    expect(await analyticsNames()).toEqual(['route_unpublished']);
  });

  it('opens an old private route with the switch off, and publishes it when turned on', async () => {
    let store = await readyToSave();
    const id = await store.save();
    store = await open();
    await store.loadForEdit(id);
    expect(store.draft?.publish).toBe(false);
    await store.update({ publish: true });
    await store.save();
    expect(await getMyRoute(id)).toMatchObject({ visibility: 'public' });
    expect(await analyticsNames()).toContain('route_published');
  });
});
