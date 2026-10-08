import type { Locale } from '@rumbo/route-spec';
import { currentLocale, onLocaleChange } from '../i18n/index.ts';
import { api } from './api.ts';
import { notificationsNeedInstall } from './platform.ts';

// Web Push (PROJECT_PLAN §10.5): reminders and announcements that reach the
// device while the app is closed; the service worker shows them (sw.ts,
// pushEvents.ts). The server only learns this device's push endpoint, never
// its position, so a push can never report an arrival: those stay local.
//
// The Settings switch shows one of these states:
//   unsupported    no service worker, Push API or notifications in this browser
//   needs-install  iPhone and iPad deliver push only to the app on the home screen
//   denied         notifications are blocked in the browser
//   off | on       the user's choice, once everything above allows it
//   unavailable    the server has push off, or can't be reached right now

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on' | 'unavailable';

/** How long to wait for the service worker to become active (a first visit). */
const READY_TIMEOUT_MS = 5000;

/** What the server stores of a subscription (POST /v1/push/subscriptions). */
interface SubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: Locale;
}

/** Everything push needs from the browser: a service worker, the Push API and notifications. */
function pushSupported(): boolean {
  return (
    'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis
  );
}

/** What rules push out before anything is asked, or null when the browser may go ahead. */
function blocker(): 'unsupported' | 'needs-install' | null {
  // First: Safari's tabs don't even have the Push API on iPhone and iPad, and
  // what the user needs there is the installed app, not a newer browser.
  if (notificationsNeedInstall()) return 'needs-install';
  return pushSupported() ? null : 'unsupported';
}

/** The page's service worker registration, or undefined when there is none (a development build). */
async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  try {
    return await navigator.serviceWorker.getRegistration();
  } catch {
    return undefined;
  }
}

/** The registration once its worker is active, which subscribing needs; null if it never is. */
async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  // With no worker at all `ready` would never settle.
  if (!(await registration())) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The VAPID public key: an uncompressed P-256 point (0x04 and two 32-byte coordinates), base64url on the wire. */
function decodeKey(publicKey: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(publicKey)) return null;
  try {
    const base64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytes.length === 65 && bytes[0] === 4 ? bytes : null;
  } catch {
    return null;
  }
}

/** The server's VAPID public key, or null when push is off there (503) or it can't be reached. */
async function serverKey(): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const response = await api('/push/key', { device: true });
    if (!response.ok) return null;
    const { publicKey } = (await response.json()) as { publicKey?: unknown };
    return typeof publicKey === 'string' ? decodeKey(publicKey) : null;
  } catch {
    return null;
  }
}

/** Whether the subscription was made with this key (a browser that doesn't say counts as yes). */
function usesKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const made = subscription.options?.applicationServerKey;
  if (!made) return true;
  const bytes = new Uint8Array(made);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

/** Subscribes this browser, replacing a subscription made with another key (a new key needs a new one). */
async function subscribeWith(
  worker: ServiceWorkerRegistration,
  key: Uint8Array<ArrayBuffer>,
): Promise<PushSubscription> {
  const existing = await worker.pushManager.getSubscription();
  if (existing && !usesKey(existing, key)) await existing.unsubscribe();
  return worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

/** Tells the server about this subscription: an upsert, so sending it again is harmless. True if it has it. */
async function register(subscription: PushSubscription): Promise<boolean> {
  const { endpoint, keys } = subscription.toJSON();
  const p256dh = keys?.['p256dh'];
  const auth = keys?.['auth'];
  if (!endpoint || !p256dh || !auth) return false;
  const body: SubscriptionBody = { endpoint, keys: { p256dh, auth }, locale: currentLocale() };
  try {
    const response = await api('/push/subscriptions', { method: 'POST', body, device: true });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Asks the server to forget a subscription. Best effort: one that stays is
 * harmless, since the push service answers 404 or 410 for an endpoint that was
 * unsubscribed and the server drops it at the next send.
 */
async function unregister(endpoint: string): Promise<void> {
  try {
    await api('/push/subscriptions', { method: 'DELETE', body: { endpoint }, device: true });
  } catch {
    // Offline: see above.
  }
}

/** Asks for the notification permission, unless the user already answered. */
async function askPermission(): Promise<NotificationPermission> {
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Where push stands on this device. Reads the browser, and the server only
 * when the answer would be "off": there is no point offering a switch the
 * server can't honour.
 */
export async function pushState(): Promise<PushState> {
  const blocked = blocker();
  if (blocked) return blocked;
  if (Notification.permission === 'denied') return 'denied';
  const worker = await registration();
  // Nothing can subscribe without a worker (a development build, or the first
  // moments of a first visit).
  if (!worker) return 'unavailable';
  const subscription = await worker.pushManager.getSubscription().catch(() => null);
  if (subscription && Notification.permission === 'granted') return 'on';
  return (await serverKey()) ? 'off' : 'unavailable';
}

/**
 * The switch turned on: permission, the server's key, a browser subscription,
 * and the server told about it. Call it straight from the tap: the permission
 * is asked before anything is awaited, because Safari only shows its prompt to
 * code that runs inside the tap. Never throws; returns the new state.
 */
export async function enablePush(): Promise<PushState> {
  const blocked = blocker();
  if (blocked) return blocked;
  const permission = await askPermission();
  if (permission === 'denied') return 'denied';
  // The prompt was dismissed without an answer.
  if (permission !== 'granted') return 'off';

  const key = await serverKey();
  if (!key) return 'unavailable';
  const worker = await activeRegistration();
  if (!worker) return 'unavailable';
  let subscription: PushSubscription;
  try {
    subscription = await subscribeWith(worker, key);
  } catch {
    // The permission went away meanwhile, or the browser's push service can't
    // be reached (offline, a browser with Google's services off).
    return Notification.permission === 'denied' ? 'denied' : 'unavailable';
  }
  if (!(await register(subscription))) {
    // Browser and server must agree: no half-subscribed device.
    await subscription.unsubscribe().catch(() => false);
    return 'unavailable';
  }
  return 'on';
}

/** The switch turned off: unsubscribes the browser, then tells the server. Never throws; returns the new state. */
export async function disablePush(): Promise<PushState> {
  const blocked = blocker();
  if (blocked) return blocked;
  const worker = await registration();
  const subscription = await worker?.pushManager.getSubscription().catch(() => null);
  if (subscription) {
    const { endpoint } = subscription;
    try {
      await subscription.unsubscribe();
    } catch {
      // Still subscribed, and the server keeps its record: nothing changed.
      return 'on';
    }
    await unregister(endpoint);
  }
  return Notification.permission === 'denied' ? 'denied' : 'off';
}

/**
 * Keeps the server's record of this device current: sends the subscription
 * again (the server upserts) so it has the device and language as they are now,
 * and replaces a subscription made with a key the server no longer uses. A
 * device that isn't subscribed costs nothing; failures wait for the next time.
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (blocker() || Notification.permission !== 'granted') return;
    const worker = await registration();
    let subscription = await worker?.pushManager.getSubscription();
    if (!worker || !subscription) return;
    // Push is off on the server, or unreachable: nothing to keep in step.
    const key = await serverKey();
    if (!key) return;
    // After a key change the old subscription could never receive a push again.
    if (!usesKey(subscription, key)) subscription = await subscribeWith(worker, key);
    await register(subscription);
  } catch {
    // Best effort.
  }
}

let syncStarted = false;

/**
 * Called when the app starts: syncs now, and again whenever the language
 * changes, so pushes come in the language the app is in. Only the first call counts.
 */
export function startPushSync(): void {
  if (syncStarted) return;
  syncStarted = true;
  void syncPushSubscription();
  onLocaleChange(() => void syncPushSubscription());
}
