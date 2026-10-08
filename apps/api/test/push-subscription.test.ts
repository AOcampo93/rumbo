import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  isAuthSecret,
  isP256dh,
  isPushEndpoint,
  MAX_ENDPOINT_LENGTH,
} from '../src/push/subscription.js';
import { browser } from './push-fakes.js';

// What a push subscription may contain. The server POSTs to the endpoint, so
// the host allow-list is what keeps the API from sending requests anywhere.

describe('isPushEndpoint', () => {
  it('accepts the addresses of the real push services', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://fcm.googleapis.com/wp/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAA',
      'https://autopush.push.services.mozilla.com/wpush/v2/x',
      'https://web.push.apple.com/QOk3',
      'https://db5p.notify.windows.com/?token=AwYAAA',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
      'https://a.b.notify.windows.com/w',
      // The default port is the same address; the host is case-insensitive.
      'https://fcm.googleapis.com:443/fcm/send/abc',
      'https://FCM.GoogleAPIs.com/fcm/send/abc',
    ]) {
      expect(isPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it('refuses anything that is not https', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'ftp://fcm.googleapis.com/x',
      'javascript:alert(1)',
      'data:text/plain,hi',
      '//fcm.googleapis.com/fcm/send/abc',
      'fcm.googleapis.com/fcm/send/abc',
    ]) {
      expect(isPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it('refuses hosts that only look like a push service', () => {
    for (const endpoint of [
      'https://example.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/fcm/send/abc',
      'https://evil-fcm.googleapis.com/fcm/send/abc',
      'https://googleapis.com/fcm/send/abc',
      'https://push.services.mozilla.com/x',
      'https://evilpush.services.mozilla.com/x',
      'https://notify.windows.com/x',
      'https://evilnotify.windows.com/x',
      'https://notify.windows.com.evil.example/x',
      'https://web.push.apple.com.evil.example/x',
      'https://evil.example/fcm.googleapis.com',
      'https://evil.example/?u=https://fcm.googleapis.com',
      'https://fcm.googleapis.com.@evil.example/x',
      // Trailing dot: a different name for the parser.
      'https://fcm.googleapis.com./fcm/send/abc',
      'https://a.notify.windows.com./x',
      // IP addresses and local names.
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://localhost/x',
      'https://192.168.1.10/fcm/send/abc',
    ]) {
      expect(isPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it('refuses credentials, other ports, rubbish and endless addresses', () => {
    for (const endpoint of [
      'https://user:pass@fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com@evil.example/fcm/send/abc',
      'https://evil.example\\@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://fcm.googleapis.com:80/fcm/send/abc',
      '',
      ' ',
      'not a url',
      `https://fcm.googleapis.com/${'a'.repeat(MAX_ENDPOINT_LENGTH)}`,
    ]) {
      expect(isPushEndpoint(endpoint), endpoint.slice(0, 60)).toBe(false);
    }
  });
});

describe('isP256dh', () => {
  it('accepts a real P-256 public key in unpadded base64url', () => {
    expect(isP256dh(browser().keys.p256dh)).toBe(true);
  });

  it('refuses text that is not one', () => {
    const real = browser().keys.p256dh;
    const bytes = Buffer.from(real, 'base64url');
    const cases: Array<[string, string]> = [
      ['empty', ''],
      ['padded', `${real}=`],
      ['standard base64', bytes.toString('base64')],
      ['not base64url', `${real.slice(0, -1)}!`],
      ['too short', bytes.subarray(0, 64).toString('base64url')],
      ['too long', Buffer.concat([bytes, Buffer.from([1])]).toString('base64url')],
      [
        'a compressed point',
        Buffer.concat([Buffer.from([0x02]), bytes.subarray(1, 33)]).toString('base64url'),
      ],
      [
        'not an uncompressed point',
        Buffer.concat([Buffer.from([0x05]), bytes.subarray(1)]).toString('base64url'),
      ],
      [
        'a point that is not on the curve',
        Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 1)]).toString('base64url'),
      ],
      ['all zeros', Buffer.alloc(65).toString('base64url')],
    ];
    for (const [what, value] of cases) expect(isP256dh(value), what).toBe(false);
  });
});

describe('isAuthSecret', () => {
  it('accepts 16 bytes in unpadded base64url', () => {
    expect(isAuthSecret(randomBytes(16).toString('base64url'))).toBe(true);
  });

  it('refuses any other size, and anything that is not base64url', () => {
    expect(isAuthSecret('')).toBe(false);
    expect(isAuthSecret(randomBytes(15).toString('base64url'))).toBe(false);
    expect(isAuthSecret(randomBytes(17).toString('base64url'))).toBe(false);
    expect(isAuthSecret(randomBytes(16).toString('base64'))).toBe(false);
    expect(isAuthSecret(`${randomBytes(16).toString('base64url')}==`)).toBe(false);
    expect(isAuthSecret('has spaces in it!!')).toBe(false);
  });
});
