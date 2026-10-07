import { type RouteSummary, summarizeRoute } from '@rumbo/route-builder';
import {
  LOCALES,
  type Locale,
  type Poi,
  PoiCollectionSchema,
  type RouteBundle,
  validateRouteBundle,
} from '@rumbo/route-spec';
import { ROUTE_COLORS } from '../map/symbols.ts';

// Where routes come from (PROJECT_PLAN §10.6): the API when it answers
// (phase 5), otherwise the curated routes bundled with the app from
// data/routes. Both end up as validated RouteBundles.

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

const API_TIMEOUT_MS = 4000;

/**
 * Routes from the API (`GET /api/v1/routes` → summaries, then each bundle).
 * Null when the API isn't there or fails: the caller falls back to the
 * bundled routes.
 */
export async function routesFromApi(fetcher: typeof fetch = fetch): Promise<CatalogRoute[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetcher('/api/v1/routes', {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const summaries = (await response.json()) as unknown;
    if (!Array.isArray(summaries) || summaries.length === 0) return null;
    const bundles: RouteBundle[] = [];
    for (const summary of summaries as Array<{ id?: unknown }>) {
      if (typeof summary.id !== 'string') continue;
      const one = await fetcher(`/api/v1/routes/${encodeURIComponent(summary.id)}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!one.ok) continue;
      const result = validateRouteBundle(await one.json());
      if (result.bundle) bundles.push(result.bundle);
    }
    return bundles.length > 0
      ? bundles.map((bundle, index) => toCatalogRoute(bundle, index))
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
