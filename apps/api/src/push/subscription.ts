import { createPublicKey } from 'node:crypto';

// What a browser's push subscription may contain. The server POSTs to the
// endpoint it is given, so only the addresses of the real push services are
// accepted: anything else would make the API a way to send requests anywhere.

const EXACT_HOSTS: ReadonlySet<string> = new Set([
  // Chrome, Edge and Opera on Android and desktop; Samsung Internet; Brave.
  'fcm.googleapis.com',
  // Firefox.
  'updates.push.services.mozilla.com',
  // Safari, and the home-screen web apps of iOS 16.4 and later.
  'web.push.apple.com',
]);
/** Subdomains of these (the dot included), on label boundaries. */
const HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com'] as const;

/** The longest endpoint kept: the real ones take 100 to 500 characters. */
export const MAX_ENDPOINT_LENGTH = 2048;

/** An https:// address, without credentials or a port, on a known push service. */
export function isPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  // URL lowercases the host and drops the default port, so `:443` passes and `:8443` does not.
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname;
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The bytes of an unpadded base64url text, or null if it isn't one. */
function decode(value: string): Buffer | null {
  return BASE64URL.test(value) ? Buffer.from(value, 'base64url') : null;
}

/** The browser's public key: an uncompressed P-256 point (65 bytes) that is really on the curve. */
export function isP256dh(value: string): boolean {
  const bytes = decode(value);
  if (!bytes || bytes.length !== 65 || bytes[0] !== 0x04) return false;
  try {
    createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: bytes.subarray(1, 33).toString('base64url'),
        y: bytes.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    return true;
  } catch {
    return false;
  }
}

/** The browser's auth secret: 16 bytes (RFC 8291). */
export function isAuthSecret(value: string): boolean {
  return decode(value)?.length === 16;
}
