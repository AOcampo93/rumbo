import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { devices, pushSubscriptions } from '../src/db/schema.js';
import { PUSH_TTL_SECONDS } from '../src/push/send.js';
import { DEVICE, OTHER_DEVICE, setupApi } from './helpers.js';
import {
  ADMIN_TOKEN,
  browser,
  messageOf,
  pushService,
  subscription,
  vapidSettings,
} from './push-fakes.js';

// Web Push's endpoints: the key, subscribing and unsubscribing, and the
// operator's announcements. No push service is ever reached: the transport
// is a stand-in that answers with the status each test chooses.

let api: Awaited<ReturnType<typeof setupApi>> | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const app = () => {
  if (!api) throw new Error('setupApi first');
  return api.app;
};

const ANDROID = 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile';
const IDENTIFIED = { 'x-device-id': DEVICE };

const getKey = () => app().inject({ method: 'GET', url: '/api/v1/push/key' });
const subscribe = (
  payload: unknown,
  headers: Record<string, string> = IDENTIFIED,
  remoteAddress?: string,
) =>
  app().inject({
    method: 'POST',
    url: '/api/v1/push/subscriptions',
    payload: payload as object,
    headers,
    ...(remoteAddress ? { remoteAddress } : {}),
  });
const unsubscribe = (payload: unknown) =>
  app().inject({ method: 'DELETE', url: '/api/v1/push/subscriptions', payload: payload as object });
const announce = (payload: unknown, authorization?: string) =>
  app().inject({
    method: 'POST',
    url: '/api/v1/admin/push',
    payload: payload as object,
    headers: authorization === undefined ? {} : { authorization },
  });

const ANNOUNCEMENT = {
  title: { es: 'Novedades', en: 'News', pt: 'Novidades' },
  body: {
    es: 'Hay una ruta nueva en Leiria',
    en: 'There is a new route in Leiria',
    pt: 'Há uma rota nova em Leiria',
  },
  url: '/explore',
};
const BEARER = `Bearer ${ADMIN_TOKEN}`;

/** The subscriptions in the database, oldest first. */
const stored = () => {
  if (!api) throw new Error('setupApi first');
  return api.db.select().from(pushSubscriptions).orderBy(asc(pushSubscriptions.id));
};

const complete = vapidSettings();
const OFF = [
  ['no VAPID settings', {}],
  [
    'only some of them',
    { vapidPublicKey: complete.vapidPublicKey, vapidSubject: complete.vapidSubject },
  ],
  ['malformed ones', { ...complete, vapidPublicKey: 'not-a-key' }],
  ['a pair that doesn’t match', { ...complete, vapidPublicKey: vapidSettings().vapidPublicKey }],
] as const;

describe('when push is off', () => {
  it.each(OFF)('every endpoint answers 503 push_unavailable (%s)', async (_what, settings) => {
    api = await setupApi({ ...settings, adminToken: ADMIN_TOKEN });
    const b = browser();
    const answers = [
      await getKey(),
      await subscribe(subscription(b)),
      await unsubscribe({ endpoint: b.endpoint }),
      await announce(ANNOUNCEMENT, BEARER),
    ];
    for (const res of answers) {
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ code: 'push_unavailable' });
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(await stored()).toEqual([]);
  });

  it('does not tell a stranger so: a wrong token is still 403', async () => {
    api = await setupApi({ adminToken: ADMIN_TOKEN });
    expect((await announce(ANNOUNCEMENT, 'Bearer nope')).statusCode).toBe(403);
    expect((await announce(ANNOUNCEMENT)).statusCode).toBe(403);
  });
});

describe('while the database is not ready', () => {
  it('answers the key, and 503 unavailable to what needs the database', async () => {
    const config = { ...loadConfig({}), ...vapidSettings(), adminToken: ADMIN_TOKEN };
    const app = await buildApp(config, { database: null, data: () => null }, { logger: false });
    try {
      expect((await app.inject({ method: 'GET', url: '/api/v1/push/key' })).statusCode).toBe(200);
      const b = browser();
      const answers = [
        await app.inject({
          method: 'POST',
          url: '/api/v1/push/subscriptions',
          headers: IDENTIFIED,
          payload: subscription(b),
        }),
        await app.inject({
          method: 'DELETE',
          url: '/api/v1/push/subscriptions',
          payload: { endpoint: b.endpoint },
        }),
        await app.inject({
          method: 'POST',
          url: '/api/v1/admin/push',
          headers: { authorization: BEARER },
          payload: ANNOUNCEMENT,
        }),
      ];
      for (const res of answers) {
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ code: 'unavailable' });
      }
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/v1/push/key', () => {
  it('answers the public key, cacheable, to anyone', async () => {
    const settings = vapidSettings();
    api = await setupApi(settings);
    const res = await getKey();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ publicKey: settings.vapidPublicKey });
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.body).not.toContain(settings.vapidPrivateKey as string);
  });
});

describe('POST /api/v1/push/subscriptions', () => {
  it('needs the device id, before it looks at the body', async () => {
    api = await setupApi(vapidSettings());
    for (const body of [subscription(browser()), { rubbish: true }]) {
      const res = await subscribe(body, {});
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ code: 'missing_device_id' });
    }
    const notUuid = await subscribe(subscription(browser()), { 'x-device-id': 'me' });
    expect(notUuid.json()).toEqual({ code: 'missing_device_id' });
  });

  it('refuses an endpoint that is not a push service’s, and stores nothing', async () => {
    api = await setupApi(vapidSettings());
    const b = browser();
    for (const endpoint of [
      'https://example.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/fcm/send/abc',
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://127.0.0.1/x',
      'https://user:pass@fcm.googleapis.com/fcm/send/abc',
      'nonsense',
    ]) {
      const res = await subscribe({ ...subscription(b), endpoint });
      expect(res.statusCode, endpoint).toBe(400);
      expect(res.json().code).toBe('validation_failed');
      expect(res.json().details[0].path).toBe('/endpoint');
      // The answer never echoes what was sent.
      expect(res.body).not.toContain('evil');
    }
    expect(await stored()).toEqual([]);
  });

  it('refuses keys, a language or a body that is not right', async () => {
    api = await setupApi(vapidSettings());
    const b = browser();
    const good = subscription(b);
    const cases: Array<[string, unknown, string]> = [
      [
        'p256dh of the wrong size',
        { ...good, keys: { ...good.keys, p256dh: 'AAAA' } },
        '/keys/p256dh',
      ],
      [
        'p256dh that is not a point on the curve',
        {
          ...good,
          keys: {
            ...good.keys,
            p256dh: Buffer.concat([Buffer.of(4), Buffer.alloc(64, 1)]).toString('base64url'),
          },
        },
        '/keys/p256dh',
      ],
      ['auth of the wrong size', { ...good, keys: { ...good.keys, auth: 'AAAA' } }, '/keys/auth'],
      ['no keys', { endpoint: good.endpoint, locale: 'es' }, '/keys'],
      ['a language we don’t speak', { ...good, locale: 'fr' }, '/locale'],
      ['no language', { endpoint: good.endpoint, keys: good.keys }, '/locale'],
      ['no endpoint', { keys: good.keys, locale: 'es' }, '/endpoint'],
    ];
    for (const [what, body, path] of cases) {
      const res = await subscribe(body);
      expect(res.statusCode, what).toBe(400);
      expect(res.json().code, what).toBe('validation_failed');
      expect(
        res.json().details.map((detail: { path: string }) => detail.path),
        what,
      ).toContain(path);
    }
    const notJson = await app().inject({
      method: 'POST',
      url: '/api/v1/push/subscriptions',
      headers: { ...IDENTIFIED, 'content-type': 'application/json' },
      payload: '{"endpoint":',
    });
    expect(notJson.statusCode).toBe(400);
    expect(await stored()).toEqual([]);
  });

  it('stores the subscription for the device, and remembers the device', async () => {
    api = await setupApi(vapidSettings());
    const b = browser();
    const res = await subscribe(subscription(b, 'pt'), { ...IDENTIFIED, 'user-agent': ANDROID });
    expect(res.statusCode).toBe(201);
    expect(res.body).toBe('');
    expect(await stored()).toMatchObject([
      {
        deviceId: DEVICE,
        endpoint: b.endpoint,
        p256dh: b.keys.p256dh,
        auth: b.keys.auth,
        locale: 'pt',
        failures: 0,
        lastSuccessAt: null,
      },
    ]);
    const [device] = await api.db.select().from(devices).where(eq(devices.id, DEVICE));
    expect(device?.platform).toBe('android');
  });

  it('ignores what a browser adds, like expirationTime', async () => {
    api = await setupApi(vapidSettings());
    const b = browser('updates.push.services.mozilla.com');
    const res = await subscribe({ ...subscription(b), expirationTime: null, extra: 1 });
    expect(res.statusCode).toBe(201);
    expect(await stored()).toHaveLength(1);
  });

  it('refreshes a subscription that is already there, taking it over from another device', async () => {
    api = await setupApi(vapidSettings());
    const b = browser();
    expect((await subscribe(subscription(b, 'es'))).statusCode).toBe(201);
    // It had failed, and the device id was reset since.
    await api.db.update(pushSubscriptions).set({ failures: 4 });

    const newKeys = browser();
    const again = await subscribe(
      { endpoint: b.endpoint, keys: newKeys.keys, locale: 'en' },
      { 'x-device-id': OTHER_DEVICE },
    );
    expect(again.statusCode).toBe(201);
    expect(await stored()).toMatchObject([
      {
        deviceId: OTHER_DEVICE,
        endpoint: b.endpoint,
        p256dh: newKeys.keys.p256dh,
        auth: newKeys.keys.auth,
        locale: 'en',
        failures: 0,
      },
    ]);
  });

  it('keeps every browser of a device', async () => {
    api = await setupApi(vapidSettings());
    const phone = browser();
    const laptop = browser('updates.push.services.mozilla.com');
    await subscribe(subscription(phone));
    await subscribe(subscription(laptop));
    expect((await stored()).map((row) => row.endpoint)).toEqual([phone.endpoint, laptop.endpoint]);
  });

  it('counts per address: the next one past the limit is 429, whoever it says it is', async () => {
    api = await setupApi({ ...vapidSettings(), pushRateLimitPerMinute: 3 });
    for (let i = 0; i < 3; i++) {
      const res = await subscribe(subscription(browser()), { 'x-device-id': randomUUID() });
      expect(res.statusCode).toBe(201);
    }
    const limited = await subscribe(subscription(browser()), { 'x-device-id': randomUUID() });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Unsubscribing shares the budget; someone else is not affected.
    expect((await unsubscribe({ endpoint: browser().endpoint })).statusCode).toBe(429);
    const other = await subscribe(subscription(browser()), IDENTIFIED, '203.0.113.9');
    expect(other.statusCode).toBe(201);
    expect(await stored()).toHaveLength(4);
  });

  it('takes a few KB at most', async () => {
    api = await setupApi(vapidSettings());
    const res = await subscribe({ ...subscription(browser()), padding: 'x'.repeat(5000) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ code: 'payload_too_large' });
  });
});

describe('DELETE /api/v1/push/subscriptions', () => {
  it('forgets the subscription, and only that one', async () => {
    api = await setupApi(vapidSettings());
    const [a, b] = [browser(), browser()];
    await subscribe(subscription(a));
    await subscribe(subscription(b));
    const res = await unsubscribe({ endpoint: a.endpoint });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect((await stored()).map((row) => row.endpoint)).toEqual([b.endpoint]);
  });

  it('answers 204 also for an endpoint nobody knows', async () => {
    api = await setupApi(vapidSettings());
    await subscribe(subscription(browser()));
    for (const endpoint of [browser().endpoint, 'whatever', 'https://example.com/x']) {
      expect((await unsubscribe({ endpoint })).statusCode, endpoint).toBe(204);
    }
    expect(await stored()).toHaveLength(1);
  });

  it('wants an endpoint in the body', async () => {
    api = await setupApi(vapidSettings());
    for (const body of [{}, { endpoint: '' }, { endpoint: 7 }, { endpoint: 'x'.repeat(3000) }]) {
      const res = await unsubscribe(body);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('validation_failed');
    }
  });
});

describe('POST /api/v1/admin/push', () => {
  it('does not exist without an ADMIN_TOKEN', async () => {
    api = await setupApi(vapidSettings());
    for (const authorization of [undefined, BEARER, 'Bearer short']) {
      const res = await announce(ANNOUNCEMENT, authorization);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'not_found' });
    }
  });

  it('does not use a token too short to trust', async () => {
    const short = 'x'.repeat(31);
    api = await setupApi({ ...vapidSettings(), adminToken: short });
    expect((await announce(ANNOUNCEMENT, `Bearer ${short}`)).statusCode).toBe(404);
  });

  it('wants the token as a Bearer, and answers 403 to anything else', async () => {
    const { transport } = pushService();
    api = await setupApi(
      { ...vapidSettings(), adminToken: ADMIN_TOKEN },
      { pushTransport: transport },
    );
    await subscribe(subscription(browser()));
    for (const authorization of [
      undefined,
      '',
      'Bearer',
      'Bearer ',
      'Bearer nope',
      `Bearer ${ADMIN_TOKEN}x`,
      `Bearer ${ADMIN_TOKEN.slice(0, -1)}`,
      `Bearer ${ADMIN_TOKEN.toUpperCase()}`,
      `Token ${ADMIN_TOKEN}`,
      `Basic ${ADMIN_TOKEN}`,
      ADMIN_TOKEN,
    ]) {
      const res = await announce(ANNOUNCEMENT, authorization);
      expect(res.statusCode, String(authorization)).toBe(403);
      expect(res.json()).toEqual({ code: 'forbidden' });
    }
    expect(transport).not.toHaveBeenCalled();
    // The scheme's name is not case-sensitive.
    expect((await announce(ANNOUNCEMENT, `bearer ${ADMIN_TOKEN}`)).statusCode).toBe(200);
  });

  it('checks the body only for whoever has the token', async () => {
    api = await setupApi({ ...vapidSettings(), adminToken: ADMIN_TOKEN });
    expect((await announce({ rubbish: true }, 'Bearer nope')).statusCode).toBe(403);
    const { title, body } = ANNOUNCEMENT;
    const cases: Array<[string, unknown]> = [
      ['nothing', {}],
      ['no title', { body }],
      ['a title missing a language', { title: { es: 'Hola', en: 'Hi' }, body }],
      ['an empty text', { title: { ...title, pt: '   ' }, body }],
      ['a title that is plain text', { title: 'Hola', body }],
      ['a text that is too long', { title: { ...title, es: 'x'.repeat(81) }, body }],
      ['a body that is too long', { title, body: { ...body, en: 'x'.repeat(241) } }],
      ['another language', { title: { ...title, fr: 'Salut' }, body }],
      ['a field it doesn’t know', { title, body, icon: '/x.png' }],
      ['an address elsewhere', { title, body, url: 'https://example.com/' }],
      ['an address without a scheme', { title, body, url: '//example.com/' }],
      ['a script', { title, body, url: 'javascript:alert(1)' }],
      ['a backslash', { title, body, url: '/\\example.com' }],
      ['a path that doesn’t start with a slash', { title, body, url: 'run' }],
      ['a path with a line break', { title, body, url: '/run\nSet-Cookie: x=1' }],
      ['a path with a space', { title, body, url: '/run now' }],
    ];
    for (const [what, payload] of cases) {
      const res = await announce(payload, BEARER);
      expect(res.statusCode, what).toBe(400);
      expect(res.json().code, what).toBe('validation_failed');
    }
  });

  it('announces to every subscription in its own language, and says how it went', async () => {
    const service = pushService((request) =>
      request.endpoint.includes('/gone') ? 410 : request.endpoint.includes('/broken') ? 500 : 201,
    );
    api = await setupApi(
      { ...vapidSettings(), adminToken: ADMIN_TOKEN },
      { pushTransport: service.transport },
    );
    const withPath = (path: string) => ({
      ...browser(),
      endpoint: `https://fcm.googleapis.com/${path}`,
    });
    const people = [
      { b: browser(), locale: 'es' as const },
      { b: browser('web.push.apple.com'), locale: 'en' as const },
      { b: browser('updates.push.services.mozilla.com'), locale: 'pt' as const },
      { b: withPath('gone/1'), locale: 'es' as const },
      { b: withPath('gone/2'), locale: 'en' as const },
      { b: withPath('broken/1'), locale: 'pt' as const },
    ];
    for (const { b, locale } of people) {
      expect((await subscribe(subscription(b, locale))).statusCode).toBe(201);
    }

    const res = await announce(ANNOUNCEMENT, BEARER);
    expect(res.statusCode).toBe(200);
    // Three delivered; the two the push service forgot and the one it refused did not arrive.
    expect(res.json()).toEqual({ sent: 3, failed: 3 });

    const byEndpoint = new Map(service.sent.map((request) => [request.endpoint, request]));
    expect(service.sent).toHaveLength(6);
    const tags = new Set<string>();
    const expected = {
      es: { title: 'Novedades', body: 'Hay una ruta nueva en Leiria' },
      en: { title: 'News', body: 'There is a new route in Leiria' },
      pt: { title: 'Novidades', body: 'Há uma rota nova em Leiria' },
    };
    for (const { b, locale } of people) {
      const request = byEndpoint.get(b.endpoint);
      expect(request, locale).toBeDefined();
      expect(request).toMatchObject({
        p256dh: b.keys.p256dh,
        auth: b.keys.auth,
        ttlSeconds: PUSH_TTL_SECONDS,
        urgency: 'normal',
      });
      const message = messageOf(request!);
      expect(message).toEqual({
        ...expected[locale],
        url: '/explore',
        tag: expect.stringMatching(/^announcement:\d+$/),
      });
      tags.add(message.tag);
    }
    // One announcement, one tag.
    expect(tags.size).toBe(1);

    // The gone ones were deleted; the refused one stays, with a failure on its record.
    const rows = await stored();
    expect(rows.map((row) => [row.endpoint, row.failures, row.lastSuccessAt !== null])).toEqual([
      [people[0]!.b.endpoint, 0, true],
      [people[1]!.b.endpoint, 0, true],
      [people[2]!.b.endpoint, 0, true],
      [people[5]!.b.endpoint, 1, false],
    ]);
  });

  it('sends people to the home page when it says no other', async () => {
    const service = pushService();
    api = await setupApi(
      { ...vapidSettings(), adminToken: ADMIN_TOKEN },
      { pushTransport: service.transport },
    );
    await subscribe(subscription(browser()));
    const withoutUrl = { title: ANNOUNCEMENT.title, body: ANNOUNCEMENT.body };
    expect((await announce(withoutUrl, BEARER)).json()).toEqual({ sent: 1, failed: 0 });
    expect(messageOf(service.sent[0]!).url).toBe('/');
  });

  it('answers { sent: 0, failed: 0 } when nobody has subscribed', async () => {
    const service = pushService();
    api = await setupApi(
      { ...vapidSettings(), adminToken: ADMIN_TOKEN },
      { pushTransport: service.transport },
    );
    const res = await announce(ANNOUNCEMENT, BEARER);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: 0, failed: 0 });
    expect(service.sent).toEqual([]);
  });

  it('reaches every subscription, however many pages they take', async () => {
    const service = pushService();
    api = await setupApi(
      { ...vapidSettings(), adminToken: ADMIN_TOKEN },
      { pushTransport: service.transport },
    );
    const total = 1001;
    await api.db.insert(pushSubscriptions).values(
      Array.from({ length: total }, (_, i) => ({
        deviceId: DEVICE,
        endpoint: `https://fcm.googleapis.com/fcm/send/${i}`,
        p256dh: 'p',
        auth: 'a',
        locale: (['es', 'en', 'pt'] as const)[i % 3]!,
      })),
    );
    const res = await announce(ANNOUNCEMENT, BEARER);
    expect(res.json()).toEqual({ sent: total, failed: 0 });
    expect(new Set(service.sent.map((request) => request.endpoint)).size).toBe(total);
  });

  it('is strictly limited per address, wrong tokens included', async () => {
    api = await setupApi({
      ...vapidSettings(),
      adminToken: ADMIN_TOKEN,
      adminRateLimitPerMinute: 2,
    });
    expect((await announce(ANNOUNCEMENT, 'Bearer nope')).statusCode).toBe(403);
    expect((await announce(ANNOUNCEMENT, 'Bearer nope')).statusCode).toBe(403);
    const limited = await announce(ANNOUNCEMENT, BEARER);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'rate_limited' });
    const elsewhere = await app().inject({
      method: 'POST',
      url: '/api/v1/admin/push',
      payload: ANNOUNCEMENT,
      headers: { authorization: BEARER },
      remoteAddress: '203.0.113.9',
    });
    expect(elsewhere.statusCode).toBe(200);
  });
});
