import { DEVICE_ID_HEADER, DeviceIdSchema } from '@rumbo/api-contract';
import type { FastifyRequest } from 'fastify';
import type { Db } from './db/index.js';
import { devices } from './db/schema.js';
import { fail } from './errors.js';

// The anonymous device id (PROJECT_PLAN §10.8): a random UUID the app keeps.
// Not authentication: it rate-limits and, from phase 6, owns drafts.

export function deviceIdFrom(request: FastifyRequest): string | null {
  const parsed = DeviceIdSchema.safeParse(request.headers[DEVICE_ID_HEADER]);
  return parsed.success ? parsed.data : null;
}

export function requireDeviceId(request: FastifyRequest): string {
  const id = deviceIdFrom(request);
  if (!id) throw fail(400, 'missing_device_id');
  return id;
}

/** A rough platform from the User-Agent; nothing more precise is kept. */
export function platformOf(userAgent: string | undefined): 'ios' | 'android' | 'desktop' | 'other' {
  if (!userAgent) return 'other';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/i.test(userAgent)) return 'desktop';
  return 'other';
}

/** Records the device on its first request and refreshes `last_seen` after. */
export async function touchDevice(
  db: Db,
  id: string,
  userAgent: string | undefined,
): Promise<void> {
  await db
    .insert(devices)
    .values({ id, platform: platformOf(userAgent) })
    .onConflictDoUpdate({ target: devices.id, set: { lastSeen: new Date() } });
}
