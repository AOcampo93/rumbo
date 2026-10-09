import {
  EDIT_TOKEN_HEADER,
  type ReportReason,
  RouteIdParamsSchema,
  type RouteOwnerStatus,
  RouteOwnerStatusSchema,
  RouteReportResponseSchema,
} from '@rumbo/api-contract';
import type { LatLng } from '@rumbo/geo-utils';
import { type RouteBundle, validateRouteBundle } from '@rumbo/route-spec';
import { api, apiErrorCode } from './api.ts';
import { db, KEYS } from './storage.ts';

// What the app asks of the API about the community's routes (phase 7.2,
// ADR 0004): the routes around a position and their bundles, the owner's view
// of their own published route, and the reports. Every call answers with a
// plain value and never throws: a community route that can't be loaded must
// never break the screen that asked.

const API_TIMEOUT_MS = 6000;

/** Rounds to 3 decimals (about 110 m), as the server does: an exact position never leaves the device. */
const round3 = (value: number): string => (Math.round(value * 1000) / 1000 || 0).toFixed(3);

/** The value of `?near=`: "lat,lng" with 3 decimals. */
export const nearParam = (position: LatLng): string =>
  `${round3(position.lat)},${round3(position.lng)}`;

const routeId = RouteIdParamsSchema.shape.id;

/**
 * GET /routes?near=…: the ids of the routes around a position, nearest first.
 * The curated routes are in the list too; the caller knows which they are.
 * Null when the API doesn't answer, or what answers isn't its list.
 */
export async function nearbyRouteIds(
  position: LatLng,
  signal?: AbortSignal,
): Promise<string[] | null> {
  try {
    const response = await api(`/routes?near=${nearParam(position)}`, {
      timeoutMs: API_TIMEOUT_MS,
      signal,
    });
    if (!response.ok) return null;
    const list = (await response.json()) as unknown;
    if (!Array.isArray(list)) return null;
    return list.flatMap((item: unknown) => {
      const id = routeId.safeParse(
        typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : undefined,
      );
      return id.success ? [id.data] : [];
    });
  } catch {
    return null;
  }
}

/**
 * GET /routes/:id: a route's bundle (anyone reads a public one). 'gone' when
 * the API says there is no such route (never published, taken back or taken
 * down); null when it can't tell (offline, an error, not a valid bundle).
 */
export async function fetchRouteBundle(
  id: string,
  signal?: AbortSignal,
): Promise<RouteBundle | 'gone' | null> {
  try {
    const response = await api(`/routes/${encodeURIComponent(id)}`, {
      timeoutMs: API_TIMEOUT_MS,
      signal,
    });
    if (response.status === 404 && (await apiErrorCode(response)) !== null) return 'gone';
    if (!response.ok) return null;
    return validateRouteBundle(await response.json()).bundle ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /routes/:id/status: what others can see of the route, for its owner.
 * Null when it can't be known (offline, the server has no such route…): the
 * screen then keeps what the device knows.
 */
export async function fetchOwnerStatus(
  id: string,
  editToken: string,
  signal?: AbortSignal,
): Promise<RouteOwnerStatus | null> {
  try {
    const response = await api(`/routes/${encodeURIComponent(id)}/status`, {
      headers: { [EDIT_TOKEN_HEADER]: editToken },
      timeoutMs: API_TIMEOUT_MS,
      signal,
    });
    if (!response.ok) return null;
    const parsed = RouteOwnerStatusSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * POST /routes/:id/reports. 'sent' on the API's `{ received: true }` (a new
 * report and a repeated one look the same). 'gone' when it no longer takes
 * reports for the route (hidden, taken back or deleted meanwhile): nothing
 * left to report. 'failed' for anything else, offline included.
 */
export async function sendReport(
  id: string,
  reason: ReportReason,
): Promise<'sent' | 'gone' | 'failed'> {
  try {
    const response = await api(`/routes/${encodeURIComponent(id)}/reports`, {
      method: 'POST',
      device: true,
      body: { reason },
      timeoutMs: API_TIMEOUT_MS,
    });
    if (response.status === 404 && (await apiErrorCode(response)) === 'route_not_found') {
      return 'gone';
    }
    if (!response.ok) return 'failed';
    return RouteReportResponseSchema.safeParse(await response.json()).success ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

// ------------------------------------------------------------------ reported routes

/** More reports than anyone sends; the oldest are forgotten. */
const MAX_REPORTED = 500;

/** The routes this device reported. Empty when storage can't be read. */
export async function reportedRoutes(): Promise<Set<string>> {
  return new Set((await db.get<string[]>(KEYS.reportedRoutes)) ?? []);
}

/** Remembers that this device reported the route, so the app doesn't offer to again. Best effort. */
export async function rememberReported(id: string): Promise<void> {
  try {
    await db.update<string[]>(KEYS.reportedRoutes, (old) =>
      old?.includes(id) ? old : [...(old ?? []), id].slice(-MAX_REPORTED),
    );
  } catch {
    // Storage unavailable: the button simply comes back next time.
  }
}
