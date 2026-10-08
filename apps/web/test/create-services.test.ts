import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/en.json';
import es from '../src/i18n/es.json';
import pt from '../src/i18n/pt.json';
import { AI_ERROR_MESSAGES, AiError, BLOCKING_AI_ERRORS } from '../src/services/ai.ts';
import { generateCard } from '../src/services/content.ts';
import { suggestPlaces } from '../src/services/suggest.ts';
import { apiError, generated, json, suggestion } from './create-fixtures.ts';

// The two AI endpoints (design §4): the request, the answer checked against the
// contract and every failure as a code the screens explain.

const body = {
  name: 'Castelo de Leiria',
  position: { lat: 39.7473, lng: -8.8077 },
  locale: 'es' as const,
  externalId: 'Q1023767',
  interests: ['history' as const],
  custom: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

function answer(response: () => Response | Promise<Response>): void {
  fetchMock = vi.fn(async () => response());
  vi.stubGlobal('fetch', fetchMock);
}

async function failure(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'resolved',
    (error: unknown) => (error instanceof AiError ? error.code : error),
  );
}

beforeEach(() => {
  answer(() => json(generated()));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generateCard', () => {
  it('posts the place with the device id and returns the card as the API made it', async () => {
    const result = await generateCard(body);
    expect(result.content.title).toBe('Castillo de Leiria');
    expect(result.grounding).toBe('wikipedia');
    expect(result.cached).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/content/generate');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-device-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it.each([
    [503, 'ai_unavailable', 'ai_unavailable'],
    [429, 'ai_budget_exceeded', 'ai_budget_exceeded'],
    [429, 'ai_device_limit', 'ai_device_limit'],
    [502, 'generation_failed', 'failed'],
    [429, 'rate_limited', 'failed'],
    [400, 'validation_failed', 'failed'],
    [500, 'internal', 'failed'],
  ])('turns %i %s into "%s"', async (status, code, expected) => {
    answer(() => apiError(code, status));
    expect(await failure(generateCard(body))).toBe(expected);
  });

  it('does not take a proxy page or a broken answer for the API', async () => {
    answer(() => new Response('<!doctype html><title>Bad gateway</title>', { status: 502 }));
    expect(await failure(generateCard(body))).toBe('failed');
    answer(() => json({ nope: true }));
    expect(await failure(generateCard(body))).toBe('failed');
    answer(() => new Response('not json', { status: 200 }));
    expect(await failure(generateCard(body))).toBe('failed');
  });

  it('refuses a card in another language than the one asked for', async () => {
    answer(() => json(generated({ locale: 'en' })));
    expect(await failure(generateCard(body))).toBe('failed');
  });

  it('says "offline" when the request cannot leave and the browser is offline', async () => {
    answer(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await failure(generateCard(body))).toBe('failed');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await failure(generateCard(body))).toBe('offline');
  });

  it("rethrows the caller's abort instead of calling it an error", async () => {
    const controller = new AbortController();
    answer(
      () =>
        new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason));
        }),
    );
    const call = failure(generateCard(body, controller.signal));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    controller.abort(new DOMException('closed', 'AbortError'));
    const error = (await call) as DOMException;
    expect(error).toBeInstanceOf(DOMException);
    expect(error.name).toBe('AbortError');
  });
});

describe('suggestPlaces', () => {
  const request = {
    near: { lat: 39.74362, lng: -8.80711 },
    locale: 'es' as const,
    interests: ['history' as const, 'food' as const],
    minutes: 120,
    activity: 'walk' as const,
    exclude: ['Q1023767'],
  };

  it('rounds the position to about 110 m before it leaves the device', async () => {
    answer(() => json(suggestion));
    const result = await suggestPlaces(request);
    expect(result.places.map((place) => place.externalId)).toEqual([
      'Q1023767',
      'Q2422093',
      'Q10331797',
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/suggest/places');
    expect((init.headers as Record<string, string>)['x-device-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toMatchObject({
      near: { lat: 39.744, lng: -8.807 },
      minutes: 120,
      exclude: ['Q1023767'],
    });
  });

  it('explains the daily limits and treats the rest as a failure to try again', async () => {
    answer(() => apiError('ai_budget_exceeded', 429));
    expect(await failure(suggestPlaces(request))).toBe('ai_budget_exceeded');
    answer(() => apiError('ai_unavailable', 503));
    expect(await failure(suggestPlaces(request))).toBe('ai_unavailable');
    answer(() => apiError('generation_failed', 502));
    expect(await failure(suggestPlaces(request))).toBe('failed');
    answer(() => json({ title: 'x', summary: 'y', places: [{ name: 'no id' }] }));
    expect(await failure(suggestPlaces(request))).toBe('failed');
  });
});

describe('the texts of the errors', () => {
  it('exist in the three languages, and the blocking ones are the ones nobody can retry', () => {
    const lookup = (catalog: unknown, key: string) =>
      key
        .split('.')
        .reduce<unknown>((tree, part) => (tree as Record<string, unknown>)[part], catalog);
    for (const [code, key] of Object.entries(AI_ERROR_MESSAGES)) {
      for (const catalog of [es, en, pt]) {
        expect([code, typeof lookup(catalog, key)]).toEqual([code, 'string']);
      }
    }
    expect([...BLOCKING_AI_ERRORS].sort()).toEqual([
      'ai_budget_exceeded',
      'ai_device_limit',
      'ai_unavailable',
    ]);
  });
});
