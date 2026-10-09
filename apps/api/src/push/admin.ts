import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '../errors.js';
import { addressLimit } from '../limits.js';

// The operator's token for the admin endpoints: the push announcements
// (POST /v1/admin/push) and the moderation of community routes. A secret in
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

export interface AdminGuardOptions {
  /** ADMIN_TOKEN; null, or too short to trust: the admin endpoints answer 404. */
  adminToken: string | null;
  /** Admin requests, and wrong tokens, per minute per client address. */
  rateLimitPerMinute: number;
}

/** The onRequest hooks of an admin endpoint, in the order they run. */
export type AdminGuard = Array<(request: FastifyRequest, reply: FastifyReply) => Promise<void>>;

/**
 * What every admin endpoint is guarded with. Without a usable token the
 * endpoint doesn't exist (404). The address limit then counts each request
 * (429), so a wrong token costs an attempt too, and only then is the token
 * checked (403). Create it once: the endpoints that use it share one budget
 * per address.
 */
export function adminGuard(app: FastifyInstance, options: AdminGuardOptions): AdminGuard {
  const token = usableAdminToken(options.adminToken);
  const limit = addressLimit(app, [{ max: options.rateLimitPerMinute, timeWindow: '1 minute' }]);
  return [
    async () => {
      if (!token) throw fail(404, 'not_found');
    },
    limit,
    async (request) => {
      if (!token || !bearerMatches(request.headers.authorization, token)) {
        throw fail(403, 'forbidden');
      }
    },
  ];
}
