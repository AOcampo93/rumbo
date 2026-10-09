import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformOf } from '../src/device.js';
import { DEVICE, setupApi } from './helpers.js';

// Cross-cutting behaviour: OpenAPI docs, security headers, rate limits.

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => {
  api = await setupApi({ rateLimitPerMinute: 3 });
});
afterAll(() => api.close());

describe('the API', () => {
  it('publishes its OpenAPI description under /api/v1/docs', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/api/v1/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/v1/routes',
        '/v1/routes/{id}',
        '/v1/runs',
        '/v1/runs/{runId}',
        '/v1/analytics/batch',
        '/v1/geo/suggest',
        '/v1/geo/resolve',
        '/v1/content/generate',
        '/v1/suggest/places',
        '/v1/push/key',
        '/v1/push/subscriptions',
        '/v1/admin/push',
        '/v1/routes/{id}/status',
        '/v1/routes/{id}/reports',
        '/v1/admin/moderation',
        '/v1/admin/routes/{id}',
        '/v1/admin/routes/{id}/moderation',
      ]),
    );
    expect(Object.keys(doc.paths['/v1/routes'])).toEqual(expect.arrayContaining(['get', 'post']));
    expect(Object.keys(doc.paths['/v1/routes/{id}'])).toEqual(
      expect.arrayContaining(['get', 'put', 'delete']),
    );
    expect(Object.keys(doc.paths['/v1/push/key'])).toEqual(['get']);
    expect(Object.keys(doc.paths['/v1/push/subscriptions'])).toEqual(
      expect.arrayContaining(['post', 'delete']),
    );
    expect(Object.keys(doc.paths['/v1/admin/push'])).toEqual(['post']);
    expect(doc.servers).toEqual([{ url: '/api' }]);
  });

  it('describes the community routes’ endpoints with their schemas', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/api/v1/docs/json' });
    const { paths } = res.json();
    interface Schema {
      properties: Record<string, unknown>;
      required: string[];
    }
    const schemaOf = (
      operation: {
        responses: Record<string, { content: { 'application/json': { schema: Schema } } }>;
      },
      status: string,
    ) => operation.responses[status]!.content['application/json'].schema;

    const status = paths['/v1/routes/{id}/status'];
    expect(Object.keys(status)).toEqual(['get']);
    expect(Object.keys(schemaOf(status.get, '200').properties)).toEqual([
      'visibility',
      'moderation',
      'publishedAt',
    ]);

    const reports = paths['/v1/routes/{id}/reports'];
    expect(Object.keys(reports)).toEqual(['post']);
    expect(
      reports.post.requestBody.content['application/json'].schema.properties.reason.enum,
    ).toEqual(['spam', 'offensive', 'dangerous', 'privacy', 'wrong', 'other']);
    expect(Object.keys(reports.post.responses).sort()).toEqual(['200', '201']);
    expect(schemaOf(reports.post, '201').required).toEqual(['received']);

    const queue = paths['/v1/admin/moderation'];
    expect(Object.keys(queue)).toEqual(['get']);
    expect(Object.keys(schemaOf(queue.get, '200').properties)).toEqual(['routes']);

    const action = paths['/v1/admin/routes/{id}/moderation'];
    expect(Object.keys(action)).toEqual(['post']);
    expect(
      action.post.requestBody.content['application/json'].schema.properties.action.enum,
    ).toEqual(['block', 'restore']);
    expect(schemaOf(action.post, '200').required).toEqual(['id', 'moderation']);

    // POST and PUT /routes take a visibility and answer with it.
    const body = (verb: 'post' | 'put', path: string) =>
      paths[path][verb].requestBody.content['application/json'].schema.properties;
    expect(body('post', '/v1/routes').visibility.enum).toEqual(['private', 'public']);
    expect(body('put', '/v1/routes/{id}').visibility.enum).toEqual(['private', 'public']);
    expect(Object.keys(schemaOf(paths['/v1/routes'].post, '201').properties)).toEqual([
      'id',
      'updatedAt',
      'visibility',
      'moderation',
    ]);
  });

  it('sends security headers', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('limits requests per device with { code: "rate_limited" }', async () => {
    const hit = () =>
      api.app.inject({ method: 'GET', url: '/api/v1/routes', headers: { 'x-device-id': DEVICE } });
    for (let i = 0; i < 3; i++) expect((await hit()).statusCode).toBe(200);
    const limited = await hit();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'rate_limited' });
  });

  it('keeps only a rough platform from the User-Agent', () => {
    expect(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)')).toBe('desktop');
    expect(platformOf(undefined)).toBe('other');
  });
});
