import { db, KEYS } from './storage.ts';

// The anonymous device id (PROJECT_PLAN §10.8): a random UUID made on first
// use and kept in IndexedDB. Not authentication: the API uses it to rate-limit,
// to tie a run's start to its end and, later, to own the routes you create.

let cached: Promise<string> | null = null;

function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Older browsers: a v4 UUID from getRandomValues.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deviceId(): Promise<string> {
  cached ??= (async () => {
    const saved = await db.get<string>(KEYS.deviceId);
    if (saved) return saved;
    const id = randomId();
    await db.set(KEYS.deviceId, id);
    return id;
  })();
  return cached;
}

/** After "Delete my local data": a new id from now on. */
export function forgetDeviceId(): void {
  cached = null;
}
