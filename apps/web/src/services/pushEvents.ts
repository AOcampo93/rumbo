// What the service worker does when a push arrives and when a notification is
// tapped (PROJECT_PLAN §10.5). No imports and no browser globals beyond `URL`:
// sw.ts has no DOM, and the tests call these functions directly.
//
// The server sends every push as JSON, already written in the language the
// device subscribed with:
//   { "title": string, "body": string, "tag"?: string, "url"?: string }
// `url` is a path inside the app that opens when the notification is tapped.
// Anything else (no data, plain text, a wrong shape) still shows a
// notification: a push that shows nothing costs the site its permission
// (Safari revokes it after a few, Chrome shows a generic message of its own).

/** The app's own icon (already precached): the only art a notification needs. */
export const PUSH_ICON = '/icons/icon-192.png';
// No `badge`: Android draws it as a white silhouette in the status bar, and a
// full-colour icon becomes a white square; without one it uses its own.
/** The title when the push carries none: the product name, the same in every language. */
export const PUSH_FALLBACK_TITLE = 'Rumbo';
/** Where a tap goes when the push names no usable destination: the home screen. */
export const PUSH_FALLBACK_URL = '/';

/** `showNotification`'s arguments for one push. */
export interface PushDisplay {
  title: string;
  options: {
    body?: string;
    tag?: string;
    icon: string;
    data: { url: string };
  };
}

/** The part of PushMessageData this file uses. */
export interface PushDataLike {
  json(): unknown;
  text(): string;
}

const PROBE_ORIGIN = 'https://rumbo.invalid';

/**
 * A path inside the app, or the home screen. A push can only point at this
 * app: other sites, protocol-relative URLs (`//host`, `/\host`) and anything
 * that is not a path fall back to `/`.
 */
export function appPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return PUSH_FALLBACK_URL;
  try {
    const url = new URL(value, PROBE_ORIGIN);
    return url.origin === PROBE_ORIGIN
      ? `${url.pathname}${url.search}${url.hash}`
      : PUSH_FALLBACK_URL;
  } catch {
    return PUSH_FALLBACK_URL;
  }
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** The payload of a push event, whatever it is: JSON if it parses, else its text as the body; never throws. */
export function readPushData(data: PushDataLike | null): unknown {
  if (!data) return null;
  try {
    return data.json();
  } catch {
    try {
      return { body: data.text() };
    } catch {
      return null;
    }
  }
}

/** What to show for a payload, trusting nothing about its shape. */
export function pushDisplay(payload: unknown): PushDisplay {
  const message: Record<string, unknown> =
    typeof payload === 'string'
      ? { body: payload }
      : typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)
        : {};
  const body = text(message['body']);
  const tag = text(message['tag']);
  return {
    title: text(message['title']) ?? PUSH_FALLBACK_TITLE,
    options: {
      ...(body ? { body } : {}),
      ...(tag ? { tag } : {}),
      icon: PUSH_ICON,
      data: { url: appPath(message['url']) },
    },
  };
}

/** The part of PushEvent this file uses. */
export interface PushEventLike {
  data: PushDataLike | null;
  waitUntil(promise: Promise<unknown>): void;
}

/** The part of ServiceWorkerRegistration this file uses. */
export interface NotifierLike {
  showNotification(title: string, options: PushDisplay['options']): Promise<void>;
}

/** The `push` event: always a visible notification, even for an empty or odd payload. */
export function showPush(event: PushEventLike, registration: NotifierLike): void {
  const { title, options } = pushDisplay(readPushData(event.data));
  event.waitUntil(registration.showNotification(title, options));
}

/** The part of a WindowClient this file uses. */
export interface WindowClientLike {
  focus(): Promise<unknown>;
  postMessage(message: unknown): void;
}

/** The part of Clients this file uses. */
export interface ClientsLike {
  matchAll(options: {
    type: 'window';
    includeUncontrolled: boolean;
  }): Promise<readonly WindowClientLike[]>;
  openWindow(url: string): Promise<unknown>;
}

/**
 * A tapped notification brings the app forward on `url` (§10.2). An open
 * window routes itself, so a run in memory is kept; with none open, or one
 * that can't be focused, a new window opens there.
 */
export async function openNotificationTarget(url: string, clients: ClientsLike): Promise<void> {
  // The most recently focused window comes first.
  const [open] = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (open) {
    try {
      await open.focus();
      open.postMessage({ type: 'navigate', url });
      return;
    } catch {
      // The window closed meanwhile, or the browser refused to focus it.
    }
  }
  await clients.openWindow(url);
}
