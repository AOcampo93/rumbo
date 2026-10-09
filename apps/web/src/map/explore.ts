import { INTERESTS, type Interest } from '@rumbo/api-contract';
import type { LatLng } from '@rumbo/geo-utils';
import {
  type Activity,
  ActivitySchema,
  type Locale,
  type PointCategory,
  type Poi,
} from '@rumbo/route-spec';
import { localizedIn } from '../i18n/text.ts';
import { type CatalogRoute, isCommunityRoute } from '../services/catalog.ts';
import { ACTIVITY_LOOKS } from './symbols.ts';
import type { MapLine, MapMarker } from './types.ts';

// What the Explore map draws (PROJECT_PLAN §10.4, ADR 0005): every point of
// every route, coloured by the route's activity, plus the points of interest;
// or, in the routes view, a line per route. And what narrows them down: the
// filter of the sheet and the entries of the legend.

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** What the map shows: the pins and the points of interest, or the routes as lines. */
export type MapMode = 'points' | 'routes';

/** Where a route comes from: the app's own, other people's (published) or the user's. */
export type RouteOrigin = 'curated' | 'community' | 'mine';

/** The origins in the order the filter lists them. */
export const ROUTE_ORIGINS: readonly RouteOrigin[] = ['curated', 'community', 'mine'];

/** The activities in the order the legend lists them. */
export const ACTIVITIES: readonly Activity[] = ActivitySchema.options;

export interface ExploreFilter {
  /** Route ids hidden from the map. */
  hiddenRoutes: ReadonlySet<string>;
  showPois: boolean;
  /** Empty = every category. */
  categories: ReadonlySet<PointCategory>;
}

/** The route a marker belongs to ("leiria-historica/castelo" is of "leiria-historica"). */
export const markerRouteId = (markerId: string): string => markerId.split('/')[0] ?? '';

export function routeMarkers(
  routes: readonly CatalogRoute[],
  locale: Locale,
  t: Translate,
): MapMarker[] {
  return routes.flatMap((route) => {
    const spec = route.bundle.spec;
    const routeName = localizedIn(spec.name, locale, spec.locale);
    // The pins take their activity's colour (the legend says which is which), not one per route.
    const { color } = ACTIVITY_LOOKS[spec.activity];
    return spec.points.map((point) => {
      const category = point.category ?? 'other';
      const name = localizedIn(point.name, locale, spec.locale);
      return {
        id: `${route.id}/${point.id}`,
        position: point.position,
        category,
        state: 'explore' as const,
        color,
        popup: {
          kicker: routeName,
          title: name,
          chips: [
            { label: t(`category.${category}`) },
            { label: t(`activity.${spec.activity}`), color },
          ],
          actions: [{ id: 'viewRoute', label: t('popup.viewRoute'), primary: true }],
        },
      };
    });
  });
}

/** What a route's line follows: its drawn path, or else straight legs from point to point, in order. */
export function routePath(route: CatalogRoute): LatLng[] {
  const { path, points } = route.bundle.spec;
  if (path && path.length >= 2) return path;
  return [...points].sort((a, b) => a.order - b.order).map((point) => point.position);
}

/**
 * One line per route, in its activity's colour and style. With a route
 * selected, that one is the strong line and the others fade.
 */
export function routeLines(
  routes: readonly CatalogRoute[],
  locale: Locale,
  selectedId: string | null = null,
): MapLine[] {
  return routes.map((route) => {
    const spec = route.bundle.spec;
    const { color, line } = ACTIVITY_LOOKS[spec.activity];
    return {
      id: route.id,
      points: routePath(route),
      color,
      style: line,
      emphasis: selectedId === null ? 'normal' : route.id === selectedId ? 'strong' : 'dim',
      label: localizedIn(spec.name, locale, spec.locale),
    };
  });
}

/** Fades the markers of every route but the selected one (none selected: nothing fades). */
export function dimMarkers(markers: readonly MapMarker[], selectedId: string | null): MapMarker[] {
  if (selectedId === null) return [...markers];
  return markers.map((marker) =>
    marker.state === 'explore' && markerRouteId(marker.id) !== selectedId
      ? { ...marker, dim: true }
      : marker,
  );
}

/** The Wikipedia article in the user's language, or the closest one available. */
export function wikipediaFor(poi: Poi, locale: Locale): string | undefined {
  const links = poi.wikipedia ?? {};
  return links[locale] ?? links.pt ?? links.en ?? links.es;
}

export function poiMarkers(
  pois: ReadonlyArray<{ poi: Poi; locale: Locale }>,
  locale: Locale,
  t: Translate,
): MapMarker[] {
  return pois.map(({ poi, locale: source }) => {
    const name = localizedIn(poi.name, locale, source);
    const wiki = wikipediaFor(poi, locale);
    const credit = [poi.image?.credit, poi.image?.license].filter(Boolean).join(' · ');
    return {
      id: `poi/${poi.id}`,
      position: poi.position,
      category: poi.category,
      state: 'poi' as const,
      popup: {
        kicker: t('popup.poi'),
        title: name,
        chips: [{ label: t(`category.${poi.category}`) }],
        ...(poi.image
          ? {
              image: {
                url: poi.image.url,
                alt: localizedIn(poi.image.alt, locale, source),
                ...(credit ? { credit } : {}),
              },
            }
          : {}),
        actions: wiki ? [{ id: 'wikipedia', label: t('popup.wikipedia'), href: wiki }] : [],
      },
    };
  });
}

export function filterMarkers(markers: readonly MapMarker[], filter: ExploreFilter): MapMarker[] {
  return markers.filter((marker) => {
    if (filter.categories.size > 0 && !filter.categories.has(marker.category)) return false;
    if (marker.state === 'poi') return filter.showPois;
    return !filter.hiddenRoutes.has(markerRouteId(marker.id));
  });
}

// ---------------------------------------------------------------- filtering routes

/** Official routes are the curated ones; the user's own carry `mine`; any other user route is the community's. */
export function routeOrigin(route: CatalogRoute): RouteOrigin {
  if (route.mine) return 'mine';
  return isCommunityRoute(route) ? 'community' : 'curated';
}

/** What a route was made for (`meta.interests`), in the contract's order; anything unknown is left out. */
export function routeInterests(route: CatalogRoute): Interest[] {
  const chosen = route.bundle.spec.meta?.['interests'];
  if (!Array.isArray(chosen)) return [];
  return INTERESTS.filter((interest) => chosen.includes(interest));
}

/** The origins the routes come from, in the filter's order. */
export function presentOrigins(routes: readonly CatalogRoute[]): RouteOrigin[] {
  return ROUTE_ORIGINS.filter((origin) => routes.some((route) => routeOrigin(route) === origin));
}

/** The interests some route has, in the contract's order. */
export function presentInterests(routes: readonly CatalogRoute[]): Interest[] {
  return INTERESTS.filter((interest) =>
    routes.some((route) => routeInterests(route).includes(interest)),
  );
}

export interface RouteFilter {
  /** Origins to keep; empty = every origin. */
  origins: ReadonlySet<RouteOrigin>;
  /** Routes to keep: the ones made for any of these; empty = every route. */
  interests: ReadonlySet<Interest>;
}

/**
 * The routes that pass the filter. An origin or an interest that no route has
 * at the moment doesn't count (the sheet only offers what exists), so the
 * filter can't hide everything behind a chip nobody can see.
 */
export function filterRoutes(routes: readonly CatalogRoute[], filter: RouteFilter): CatalogRoute[] {
  const origins = new Set(presentOrigins(routes).filter((origin) => filter.origins.has(origin)));
  const interests = new Set(
    presentInterests(routes).filter((interest) => filter.interests.has(interest)),
  );
  return routes.filter(
    (route) =>
      (origins.size === 0 || origins.has(routeOrigin(route))) &&
      (interests.size === 0 || routeInterests(route).some((interest) => interests.has(interest))),
  );
}

// ---------------------------------------------------------------- legend

export interface LegendEntries {
  /** The activities of the routes on the map, in the legend's order. */
  activities: Activity[];
  /** "Lugares de interés": only in the points view, while there are some on the map. */
  places: boolean;
}

/**
 * What the legend lists: no route names, just the activities present (with
 * their line, in the routes view) and the points of interest. `routes` are the
 * routes shown and `markers` the markers drawn; in the points view a route
 * whose every pin is filtered out is not on the map, so it isn't listed.
 */
export function legendEntries(
  mode: MapMode,
  routes: readonly CatalogRoute[],
  markers: readonly MapMarker[],
): LegendEntries {
  const pinned = new Set(
    markers
      .filter((marker) => marker.state === 'explore')
      .map((marker) => markerRouteId(marker.id)),
  );
  const onMap = mode === 'routes' ? routes : routes.filter((route) => pinned.has(route.id));
  const present = new Set(onMap.map((route) => route.bundle.spec.activity));
  return {
    activities: ACTIVITIES.filter((activity) => present.has(activity)),
    places: mode === 'points' && markers.some((marker) => marker.state === 'poi'),
  };
}
