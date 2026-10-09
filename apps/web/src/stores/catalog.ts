import { COMMUNITY_ROUTES } from '@rumbo/api-contract';
import type { LatLng } from '@rumbo/geo-utils';
import { type RouteBundle, validateRouteBundle } from '@rumbo/route-spec';
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
import { fetchRouteBundle, nearbyRouteIds, nearParam } from '../services/community.ts';
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
//
// The community's routes (phase 7.2) are apart: `routes` stays the curated and
// the user's own. Explore asks for the ones around the user (`loadCommunity`),
// and any screen that is handed a route id the catalog doesn't know (a
// community route opened by its address, a run in progress after a reload)
// asks for it by id (`resolve`). Their bundles live in memory only: they are
// kept on the device when the user downloads one, as the curated ones are.

/** Explore's community list is asked for again after this long, or when the position changes. */
const COMMUNITY_FRESH_MS = 2 * 60_000;
/** Bundles asked for at once. */
const BUNDLE_CONCURRENCY = 4;

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
  /** Every community route the app has by id: the ones listed around the user, and the ones opened directly. */
  const communityPool = shallowRef<ReadonlyMap<string, CatalogRoute>>(new Map());
  /** The ids listed around the user, nearest first. */
  const nearIds = shallowRef<readonly string[]>([]);
  const communityStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** The position (as the API gets it) the list was asked for, and when it arrived. */
  let communityKey: string | null = null;
  let communityLoadedAt = 0;
  let communityRequest: AbortController | null = null;
  const resolving = new Map<string, Promise<Resolved>>();
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
          mine: {
            sync: record.sync,
            ...(record.error ? { error: record.error } : {}),
            ...(record.visibility === 'public' ? { published: true as const } : {}),
          },
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
    return routes.value.find((route) => route.id === id) ?? communityPool.value.get(id);
  }

  // ------------------------------------------------------------ community routes

  /** The routes around the user, nearest first, without the ones already listed as curated or "Creada por ti". */
  const community = computed(() => {
    const own = new Set([...routes.value, ...myRecords.value].map((route) => route.id));
    return nearIds.value.flatMap((id) => {
      const route = communityPool.value.get(id);
      return route && !own.has(id) ? [route] : [];
    });
  });

  /** A downloaded bundle is still there after a reload: mark the routes that have one. */
  async function markDownloaded(ids: readonly string[]): Promise<void> {
    const saved = await Promise.all(
      ids.map(async (id) => ((await db.get(KEYS.bundle(id))) ? id : null)),
    );
    const found = saved.filter((id): id is string => id !== null);
    if (found.length > 0) downloaded.value = new Set([...downloaded.value, ...found]);
  }

  /** Keeps the bundles by id (in memory only), and says which of them the device has downloaded. */
  async function addToPool(bundles: readonly RouteBundle[]): Promise<CatalogRoute[]> {
    const next = new Map(communityPool.value);
    const added = bundles.map((bundle) => {
      const route = toCatalogRoute(bundle, colorIndex(bundle.spec.id));
      next.set(route.id, route);
      return route;
    });
    communityPool.value = next;
    await markDownloaded(added.map((route) => route.id));
    return added;
  }

  /**
   * Asks for the community routes around a position: the list
   * (GET /routes?near=…) and then the bundle of each one that isn't curated
   * or the user's own, a few at a time, so the map has their points. Does
   * nothing offline, nor for the position it already has (a minute or two
   * old at most). Never rejects: a failure leaves `communityStatus` at
   * 'error' and the rest of the catalog as it was.
   */
  async function loadCommunity(position: LatLng): Promise<void> {
    if (globalThis.navigator?.onLine === false) return;
    const key = nearParam(position);
    const status = communityStatus.value;
    const fresh = Date.now() - communityLoadedAt < COMMUNITY_FRESH_MS;
    if (key === communityKey && (status === 'loading' || (status === 'ready' && fresh))) return;
    communityKey = key;
    communityRequest?.abort();
    const request = new AbortController();
    communityRequest = request;
    communityStatus.value = 'loading';
    // A newer call (another position) took over: this one says nothing more.
    const stale = () => communityRequest !== request;
    const fail = () => {
      communityStatus.value = 'error';
      communityKey = null;
    };
    try {
      // The curated routes and the user's own are known first: they are left out.
      await load();
      const ids = await nearbyRouteIds(position, request.signal);
      if (stale()) return;
      if (ids === null) return fail();
      const known = new Set([...routes.value, ...myRecords.value].map((route) => route.id));
      const wanted = ids.filter((id) => !known.has(id)).slice(0, COMMUNITY_ROUTES.maxListed);
      const found: Array<RouteBundle | undefined> = Array.from({ length: wanted.length });
      // Routes the API couldn't answer for. One it says is gone (hidden, taken back or taken
      // down: a shared cache may still list it for a minute) is dropped quietly, not a failure.
      let unreadable = 0;
      let next = 0;
      const worker = async (): Promise<void> => {
        for (let index = next++; index < wanted.length; index = next++) {
          const id = wanted[index] as string;
          const answer = await fetchRouteBundle(id, request.signal);
          if (answer === 'gone') continue;
          if (answer === null || answer.spec.id !== id) unreadable += 1;
          else if (answer.spec.source === 'user') found[index] = answer;
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(BUNDLE_CONCURRENCY, wanted.length) }, worker),
      );
      if (stale()) return;
      const bundles = found.filter((bundle): bundle is RouteBundle => bundle !== undefined);
      // Routes listed, none readable and some failed: that is a failure, not an empty area.
      if (bundles.length === 0 && unreadable > 0) return fail();
      const added = await addToPool(bundles);
      if (stale()) return;
      nearIds.value = added.map((route) => route.id);
      communityStatus.value = 'ready';
      communityLoadedAt = Date.now();
    } catch (error) {
      if (stale()) return;
      console.warn('catalog: the community routes could not be loaded', error);
      fail();
    }
  }

  /** What `resolve` found: the route, or why there is none (`gone`: the API says it doesn't exist). */
  type Resolved = { route: CatalogRoute | null; gone: boolean };

  async function resolveRoute(id: string): Promise<Resolved> {
    const known = byId(id);
    if (known) return { route: known, gone: false };
    const answer = await fetchRouteBundle(id);
    if (answer && answer !== 'gone' && answer.spec.id === id) {
      return { route: (await addToPool([answer]))[0] ?? null, gone: false };
    }
    // The API can't give it (offline, taken down…): a copy the user downloaded still runs.
    const stored = await db.get<unknown>(KEYS.bundle(id));
    const copy = stored === undefined ? undefined : validateRouteBundle(stored).bundle;
    if (copy && copy.spec.id === id) {
      return { route: (await addToPool([copy]))[0] ?? null, gone: false };
    }
    return { route: null, gone: answer === 'gone' };
  }

  /**
   * A route by id: the catalog's, or else the API's (a community route opened
   * by its address, or the one a run in progress was walking) or the copy the
   * user downloaded. Never rejects. `gone` is true only when the API says the
   * route doesn't exist (not when it just couldn't be asked).
   */
  function resolve(id: string): Promise<Resolved> {
    let pending = resolving.get(id);
    if (!pending) {
      pending = resolveRoute(id)
        .catch((error: unknown): Resolved => {
          console.warn('catalog: a route could not be resolved', error);
          return { route: null, gone: false };
        })
        .finally(() => resolving.delete(id));
      resolving.set(id, pending);
    }
    return pending;
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
    community,
    communityStatus,
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
    loadCommunity,
    byId,
    resolve,
    download,
  };
});
