import { createPublicKey, verify } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebPushTransport, type PushRequest } from '../src/push/send.js';
import { checkVapid } from '../src/push/vapid.js';
import { browser, vapidSettings } from './push-fakes.js';

// The real transport, `web-push` over HTTPS, with https.request replaced by a
// push service of our own: what goes out on the wire is checked, nothing
// reaches the network.

const check = checkVapid(vapidSettings());
if (!check.ok) throw new Error('the test VAPID settings are not valid');
const VAPID = check.vapid;

// http_ece is web-push's own dependency, so it is found from web-push.
const fromWebPush = createRequire(
  join(dirname(createRequire(import.meta.url).resolve('web-push')), 'index.js'),
);
const ece = fromWebPush('http_ece') as {
  decrypt(
    data: Buffer,
    params: { version: string; privateKey: unknown; authSecret: string },
  ): Buffer;
};

interface Seen {
  options: RequestOptions;
  body: Buffer;
}

/** Replaces https.request with a push service that answers `status`, or fails with `error`. */
function pushService(answer: { status: number } | { error: Error }) {
  const seen: Seen[] = [];
  vi.spyOn(https, 'request').mockImplementation(((
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => {
    const chunks: Buffer[] = [];
    const request = new EventEmitter() as ClientRequest;
    request.write = ((chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }) as ClientRequest['write'];
    request.destroy = ((error?: Error) => {
      queueMicrotask(() => request.emit('error', error));
      return request;
    }) as ClientRequest['destroy'];
    request.end = (() => {
      seen.push({ options, body: Buffer.concat(chunks) });
      if ('error' in answer) {
        // The library asks the socket to time out by itself; any other failure is the network's.
        if (answer.error.message === 'timeout') request.emit('timeout');
        else queueMicrotask(() => request.emit('error', answer.error));
        return request;
      }
      const response = new PassThrough() as unknown as IncomingMessage;
      response.statusCode = answer.status;
      response.headers = {};
      callback(response);
      (response as unknown as PassThrough).end('the push service’s words');
      return request;
    }) as ClientRequest['end'];
    return request;
  }) as unknown as typeof https.request);
  return seen;
}

afterEach(() => vi.restoreAllMocks());

const requestFor = (b: ReturnType<typeof browser>, payload: string): PushRequest => ({
  endpoint: b.endpoint,
  p256dh: b.keys.p256dh,
  auth: b.keys.auth,
  payload,
  ttlSeconds: 86_400,
  urgency: 'normal',
});

describe('the web-push transport', () => {
  it('sends the message encrypted for the browser, signed with the server’s VAPID key', async () => {
    const seen = pushService({ status: 201 });
    const transport = createWebPushTransport(VAPID);
    const b = browser();
    const payload = JSON.stringify({
      title: '¿Seguimos?',
      body: 'Tu recorrido «X»',
      url: '/run',
      tag: 't',
    });

    expect(await transport(requestFor(b, payload))).toEqual({ status: 201 });

    expect(seen).toHaveLength(1);
    const { options, body } = seen[0] as Seen;
    const url = new URL(b.endpoint);
    expect(options).toMatchObject({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      timeout: 10_000,
    });
    expect(options.headers).toMatchObject({
      TTL: 86_400,
      Urgency: 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    });
    // Only the browser can read it: decrypted with its key and secret, it is the message.
    expect(body.includes(Buffer.from('Seguimos'))).toBe(false);
    expect(
      ece
        .decrypt(body, { version: 'aes128gcm', privateKey: b.curve, authSecret: b.keys.auth })
        .toString(),
    ).toBe(payload);

    // The VAPID header: a JWT for the push service's origin, from the server's contact.
    const authorization = String((options.headers as Record<string, unknown>)['Authorization']);
    const [, jwt, key] = /^vapid t=([\w.-]+), k=([\w-]+)$/.exec(authorization) ?? [];
    expect(key).toBe(VAPID.publicKey);
    const claims = JSON.parse(
      Buffer.from((jwt as string).split('.')[1] as string, 'base64url').toString(),
    );
    expect(claims).toMatchObject({ aud: `https://${url.hostname}`, sub: VAPID.subject });
    expect(claims.exp * 1000).toBeGreaterThan(Date.now());
    expect(claims.exp * 1000).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000);

    // And it is signed with the private key that goes with the public one the push service is given.
    const [header, payloadPart, signature] = (jwt as string).split('.') as [string, string, string];
    const publicBytes = Buffer.from(VAPID.publicKey, 'base64url');
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: publicBytes.subarray(1, 33).toString('base64url'),
        y: publicBytes.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payloadPart}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('answers the status the push service gave, accepted or refused', async () => {
    const transport = createWebPushTransport(VAPID);
    for (const status of [200, 201, 202, 400, 404, 410, 413, 429, 500]) {
      vi.restoreAllMocks();
      pushService({ status });
      expect(await transport(requestFor(browser(), '{}')), String(status)).toEqual({ status });
    }
  });

  it('answers status 0 and why when the push service never answers, without the address', async () => {
    const transport = createWebPushTransport(VAPID);
    const b = browser();
    const cases: Array<[string, Error, string]> = [
      [
        'a reset',
        Object.assign(new Error(`read ECONNRESET ${b.endpoint}`), { code: 'ECONNRESET' }),
        'ECONNRESET',
      ],
      [
        'no such host',
        Object.assign(new Error('getaddrinfo ENOTFOUND fcm.googleapis.com'), { code: 'ENOTFOUND' }),
        'ENOTFOUND',
      ],
      ['a timeout', new Error('timeout'), 'timeout'],
      ['something else', new Error(`weird ${b.endpoint} ${b.keys.auth}`), 'Error'],
    ];
    for (const [what, error, reason] of cases) {
      vi.restoreAllMocks();
      pushService({ error });
      const answer = await transport(requestFor(b, '{}'));
      expect(answer, what).toEqual({ status: 0, reason });
      expect(JSON.stringify(answer), what).not.toContain(b.endpoint);
    }
  });

  it('answers status 0 for keys that cannot encrypt, and sends nothing', async () => {
    const seen = pushService({ status: 201 });
    const transport = createWebPushTransport(VAPID);
    const b = browser();
    const answer = await transport({ ...requestFor(b, '{}'), p256dh: 'too-short' });
    expect(answer).toEqual({ status: 0, reason: 'Error' });
    expect(seen).toHaveLength(0);
  });
});
