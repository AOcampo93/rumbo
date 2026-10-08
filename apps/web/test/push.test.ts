import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { applyLocale } from '../src/i18n/index.ts';
import { disablePush, enablePush, pushState, syncPushSubscription } from '../src/services/push.ts';

// Web Push on the page (PROJECT_PLAN §10.5): the state behind the Settings
// switch, the requests it makes and what it does when something fails. The
// browser (service worker, Push API, Notification) and the server are stubs.

const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
/** What iPadOS says it is. */
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A key-shaped value (0x04 and 64 more bytes), built here so no key-like string sits in the source. */
const point = (fill: number) =>
  Uint8Array.from({ length: 65 }, (_, index) => (index === 0 ? 4 : fill));
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const SERVER_KEY = point(7);
const OTHER_KEY = point(9);
const P256DH = base64url(point(1));
const AUTH = base64url(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
/** The subscription the browser already has, and the one pushManager.subscribe() makes. */
const ENDPOINT = 'https://push.example.test/send/device-one';
const NEW_ENDPOINT = 'https://push.example.test/send/device-two';

/** What happened, in order, across the browser and the server. */
let events: string[] = [];

interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON(): { endpoint: string; expirationTime: null; keys: { p256dh: string; auth: string } };
  unsubscribe: Mock<() => Promise<boolean>>;
}

function subscription(key: Uint8Array | null = SERVER_KEY, endpoint = ENDPOINT): FakeSubscription {
  return {
    endpoint,
    options: { applicationServerKey: key ? key.slice().buffer : null },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } }),
    unsubscribe: vi.fn(async () => {
      events.push('unsubscribe');
      return true;
    }),
  };
}

interface BrowserOptions {
  userAgent?: string;
  touchPoints?: number;
  /** Installed as an app, as `navigator.standalone` (Safari) or as the display-mode media query. */
  standalone?: 'navigator' | 'display-mode';
  /** false: the browser has no such API. */
  serviceWorker?: boolean;
  pushApi?: boolean;
  notifications?: boolean;
  /** `none`: nothing registered (a development build); `inactive`: registered, never active. */
  worker?: 'active' | 'none' | 'inactive';
  permission?: NotificationPermission;
  /** What the permission prompt resolves to. */
  prompt?: NotificationPermission;
  subscription?: FakeSubscription | null;
}

function stubBrowser(options: BrowserOptions = {}) {
  const { userAgent = ANDROID, touchPoints = 0, standalone, worker = 'active' } = options;
  const notification = {
    permission: options.permission ?? 'default',
    requestPermission: vi.fn(async () => {
      events.push('permission');
      notification.permission = options.prompt ?? 'granted';
      return notification.permission;
    }),
  };
  const current = { subscription: options.subscription ?? null };
  const pushManager = {
    getSubscription: vi.fn(async () => current.subscription),
    subscribe: vi.fn(
      async (made: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
        events.push('subscribe');
        current.subscription = subscription(made.applicationServerKey, NEW_ENDPOINT);
        return current.subscription;
      },
    ),
  };
  const registration = { pushManager };
  const serviceWorker = {
    getRegistration: vi.fn(async () => (worker === 'none' ? undefined : registration)),
    ready:
      worker === 'inactive'
        ? new Promise<typeof registration>(() => undefined)
        : Promise.resolve(registration),
  };
  vi.stubGlobal('navigator', {
    userAgent,
    maxTouchPoints: touchPoints,
    standalone: standalone === 'navigator',
    ...(options.serviceWorker === false ? {} : { serviceWorker }),
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: standalone === 'display-mode' && query.includes('standalone'),
  }));
  if (options.pushApi !== false) vi.stubGlobal('PushManager', class {});
  if (options.notifications !== false) vi.stubGlobal('Notification', notification);
  return { notification, pushManager, serviceWorker, current };
}

interface ServerOptions {
  /** 200 with a key; 503 push off; a page that isn't JSON; a key of the wrong size; no connection. */
  key?: 200 | 503 | 'garbage' | 'short' | 'network';
  subscribe?: 201 | 400 | 429 | 503 | 'network';
  unsubscribe?: 204 | 500 | 'network';
}

interface Seen {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubServer(options: ServerOptions = {}) {
  const requests: Seen[] = [];
  const { key = 200, subscribe = 201, unsubscribe = 204 } = options;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const path = url.replace('/api/v1', '');
      events.push(`${method} ${path}`);
      requests.push({
        method,
        path,
        headers: init.headers as Record<string, string>,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      const outcome = path === '/push/key' ? key : method === 'POST' ? subscribe : unsubscribe;
      if (outcome === 'network') throw new TypeError('Failed to fetch');
      if (path === '/push/key') {
        if (outcome === 503) return json({ code: 'unavailable' }, 503);
        if (outcome === 'garbage') return new Response('<html>Bad gateway</html>');
        const bytes = outcome === 'short' ? SERVER_KEY.slice(0, 64) : SERVER_KEY;
        return json({ publicKey: base64url(bytes) });
      }
      const status = outcome as number;
      return status < 300 ? new Response(null, { status }) : json({}, status);
    }),
  );
  return { requests, posts: () => requests.filter((request) => request.method === 'POST') };
}

function scene(browser: BrowserOptions = {}, server: ServerOptions = {}) {
  return { browser: stubBrowser(browser), server: stubServer(server) };
}

beforeEach(() => {
  events = [];
  applyLocale('es');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pushState', () => {
  it.each([
    ['service workers', { serviceWorker: false }],
    ['the Push API', { pushApi: false }],
    ['notifications', { notifications: false }],
  ] as const)('is unsupported without %s, asking nobody', async (_missing, browser) => {
    scene(browser);
    expect(await pushState()).toBe('unsupported');
    expect(events).toEqual([]);
  });

  it.each([
    ['an iPhone', { userAgent: IPHONE }],
    ['an iPad that says it is a Mac', { userAgent: MAC, touchPoints: 5 }],
  ] as const)(
    'needs the installed app on %s, where Safari tabs have no Push API at all',
    async (_device, device) => {
      scene({ ...device, pushApi: false, notifications: false });
      expect(await pushState()).toBe('needs-install');
      expect(events).toEqual([]);
    },
  );

  it.each([
    ['navigator.standalone', 'navigator'],
    ['display-mode: standalone', 'display-mode'],
  ] as const)(
    'goes ahead on an iPhone once the app is installed (%s)',
    async (_how, standalone) => {
      scene({ userAgent: IPHONE, standalone });
      expect(await pushState()).toBe('off');
    },
  );

  it('takes a Mac without a touch screen for a Mac', async () => {
    scene({ userAgent: MAC, touchPoints: 0 });
    expect(await pushState()).toBe('off');
  });

  it('is denied when the user blocked notifications, asking nobody', async () => {
    scene({ permission: 'denied' });
    expect(await pushState()).toBe('denied');
    expect(events).toEqual([]);
  });

  it('is on when allowed and subscribed, without bothering the server', async () => {
    scene({ permission: 'granted', subscription: subscription() });
    expect(await pushState()).toBe('on');
    expect(events).toEqual([]);
  });

  it('is off when the permission is not granted, whatever subscription is left over', async () => {
    scene({ permission: 'default', subscription: subscription() });
    expect(await pushState()).toBe('off');
  });

  it('is off when nothing is subscribed and the server has push on', async () => {
    scene({ permission: 'granted' });
    expect(await pushState()).toBe('off');
    expect(events).toEqual(['GET /push/key']);
  });

  it.each([
    ['has push off (503)', { key: 503 }],
    ['cannot be reached', { key: 'network' }],
    ['answers with a page that is not JSON', { key: 'garbage' }],
    ['sends a key of the wrong size', { key: 'short' }],
  ] as const)('is unavailable when the server %s', async (_why, server) => {
    scene({}, server);
    expect(await pushState()).toBe('unavailable');
  });

  it('is unavailable with no service worker registered, as in a development build', async () => {
    scene({ worker: 'none' });
    expect(await pushState()).toBe('unavailable');
    expect(events).toEqual([]);
  });
});

describe('enablePush', () => {
  it('asks for the permission, gets the key, subscribes with it and registers the subscription', async () => {
    const { browser, server } = scene();
    applyLocale('pt');
    expect(await enablePush()).toBe('on');
    expect(events).toEqual([
      'permission',
      'GET /push/key',
      'subscribe',
      'POST /push/subscriptions',
    ]);

    const [made] = browser.pushManager.subscribe.mock.calls[0] ?? [];
    expect(made?.userVisibleOnly).toBe(true);
    expect([...(made?.applicationServerKey ?? [])]).toEqual([...SERVER_KEY]);

    const [keyRequest, post] = server.requests;
    expect(keyRequest).toMatchObject({ method: 'GET', path: '/push/key' });
    expect(post).toMatchObject({
      method: 'POST',
      path: '/push/subscriptions',
      body: { endpoint: NEW_ENDPOINT, keys: { p256dh: P256DH, auth: AUTH }, locale: 'pt' },
    });
    expect(post?.headers).toMatchObject({ 'content-type': 'application/json' });
    // Every request names the same anonymous device.
    expect(keyRequest?.headers['x-device-id']).toMatch(UUID);
    expect(post?.headers['x-device-id']).toBe(keyRequest?.headers['x-device-id']);
  });

  it('asks for the permission inside the tap: before awaiting anything', async () => {
    const { browser } = scene();
    const pending = enablePush();
    // Safari only shows the prompt to code that runs in the tap's own turn.
    expect(browser.notification.requestPermission).toHaveBeenCalledTimes(1);
    await pending;
  });

  it('does not prompt again when the user already said yes', async () => {
    const { browser } = scene({ permission: 'granted' });
    expect(await enablePush()).toBe('on');
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
    expect(events).toEqual(['GET /push/key', 'subscribe', 'POST /push/subscriptions']);
  });

  it.each([
    ['stays off when the prompt is dismissed', { permission: 'default', prompt: 'default' }, 'off'],
    ['is denied when the user refuses', { permission: 'default', prompt: 'denied' }, 'denied'],
  ] as const)('%s, without a word to the server', async (_what, browser, state) => {
    const { browser: stub } = scene(browser);
    expect(await enablePush()).toBe(state);
    expect(events).toEqual(['permission']);
    expect(stub.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('does not prompt for a permission that is blocked already', async () => {
    const { browser } = scene({ permission: 'denied' });
    expect(await enablePush()).toBe('denied');
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it.each([
    ['needs the installed app', { userAgent: IPHONE, pushApi: false }, 'needs-install'],
    ['has no Push API', { pushApi: false }, 'unsupported'],
  ] as const)('leaves everything alone when the browser %s', async (_why, browser, state) => {
    const { browser: stub } = scene(browser);
    expect(await enablePush()).toBe(state);
    expect(stub.notification.requestPermission).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it.each([
    ['has push off (503)', { key: 503 }],
    ['cannot be reached', { key: 'network' }],
    ['sends a page that is not JSON', { key: 'garbage' }],
    ['sends a key of the wrong size', { key: 'short' }],
  ] as const)(
    'is unavailable, subscribing to nothing, when the server %s',
    async (_why, server) => {
      const { browser } = scene({ permission: 'granted' }, server);
      expect(await enablePush()).toBe('unavailable');
      expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
      expect(events).toEqual(['GET /push/key']);
    },
  );

  it('is unavailable with no service worker registered', async () => {
    const { browser } = scene({ permission: 'granted', worker: 'none' });
    expect(await enablePush()).toBe('unavailable');
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('gives up after a few seconds when the worker never becomes active', async () => {
    const { browser } = scene({ permission: 'granted', worker: 'inactive' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = enablePush();
    // The flow reaches the wait after a few real async steps (the device id comes from IndexedDB).
    await vi.waitFor(() => expect(browser.serviceWorker.getRegistration).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe('unavailable');
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('is denied when the permission is revoked while subscribing', async () => {
    const { browser, server } = scene({ permission: 'granted' });
    browser.pushManager.subscribe.mockImplementationOnce(async () => {
      browser.notification.permission = 'denied';
      throw new DOMException('Permission denied', 'NotAllowedError');
    });
    expect(await enablePush()).toBe('denied');
    expect(server.posts()).toEqual([]);
  });

  it("is unavailable when the browser's push service cannot be reached", async () => {
    const { browser, server } = scene({ permission: 'granted' });
    browser.pushManager.subscribe.mockRejectedValueOnce(
      new DOMException('Registration failed - push service error', 'AbortError'),
    );
    expect(await enablePush()).toBe('unavailable');
    expect(server.posts()).toEqual([]);
  });

  it.each([
    ['503', 503],
    ['429', 429],
    ['400', 400],
    ['no connection', 'network'],
  ] as const)(
    'rolls the subscription back when the server answers %s, so both always agree',
    async (_answer, subscribe) => {
      const { browser } = scene({ permission: 'granted' }, { subscribe });
      expect(await enablePush()).toBe('unavailable');
      expect(events).toEqual([
        'GET /push/key',
        'subscribe',
        'POST /push/subscriptions',
        'unsubscribe',
      ]);
      expect(browser.current.subscription?.unsubscribe).toHaveBeenCalledTimes(1);
    },
  );

  it('replaces a subscription made with another key before subscribing', async () => {
    const stale = subscription(OTHER_KEY);
    const { server } = scene({ permission: 'granted', subscription: stale });
    expect(await enablePush()).toBe('on');
    expect(events).toEqual([
      'GET /push/key',
      'unsubscribe',
      'subscribe',
      'POST /push/subscriptions',
    ]);
    expect(server.posts()[0]?.body).toMatchObject({ endpoint: NEW_ENDPOINT });
  });

  it('keeps the subscription it has when the key is the same', async () => {
    const mine = subscription(SERVER_KEY);
    scene({ permission: 'granted', subscription: mine });
    expect(await enablePush()).toBe('on');
    expect(mine.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('disablePush', () => {
  it('unsubscribes the browser, then asks the server to forget the endpoint', async () => {
    const mine = subscription();
    const { server } = scene({ permission: 'granted', subscription: mine });
    expect(await disablePush()).toBe('off');
    expect(events).toEqual(['unsubscribe', 'DELETE /push/subscriptions']);
    const [request] = server.requests;
    expect(request).toMatchObject({
      method: 'DELETE',
      path: '/push/subscriptions',
      body: { endpoint: ENDPOINT },
    });
    expect(request?.headers['x-device-id']).toMatch(UUID);
    expect(request?.headers['content-type']).toBe('application/json');
  });

  it.each([
    ['answers with an error', { unsubscribe: 500 }],
    ['cannot be reached', { unsubscribe: 'network' }],
  ] as const)('is off all the same when the server %s', async (_why, server) => {
    scene({ permission: 'granted', subscription: subscription() }, server);
    expect(await disablePush()).toBe('off');
  });

  it('stays on, telling nobody, when the browser fails to unsubscribe', async () => {
    const mine = subscription();
    mine.unsubscribe.mockRejectedValueOnce(new Error('Failed to unsubscribe'));
    const { server } = scene({ permission: 'granted', subscription: mine });
    expect(await disablePush()).toBe('on');
    expect(server.requests).toEqual([]);
  });

  it('has nothing to do without a subscription', async () => {
    const { server } = scene({ permission: 'granted' });
    expect(await disablePush()).toBe('off');
    expect(server.requests).toEqual([]);
  });

  it('leaves a browser that cannot do push alone', async () => {
    const { server } = scene({ userAgent: IPHONE, pushApi: false });
    expect(await disablePush()).toBe('needs-install');
    expect(server.requests).toEqual([]);
  });
});

describe('syncPushSubscription', () => {
  it('sends the subscription again, with the language as it is now', async () => {
    const { server } = scene({ permission: 'granted', subscription: subscription() });
    applyLocale('en');
    await syncPushSubscription();
    expect(events).toEqual(['GET /push/key', 'POST /push/subscriptions']);
    expect(server.posts()[0]).toMatchObject({
      path: '/push/subscriptions',
      body: { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH }, locale: 'en' },
    });
    expect(server.posts()[0]?.headers['x-device-id']).toMatch(UUID);
  });

  it.each([
    ['is not subscribed', { permission: 'granted' }],
    ['has not allowed notifications', { permission: 'default', subscription: subscription() }],
    ['needs the installed app', { userAgent: IPHONE, permission: 'granted', pushApi: false }],
    ['cannot do push', { pushApi: false, permission: 'granted' }],
    ['has no service worker registered', { worker: 'none', permission: 'granted' }],
  ] as const)('does nothing when the device %s', async (_why, browser) => {
    const { server } = scene(browser);
    await syncPushSubscription();
    expect(server.requests).toEqual([]);
  });

  it('leaves the server alone when it has push off', async () => {
    const { server } = scene({ permission: 'granted', subscription: subscription() }, { key: 503 });
    await syncPushSubscription();
    expect(events).toEqual(['GET /push/key']);
    expect(server.posts()).toEqual([]);
  });

  it('replaces a subscription made with a key the server no longer uses', async () => {
    const stale = subscription(OTHER_KEY);
    const { server } = scene({ permission: 'granted', subscription: stale });
    await syncPushSubscription();
    expect(events).toEqual([
      'GET /push/key',
      'unsubscribe',
      'subscribe',
      'POST /push/subscriptions',
    ]);
    expect(server.posts()[0]?.body).toMatchObject({ endpoint: NEW_ENDPOINT });
  });

  it('never throws, whatever fails', async () => {
    const { browser } = scene({ permission: 'granted', subscription: subscription() });
    browser.pushManager.getSubscription.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(syncPushSubscription()).resolves.toBeUndefined();
    scene({ permission: 'granted', subscription: subscription() }, { subscribe: 'network' });
    await expect(syncPushSubscription()).resolves.toBeUndefined();
  });
});

describe('startPushSync', () => {
  it('syncs at start and again whenever the language changes, however often it is called', async () => {
    // A fresh copy of the modules: whether the sync started is state of the module.
    vi.resetModules();
    const { startPushSync } = await import('../src/services/push.ts');
    const { applyLocale: apply } = await import('../src/i18n/index.ts');
    const { server } = scene({ permission: 'granted', subscription: subscription() });

    startPushSync();
    startPushSync();
    await vi.waitFor(() => expect(server.posts()).toHaveLength(1));
    apply('en');
    await vi.waitFor(() => expect(server.posts()).toHaveLength(2));
    apply('pt');
    await vi.waitFor(() => expect(server.posts()).toHaveLength(3));
    expect(server.posts().map((post) => (post.body as { locale: string }).locale)).toEqual([
      'es',
      'en',
      'pt',
    ]);
  });
});
