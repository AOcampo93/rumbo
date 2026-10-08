import { DEVICE_ID_HEADER } from '@rumbo/api-contract';
import { deviceId } from './device.ts';
import { db, KEYS } from './storage.ts';

// Anonymous product analytics (PROJECT_PLAN §13): only with consent, never
// with coordinates, sent in batches every 30 s or when the page is hidden.
// Batches the API refuses (4xx) are dropped; network errors, 5xx and rate
// limits keep them for the next try.

export interface AnalyticsEvent {
  name: string;
  props: Record<string, unknown>;
  at: number;
}

const ENDPOINT = '/api/v1/analytics/batch';
const MAX_QUEUE = 200;
const FLUSH_MS = 30_000;

let queue: AnalyticsEvent[] = [];
let consent: () => boolean = () => false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Starts the batching; `hasConsent` is read on every event. */
export async function initAnalytics(hasConsent: () => boolean): Promise<void> {
  consent = hasConsent;
  queue = (await db.get<AnalyticsEvent[]>(KEYS.analyticsQueue)) ?? [];
  timer ??= setInterval(() => void flush(), FLUSH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true);
  });
}

export function track(name: string, props: Record<string, unknown> = {}): void {
  if (!consent()) return;
  queue.push({ name, props, at: Date.now() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  void db.set(KEYS.analyticsQueue, queue);
}

export async function flush(useBeacon = false): Promise<void> {
  if (queue.length === 0 || !consent() || !navigator.onLine) return;
  const batch = queue;
  queue = [];
  void db.set(KEYS.analyticsQueue, queue);
  const device = await deviceId();
  // sendBeacon can't set headers: the device id also travels in the body.
  const body = JSON.stringify({ deviceId: device, events: batch });
  try {
    if (
      useBeacon &&
      navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))
    )
      return;
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [DEVICE_ID_HEADER]: device },
      body,
      keepalive: true,
    });
    if (response.status >= 500 || response.status === 429)
      queue = [...batch, ...queue].slice(-MAX_QUEUE);
  } catch {
    // Offline or blocked: try again next time.
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
  }
}

/** Forgets queued events (consent withdrawn, local data cleared). */
export function clearAnalytics(): void {
  queue = [];
  void db.del(KEYS.analyticsQueue);
}

export function stopAnalytics(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
