import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import {
  type MediaRef,
  type PointContent,
  type RouteBundle,
  validateRouteBundle,
} from '@rumbo/route-spec';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { prefetchImages, routeImageUrls, toCatalogRoute } from '../src/services/catalog.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCatalogStore } from '../src/stores/catalog.ts';
import PrepareView from '../src/views/PrepareView.vue';

// Offline photos: downloading a route for offline use also loads its photos
// the way a card's <img> does, so the service worker (sw.ts) keeps them.

const photo = (name: string): MediaRef => ({
  url: `https://upload.wikimedia.org/wikipedia/commons/thumb/${name}/1024px-${name}.jpg`,
  alt: `Foto ${name}`,
  credit: 'Autor',
  license: 'CC BY-SA 4.0',
});
const COVER = photo('cover');
const CASTLE = photo('castle');
const CATHEDRAL = photo('cathedral');
const SQUARE = photo('square');

function card(ref: string, locale: 'es' | 'en', images: MediaRef[]): PointContent {
  return {
    id: ref,
    locale,
    title: ref,
    summary: 'A place.',
    facts: [],
    images,
    sources: [],
    generated: { by: 'ai', at: '2026-10-08T10:00:00Z' },
    status: 'approved',
  };
}

function places(withCards: boolean) {
  const at = (lat: number, lng: number) => ({ lat, lng });
  return [
    {
      tempId: 'a',
      name: 'Castelo',
      position: at(39.7473, -8.8077),
      ...(withCards ? { contentRef: 'card-a' } : {}),
    },
    {
      tempId: 'b',
      name: 'Sé',
      position: at(39.7448, -8.8079),
      ...(withCards ? { contentRef: 'card-b' } : {}),
    },
    { tempId: 'c', name: 'Plaza', position: at(39.7436, -8.8072) },
  ];
}

/** A user route that has no photo anywhere, like the curated one. */
function plainBundle(): RouteBundle {
  const built = buildRouteSpec(
    { name: 'Sin fotos', locale: 'es', mode: 'free', activity: 'walk', places: places(false) },
    { source: 'user', idFactory: () => 'plain00001' },
  );
  return { spec: built.normalized, contents: {} };
}

/** A user route: a cover, two cards (one in two languages sharing a photo) and a basic sheet with a photo. */
function bundleWithPhotos(): RouteBundle {
  const built = buildRouteSpec(
    { name: 'Fotos de Leiria', locale: 'es', mode: 'free', activity: 'walk', places: places(true) },
    { source: 'user', idFactory: () => 'photos0001' },
  );
  const spec = {
    ...built.normalized,
    coverImage: COVER,
    actions: {
      ...built.normalized.actions,
      content_plaza: { type: 'info_sheet', params: { title: 'Plaza', image: SQUARE } },
    },
  };
  return {
    spec,
    contents: {
      'card-a': {
        es: card('card-a', 'es', [CASTLE, CATHEDRAL]),
        en: card('card-a', 'en', [CASTLE]),
      },
      'card-b': { es: card('card-b', 'es', []) },
    },
  };
}

describe('routeImageUrls', () => {
  it('lists the cover, the photos of every card in every language and the info sheets, once each', () => {
    const bundle = bundleWithPhotos();
    // The fixture is a valid bundle, so this is what a saved route holds.
    expect(validateRouteBundle(bundle).ok).toBe(true);
    expect(routeImageUrls(bundle)).toEqual([COVER.url, CASTLE.url, CATHEDRAL.url, SQUARE.url]);
  });

  it('is empty for a route with no photos, like the curated one', () => {
    expect(routeImageUrls(plainBundle())).toEqual([]);
  });

  it('never lists more than a route could show', () => {
    const many = Array.from({ length: 100 }, (_, i) => photo(`p${i}`));
    const { spec } = bundleWithPhotos();
    const urls = routeImageUrls({
      spec,
      contents: { 'card-a': { es: card('card-a', 'es', many) } },
    });
    expect(urls).toHaveLength(60);
    expect(urls[0]).toBe(COVER.url);
  });
});

describe('prefetchImages', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads each photo once, four at a time, and counts the ones that loaded', async () => {
    let open = 0;
    let most = 0;
    const load = vi.fn(async (url: string) => {
      open += 1;
      most = Math.max(most, open);
      await Promise.resolve();
      await Promise.resolve();
      open -= 1;
      return !url.endsWith('/bad');
    });
    const urls = [
      ...Array.from({ length: 9 }, (_, i) => `https://x.test/${i}`),
      'https://x.test/bad',
    ];
    expect(await prefetchImages([...urls, ...urls], { load })).toBe(9);
    expect(load).toHaveBeenCalledTimes(10);
    expect(most).toBe(4);
  });

  it('never rejects: a photo whose load throws is skipped', async () => {
    const load = vi.fn(async (url: string): Promise<boolean> => {
      if (url.endsWith('/boom')) throw new Error('network down');
      return true;
    });
    const urls = ['https://x.test/boom', 'https://x.test/ok'];
    await expect(prefetchImages(urls, { load })).resolves.toBe(1);
    await expect(prefetchImages([])).resolves.toBe(0);
  });

  it('stops waiting when its time budget runs out, and the rest keeps loading', async () => {
    vi.useFakeTimers();
    const pending: Array<(loaded: boolean) => void> = [];
    const load = vi.fn(() => new Promise<boolean>((resolve) => pending.push(resolve)));
    const urls = Array.from({ length: 10 }, (_, i) => `https://slow.test/${i}`);
    const done = prefetchImages(urls, { load, budgetMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toBe(0);
    expect(load).toHaveBeenCalledTimes(4);

    // The download went on without them; they finish, and the queue is still worked through.
    while (pending.length > 0) {
      for (const resolve of pending.splice(0)) resolve(true);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(load).toHaveBeenCalledTimes(10);
  });

  describe('with the browser image loader', () => {
    class FakeImage {
      static all: FakeImage[] = [];
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      crossOrigin: string | null = null;
      src = '';
      constructor() {
        FakeImage.all.push(this);
      }
    }

    beforeEach(() => {
      FakeImage.all = [];
      vi.stubGlobal('Image', FakeImage);
    });

    it('asks as an <img> would, with CORS, so the service worker stores the response', async () => {
      const done = prefetchImages([CASTLE.url, CATHEDRAL.url]);
      expect(FakeImage.all.map((image) => [image.src, image.crossOrigin])).toEqual([
        [CASTLE.url, 'anonymous'],
        [CATHEDRAL.url, 'anonymous'],
      ]);
      FakeImage.all[0]?.onload?.();
      FakeImage.all[1]?.onerror?.();
      expect(await done).toBe(1);
    });

    it('gives up on a photo that takes too long, and carries on with the next', async () => {
      vi.useFakeTimers();
      const done = prefetchImages(Array.from({ length: 5 }, (_, i) => `https://slow.test/${i}`));
      expect(FakeImage.all).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(8000);
      // The four stuck ones timed out; the fifth started in their place.
      expect(FakeImage.all).toHaveLength(5);
      FakeImage.all[4]?.onload?.();
      expect(await done).toBe(1);
    });

    it('counts a missing Image (no browser) as photos that failed', async () => {
      vi.stubGlobal('Image', undefined);
      await expect(prefetchImages([CASTLE.url])).resolves.toBe(0);
    });
  });
});

describe('downloading a route for offline use (PrepareView)', () => {
  let view: VueWrapper | null = null;
  let images: Array<{ src: string; crossOrigin: string | null }> = [];

  /** Every photo "loads" a tick after it is asked for, or fails when `failing`. */
  function stubImage(failing = false) {
    images = [];
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      crossOrigin: string | null = null;
      private current = '';
      get src() {
        return this.current;
      }
      set src(value: string) {
        this.current = value;
        images.push(this);
        queueMicrotask(() => (failing ? this.onerror : this.onload)?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
  }

  async function open(bundle: RouteBundle) {
    const pinia = createPinia();
    setActivePinia(pinia);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const catalog = useCatalogStore();
    await catalog.load();
    catalog.curated = [toCatalogRoute(bundle, 0)];
    const empty = { render: () => null };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: empty },
        { path: '/run', name: 'run', component: empty },
      ],
    });
    await router.push('/');
    view = mount(PrepareView, {
      props: { routeId: bundle.spec.id },
      global: { plugins: [pinia, router, i18n] },
    });
    return catalog;
  }

  beforeEach(async () => {
    applyLocale('es');
    for (const { spec } of [bundleWithPhotos(), plainBundle()]) await db.del(KEYS.bundle(spec.id));
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    vi.unstubAllGlobals();
  });

  it('loads the photos of the route, then says it is ready', async () => {
    stubImage();
    const bundle = bundleWithPhotos();
    const catalog = await open(bundle);
    await vi.waitFor(() => expect(view?.text()).toContain('Listo para usar sin conexión'));

    expect(catalog.downloaded.has(bundle.spec.id)).toBe(true);
    expect(images.map((image) => image.src).sort()).toEqual(
      [COVER.url, CASTLE.url, CATHEDRAL.url, SQUARE.url].sort(),
    );
    expect(images.every((image) => image.crossOrigin === 'anonymous')).toBe(true);
  });

  it('is ready even when every photo fails', async () => {
    stubImage(true);
    const bundle = bundleWithPhotos();
    const catalog = await open(bundle);
    await vi.waitFor(() => expect(view?.text()).toContain('Listo para usar sin conexión'));
    await flushPromises();

    expect(images).toHaveLength(4);
    expect(view?.text()).not.toContain('No se pudo descargar la ruta.');
    expect(catalog.downloaded.has(bundle.spec.id)).toBe(true);
  });

  it('loads nothing for a route without photos', async () => {
    stubImage();
    const bundle = plainBundle();
    const catalog = await open(bundle);
    await vi.waitFor(() => expect(view?.text()).toContain('Listo para usar sin conexión'));
    expect(images).toEqual([]);
    expect(catalog.downloaded.has(bundle.spec.id)).toBe(true);
  });
});
