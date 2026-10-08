import { Writable } from 'node:stream';
import { DrizzleQueryError } from 'drizzle-orm';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { fail, installErrorHandling } from '../src/errors.js';
import { DEVICE } from './helpers.js';

// What error answers say and what the log keeps of them.

async function appThrowing(error: unknown) {
  const lines: string[] = [];
  const app = Fastify({
    logger: {
      level: 'error',
      stream: new Writable({
        write(chunk, _encoding, done) {
          lines.push(String(chunk));
          done();
        },
      }),
    },
  });
  installErrorHandling(app);
  app.get('/boom', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    throw error;
  });
  const res = await app.inject({ method: 'GET', url: '/boom' });
  await app.close();
  return { res, log: lines.join('') };
}

const databaseError = (code: string, message: string) =>
  new DrizzleQueryError(
    'insert into "routes" ("id", "owner_device_id", "edit_token_hash") values ($1, $2, $3)',
    ['ruta-abcdefghij', DEVICE, 'a'.repeat(64)],
    Object.assign(new Error(message), { code }),
  );

describe('error answers', () => {
  it('log only the database code and message of a failed query, never its values', async () => {
    const { res, log } = await appThrowing(databaseError('23502', 'null value in column "spec"'));
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'internal' });
    expect(log).toContain('23502');
    expect(log).toContain('null value in column');
    expect(log).not.toContain(DEVICE);
    expect(log).not.toContain('aaaaaaaa');
    expect(log).not.toContain('insert into');
  });

  it('are never cached, whatever the handler set before failing', async () => {
    const { res } = await appThrowing(fail(404, 'route_not_found'));
    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('treat values the database cannot store as the client fault, without logging', async () => {
    const { res, log } = await appThrowing(databaseError('22P05', 'unsupported Unicode escape'));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'validation_failed' });
    expect(log).toBe('');
  });

  it('carry at most 20 details', async () => {
    const details = Array.from({ length: 30 }, (_, i) => ({
      path: `spec.points[${i}]`,
      message: 'x',
    }));
    const { res } = await appThrowing(fail(422, 'invalid_route', details));
    expect(res.statusCode).toBe(422);
    expect(res.json().details).toHaveLength(20);
    const { res: bare } = await appThrowing(fail(422, 'invalid_route', []));
    expect(bare.json()).toEqual({ code: 'invalid_route' });
  });
});
