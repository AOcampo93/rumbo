import { EARTH_RADIUS_M, type LatLng, toDegrees, toRadians } from '@rumbo/geo-utils';
import { and, eq, gte, lte, or, type SQL } from 'drizzle-orm';
import { routes } from './db/schema.js';

// What makes a user route part of the community (phase 7.2, ADR 0004): its
// owner made it public and nobody took it down. Curated routes are not part of
// it: they are always served, and never moderated.

type CommunityColumns = Pick<typeof routes.$inferSelect, 'source' | 'visibility' | 'moderation'>;

/** Whether anyone may list, read and report this route without being its owner. */
export const isCommunityRoute = (row: CommunityColumns): boolean =>
  row.source === 'user' && row.visibility === 'public' && row.moderation === 'visible';

/** The same test, as a condition. */
export const communityFilter = and(
  eq(routes.source, 'user'),
  eq(routes.visibility, 'public'),
  eq(routes.moderation, 'visible'),
);

/** The box is a hair larger than needed: the exact distance is checked afterwards. */
const BOX_SLACK = 1.001;

/**
 * A condition on the routes' centroids: inside the box that contains every
 * point within `meters` of `center`. It narrows the rows to read; it isn't the
 * distance (the corners of the box are farther than `meters`).
 */
export function centroidNear(center: LatLng, meters: number): SQL | undefined {
  const angle = meters / EARTH_RADIUS_M;
  const latitudeSpan = toDegrees(angle) * BOX_SLACK;
  const south = center.lat - latitudeSpan;
  const north = center.lat + latitudeSpan;
  const latitudes = and(gte(routes.centroidLat, south), lte(routes.centroidLat, north));
  // Next to a pole every longitude is within reach.
  if (north >= 90 || south <= -90) return latitudes;

  const longitudeSpan =
    toDegrees(Math.asin(Math.sin(angle) / Math.cos(toRadians(center.lat)))) * BOX_SLACK;
  const west = center.lng - longitudeSpan;
  const east = center.lng + longitudeSpan;
  // Across the antimeridian the box has two parts.
  if (west < -180) {
    return and(latitudes, or(gte(routes.centroidLng, west + 360), lte(routes.centroidLng, east)));
  }
  if (east > 180) {
    return and(latitudes, or(gte(routes.centroidLng, west), lte(routes.centroidLng, east - 360)));
  }
  return and(latitudes, gte(routes.centroidLng, west), lte(routes.centroidLng, east));
}
