import type { RouteSummary } from '@rumbo/api-contract';
import { summarizeRoute } from '@rumbo/route-builder';
import {
  findLocalizedTexts,
  hashRouteSpec,
  type Locale,
  LOCALES,
  localesOf,
  type LocalizedText,
  type MediaRef,
  type NormalizedRouteSpec,
  type RouteSpec,
} from '@rumbo/route-spec';
import type { routes } from './db/schema.js';

type RouteRow = typeof routes.$inferSelect;
type RouteInsert = typeof routes.$inferInsert;

/** Languages in which every text of the route exists (plain strings count for all). */
export function completeLocales(spec: RouteSpec): Locale[] {
  const texts = findLocalizedTexts(spec, 'spec').map(({ text }) => text);
  return LOCALES.filter((locale) => texts.every((text) => localesOf(text).includes(locale)));
}

/** The row for a validated route: the authored spec plus the columns used to list it. */
export function routeRow(
  authored: RouteSpec,
  normalized: NormalizedRouteSpec,
): Omit<RouteInsert, 'createdAt' | 'updatedAt'> {
  const summary = summarizeRoute(normalized);
  return {
    id: normalized.id,
    spec: authored,
    specVersion: normalized.specVersion,
    specHash: hashRouteSpec(normalized),
    name: normalized.name,
    summary: normalized.summary ?? null,
    mode: normalized.mode,
    activity: normalized.activity,
    source: normalized.source,
    locale: normalized.locale,
    locales: completeLocales(normalized),
    coverImage: normalized.coverImage ?? null,
    pointCount: summary.pointCount,
    distanceM: summary.distanceMeters,
    estMinutes: summary.estimatedMinutes,
    centroidLat: summary.centroid.lat,
    centroidLng: summary.centroid.lng,
    bbox: summary.bbox,
    status: 'published',
  };
}

/** What GET /routes lists for each route. */
export function toSummary(row: RouteRow): RouteSummary {
  return {
    id: row.id,
    name: row.name as LocalizedText,
    ...(row.summary ? { summary: row.summary as LocalizedText } : {}),
    mode: row.mode as RouteSummary['mode'],
    activity: row.activity as RouteSummary['activity'],
    source: row.source as RouteSummary['source'],
    locale: row.locale as Locale,
    locales: row.locales as Locale[],
    ...(row.coverImage ? { coverImage: row.coverImage as MediaRef } : {}),
    pointCount: row.pointCount,
    distanceMeters: row.distanceM,
    estimatedMinutes: row.estMinutes,
    centroid: { lat: row.centroidLat, lng: row.centroidLng },
    bbox: row.bbox as RouteSummary['bbox'],
    updatedAt: row.updatedAt.toISOString(),
  };
}
