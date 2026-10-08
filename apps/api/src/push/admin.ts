import { createHash, timingSafeEqual } from 'node:crypto';

// The operator's token for POST /v1/admin/push (announcements). A secret in
// the server's environment (ADMIN_TOKEN), sent as `Authorization: Bearer …`.

/** A shorter token is not used: the endpoint stays off (404) rather than guarded by a guessable secret. */
export const MIN_ADMIN_TOKEN_LENGTH = 32;

/** The token to guard the endpoint with, or null when there is none worth trusting. */
export function usableAdminToken(token: string | null): string | null {
  return token !== null && token.length >= MIN_ADMIN_TOKEN_LENGTH ? token : null;
}

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest();

/**
 * Whether `header` is `Authorization: Bearer <token>`. The comparison is in
 * constant time: it runs over two SHA-256 digests, which are always the same
 * length, so neither the time nor an early exit says how much matched.
 */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const given = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? '';
  return timingSafeEqual(digest(given), digest(token));
}
