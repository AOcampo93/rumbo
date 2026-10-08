import { createECDH, randomBytes } from 'node:crypto';
import type { Locale } from '@rumbo/route-spec';
import { vi } from 'vitest';
import webpush from 'web-push';
import type { AppConfig } from '../src/config.js';
import type { PushRequest, PushResponse, PushTransport } from '../src/push/send.js';

// Stand-ins for the browsers and for the push services, shared by the tests of
// Web Push. Nothing here touches the network, and nothing is a literal that
// looks like a key: the secret scan of the repository's history would flag it.

/** A VAPID pair made on the spot, with the contact the production server uses. */
export function vapidSettings(): Pick<
  AppConfig,
  'vapidPublicKey' | 'vapidPrivateKey' | 'vapidSubject'
> {
  const keys = webpush.generateVAPIDKeys();
  return {
    vapidPublicKey: keys.publicKey,
    vapidPrivateKey: keys.privateKey,
    vapidSubject: 'https://rumbo.arturoocampo.com',
  };
}

/** The operator's token: long enough to be used, made from fixed bytes at run time. */
export const ADMIN_TOKEN = Buffer.alloc(32, 9).toString('base64url');

let counter = 0;

/** What a browser's PushSubscription holds: a real P-256 key and a 16-byte secret. */
export function browser(host = 'fcm.googleapis.com') {
  const curve = createECDH('prime256v1');
  curve.generateKeys();
  counter += 1;
  return {
    endpoint: `https://${host}/fcm/send/${counter}-${randomBytes(12).toString('base64url')}`,
    keys: {
      p256dh: curve.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
    /** The browser's private half, to read what was sent to it. */
    curve,
  };
}

export type Browser = ReturnType<typeof browser>;

/** The body of POST /push/subscriptions for a browser. */
export const subscription = (b: Browser, locale: Locale = 'es') => ({
  endpoint: b.endpoint,
  keys: b.keys,
  locale,
});

/** A push service that answers with `answer` (201 by default) and remembers what it was sent. */
export function pushService(answer: (request: PushRequest) => number | PushResponse = () => 201) {
  const sent: PushRequest[] = [];
  const transport = vi.fn<PushTransport>(async (request) => {
    sent.push(request);
    const response = answer(request);
    return typeof response === 'number' ? { status: response } : response;
  });
  return { transport, sent };
}

/** What a push carried, as the service worker reads it. */
export const messageOf = (request: PushRequest) =>
  JSON.parse(request.payload) as { title: string; body: string; url: string; tag: string };
