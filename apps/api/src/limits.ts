import { BlockList, isIPv6 } from 'node:net';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fail } from './errors.js';

// The strict limits (route writes, place search) count per client address.
// X-Device-Id is the client's choice, so a limit keyed on it is dodged by
// sending a new one each time; the address is not.

/** Loopback, link-local and private networks: Docker's, where Traefik connects from. */
const PRIVATE_NETWORKS = new BlockList();
for (const [network, prefix] of [
  ['127.0.0.0', 8],
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['169.254.0.0', 16],
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, 'ipv6');
}

/**
 * Fastify's trustProxy: one hop (Traefik is the only proxy; DNS is not
 * proxied), and only when the connection comes from a private network.
 * request.ip is then the last X-Forwarded-For entry, the one Traefik adds;
 * entries a client writes come before it and never count. Fastify 5 turns a
 * plain hop count (`trustProxy: 1`) into "trust nothing", since it can't
 * tell a proxy from a client connecting directly; the network check does.
 */
export function trustProxyHop(address: string | undefined, hop: number): boolean {
  return (
    hop === 0 &&
    typeof address === 'string' &&
    PRIVATE_NETWORKS.check(address, isIPv6(address) ? 'ipv6' : 'ipv4')
  );
}

/** The client's address; IPv6 by its /64, the share a single subscriber usually gets. */
export const clientAddress = (request: FastifyRequest): string => normalizeIP(request.ip);

export interface LimitWindow {
  max: number;
  /** '1 minute', '1 day'… */
  timeWindow: string;
}

/**
 * An onRequest hook that counts each request in every window (one counter per
 * address, shared by all the routes that use this hook) and answers 429
 * `rate_limited` with Retry-After once any window is exceeded. Create it once
 * per budget. It is built on createRateLimit rather than rateLimit: the
 * plugin lets only the first rateLimit hook of a request count, so a second
 * window (or the global limit) would be skipped.
 */
export function addressLimit(
  app: FastifyInstance,
  windows: readonly LimitWindow[],
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const limiters = windows.map((window) =>
    app.createRateLimit({ ...window, keyGenerator: clientAddress }),
  );
  return async (request, reply) => {
    for (const limit of limiters) {
      const result = await limit(request);
      if (!result.isAllowed && result.isExceeded) {
        reply.header('retry-after', result.ttlInSeconds);
        throw fail(429, 'rate_limited');
      }
    }
  };
}
