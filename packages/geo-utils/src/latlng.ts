/**
 * A WGS84 coordinate. Rumbo always uses `{ lat, lng }` objects instead of
 * arrays, because ArcGIS and GeoJSON put longitude first and arrays make that
 * mistake silent.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Mean Earth radius in metres (IUGG), used by every spherical formula here. */
export const EARTH_RADIUS_M = 6_371_008.8;

export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
export const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** True when both values are finite and inside the valid latitude/longitude ranges. */
export function isValidLatLng(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

/** Wraps a longitude (or a longitude difference) into [-180, 180). */
export function wrapLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}
