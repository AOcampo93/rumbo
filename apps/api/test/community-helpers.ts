import { randomUUID } from 'node:crypto';
import type { ReportReason, RouteVisibility } from '@rumbo/api-contract';
import { buildRouteSpec } from '@rumbo/route-builder';
import { destination, type LatLng } from '@rumbo/geo-utils';
import type { RouteSpec } from '@rumbo/route-spec';
import { asc, eq } from 'drizzle-orm';
import { routeReports, routes } from '../src/db/schema.js';
import { DEVICE, OTHER_DEVICE, OTHER_TOKEN, type setupApi, TOKEN, userRoute } from './helpers.js';

// What the tests of the community routes (phase 7.2) share: who owns a route
// and who doesn't, and the few calls and queries they repeat.

export type Api = Awaited<ReturnType<typeof setupApi>>;
export type Headers = Record<string, string>;

/** The device that made the routes of these tests, and another one. */
export const owner: Headers = { 'x-edit-token': TOKEN, 'x-device-id': DEVICE };
export const stranger: Headers = { 'x-edit-token': OTHER_TOKEN, 'x-device-id': OTHER_DEVICE };

interface CreateOptions {
  visibility?: RouteVisibility;
  headers?: Headers;
  spec?: RouteSpec;
}

/** POST /routes: a user route (the Leiria one unless `spec` says otherwise). */
export const create = (api: Api, id: string, options: CreateOptions = {}) =>
  api.app.inject({
    method: 'POST',
    url: '/api/v1/routes',
    headers: options.headers ?? owner,
    payload: {
      spec: options.spec ?? userRoute(id),
      contents: {},
      ...(options.visibility ? { visibility: options.visibility } : {}),
    },
  });

/** PUT /routes/:id with the route's own token. */
export const replace = (
  api: Api,
  id: string,
  options: { visibility?: RouteVisibility; headers?: Headers; spec?: RouteSpec } = {},
) =>
  api.app.inject({
    method: 'PUT',
    url: `/api/v1/routes/${id}`,
    headers: options.headers ?? { 'x-edit-token': TOKEN },
    payload: {
      spec: options.spec ?? userRoute(id),
      contents: {},
      ...(options.visibility ? { visibility: options.visibility } : {}),
    },
  });

/** A public user route, stored through the API. */
export async function publish(
  api: Api,
  id: string,
  options: Omit<CreateOptions, 'visibility'> = {},
) {
  const res = await create(api, id, { ...options, visibility: 'public' });
  if (res.statusCode !== 201) throw new Error(`could not publish ${id}: ${res.body}`);
}

/** GET /routes/:id. */
export const read = (api: Api, id: string, headers: Headers = {}) =>
  api.app.inject({ method: 'GET', url: `/api/v1/routes/${id}`, headers });

/** GET /routes/:id/status. */
export const status = (api: Api, id: string, headers: Headers = { 'x-edit-token': TOKEN }) =>
  api.app.inject({ method: 'GET', url: `/api/v1/routes/${id}/status`, headers });

/** POST /routes/:id/reports from a device (a new one by default). */
export const report = (
  api: Api,
  id: string,
  device: string = randomUUID(),
  reason: ReportReason = 'spam',
  headers: Headers = {},
) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/routes/${id}/reports`,
    headers: { 'x-device-id': device, ...headers },
    payload: { reason },
  });

/** `count` reports, each from its own device. */
export async function reportFromNew(api: Api, id: string, count: number): Promise<string[]> {
  const devices = Array.from({ length: count }, () => randomUUID());
  for (const device of devices) {
    const res = await report(api, id, device);
    if (res.statusCode !== 201) throw new Error(`could not report ${id}: ${res.body}`);
  }
  return devices;
}

/** The route's row. */
export const routeRow = async (api: Api, id: string) =>
  (await api.db.select().from(routes).where(eq(routes.id, id)))[0];

/** Every report of the route, open and closed, oldest first. */
export const reportsOf = (api: Api, id: string) =>
  api.db
    .select()
    .from(routeReports)
    .where(eq(routeReports.routeId, id))
    .orderBy(asc(routeReports.id));

/** Moves the route's centroid (what GET /routes?near=… measures from) without rebuilding it. */
export async function moveTo(api: Api, id: string, position: LatLng): Promise<void> {
  await api.db
    .update(routes)
    .set({ centroidLat: position.lat, centroidLng: position.lng })
    .where(eq(routes.id, id));
}

/** `meters` from `from` along `bearing`: where the tests put routes. */
export const awayFrom = (from: LatLng, bearing: number, meters: number): LatLng =>
  destination(from, bearing, meters);

/** The route of three places around `center`, with the mode and activity a test needs. */
export function routeAround(
  id: string,
  center: LatLng,
  options: { name?: string; mode?: 'free' | 'challenge'; activity?: 'walk' | 'bike' } = {},
): RouteSpec {
  const places = [0, 120, 240].map((bearing, i) => ({
    tempId: `p${i}`,
    name: `Lugar ${i + 1}`,
    position: destination(center, bearing, 60),
  }));
  return buildRouteSpec(
    {
      name: options.name ?? 'Ruta de la comunidad',
      locale: 'es',
      mode: options.mode ?? 'free',
      activity: options.activity ?? 'walk',
      places,
    },
    { source: 'user', id },
  ).spec;
}
