import { type BBox, bbox, centroid, type LatLng, polylineLength } from '@rumbo/geo-utils';
import { normalizeRouteSpec, type RouteMode, type RouteSpec } from '@rumbo/route-spec';

/** Average stop at each point: a free route invites a visit, a challenge just a check-in. */
export const VISIT_MINUTES: Record<RouteMode, number> = { free: 6, challenge: 0.5 };

export interface RouteSummary {
  pointCount: number;
  /** Along the drawn path when there is one, otherwise point to point in order. */
  distanceMeters: number;
  /** Moving time at the activity's expected speed plus the stops, rounded to 5 min. */
  estimatedMinutes: number;
  centroid: LatLng;
  bbox: BBox;
}

/**
 * Moving time at `expectedSpeed` (m/s) plus a stop at each point, rounded to
 * 5 min and never under 5. Shared by routes and the creator's live estimate.
 */
export function estimateMinutes(
  distanceMeters: number,
  stops: number,
  mode: RouteMode,
  expectedSpeed: number,
): number {
  const minutes = distanceMeters / expectedSpeed / 60 + stops * VISIT_MINUTES[mode];
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/** The numbers shown on route cards and stored next to each route for listing. */
export function summarizeRoute(spec: RouteSpec): RouteSummary {
  const route = normalizeRouteSpec(spec);
  const stops = route.points.map((p) => p.position);
  const distanceMeters = polylineLength(route.path ?? stops);
  const everything = [...stops, ...(route.path ?? [])];
  return {
    pointCount: route.points.length,
    distanceMeters: Math.round(distanceMeters),
    estimatedMinutes: estimateMinutes(
      distanceMeters,
      route.points.length,
      route.mode,
      route.settings.expectedSpeed,
    ),
    centroid: centroid(everything),
    bbox: bbox(everything),
  };
}
