import { EARTH_RADIUS_M, type LatLng, toDegrees, toRadians, wrapLongitude } from './latlng.ts';

/** Great-circle distance between two points, in metres (haversine formula). */
export function distance(a: LatLng, b: LatLng): number {
  const phi1 = toRadians(a.lat);
  const phi2 = toRadians(b.lat);
  const dPhi = phi2 - phi1;
  const dLambda = toRadians(b.lng - a.lng);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  // min() guards against values a hair above 1 caused by floating-point error.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Normalizes any angle in degrees into [0, 360). */
export function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Initial bearing from `a` towards `b`, in degrees clockwise from north, in [0, 360).
 * This is what the HUD arrow points at. Identical points return 0.
 */
export function bearing(a: LatLng, b: LatLng): number {
  const phi1 = toRadians(a.lat);
  const phi2 = toRadians(b.lat);
  const dLambda = toRadians(b.lng - a.lng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalizeBearing(toDegrees(Math.atan2(y, x)));
}

/**
 * The point reached by travelling `meters` from `origin` along `bearingDegrees`.
 * Used by the simulated position source and to build test trajectories.
 */
export function destination(origin: LatLng, bearingDegrees: number, meters: number): LatLng {
  const delta = meters / EARTH_RADIUS_M;
  const theta = toRadians(bearingDegrees);
  const phi1 = toRadians(origin.lat);
  const lambda1 = toRadians(origin.lng);
  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * sinPhi2,
    );
  return { lat: toDegrees(phi2), lng: wrapLongitude(toDegrees(lambda2)) };
}
