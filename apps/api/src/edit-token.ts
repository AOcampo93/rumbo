import { createHash, timingSafeEqual } from 'node:crypto';
import { EDIT_TOKEN_HEADER, EditTokenSchema } from '@rumbo/api-contract';
import type { FastifyRequest } from 'fastify';
import { fail } from './errors.js';

// The edit token of a user route (PROJECT_PLAN §10.8): 32 random bytes the
// client makes when it creates the route and sends as X-Edit-Token on every
// write. The server keeps only its SHA-256, so a database leak gives no write
// access.

const digest = (token: string) => createHash('sha256').update(token, 'utf8').digest();

/** What the routes table stores: the token's SHA-256, in hex. */
export function hashEditToken(token: string): string {
  return digest(token).toString('hex');
}

/** Compares in constant time; a route without a stored hash matches no token. */
export function editTokenMatches(token: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const stored = Buffer.from(storedHash, 'hex');
  const given = digest(token);
  return stored.length === given.length && timingSafeEqual(stored, given);
}

/** The request's X-Edit-Token when it is well formed; undefined otherwise. */
export function editTokenFrom(request: FastifyRequest): string | undefined {
  const parsed = EditTokenSchema.safeParse(request.headers[EDIT_TOKEN_HEADER]);
  return parsed.success ? parsed.data : undefined;
}

export function requireEditToken(request: FastifyRequest): string {
  const token = editTokenFrom(request);
  if (!token) throw fail(401, 'missing_edit_token');
  return token;
}
