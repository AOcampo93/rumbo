import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import {
  bundledPois,
  bundledRoutes,
  type CatalogRoute,
  type PoiLayer,
  routesFromApi,
  toCatalogRoute,
} from '../services/catalog.ts';
import {
  listMyRoutes,
  myRouteBundle,
  type MyRouteRecord,
  onMyRoutesChange,
} from '../services/myRoutes.ts';
import { db, KEYS } from '../services/storage.ts';

// The routes the user can explore (the curated ones, then their own), plus the
// points of interest of the Explore map. The curated routes load once per
// session; the user's routes come from this device first (fast, offline) and
// follow every change of the registry, sync states included.

/** A stable colour per route id, whatever else is loaded. */
function colorIndex(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash;
}

export const useCatalogStore = defineStore('catalog', () => {
  const curated = shallowRef<CatalogRoute[]>([]);
  /** The user's routes that can run (records whose bundle validates), newest first. */
  const mine = shallowRef<CatalogRoute[]>([]);
  const routes = computed(() => [...curated.value, ...mine.value]);
  /** Every route the user created, newest first, unreadable ones included (My routes lists them). */
  const myRecords = shallowRef<MyRouteRecord[]>([]);
  const mineStatus = ref<'idle' | 'loading' | 'ready'>('idle');
  /** The registry couldn't be read (storage error, or a newer app wrote it). */
  const mineUnreadable = ref(false);
  /** Where the curated routes came from; only the API's list is complete. */
  const curatedFrom = ref<'api' | 'bundled' | null>(null);
  const poiLayers = shallowRef<PoiLayer[]>([]);
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** Bundles saved for offline use (route ids). */
  const downloaded = ref<Set<string>>(new Set());
  let loading: Promise<void> | null = null;
  let mineLoading: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;
  /** Bumped by every change applied, so an older read never overwrites a newer change. */
  let mineVersion = 0;
  /** Each record's runnable route, rebuilt only when its revision changes. */
  const built = new Map<string, { rev: number; route: CatalogRoute | null }>();

  /**
   * True when a missing id really means "this route doesn't exist": the
   * registry was read and the curated list came from the API. Offline (the
   * bundled fallback) an API-only route would look missing.
   */
  const authoritative = computed(
    () =>
      mineStatus.value === 'ready' &&
      !mineUnreadable.value &&
      status.value === 'ready' &&
      curatedFrom.value === 'api',
  );

  function applyMine(records: readonly MyRouteRecord[]): void {
    mineVersion += 1;
    const next: CatalogRoute[] = [];
    const ids = new Set<string>();
    for (const record of records) {
      ids.add(record.id);
      let entry = built.get(record.id);
      if (!entry || entry.rev !== record.rev) {
        const bundle = myRouteBundle(record);
        entry = {
          rev: record.rev,
          route: bundle ? toCatalogRoute(bundle, colorIndex(record.id)) : null,
        };
        built.set(record.id, entry);
      }
      if (entry.route) {
        next.push({
          ...entry.route,
          mine: { sync: record.sync, ...(record.error ? { error: record.error } : {}) },
        });
      }
    }
    for (const id of [...built.keys()]) if (!ids.has(id)) built.delete(id);
    // A deleted route is no longer downloaded either (deleteMyRoute removed its bundle).
    const gone = mine.value.filter((route) => !ids.has(route.id)).map((route) => route.id);
    if (gone.length > 0) {
      downloaded.value = new Set([...downloaded.value].filter((id) => !gone.includes(id)));
    }
    myRecords.value = [...records];
    mine.value = next;
  }

  onScopeDispose(() => unsubscribe?.());

  /** Reads the user's routes (fast, local) and follows their changes from then on. */
  function loadMine(): Promise<void> {
    mineLoading ??= (async () => {
      mineStatus.value = 'loading';
      unsubscribe ??= onMyRoutesChange(applyMine);
      const version = mineVersion;
      const { records, unreadable } = await listMyRoutes();
      // A change that arrived meanwhile is newer than this read.
      if (version === mineVersion) applyMine(records);
      mineUnreadable.value = unreadable;
      mineStatus.value = 'ready';
      // Try again next time (storage may come back).
      if (unreadable) mineLoading = null;
    })();
    return mineLoading;
  }

  function load(): Promise<void> {
    loading ??= (async () => {
      status.value = 'loading';
      try {
        await loadMine();
        const fromApi = await routesFromApi();
        curated.value = fromApi ?? bundledRoutes();
        curatedFrom.value = fromApi ? 'api' : 'bundled';
        poiLayers.value = bundledPois();
        const saved = await Promise.all(
          routes.value.map(async (route) =>
            (await db.get(KEYS.bundle(route.id))) ? route.id : null,
          ),
        );
        downloaded.value = new Set(saved.filter((id): id is string => id !== null));
        status.value = 'ready';
      } catch (error) {
        console.error('catalog: load failed', error);
        status.value = 'error';
        loading = null;
      }
    })();
    return loading;
  }

  function byId(id: string): CatalogRoute | undefined {
    return routes.value.find((route) => route.id === id);
  }

  /** Keeps the bundle (all languages) in IndexedDB so the route runs offline. */
  async function download(id: string): Promise<boolean> {
    const route = byId(id);
    if (!route) return false;
    await db.set(KEYS.bundle(id), route.bundle);
    downloaded.value = new Set([...downloaded.value, id]);
    return true;
  }

  const pois = computed(() =>
    poiLayers.value.flatMap((layer) => layer.pois.map((poi) => ({ poi, locale: layer.locale }))),
  );

  return {
    routes,
    curated,
    mine,
    myRecords,
    mineStatus,
    mineUnreadable,
    curatedFrom,
    authoritative,
    poiLayers,
    pois,
    status,
    downloaded,
    load,
    loadMine,
    byId,
    download,
  };
});
