import { type LatLng, toDegrees, toRadians } from './latlng.ts';

/** Bounding box in GeoJSON order: [west, south, east, north]. */
export type BBox = [west: number, south: number, east: number, north: number];

/** Smallest box containing every point. Assumes the points don't cross the antimeridian. */
export function bbox(points: readonly LatLng[]): BBox {
  if (points.length === 0) throw new RangeError('bbox: no points');
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  return [west, south, east, north];
}

/**
 * Geographic centre of the points: the average of their unit vectors on the
 * sphere, which (unlike averaging degrees) also works across the antimeridian.
 */
export function centroid(points: readonly LatLng[]): LatLng {
  if (points.length === 0) throw new RangeError('centroid: no points');
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const phi = toRadians(p.lat);
    const lambda = toRadians(p.lng);
    x += Math.cos(phi) * Math.cos(lambda);
    y += Math.cos(phi) * Math.sin(lambda);
    z += Math.sin(phi);
  }
  return {
    lat: toDegrees(Math.atan2(z, Math.hypot(x, y))),
    lng: toDegrees(Math.atan2(y, x)),
  };
}
