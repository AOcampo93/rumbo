import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import {
  bundledPois,
  bundledRoutes,
  type CatalogRoute,
  type PoiLayer,
  routesFromApi,
} from '../services/catalog.ts';
import { db, KEYS } from '../services/storage.ts';

// The routes the user can explore, plus the points of interest of the
// Explore map. Loaded once per session.

export const useCatalogStore = defineStore('catalog', () => {
  const routes = shallowRef<CatalogRoute[]>([]);
  const poiLayers = shallowRef<PoiLayer[]>([]);
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** Bundles saved for offline use (route ids). */
  const downloaded = ref<Set<string>>(new Set());
  let loading: Promise<void> | null = null;

  function load(): Promise<void> {
    loading ??= (async () => {
      status.value = 'loading';
      try {
        routes.value = (await routesFromApi()) ?? bundledRoutes();
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

  return { routes, poiLayers, pois, status, downloaded, load, byId, download };
});
