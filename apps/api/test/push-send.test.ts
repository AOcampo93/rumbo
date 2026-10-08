import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushSubscriptions } from '../src/db/schema.js';
import {
  createPushSender,
  MAX_PUSH_FAILURES,
  PUSH_TTL_SECONDS,
  type PushMessage,
  type PushRecipient,
  type PushTransport,
  recipientOf,
} from '../src/push/send.js';
import { DEVICE, resetDatabase, setupApi } from './helpers.js';
import { pushService } from './push-fakes.js';

// The sender: what a message carries, and what each answer of a push service
// does to the subscription it was sent to. Nothing touches the network.

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => {
  api = await setupApi();
});
afterAll(() => api.close());
beforeEach(() => resetDatabase(api.database));

const NOW = Date.parse('2026-10-08T12:00:00.000Z');

function logger() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { log, asFastify: log as unknown as FastifyBaseLogger };
}

function senderOver(
  transport: PushTransport,
  database = () => api.database as typeof api.database | null,
) {
  const { log, asFastify } = logger();
  return { sender: createPushSender({ database, transport, log: asFastify, now: () => NOW }), log };
}

/** A subscription in the database, as the sender receives it. */
async function subscribed(
  endpoint: string,
  locale: 'es' | 'en' | 'pt' = 'es',
  failures = 0,
): Promise<PushRecipient> {
  const [row] = await api.db
    .insert(pushSubscriptions)
    .values({
      deviceId: DEVICE,
      endpoint: `https://fcm.googleapis.com/fcm/send/${endpoint}`,
      p256dh: `p256dh-${endpoint}`,
      auth: `auth-${endpoint}`,
      locale,
      failures,
    })
    .returning();
  return recipientOf(row as typeof pushSubscriptions.$inferSelect);
}

const rowOf = async (recipient: PushRecipient) =>
  (await api.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, recipient.id)))[0];

const message = (locale: string): PushMessage => ({
  title: `title ${locale}`,
  body: `body ${locale}`,
  url: '/run',
  tag: 'test:1',
});

describe('a message', () => {
  it('is JSON of title, body, url and tag, written in each recipient’s language', async () => {
    const service = pushService();
    const { sender } = senderOver(service.transport);
    const [es1, es2, en, pt] = [
      await subscribed('a', 'es'),
      await subscribed('b', 'es'),
      await subscribed('c', 'en'),
      await subscribed('d', 'pt'),
    ] as [PushRecipient, PushRecipient, PushRecipient, PushRecipient];
    const messageFor = vi.fn(message);

    const tally = await sender.deliver([es1, es2, en, pt], messageFor);

    expect(tally).toEqual({ sent: 4, gone: 0, failed: 0 });
    // Each language is written once, however many people read it.
    expect(messageFor.mock.calls.map(([locale]) => locale).sort()).toEqual(['en', 'es', 'pt']);
    expect(service.sent.map((request) => JSON.parse(request.payload))).toEqual([
      { title: 'title es', body: 'body es', url: '/run', tag: 'test:1' },
      { title: 'title es', body: 'body es', url: '/run', tag: 'test:1' },
      { title: 'title en', body: 'body en', url: '/run', tag: 'test:1' },
      { title: 'title pt', body: 'body pt', url: '/run', tag: 'test:1' },
    ]);
  });

  it('is kept by the push service for a day, at normal urgency, and goes with the recipient’s keys', async () => {
    const service = pushService();
    const { sender } = senderOver(service.transport);
    const recipient = await subscribed('a');
    await sender.deliver([recipient], message);
    expect(PUSH_TTL_SECONDS).toBe(86_400);
    expect(service.sent).toEqual([
      {
        endpoint: recipient.endpoint,
        p256dh: recipient.p256dh,
        auth: recipient.auth,
        payload: JSON.stringify(message('es')),
        ttlSeconds: 86_400,
        urgency: 'normal',
      },
    ]);
  });

  it('sends nothing, and needs nothing, to nobody', async () => {
    const service = pushService();
    const { sender } = senderOver(service.transport);
    expect(await sender.deliver([], message)).toEqual({ sent: 0, gone: 0, failed: 0 });
    expect(service.transport).not.toHaveBeenCalled();
  });

  it('is never sent if it cannot be written', async () => {
    const service = pushService();
    const { sender } = senderOver(service.transport);
    const recipient = await subscribed('a');
    await expect(
      sender.deliver([recipient], () => {
        throw new RangeError('no text');
      }),
    ).rejects.toThrow('no text');
    expect(service.transport).not.toHaveBeenCalled();
    // And it is no failure of the subscription.
    expect((await rowOf(recipient))?.failures).toBe(0);
  });
});

describe('an answer of the push service', () => {
  it('2xx: delivered, the subscription is marked and its failures forgiven', async () => {
    const { sender } = senderOver(
      pushService((request) => (request.endpoint.endsWith('/b') ? 202 : 201)).transport,
    );
    const [a, b] = [await subscribed('a', 'es', 3), await subscribed('b', 'es', 1)] as [
      PushRecipient,
      PushRecipient,
    ];
    expect(await sender.deliver([a, b], message)).toEqual({ sent: 2, gone: 0, failed: 0 });
    for (const recipient of [a, b]) {
      expect(await rowOf(recipient)).toMatchObject({ failures: 0, lastSuccessAt: new Date(NOW) });
    }
  });

  it('404 and 410: the push service forgot the subscription, so it is deleted', async () => {
    const { sender, log } = senderOver(
      pushService((request) =>
        request.endpoint.endsWith('/a') ? 404 : request.endpoint.endsWith('/b') ? 410 : 201,
      ).transport,
    );
    const [a, b, c] = [await subscribed('a'), await subscribed('b'), await subscribed('c')] as [
      PushRecipient,
      PushRecipient,
      PushRecipient,
    ];
    expect(await sender.deliver([a, b, c], message)).toEqual({ sent: 1, gone: 2, failed: 0 });
    expect(await rowOf(a)).toBeUndefined();
    expect(await rowOf(b)).toBeUndefined();
    expect(await rowOf(c)).toBeDefined();
    // A subscription that is gone is no refusal worth a warning.
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 413, 429, 500, 503])(
    '%i: counted against the subscription, which stays',
    async (status) => {
      const { sender } = senderOver(pushService(() => status).transport);
      const recipient = await subscribed('a');
      expect(await sender.deliver([recipient], message)).toEqual({ sent: 0, gone: 0, failed: 1 });
      expect(await rowOf(recipient)).toMatchObject({ failures: 1, lastSuccessAt: null });
    },
  );

  it(`${MAX_PUSH_FAILURES} refusals in a row and the subscription is dropped; a delivery in between starts the count again`, async () => {
    let status = 500;
    const { sender } = senderOver(pushService(() => status).transport);
    const recipient = await subscribed('a');
    for (let i = 1; i < MAX_PUSH_FAILURES; i++) {
      await sender.deliver([recipient], message);
      expect((await rowOf(recipient))?.failures).toBe(i);
    }
    status = 201;
    await sender.deliver([recipient], message);
    expect((await rowOf(recipient))?.failures).toBe(0);

    status = 500;
    for (let i = 0; i < MAX_PUSH_FAILURES; i++) await sender.deliver([recipient], message);
    expect(await rowOf(recipient)).toBeUndefined();
  });

  it('none at all (status 0, or a transport that throws): a refusal too, and the rest still go', async () => {
    const transport = vi.fn<PushTransport>(async (request) => {
      if (request.endpoint.endsWith('/a')) return { status: 0, reason: 'ECONNRESET' };
      if (request.endpoint.endsWith('/b')) throw new Error(`socket hang up ${request.endpoint}`);
      return { status: 201 };
    });
    const { sender } = senderOver(transport);
    const [a, b, c] = [await subscribed('a'), await subscribed('b'), await subscribed('c')] as [
      PushRecipient,
      PushRecipient,
      PushRecipient,
    ];
    expect(await sender.deliver([a, b, c], message)).toEqual({ sent: 1, gone: 0, failed: 2 });
    expect((await rowOf(a))?.failures).toBe(1);
    expect((await rowOf(b))?.failures).toBe(1);
    expect((await rowOf(c))?.failures).toBe(0);
  });
});

describe('what is logged', () => {
  it('is why messages were refused, never an address or a key', async () => {
    const statuses: Record<string, PushResponseLike> = {
      a: { status: 500 },
      b: { status: 500 },
      c: { status: 403 },
      d: { status: 0, reason: 'ECONNRESET' },
    };
    const transport = vi.fn<PushTransport>(async (request) => {
      const key = request.endpoint.slice(-1);
      if (key === 'e')
        throw new Error(`boom ${request.endpoint} ${request.p256dh} ${request.auth}`);
      return statuses[key] ?? { status: 201 };
    });
    const { sender, log } = senderOver(transport);
    const recipients = await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => subscribed(id)),
    );
    await sender.deliver(recipients, message);

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { refused: { '500': 2, '403': 1, ECONNRESET: 1, Error: 1 } },
      'push messages not delivered',
    );
    const everything = JSON.stringify([
      log.info.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls,
    ]);
    for (const recipient of recipients) {
      expect(everything).not.toContain(recipient.endpoint);
      expect(everything).not.toContain(recipient.p256dh);
      expect(everything).not.toContain(recipient.auth);
    }
  });
});

type PushResponseLike = { status: number; reason?: string };

describe('the way it works', () => {
  it('has ten messages in flight at most', async () => {
    let inFlight = 0;
    let peak = 0;
    const transport = vi.fn<PushTransport>(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { status: 201 };
    });
    const { sender } = senderOver(transport);
    const recipients = await Promise.all(Array.from({ length: 35 }, (_, i) => subscribed(`n${i}`)));
    expect(await sender.deliver(recipients, message)).toEqual({ sent: 35, gone: 0, failed: 0 });
    expect(transport).toHaveBeenCalledTimes(35);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(10);
  });

  it('answers 503 unavailable while the database is not ready, and sends nothing', async () => {
    const service = pushService();
    const { sender } = senderOver(service.transport, () => null);
    await expect(
      sender.deliver([{ id: 1, endpoint: 'e', p256dh: 'p', auth: 'a', locale: 'es' }], message),
    ).rejects.toMatchObject({ status: 503, code: 'unavailable' });
    expect(service.transport).not.toHaveBeenCalled();
  });

  it('reads a language it does not know as Spanish', async () => {
    const [row] = await api.db
      .insert(pushSubscriptions)
      .values({
        deviceId: DEVICE,
        endpoint: 'https://fcm.googleapis.com/fcm/send/odd',
        p256dh: 'p',
        auth: 'a',
        locale: 'fr',
      })
      .returning();
    expect(recipientOf(row as typeof pushSubscriptions.$inferSelect).locale).toBe('es');
  });
});
