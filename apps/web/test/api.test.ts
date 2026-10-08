import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, apiErrorCode } from '../src/services/api.ts';
import { registerRunEnd } from '../src/services/runs.ts';

// The API client: methods, headers, timeouts and aborts, and the error codes
// it trusts (PROJECT_PLAN §11.1).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubFetch(answer: (init: RequestInit) => Promise<Response> = async () => json({})) {
  const fetchMock = vi.fn((_url: string, init: RequestInit) => answer(init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api()', () => {
  it('sends PUT and DELETE with extra headers, never as keepalive unless asked', async () => {
    const fetchMock = stubFetch();
    await api('/routes/x', { method: 'PUT', body: { a: 1 }, headers: { 'x-edit-token': 't' } });
    await api('/routes/x', { method: 'DELETE', headers: { 'x-edit-token': 't' } });
    const [put, del] = fetchMock.mock.calls.map(([url, init]) => ({ url, ...init }));
    expect(put).toMatchObject({ url: '/api/v1/routes/x', method: 'PUT', body: '{"a":1}' });
    expect(put?.headers).toMatchObject({
      'x-edit-token': 't',
      'content-type': 'application/json',
      accept: 'application/json',
    });
    expect(put?.keepalive).toBeUndefined();
    expect(del).toMatchObject({ method: 'DELETE' });
    expect(del?.body).toBeUndefined();
  });

  it('only lets small requests that may outlive the page ask for keepalive (the run end)', async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 204 }));
    await registerRunEnd('3c8f0a52-7d1e-4b6a-9f2c-5e4d3c2b1a09', {
      status: 'finished',
      endedAt: '2026-10-08T10:00:00.000Z',
      elapsedMs: 1000,
      completedPoints: 1,
      totalPoints: 1,
      score: 0,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH', keepalive: true });
  });

  it('never sends a request whose signal is already aborted', async () => {
    const fetchMock = stubFetch();
    const controller = new AbortController();
    controller.abort(new DOMException('Replaced', 'AbortError'));
    await expect(api('/geo/suggest?q=se', { signal: controller.signal })).rejects.toThrow(
      'Replaced',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the caller's abort and stops listening to its signal afterwards", async () => {
    stubFetch(
      (init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        ),
    );
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const request = api('/routes', { signal: controller.signal });
    await Promise.resolve();
    controller.abort(new DOMException('Stale', 'AbortError'));
    await expect(request).rejects.toThrow('Stale');
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('gives up after timeoutMs with a TimeoutError', async () => {
    vi.useFakeTimers();
    stubFetch(
      (init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        ),
    );
    const request = api('/routes', { timeoutMs: 1000 });
    const outcome = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(1000);
    await outcome;
  });
});

describe('apiErrorCode()', () => {
  it("reads the API's error code, and nothing from anyone else", async () => {
    expect(await apiErrorCode(json({ code: 'route_not_found' }, 404))).toBe('route_not_found');
    expect(
      await apiErrorCode(
        json({ code: 'invalid_route', details: [{ path: 'spec', message: 'x' }] }),
      ),
    ).toBe('invalid_route');
    expect(await apiErrorCode(json({ code: 'teapot' }, 418))).toBe(null);
    expect(await apiErrorCode(new Response('<html>404</html>', { status: 404 }))).toBe(null);
    expect(await apiErrorCode(new Response(null, { status: 502 }))).toBe(null);
  });

  it('leaves the body readable', async () => {
    const response = json({ code: 'forbidden' }, 403);
    await apiErrorCode(response);
    expect(await response.json()).toEqual({ code: 'forbidden' });
  });
});
