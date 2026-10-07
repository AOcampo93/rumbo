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

/** The numbers shown on route cards and stored next to each route for listing. */
export function summarizeRoute(spec: RouteSpec): RouteSummary {
  const route = normalizeRouteSpec(spec);
  const stops = route.points.map((p) => p.position);
  const distanceMeters = polylineLength(route.path ?? stops);
  const movingMinutes = distanceMeters / route.settings.expectedSpeed / 60;
  const minutes = movingMinutes + route.points.length * VISIT_MINUTES[route.mode];
  const everything = [...stops, ...(route.path ?? [])];
  return {
    pointCount: route.points.length,
    distanceMeters: Math.round(distanceMeters),
    estimatedMinutes: Math.max(5, Math.round(minutes / 5) * 5),
    centroid: centroid(everything),
    bbox: bbox(everything),
  };
}
