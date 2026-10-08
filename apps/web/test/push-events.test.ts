import { describe, expect, it, vi } from 'vitest';
import {
  appPath,
  type ClientsLike,
  openNotificationTarget,
  PUSH_ICON,
  pushDisplay,
  type PushDataLike,
  type PushDisplay,
  readPushData,
  showPush,
  type WindowClientLike,
} from '../src/services/pushEvents.ts';

// What the service worker makes of a push and of a tap on a notification
// (PROJECT_PLAN §10.5). The functions sw.ts calls, run here without a worker.

/** The icons in public/, by path: only the file names are read, nothing is imported. */
const SHIPPED_ICONS = Object.keys(import.meta.glob('../public/icons/*.png'));

const data = (json: () => unknown, text = () => ''): PushDataLike => ({ json, text });

describe('pushDisplay', () => {
  it('shows the title, body and tag the server sent, with the app icon and where a tap goes', () => {
    expect(
      pushDisplay({
        title: 'Tu ruta te espera',
        body: 'Quedan 3 puntos',
        tag: 'reminder:leiria',
        url: '/routes/leiria-centro?from=push#top',
      }),
    ).toEqual({
      title: 'Tu ruta te espera',
      options: {
        body: 'Quedan 3 puntos',
        tag: 'reminder:leiria',
        icon: PUSH_ICON,
        data: { url: '/routes/leiria-centro?from=push#top' },
      },
    });
  });

  it('leaves out the body and the tag when there are none, and trims what it keeps', () => {
    const { title, options } = pushDisplay({ title: '  Rumbo news  ', body: '   ', tag: '' });
    expect(title).toBe('Rumbo news');
    expect(options).not.toHaveProperty('body');
    expect(options).not.toHaveProperty('tag');
    expect(options.data).toEqual({ url: '/' });
  });

  it('still shows something for a payload with nothing usable: the product name, home on tap', () => {
    for (const payload of [null, undefined, {}, [], 42, true, { title: 7, body: {}, url: 5 }]) {
      expect(pushDisplay(payload)).toEqual({
        title: 'Rumbo',
        options: { icon: PUSH_ICON, data: { url: '/' } },
      });
    }
  });

  it('takes a bare string as the message itself', () => {
    expect(pushDisplay('Hola').options.body).toBe('Hola');
  });

  it('uses an icon the app ships (and precaches), and no badge', () => {
    expect(SHIPPED_ICONS).toContain(`../public${PUSH_ICON}`);
    expect(pushDisplay({}).options).not.toHaveProperty('badge');
  });
});

describe('appPath', () => {
  it('keeps paths of this app, normalised', () => {
    expect(appPath('/run')).toBe('/run');
    expect(appPath('/routes/a b?x=1#h')).toBe('/routes/a%20b?x=1#h');
    expect(appPath('/')).toBe('/');
  });

  it('sends everything that could leave the app, or is not a path, to the home screen', () => {
    for (const url of [
      'https://evil.example/x',
      '//evil.example/x',
      '/\\evil.example',
      '/\\\\evil.example/x',
      'javascript:alert(1)',
      'routes/a',
      '',
      undefined,
      null,
      5,
      {},
    ]) {
      expect(appPath(url), String(url)).toBe('/');
    }
  });
});

describe('readPushData', () => {
  it('reads JSON, falls back to the text as the body, and never throws', () => {
    expect(readPushData(null)).toBe(null);
    expect(readPushData(data(() => ({ title: 'T' })))).toEqual({ title: 'T' });
    expect(
      readPushData(
        data(
          () => {
            throw new SyntaxError('Unexpected token');
          },
          () => 'plain text',
        ),
      ),
    ).toEqual({ body: 'plain text' });
    const broken = () => {
      throw new Error('unreadable');
    };
    expect(readPushData(data(broken, broken))).toBe(null);
  });
});

describe('showPush', () => {
  const fake = (payload: PushDataLike | null) => {
    const waited: Array<Promise<unknown>> = [];
    const showNotification = vi.fn<
      (title: string, options: PushDisplay['options']) => Promise<void>
    >(async () => undefined);
    return {
      waited,
      showNotification,
      run: () =>
        showPush(
          { data: payload, waitUntil: (promise) => waited.push(promise) },
          { showNotification },
        ),
    };
  };

  it('shows the notification and keeps the worker alive until it is on screen', async () => {
    const push = fake(data(() => ({ title: 'T', body: 'B', url: '/run' })));
    push.run();
    expect(push.showNotification).toHaveBeenCalledWith('T', {
      body: 'B',
      icon: PUSH_ICON,
      data: { url: '/run' },
    });
    expect(push.waited).toHaveLength(1);
    await expect(push.waited[0]).resolves.toBeUndefined();
  });

  it('shows one even for a push without data or with a broken one', () => {
    for (const payload of [
      null,
      data(() => {
        throw new SyntaxError('nope');
      }),
    ]) {
      const push = fake(payload);
      push.run();
      expect(push.showNotification).toHaveBeenCalledTimes(1);
      expect(push.showNotification.mock.calls[0]?.[0]).toBe('Rumbo');
      expect(push.waited).toHaveLength(1);
    }
  });
});

describe('openNotificationTarget', () => {
  const windowClient = () => {
    const client = {
      focus: vi.fn(async (): Promise<unknown> => undefined),
      postMessage: vi.fn<(message: unknown) => void>(),
    };
    return client satisfies WindowClientLike;
  };
  const clientsWith = (windows: WindowClientLike[]) => {
    const clients = {
      matchAll: vi.fn<ClientsLike['matchAll']>(async () => windows),
      openWindow: vi.fn<ClientsLike['openWindow']>(async () => null),
    };
    return clients satisfies ClientsLike;
  };

  it('focuses the open window and lets it route itself, so a run in memory is kept', async () => {
    const [first, second] = [windowClient(), windowClient()];
    const clients = clientsWith([first, second]);
    await openNotificationTarget('/routes/leiria-centro', clients);
    expect(clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(first.postMessage).toHaveBeenCalledWith({
      type: 'navigate',
      url: '/routes/leiria-centro',
    });
    expect(second.focus).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window on the URL when the app is not open', async () => {
    const clients = clientsWith([]);
    await openNotificationTarget('/run', clients);
    expect(clients.openWindow).toHaveBeenCalledWith('/run');
  });

  it('opens a window too when the open one cannot be focused', async () => {
    const stuck = windowClient();
    stuck.focus.mockRejectedValue(new DOMException('Not allowed', 'InvalidAccessError'));
    const clients = clientsWith([stuck]);
    await openNotificationTarget('/run', clients);
    expect(stuck.postMessage).not.toHaveBeenCalled();
    expect(clients.openWindow).toHaveBeenCalledWith('/run');
  });
});
