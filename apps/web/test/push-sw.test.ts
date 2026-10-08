import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The service worker's own wiring: sw.ts handed a fake worker scope, the
// events it listens to fired by hand. What the handlers do is tested in
// push-events.test.ts; this checks that sw.ts hooks them to the right events.

// Workbox is irrelevant here and needs a real worker.
vi.mock('workbox-core', () => ({ clientsClaim: vi.fn() }));
vi.mock('workbox-expiration', () => ({ ExpirationPlugin: class {} }));
vi.mock('workbox-precaching', () => ({
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: vi.fn(),
  precacheAndRoute: vi.fn(),
}));
vi.mock('workbox-routing', () => ({ NavigationRoute: class {}, registerRoute: vi.fn() }));
vi.mock('workbox-strategies', () => ({ CacheFirst: class {}, NetworkFirst: class {} }));

type Listener = (event: unknown) => void;
const listeners = new Map<string, Listener>();
const scope = {
  __WB_MANIFEST: [],
  location: { origin: 'https://rumbo.test' },
  skipWaiting: vi.fn(async () => undefined),
  addEventListener: vi.fn((type: string, listener: Listener) => listeners.set(type, listener)),
  registration: {
    showNotification: vi.fn<(title: string, options: unknown) => Promise<void>>(
      async () => undefined,
    ),
  },
  clients: {
    matchAll: vi.fn<(options: unknown) => Promise<unknown[]>>(async () => []),
    openWindow: vi.fn<(url: string) => Promise<null>>(async () => null),
  },
};

/** Fires a listener the way the browser does, and waits for what it passed to waitUntil. */
async function fire(type: string, event: object): Promise<void> {
  const waited: Array<Promise<unknown>> = [];
  const listener = listeners.get(type);
  expect(listener, `a ${type} listener`).toBeTypeOf('function');
  listener?.({ ...event, waitUntil: (promise: Promise<unknown>) => waited.push(promise) });
  await Promise.all(waited);
}

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  // A variable specifier: TypeScript must not pull the worker's types into the page's program.
  const worker = '../src/sw.ts';
  await import(/* @vite-ignore */ worker);
});

afterAll(() => vi.unstubAllGlobals());

describe('sw.ts', () => {
  it('shows every push as a notification', async () => {
    await fire('push', {
      data: {
        json: () => ({ title: 'Tu ruta te espera', body: 'Quedan 3 puntos', url: '/routes/a' }),
        text: () => '',
      },
    });
    expect(scope.registration.showNotification).toHaveBeenCalledWith(
      'Tu ruta te espera',
      expect.objectContaining({ body: 'Quedan 3 puntos', data: { url: '/routes/a' } }),
    );
  });

  it('shows one for a push without data too', async () => {
    scope.registration.showNotification.mockClear();
    await fire('push', { data: null });
    expect(scope.registration.showNotification).toHaveBeenCalledWith(
      'Rumbo',
      expect.objectContaining({ data: { url: '/' } }),
    );
  });

  it('closes a tapped notification and opens its URL when the app is not open', async () => {
    const close = vi.fn();
    await fire('notificationclick', { notification: { close, data: { url: '/routes/a' } } });
    expect(close).toHaveBeenCalledTimes(1);
    expect(scope.clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    });
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/routes/a');
  });

  it('routes a tapped notification through the open window, so a run in memory is kept', async () => {
    const open = { focus: vi.fn(async () => undefined), postMessage: vi.fn() };
    scope.clients.matchAll.mockResolvedValueOnce([open]);
    scope.clients.openWindow.mockClear();
    await fire('notificationclick', {
      notification: { close: vi.fn(), data: { url: '/routes/b' } },
    });
    expect(open.focus).toHaveBeenCalledTimes(1);
    expect(open.postMessage).toHaveBeenCalledWith({ type: 'navigate', url: '/routes/b' });
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
  });

  it('sends a notification without a URL to the run, as the arrival alerts always did', async () => {
    scope.clients.openWindow.mockClear();
    await fire('notificationclick', { notification: { close: vi.fn(), data: null } });
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/run');
  });
});
