import { buildRouteSpec } from '@rumbo/route-builder';
import { describe, expect, it } from 'vitest';
import { i18n } from '../src/i18n/index.ts';
import {
  ACTIVITIES,
  dimMarkers,
  filterMarkers,
  filterRoutes,
  legendEntries,
  markerRouteId,
  poiMarkers,
  presentInterests,
  presentOrigins,
  routeInterests,
  routeLines,
  routeMarkers,
  routeOrigin,
  routePath,
} from '../src/map/explore.ts';
import { ACTIVITY_LOOKS } from '../src/map/symbols.ts';
import {
  bundledPois,
  bundledRoutes,
  type CatalogRoute,
  toCatalogRoute,
} from '../src/services/catalog.ts';

// The pure parts of the Explore map (ADR 0005): pins and lines by activity, the
// filter by origin and interest, and the legend. The screen itself is in
// ui-explore-map.test.ts and the SDK side in map-routemap.test.ts.

const t = i18n.global.t as unknown as (key: string, params?: Record<string, unknown>) => string;

const PLACES = [
  { tempId: 'a', name: 'Castelo', position: { lat: 39.7473, lng: -8.8077 } },
  { tempId: 'b', name: 'Sé', position: { lat: 39.7448, lng: -8.8079 } },
  { tempId: 'c', name: 'Rio Lis', position: { lat: 39.7408, lng: -8.8061 } },
];

interface UserRouteOptions {
  activity?: 'walk' | 'run' | 'bike';
  interests?: string[];
  mine?: boolean;
}

/** A route of a user: the user's own with `mine`, otherwise another person's (the community's). */
function userRoute(id: string, name: string, options: UserRouteOptions = {}): CatalogRoute {
  const built = buildRouteSpec(
    {
      name,
      locale: 'es',
      mode: 'free',
      activity: options.activity ?? 'walk',
      places: PLACES,
      ...(options.interests ? { interests: options.interests } : {}),
    },
    { source: 'user', id },
  );
  const route = toCatalogRoute({ spec: built.normalized, contents: {} }, 0);
  return options.mine ? { ...route, mine: { sync: 'synced' } } : route;
}

const leiria = (): CatalogRoute => {
  const route = bundledRoutes().find((r) => r.id === 'leiria-historica');
  if (!route) throw new Error('The curated route is missing');
  return route;
};

describe('the activities', () => {
  it('each have their own colour and line style, so colour is never the only cue', () => {
    const looks = ACTIVITIES.map((activity) => ACTIVITY_LOOKS[activity]);
    expect(ACTIVITIES).toEqual(['walk', 'run', 'bike']);
    expect(new Set(looks.map((look) => look.color)).size).toBe(3);
    expect(new Set(looks.map((look) => look.line)).size).toBe(3);
    // Walk is the plain line; the others are dashed.
    expect(ACTIVITY_LOOKS.walk.line).toBe('solid');
    expect(ACTIVITY_LOOKS.run.line).toBe('long-dash');
    expect(ACTIVITY_LOOKS.bike.line).toBe('dash');
  });
});

describe('route pins', () => {
  const walk = userRoute('paseo-walk', 'Paseo', { activity: 'walk' });
  const run = userRoute('paseo-run', 'Carrera', { activity: 'run' });
  const bike = userRoute('paseo-bike', 'Rodada', { activity: 'bike' });
  const other = userRoute('paseo-two', 'Otro paseo', { activity: 'walk' });

  it('take the colour of their route’s activity, the same for every route of it', () => {
    const colorOf = (route: CatalogRoute) => [
      ...new Set(routeMarkers([route], 'es', t).map((marker) => marker.color)),
    ];
    expect(colorOf(walk)).toEqual([ACTIVITY_LOOKS.walk.color]);
    expect(colorOf(run)).toEqual([ACTIVITY_LOOKS.run.color]);
    expect(colorOf(bike)).toEqual([ACTIVITY_LOOKS.bike.color]);
    expect(colorOf(other)).toEqual(colorOf(walk));
  });

  it('keep their category icon and their place in the route', () => {
    const markers = routeMarkers([leiria()], 'es', t);
    expect(markers).toHaveLength(12);
    expect(markers.every((marker) => marker.state === 'explore')).toBe(true);
    expect(new Set(markers.map((marker) => marker.category)).size).toBeGreaterThan(1);
    expect(markers.every((marker) => markerRouteId(marker.id) === 'leiria-historica')).toBe(true);
  });

  it('say the activity in their popup, with its colour, and still the route name and the way in', () => {
    const [marker] = routeMarkers([run], 'es', t);
    expect(marker?.popup.kicker).toBe('Carrera');
    expect(marker?.popup.chips).toEqual([
      { label: 'Lugar' },
      { label: 'Correr', color: ACTIVITY_LOOKS.run.color },
    ]);
    expect(marker?.popup.actions).toEqual([{ id: 'viewRoute', label: 'Ver ruta', primary: true }]);
  });

  it('fade, except those of the highlighted route, when one is highlighted', () => {
    const markers = [...routeMarkers([walk, run], 'es', t)];
    expect(dimMarkers(markers, null)).toEqual(markers);
    expect(dimMarkers(markers, null).some((marker) => marker.dim)).toBe(false);
    const faded = dimMarkers(markers, 'paseo-walk');
    expect(faded.filter((marker) => marker.dim).map((marker) => markerRouteId(marker.id))).toEqual(
      Array.from({ length: 3 }, () => 'paseo-run'),
    );
    expect(faded.filter((marker) => !marker.dim).map((marker) => markerRouteId(marker.id))).toEqual(
      Array.from({ length: 3 }, () => 'paseo-walk'),
    );
    // The input isn't touched.
    expect(markers.some((marker) => marker.dim)).toBe(false);
  });

  it('are the only markers that fade: points of interest stay as they are', () => {
    const pois = bundledPois().flatMap((layer) =>
      layer.pois.map((poi) => ({ poi, locale: layer.locale })),
    );
    const faded = dimMarkers(poiMarkers(pois, 'es', t), 'paseo-walk');
    expect(faded.some((marker) => marker.dim)).toBe(false);
  });
});

describe('route lines', () => {
  const run = userRoute('paseo-run', 'Carrera', { activity: 'run' });
  const bike = userRoute('paseo-bike', 'Rodada', { activity: 'bike' });

  it('join the points of a route in order, with straight legs when it has no drawn path', () => {
    const route = leiria();
    const [line] = routeLines([route], 'es');
    const ordered = [...route.bundle.spec.points]
      .sort((a, b) => a.order - b.order)
      .map((point) => point.position);
    expect(line?.points).toEqual(ordered);
    expect(line?.points).toHaveLength(12);
    expect(route.bundle.spec.path).toBeUndefined();
  });

  it('follow the points in their order, whatever order they are stored in', () => {
    const route = leiria();
    const shuffled: CatalogRoute = {
      ...route,
      bundle: {
        ...route.bundle,
        spec: { ...route.bundle.spec, points: [...route.bundle.spec.points].reverse() },
      },
    };
    expect(routePath(shuffled)).toEqual(routePath(route));
  });

  it('follow the drawn path when the route has one', () => {
    const route = leiria();
    const path = [
      { lat: 39.74, lng: -8.8 },
      { lat: 39.741, lng: -8.801 },
      { lat: 39.742, lng: -8.803 },
    ];
    const drawn: CatalogRoute = {
      ...route,
      bundle: { ...route.bundle, spec: { ...route.bundle.spec, path } },
    };
    expect(routePath(drawn)).toEqual(path);
    expect(routeLines([drawn], 'es')[0]?.points).toEqual(path);
  });

  it('use the colour and the style of the activity, and are named in the language shown', () => {
    const lines = routeLines([leiria(), run, bike], 'es');
    expect(lines.map((line) => [line.id, line.color, line.style])).toEqual([
      ['leiria-historica', ACTIVITY_LOOKS.walk.color, 'solid'],
      ['paseo-run', ACTIVITY_LOOKS.run.color, 'long-dash'],
      ['paseo-bike', ACTIVITY_LOOKS.bike.color, 'dash'],
    ]);
    expect(lines.map((line) => line.label)).toEqual(['Leiria histórica', 'Carrera', 'Rodada']);
    expect(routeLines([leiria()], 'en')[0]?.label).toBe('Historic Leiria');
    expect(routeLines([leiria()], 'pt')[0]?.label).toBe('Leiria histórica');
  });

  it('are all normal until a route is highlighted, then that one is strong and the others dim', () => {
    const routes = [leiria(), run, bike];
    expect(routeLines(routes, 'es').map((line) => line.emphasis)).toEqual([
      'normal',
      'normal',
      'normal',
    ]);
    expect(routeLines(routes, 'es', 'paseo-run').map((line) => line.emphasis)).toEqual([
      'dim',
      'strong',
      'dim',
    ]);
  });

  it('are one per route, none for no routes', () => {
    expect(routeLines([], 'es')).toEqual([]);
    expect(routeLines([run, bike], 'es')).toHaveLength(2);
  });
});

describe('where a route comes from', () => {
  it('is official for the curated ones, the user’s for theirs and the community’s for any other', () => {
    expect(routeOrigin(leiria())).toBe('curated');
    expect(routeOrigin(userRoute('mia-aaaa', 'Mía', { mine: true }))).toBe('mine');
    expect(routeOrigin(userRoute('otra-aaaa', 'De otra persona'))).toBe('community');
  });

  it('lists only the origins that are there, in the filter’s order', () => {
    const mine = userRoute('mia-aaaa', 'Mía', { mine: true });
    const community = userRoute('otra-aaaa', 'De otra persona');
    expect(presentOrigins([])).toEqual([]);
    expect(presentOrigins([mine])).toEqual(['mine']);
    expect(presentOrigins([mine, community, leiria()])).toEqual(['curated', 'community', 'mine']);
  });
});

describe('what a route is for', () => {
  it('reads the interests of the route, in the contract’s order, and ignores what it does not know', () => {
    expect(routeInterests(leiria())).toEqual([]);
    expect(routeInterests(userRoute('a-aaaa', 'A', { interests: ['food', 'history'] }))).toEqual([
      'history',
      'food',
    ]);
    expect(routeInterests(userRoute('b-bbbb', 'B', { interests: ['ski', 'art'] }))).toEqual([
      'art',
    ]);
  });

  it('lists the interests some route has, and none when no route has any', () => {
    const history = userRoute('h-hhhh', 'H', { interests: ['history'] });
    const nature = userRoute('n-nnnn', 'N', { interests: ['nature', 'history'] });
    expect(presentInterests([leiria()])).toEqual([]);
    expect(presentInterests([history, nature, leiria()])).toEqual(['history', 'nature']);
  });
});

describe('the routes the filter lets through', () => {
  const official = leiria();
  const mine = userRoute('mia-aaaa', 'Mía', { mine: true, interests: ['history'] });
  const riverside = userRoute('rio-aaaa', 'Junto al río', {
    activity: 'bike',
    interests: ['nature', 'history'],
  });
  const running = userRoute('run-aaaa', 'Correr', { activity: 'run', interests: ['food'] });
  const routes = [official, mine, riverside, running];
  const ids = (list: CatalogRoute[]) => list.map((route) => route.id);
  const none = { origins: new Set<never>(), interests: new Set<never>() };

  it('lets every route through when nothing is chosen', () => {
    expect(ids(filterRoutes(routes, none))).toEqual(ids(routes));
  });

  it('keeps the routes of the origins chosen', () => {
    expect(ids(filterRoutes(routes, { ...none, origins: new Set(['curated'] as const) }))).toEqual([
      'leiria-historica',
    ]);
    expect(ids(filterRoutes(routes, { ...none, origins: new Set(['mine'] as const) }))).toEqual([
      'mia-aaaa',
    ]);
    expect(
      ids(filterRoutes(routes, { ...none, origins: new Set(['mine', 'community'] as const) })),
    ).toEqual(['mia-aaaa', 'rio-aaaa', 'run-aaaa']);
  });

  it('keeps the routes made for any of the interests chosen', () => {
    expect(
      ids(filterRoutes(routes, { ...none, interests: new Set(['history'] as const) })),
    ).toEqual(['mia-aaaa', 'rio-aaaa']);
    expect(
      ids(filterRoutes(routes, { ...none, interests: new Set(['nature', 'food'] as const) })),
    ).toEqual(['rio-aaaa', 'run-aaaa']);
  });

  it('asks for both when both are chosen', () => {
    const filter = {
      origins: new Set(['community'] as const),
      interests: new Set(['history'] as const),
    };
    expect(ids(filterRoutes(routes, filter))).toEqual(['rio-aaaa']);
  });

  it('does not count a choice that no route has, so nothing hides behind a chip nobody can see', () => {
    // No route is about art, and none is the user's own among these.
    const filter = {
      origins: new Set(['mine'] as const),
      interests: new Set(['art'] as const),
    };
    expect(ids(filterRoutes([official, riverside], filter))).toEqual([
      'leiria-historica',
      'rio-aaaa',
    ]);
    // A choice that is there still counts next to one that isn't.
    expect(
      ids(
        filterRoutes([official, riverside], {
          origins: new Set(['community', 'mine'] as const),
          interests: new Set(),
        }),
      ),
    ).toEqual(['rio-aaaa']);
  });

  it('works with the markers: a route that doesn’t pass takes its pins off the map', () => {
    const markers = routeMarkers(routes, 'es', t);
    const shown = new Set(
      ids(filterRoutes(routes, { ...none, origins: new Set(['curated'] as const) })),
    );
    const hiddenRoutes = new Set(ids(routes).filter((id) => !shown.has(id)));
    const kept = filterMarkers(markers, { hiddenRoutes, showPois: true, categories: new Set() });
    expect(new Set(kept.map((marker) => markerRouteId(marker.id)))).toEqual(
      new Set(['leiria-historica']),
    );
  });
});

describe('the legend', () => {
  const walk = leiria();
  const run = userRoute('run-aaaa', 'Correr', { activity: 'run' });
  const bike = userRoute('bike-aaaa', 'Rodar', { activity: 'bike' });
  const pois = bundledPois().flatMap((layer) =>
    layer.pois.map((poi) => ({ poi, locale: layer.locale })),
  );
  const pins = (routes: CatalogRoute[]) => routeMarkers(routes, 'es', t);
  const places = () => poiMarkers(pois, 'es', t);

  it('lists the activities that are on the map, in order, and the points of interest', () => {
    expect(legendEntries('points', [bike, walk], [...pins([bike, walk]), ...places()])).toEqual({
      activities: ['walk', 'bike'],
      places: true,
    });
    expect(legendEntries('points', [bike, run, walk], pins([bike, run, walk])).activities).toEqual([
      'walk',
      'run',
      'bike',
    ]);
  });

  it('has no entry per route: two routes of one activity are one entry', () => {
    const other = userRoute('otra-aaaa', 'Otra', { activity: 'walk' });
    expect(legendEntries('points', [walk, other], pins([walk, other])).activities).toEqual([
      'walk',
    ]);
  });

  it('leaves out the points of interest when there are none on the map', () => {
    expect(legendEntries('points', [walk], pins([walk])).places).toBe(false);
  });

  it('lists a route’s activity only while a pin of it is on the map (points view)', () => {
    // The categories filter took every pin of the running route away.
    const shown = pins([walk, run]).filter((marker) => markerRouteId(marker.id) !== 'run-aaaa');
    expect(legendEntries('points', [walk, run], shown).activities).toEqual(['walk']);
  });

  it('has only the activities in the routes view: no points of interest, even with some around', () => {
    expect(legendEntries('routes', [run, walk], [...pins([run, walk]), ...places()])).toEqual({
      activities: ['walk', 'run'],
      places: false,
    });
  });

  it('is empty when nothing is shown', () => {
    expect(legendEntries('points', [], [])).toEqual({ activities: [], places: false });
    expect(legendEntries('routes', [], [])).toEqual({ activities: [], places: false });
  });
});
