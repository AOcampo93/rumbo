import { EARTH_RADIUS_M, type LatLng, toDegrees, toRadians, wrapLongitude } from './latlng.ts';
import { distance } from './sphere.ts';

/** Coordinates in metres on a local plane (x grows east, y grows north). */
export interface XY {
  x: number;
  y: number;
}

/**
 * Projects `p` onto a local plane centred on `origin` (equirectangular).
 * Within a few kilometres the error stays well under 0.5 %, which is plenty for
 * a walking or cycling route. Never use it for long distances: use `distance`.
 */
export function toLocalXY(origin: LatLng, p: LatLng): XY {
  return {
    x:
      toRadians(wrapLongitude(p.lng - origin.lng)) *
      EARTH_RADIUS_M *
      Math.cos(toRadians(origin.lat)),
    y: toRadians(p.lat - origin.lat) * EARTH_RADIUS_M,
  };
}

/** Inverse of {@link toLocalXY}. */
export function fromLocalXY(origin: LatLng, xy: XY): LatLng {
  return {
    lat: origin.lat + toDegrees(xy.y / EARTH_RADIUS_M),
    lng: wrapLongitude(
      origin.lng + toDegrees(xy.x / (EARTH_RADIUS_M * Math.cos(toRadians(origin.lat)))),
    ),
  };
}

export interface ClosestPoint {
  /** Distance from the query point, in metres. */
  distance: number;
  /** The closest point itself. */
  point: LatLng;
  /** Position along the segment: 0 at its start, 1 at its end. */
  t: number;
}

export interface PolylineMatch extends ClosestPoint {
  /** Index of the segment's first vertex in the polyline. */
  index: number;
}

/** Point-to-segment distance on the plane, with every coordinate already in metres. */
function closestOnPlanarSegment(
  p: XY,
  a: XY,
  b: XY,
): { distance: number; t: number; x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const raw = lengthSquared === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  const t = Math.min(1, Math.max(0, raw));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return { distance: Math.hypot(p.x - x, p.y - y), t, x, y };
}

/** Closest point of segment `a`–`b` to `p`. Projected around `p` for accuracy. */
export function closestPointOnSegment(p: LatLng, a: LatLng, b: LatLng): ClosestPoint {
  const origin = { x: 0, y: 0 };
  const hit = closestOnPlanarSegment(origin, toLocalXY(p, a), toLocalXY(p, b));
  return { distance: hit.distance, t: hit.t, point: fromLocalXY(p, { x: hit.x, y: hit.y }) };
}

/** Shortest distance in metres from `p` to segment `a`–`b`. */
export function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  return closestPointOnSegment(p, a, b).distance;
}

/**
 * Closest point of a polyline to `p`. A single-vertex polyline behaves as a point.
 * The engine uses this to measure how far the user is from the planned path.
 */
export function closestPointOnPolyline(p: LatLng, line: readonly LatLng[]): PolylineMatch {
  const [first] = line;
  if (!first) throw new RangeError('closestPointOnPolyline: the polyline is empty');
  let best: PolylineMatch = { distance: distance(p, first), point: first, t: 0, index: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    if (!a || !b) continue;
    const hit = closestPointOnSegment(p, a, b);
    if (hit.distance < best.distance) best = { ...hit, index: i };
  }
  return best;
}

/** Shortest distance in metres from `p` to a polyline. */
export function distanceToPolyline(p: LatLng, line: readonly LatLng[]): number {
  return closestPointOnPolyline(p, line).distance;
}

/** Total length of a polyline in metres. Fewer than two vertices measure 0. */
export function polylineLength(line: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (a && b) total += distance(a, b);
  }
  return total;
}

/**
 * Douglas–Peucker simplification with a tolerance in metres. It always keeps
 * the first and last vertices. The engine uses it to cap long GPS tracks.
 * Iterative, so 5,000-point tracks don't risk a deep recursion.
 */
export function simplify(line: readonly LatLng[], toleranceM: number): LatLng[] {
  const [origin] = line;
  if (!origin || line.length <= 2) return [...line];
  const points = line.map((p) => toLocalXY(origin, p));
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, line.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    const a = points[first] as XY;
    const b = points[last] as XY;
    let farthest = -1;
    let farthestDistance = -1;
    for (let i = first + 1; i < last; i++) {
      const d = closestOnPlanarSegment(points[i] as XY, a, b).distance;
      if (d > farthestDistance) {
        farthestDistance = d;
        farthest = i;
      }
    }
    if (farthest !== -1 && farthestDistance > toleranceM) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return line.filter((_, i) => keep[i] === 1);
}
