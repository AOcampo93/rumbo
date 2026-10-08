import { type RouteSummary, summarizeRoute } from '@rumbo/route-builder';
import {
  LOCALES,
  type Locale,
  type MediaRef,
  type Poi,
  PoiCollectionSchema,
  type RouteBundle,
  validateRouteBundle,
} from '@rumbo/route-spec';
import type { RouteSummary as ApiRouteSummary } from '@rumbo/api-contract';
import { ROUTE_COLORS } from '../map/symbols.ts';
import { api } from './api.ts';
import type { SyncState } from './myRoutes.ts';

// Where routes come from (PROJECT_PLAN §10.6): the API when it answers
// (phase 5), otherwise the curated routes bundled with the app from
// data/routes. Both end up as validated RouteBundles. The user's own routes
// come from this device (services/myRoutes.ts).

export interface CatalogRoute {
  id: string;
  bundle: RouteBundle;
  summary: RouteSummary;
  /** Colour of the route on the Explore map. */
  color: string;
  /** Languages with every text available (curated routes: all three). */
  locales: readonly Locale[];
  /** Shipped inside the app: always available offline. */
  bundled: boolean;
  /** Made with the creator on this device ("Creada por ti"), with its upload state. */
  mine?: { sync: SyncState; error?: string };
}

export interface PoiLayer {
  id: string;
  locale: Locale;
  pois: Poi[];
}

const routeFiles = import.meta.glob<unknown>('../../../../data/routes/*.json', {
  eager: true,
  import: 'default',
});
const poiFiles = import.meta.glob<unknown>('../../../../data/pois/*.json', {
  eager: true,
  import: 'default',
});

export function toCatalogRoute(bundle: RouteBundle, index: number, bundled = false): CatalogRoute {
  return {
    id: bundle.spec.id,
    bundled,
    bundle,
    summary: summarizeRoute(bundle.spec),
    color: ROUTE_COLORS[index % ROUTE_COLORS.length] ?? ROUTE_COLORS[0],
    locales: bundle.spec.source === 'curated' ? LOCALES : [bundle.spec.locale],
  };
}

/** The curated routes shipped with the app (validated: CI already did, but data is data). */
export function bundledRoutes(): CatalogRoute[] {
  const bundles: RouteBundle[] = [];
  for (const [file, data] of Object.entries(routeFiles)) {
    const result = validateRouteBundle(data);
    if (result.bundle) bundles.push(result.bundle);
    else console.warn(`catalog: ${file} is not a valid route`, result.errors);
  }
  return bundles
    .sort((a, b) => a.spec.id.localeCompare(b.spec.id))
    .map((bundle, index) => toCatalogRoute(bundle, index, true));
}

export function bundledPois(): PoiLayer[] {
  const layers: PoiLayer[] = [];
  for (const [file, data] of Object.entries(poiFiles)) {
    const result = PoiCollectionSchema.safeParse(data);
    if (result.success)
      layers.push({ id: result.data.id, locale: result.data.locale, pois: result.data.pois });
    else console.warn(`catalog: ${file} is not a valid POI collection`, result.error.issues);
  }
  return layers;
}

const API_TIMEOUT_MS = 6000;

/**
 * Routes from the API (`GET /routes` → summaries, then each bundle).
 * Null when the API isn't there or fails: the caller falls back to the
 * bundled routes. `request` is swappable for tests.
 */
export async function routesFromApi(
  request: (path: string, init: { signal: AbortSignal }) => Promise<Response> = (path, init) =>
    api(path, { signal: init.signal, timeoutMs: API_TIMEOUT_MS }),
): Promise<CatalogRoute[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await request('/routes', { signal: controller.signal });
    if (!response.ok) return null;
    const summaries = (await response.json()) as unknown;
    if (!Array.isArray(summaries) || summaries.length === 0) return null;
    const ids = summaries
      .map((summary) => (summary as Partial<ApiRouteSummary>).id)
      .filter((id): id is string => typeof id === 'string');
    const bundles = await Promise.all(
      ids.map(async (id) => {
        const one = await request(`/routes/${encodeURIComponent(id)}`, {
          signal: controller.signal,
        });
        if (!one.ok) return null;
        return validateRouteBundle(await one.json()).bundle ?? null;
      }),
    );
    const valid = bundles.filter((bundle): bundle is RouteBundle => bundle !== null);
    return valid.length > 0 ? valid.map((bundle, index) => toCatalogRoute(bundle, index)) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** More photos than any route shows; a runaway bundle can't make the download endless. */
const MAX_PREFETCH_IMAGES = 60;
const IMAGE_CONCURRENCY = 4;
/** A photo that hasn't loaded by then is given up on (it keeps loading in the background). */
const IMAGE_TIMEOUT_MS = 8000;
/** The most the download waits for photos in all; the rest keeps loading without it. */
const IMAGES_BUDGET_MS = 15_000;

/** Every photo a route can show, once each: the cover, the cards' images and the info sheets' image. */
export function routeImageUrls(bundle: RouteBundle): string[] {
  const urls = new Set<string>();
  const add = (url: unknown): void => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) urls.add(url);
  };
  add(bundle.spec.coverImage?.url);
  for (const card of Object.values(bundle.contents)) {
    for (const content of Object.values(card)) {
      for (const image of content?.images ?? []) add(image.url);
    }
  }
  for (const action of Object.values(bundle.spec.actions)) {
    if (action.type === 'info_sheet') add((action.params?.['image'] as MediaRef | undefined)?.url);
  }
  return [...urls].slice(0, MAX_PREFETCH_IMAGES);
}

/**
 * Loads a photo the way a card's <img> will: the service worker's image route
 * (sw.ts) only sees requests whose destination is `image`, which a fetch()
 * isn't. `crossOrigin` makes the request CORS: that route stores only
 * complete responses, never the opaque ones a plain cross-origin <img> gets,
 * and the card's own <img> is later served that stored copy. Resolves with
 * whether it loaded, and never rejects.
 */
function loadImage(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (loaded: boolean): void => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(loaded);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.crossOrigin = 'anonymous';
    image.src = url;
  });
}

/**
 * Fetches the photos of a route being downloaded so the service worker keeps
 * them for offline use. Best effort: a photo that fails or is slow is skipped
 * and the download goes on. It waits for them at most `budgetMs` (the route
 * works without photos); what is left keeps loading in the background.
 * Resolves with how many had loaded by then, and never rejects. `load` is
 * swappable for tests.
 */
export async function prefetchImages(
  urls: readonly string[],
  options: { load?: (url: string, timeoutMs: number) => Promise<boolean>; budgetMs?: number } = {},
): Promise<number> {
  const { load = loadImage, budgetMs = IMAGES_BUDGET_MS } = options;
  const queue = [...new Set(urls)];
  let loaded = 0;
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        if (await load(url, IMAGE_TIMEOUT_MS)) loaded += 1;
      } catch {
        // A photo that can't be loaded never fails the download.
      }
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  const workers = Array.from({ length: Math.min(IMAGE_CONCURRENCY, queue.length) }, worker);
  await Promise.race([Promise.all(workers), expired]);
  clearTimeout(timer);
  return loaded;
}
