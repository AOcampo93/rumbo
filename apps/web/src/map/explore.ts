import type { Locale, PointCategory, Poi } from '@rumbo/route-spec';
import { localizedIn } from '../i18n/text.ts';
import type { CatalogRoute } from '../services/catalog.ts';
import type { MapMarker } from './types.ts';

// Markers of the Explore map (PROJECT_PLAN §10.4): every point of every
// curated route, coloured by route, plus the points of interest.

type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface ExploreFilter {
  /** Route ids hidden from the map. */
  hiddenRoutes: ReadonlySet<string>;
  showPois: boolean;
  /** Empty = every category. */
  categories: ReadonlySet<PointCategory>;
}

export function routeMarkers(
  routes: readonly CatalogRoute[],
  locale: Locale,
  t: Translate,
): MapMarker[] {
  return routes.flatMap((route) => {
    const spec = route.bundle.spec;
    const routeName = localizedIn(spec.name, locale, spec.locale);
    return spec.points.map((point) => {
      const category = point.category ?? 'other';
      const name = localizedIn(point.name, locale, spec.locale);
      return {
        id: `${route.id}/${point.id}`,
        position: point.position,
        category,
        state: 'explore' as const,
        color: route.color,
        popup: {
          kicker: routeName,
          title: name,
          chips: [{ label: t(`category.${category}`) }, { label: routeName, color: route.color }],
          actions: [{ id: 'viewRoute', label: t('popup.viewRoute'), primary: true }],
        },
      };
    });
  });
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
    const routeId = marker.id.split('/')[0] ?? '';
    return !filter.hiddenRoutes.has(routeId);
  });
}
