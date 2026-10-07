import { db, KEYS } from './storage.ts';

// Anonymous product analytics (PROJECT_PLAN §13): only with consent, never
// with coordinates, sent in batches every 30 s or when the page is hidden.
// The endpoint arrives with the API in phase 5; until then batches that get
// a 4xx are dropped, not retried.

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
  const body = JSON.stringify({ events: batch });
  try {
    if (
      useBeacon &&
      navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))
    )
      return;
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    });
    if (response.status >= 500) queue = [...batch, ...queue].slice(-MAX_QUEUE);
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
