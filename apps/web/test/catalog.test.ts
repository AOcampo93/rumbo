import { describe, expect, it, vi } from 'vitest';
import leiria from '../../../data/routes/leiria-historica.json';
import { i18n } from '../src/i18n/index.ts';
import { filterMarkers, poiMarkers, routeMarkers, wikipediaFor } from '../src/map/explore.ts';
import { bundledPois, bundledRoutes, routesFromApi } from '../src/services/catalog.ts';

const t = i18n.global.t as unknown as (key: string, params?: Record<string, unknown>) => string;

describe('the bundled catalog', () => {
  it('ships the curated Leiria route and the points of interest', () => {
    const routes = bundledRoutes();
    expect(routes.map((r) => r.id)).toContain('leiria-historica');
    const route = routes.find((r) => r.id === 'leiria-historica');
    expect(route).toMatchObject({
      bundled: true,
      summary: { pointCount: 12 },
      locales: ['es', 'en', 'pt'],
    });
    expect(bundledPois()[0]?.pois.length).toBeGreaterThanOrEqual(20);
  });
});

describe('the Explore map', () => {
  const routes = bundledRoutes();
  const pois = bundledPois().flatMap((layer) =>
    layer.pois.map((poi) => ({ poi, locale: layer.locale })),
  );

  it('has at least 20 markers, of two kinds (course requirement)', () => {
    const markers = [...routeMarkers(routes, 'es', t), ...poiMarkers(pois, 'es', t)];
    expect(markers.length).toBeGreaterThanOrEqual(20);
    expect(new Set(markers.map((m) => m.state))).toEqual(new Set(['explore', 'poi']));
    expect(new Set(markers.map((m) => m.id)).size).toBe(markers.length);
  });

  it('builds popups in the active language, with photo credits', () => {
    i18n.global.locale.value = 'en';
    const [marker] = routeMarkers(routes, 'en', t);
    expect(marker?.popup).toMatchObject({
      kicker: 'Historic Leiria',
      actions: [{ id: 'viewRoute', label: 'View route' }],
    });
    i18n.global.locale.value = 'pt';
    const withImage = poiMarkers(pois, 'pt', t).find((m) => m.popup.image);
    expect(withImage?.popup.kicker).toBe('Ponto de interesse');
    expect(withImage?.popup.image?.credit).toMatch(/CC|Public|public/);
  });

  it('filters by route, category and points of interest', () => {
    const markers = [...routeMarkers(routes, 'es', t), ...poiMarkers(pois, 'es', t)];
    const none = { hiddenRoutes: new Set<string>(), showPois: true, categories: new Set<never>() };
    expect(filterMarkers(markers, none)).toHaveLength(markers.length);
    expect(
      filterMarkers(markers, { ...none, showPois: false }).every((m) => m.state === 'explore'),
    ).toBe(true);
    expect(
      filterMarkers(markers, { ...none, hiddenRoutes: new Set(['leiria-historica']) }).every(
        (m) => m.state === 'poi',
      ),
    ).toBe(true);
    const churches = filterMarkers(markers, { ...none, categories: new Set(['church'] as const) });
    expect(churches.length).toBeGreaterThan(0);
    expect(churches.every((m) => m.category === 'church')).toBe(true);
  });

  it("links Wikipedia in the user's language when there is an article", () => {
    const poi = {
      id: 'Q1',
      name: 'X',
      position: { lat: 0, lng: 0 },
      category: 'other' as const,
      wikipedia: { pt: 'https://pt.wikipedia.org/wiki/X', en: 'https://en.wikipedia.org/wiki/X' },
    };
    expect(wikipediaFor(poi, 'en')).toBe('https://en.wikipedia.org/wiki/X');
    expect(wikipediaFor(poi, 'es')).toBe('https://pt.wikipedia.org/wiki/X');
  });
});

describe('routes from the API', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('fall back (null) when the API is missing or broken', async () => {
    expect(await routesFromApi(vi.fn(async () => json({}, 404)))).toBe(null);
    expect(await routesFromApi(vi.fn(async () => json([])))).toBe(null);
    expect(await routesFromApi(vi.fn(async () => Promise.reject(new Error('offline'))))).toBe(null);
  });

  it('use the validated bundles the API returns', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/routes') ? json([{ id: 'leiria-historica' }]) : json(leiria),
    );
    const routes = await routesFromApi(fetcher as unknown as typeof fetch);
    expect(routes?.map((r) => r.id)).toEqual(['leiria-historica']);
    expect(routes?.[0]?.bundled).toBe(false);
  });
});
