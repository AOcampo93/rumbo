import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import type { Locale } from '@rumbo/route-spec';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import {
  type AnalyticsEvent,
  clearAnalytics,
  initAnalytics,
  stopAnalytics,
} from '../src/services/analytics.ts';
import { reportedRoutes } from '../src/services/community.ts';
import { type MyRouteRecord, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useUiStore } from '../src/stores/ui.ts';
import RouteDetailView from '../src/views/RouteDetailView.vue';
import { json } from './create-fixtures.ts';

// S03 · Route detail of a route the community published (phase 7.2, ADR 0004):
// its label, the language it is in, and the discreet "Reportar ruta" at the
// end with its sheet of reasons. The route comes from the API by its address,
// as it does when someone opens a link or reloads the page.

// The map SDK isn't needed here (RouteMap has its own test).
vi.mock('../src/map/RouteMap.vue', async () => {
  const { defineComponent: define, h } = await import('vue');
  return {
    __esModule: true,
    default: define({
      name: 'RouteMap',
      setup(_, { expose }) {
        expose({ openPopup: () => undefined });
        return () => h('div', { class: 'map-stub' });
      },
    }),
  };
});

const Empty = defineComponent({ render: () => null });
const ID = 'paseo-aaaa';
const NOT_FOUND = 'No encontramos esta ruta.';
const REASONS = [
  'Spam o publicidad',
  'Contenido ofensivo',
  'Lugar peligroso o de acceso prohibido',
  'Expone datos personales o una vivienda',
  'Información falsa o lugares que no existen',
  'Otro motivo',
];

function bundleOf(id: string, locale: Locale = 'pt') {
  const built = buildRouteSpec(
    {
      name: 'Passeio pelo centro',
      locale,
      mode: 'free',
      activity: 'walk',
      places: [
        { tempId: 'a', name: 'Castelo', position: { lat: 39.7473, lng: -8.8077 } },
        { tempId: 'b', name: 'Sé', position: { lat: 39.7448, lng: -8.8079 } },
      ],
    },
    { source: 'user', id },
  );
  return { spec: built.spec, contents: {} };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** The API: the routes it has (by id), and what POST /reports answers. Everything else is a 503. */
function stubApi(
  options: { routes?: Record<string, unknown>; report?: () => Response | Promise<Response> } = {},
): Call[] {
  const routes = options.routes ?? { [ID]: bundleOf(ID) };
  const report = options.report ?? (() => json({ received: true }, 201));
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      };
      calls.push(call);
      const reports = /^\/api\/v1\/routes\/([^/]+)\/reports$/.exec(url);
      if (reports && call.method === 'POST') return report();
      const bundle = /^\/api\/v1\/routes\/([^/?]+)$/.exec(url);
      if (bundle && call.method === 'GET') {
        const found = routes[bundle[1] ?? ''];
        return found ? json(found) : json({ code: 'route_not_found' }, 404);
      }
      return new Response(null, { status: 503 });
    }),
  );
  return calls;
}

function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
}

let wrapper: VueWrapper | null = null;

async function setup(routeId = ID) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/my-routes', name: 'my-routes', component: Empty },
      { path: '/create/details', name: 'create-details', component: Empty },
      { path: '/routes/:routeId', name: 'route', component: Empty },
      { path: '/routes/:routeId/prepare', name: 'prepare', component: Empty },
      { path: '/run', name: 'run', component: Empty },
    ],
  });
  await router.push(`/routes/${routeId}`);
  wrapper = mount(RouteDetailView, {
    props: { routeId },
    global: { plugins: [pinia, router, i18n] },
    attachTo: document.body,
  });
  await vi.waitFor(() =>
    expect(wrapper?.find('.detail__sheet').exists() || wrapper?.text().includes(NOT_FOUND)).toBe(
      true,
    ),
  );
  await flushPromises();
  return { view: wrapper, ui: useUiStore(), router };
}

const button = (view: VueWrapper, label: string) =>
  view.findAll('button').find((candidate) => candidate.text() === label);
const sheet = (view: VueWrapper) => view.find('[role="dialog"]');
const reasons = (view: VueWrapper) =>
  view.findAll('[role="dialog"] .reason').map((label) => label.text());
const reportCalls = (calls: Call[]) => calls.filter((call) => call.url.endsWith('/reports'));
const analyticsEvents = async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  return (await db.get<AnalyticsEvent[]>(KEYS.analyticsQueue)) ?? [];
};

/** Opens the sheet and picks a reason (by its label). */
async function choose(view: VueWrapper, reason: string) {
  await button(view, 'Reportar ruta')?.trigger('click');
  await flushPromises();
  const label = view.findAll('[role="dialog"] .reason').find((item) => item.text() === reason);
  await label?.get('input').setValue(true);
}

beforeEach(async () => {
  applyLocale('es');
  stubApi();
  await db.clear();
  await initAnalytics(() => true);
  clearAnalytics();
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  stopAnalytics();
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a route the community published', () => {
  it('is asked for by its address, labelled "De la comunidad", with the facts of any route', async () => {
    const calls = stubApi();
    const { view } = await setup();
    expect(calls.filter((call) => call.url === `/api/v1/routes/${ID}`)).toHaveLength(1);
    expect(view.get('h1').text()).toBe('Passeio pelo centro');
    expect(view.get('.detail__shared').text()).toBe('De la comunidad');
    // It can be started like any other route, and it is not the user's to edit.
    expect(view.get('.detail__cta').text()).toContain('Iniciar ruta');
    expect(view.find('.detail__actions').exists()).toBe(false);
    expect(view.find('.detail__status').exists()).toBe(false);
    expect(view.text()).not.toContain(NOT_FOUND);
  });

  it('says so when its texts are in another language than the app, and only then', async () => {
    const { view } = await setup();
    expect(view.get('.detail__language').text()).toBe('Esta ruta está en portugués.');
    applyLocale('en');
    await flushPromises();
    expect(view.get('.detail__language').text()).toBe('This route is in Portuguese.');
    expect(view.get('.detail__shared').text()).toBe('From the community');
    applyLocale('pt');
    await flushPromises();
    expect(view.find('.detail__language').exists()).toBe(false);
    expect(view.get('.detail__shared').text()).toBe('Da comunidade');
    expect(button(view, 'Denunciar rota')).toBeDefined();
  });

  it('names the language it is in, whichever it is', async () => {
    stubApi({ routes: { [ID]: bundleOf(ID, 'en') } });
    const { view } = await setup();
    expect(view.get('.detail__language').text()).toBe('Esta ruta está en inglés.');
  });

  it('is not found when the API says it does not exist', async () => {
    stubApi({ routes: {} });
    const { view } = await setup('paseo-zzzz');
    expect(view.text()).toContain(NOT_FOUND);
    expect(view.find('.detail__sheet').exists()).toBe(false);
  });

  it('is not found, and not an error, when the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const { view } = await setup('paseo-zzzz');
    expect(view.text()).toContain(NOT_FOUND);
  });

  it('is never reported from the curated routes nor from the ones the user made', async () => {
    const { view } = await setup('leiria-historica');
    expect(view.get('h1').text()).toBe('Leiria histórica');
    expect(view.find('.detail__shared').exists()).toBe(false);
    expect(button(view, 'Reportar ruta')).toBeUndefined();
    view.unmount();
    wrapper = null;

    const own = bundleOf('minha-rota-1', 'es');
    const record: MyRouteRecord = {
      id: 'minha-rota-1',
      editToken: 'a'.repeat(43),
      bundle: own,
      rev: 1,
      sync: 'synced',
      remote: 'yes',
      failures: 0,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    };
    await db.set(KEYS.myRoutes, { v: 1, records: { [record.id]: record } });
    const mine = await setup('minha-rota-1');
    expect(mine.view.find('.detail__shared').exists()).toBe(false);
    expect(mine.view.find('.detail__language').exists()).toBe(false);
    expect(button(mine.view, 'Reportar ruta')).toBeUndefined();
  });
});

describe('"Reportar ruta"', () => {
  it('is a discreet button after the list of places', async () => {
    const { view } = await setup();
    const report = view.get('.detail__report');
    expect(report.text()).toBe('Reportar ruta');
    expect(report.element.previousElementSibling?.classList.contains('detail__points')).toBe(true);
    expect(sheet(view).exists()).toBe(false);
  });

  it('opens a sheet with the six reasons, and sends nothing until one is chosen', async () => {
    const calls = stubApi();
    const { view } = await setup();
    await button(view, 'Reportar ruta')?.trigger('click');
    await flushPromises();
    expect(sheet(view).attributes('aria-label')).toBe('Reportar ruta');
    expect(sheet(view).text()).toContain('¿Qué le pasa a esta ruta?');
    expect(reasons(view)).toEqual(REASONS);
    const radios = view.findAll('[role="dialog"] input[type="radio"]');
    expect(radios).toHaveLength(6);
    expect(radios.every((radio) => !(radio.element as HTMLInputElement).checked)).toBe(true);
    const send = view.findAll('[role="dialog"] button').find((b) => b.text() === 'Enviar');
    expect(send?.attributes('disabled')).toBeDefined();
    await send?.trigger('click');
    expect(reportCalls(calls)).toEqual([]);
  });

  it('sends the reason with the device id, thanks the user and does not offer it again', async () => {
    const calls = stubApi();
    const { view, ui } = await setup();
    await choose(view, 'Lugar peligroso o de acceso prohibido');
    const send = () => view.findAll('[role="dialog"] button').find((b) => b.text() === 'Enviar');
    expect(send()?.attributes('disabled')).toBeUndefined();
    await send()?.trigger('click');
    await vi.waitFor(() => expect(sheet(view).exists()).toBe(false));

    expect(reportCalls(calls)).toHaveLength(1);
    expect(reportCalls(calls)[0]).toMatchObject({
      method: 'POST',
      url: `/api/v1/routes/${ID}/reports`,
      body: { reason: 'dangerous' },
    });
    expect(reportCalls(calls)[0]?.headers['x-device-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(ui.toasts[0]).toMatchObject({
      message: { key: 'route.report.thanks' },
      tone: 'success',
    });
    // Not offered again: here, nor after the page is opened anew.
    expect(button(view, 'Reportar ruta')).toBeUndefined();
    expect([...(await reportedRoutes())]).toEqual([ID]);
    view.unmount();
    wrapper = null;
    const again = await setup();
    expect(again.view.get('h1').text()).toBe('Passeio pelo centro');
    expect(button(again.view, 'Reportar ruta')).toBeUndefined();

    // Counted by reason, and nothing that tells the route.
    const events = (await analyticsEvents()).filter((event) => event.name === 'route_reported');
    expect(events.map((event) => event.props)).toEqual([{ reason: 'dangerous' }]);
  });

  it('thanks the user in the three languages', async () => {
    const { view, ui } = await setup();
    applyLocale('en');
    await flushPromises();
    await button(view, 'Report route')?.trigger('click');
    await flushPromises();
    expect(sheet(view).text()).toContain("What's wrong with this route?");
    expect(reasons(view)).toEqual([
      'Spam or advertising',
      'Offensive content',
      'Dangerous place or no-entry area',
      'Exposes personal details or a home',
      "False information or places that don't exist",
      'Another reason',
    ]);
    applyLocale('pt');
    await flushPromises();
    expect(sheet(view).attributes('aria-label')).toBe('Denunciar rota');
    expect(reasons(view)[3]).toBe('Expõe dados pessoais ou uma habitação');
    await view.findAll('[role="dialog"] input[type="radio"]')[0]?.setValue(true);
    await view
      .findAll('[role="dialog"] button')
      .find((b) => b.text() === 'Enviar')
      ?.trigger('click');
    await vi.waitFor(() => expect(ui.toasts).toHaveLength(1));
    expect(ui.toasts[0]?.message).toEqual({ key: 'route.report.thanks' });
  });

  it('thanks the user too when the route is gone meanwhile, and says nothing about it', async () => {
    stubApi({ report: () => json({ code: 'route_not_found' }, 404) });
    const { view, ui } = await setup();
    await choose(view, 'Spam o publicidad');
    await view
      .findAll('[role="dialog"] button')
      .find((b) => b.text() === 'Enviar')
      ?.trigger('click');
    await vi.waitFor(() => expect(sheet(view).exists()).toBe(false));
    expect(ui.toasts[0]?.message).toEqual({ key: 'route.report.thanks' });
    expect(button(view, 'Reportar ruta')).toBeUndefined();
  });

  it('keeps the sheet open and says so when the report did not get through, and then sends it', async () => {
    let healthy = false;
    const calls = stubApi({
      report: () => (healthy ? json({ received: true }) : json({ code: 'rate_limited' }, 429)),
    });
    const { view, ui } = await setup();
    await choose(view, 'Contenido ofensivo');
    const send = () => view.findAll('[role="dialog"] button').find((b) => b.text() === 'Enviar');
    await send()?.trigger('click');
    await vi.waitFor(() => expect(view.find('[role="dialog"] [role="alert"]').exists()).toBe(true));
    expect(view.get('[role="dialog"] [role="alert"]').text()).toBe(
      'Algo salió mal. Inténtalo de nuevo.',
    );
    expect(sheet(view).exists()).toBe(true);
    // The choice is kept, and nothing was remembered or thanked.
    expect(
      (view.findAll('[role="dialog"] input[type="radio"]')[1]?.element as HTMLInputElement).checked,
    ).toBe(true);
    expect(ui.toasts).toHaveLength(0);
    expect([...(await reportedRoutes())]).toEqual([]);
    expect((await analyticsEvents()).some((event) => event.name === 'route_reported')).toBe(false);

    healthy = true;
    await send()?.trigger('click');
    await vi.waitFor(() => expect(sheet(view).exists()).toBe(false));
    expect(reportCalls(calls)).toHaveLength(2);
    expect(ui.toasts[0]?.message).toEqual({ key: 'route.report.thanks' });
  });

  it('stays open while the report is on its way, and closes with the thanks when the API answers', async () => {
    let answer: (response: Response) => void = () => {};
    stubApi({ report: () => new Promise<Response>((resolve) => (answer = resolve)) });
    const { view, ui } = await setup();
    await choose(view, 'Spam o publicidad');
    const send = () => view.findAll('[role="dialog"] button').find((b) => b.text() === 'Enviar');
    await send()?.trigger('click');
    await vi.waitFor(() => expect(send()?.attributes('aria-busy')).toBe('true'));

    // Nothing closes it meanwhile: not the buttons, not Escape.
    expect(view.get('[role="dialog"] [aria-label="Cerrar"]').attributes('disabled')).toBeDefined();
    const cancel = view.findAll('[role="dialog"] button').find((b) => b.text() === 'Cancelar');
    expect(cancel?.attributes('disabled')).toBeDefined();
    await view.get('.frame').trigger('keydown', { key: 'Escape' });
    expect(sheet(view).exists()).toBe(true);

    answer(json({ received: true }, 201));
    await vi.waitFor(() => expect(sheet(view).exists()).toBe(false));
    expect(ui.toasts[0]?.message).toEqual({ key: 'route.report.thanks' });
    expect(button(view, 'Reportar ruta')).toBeUndefined();
  });

  it('does not send anything offline, and says so', async () => {
    const calls = stubApi();
    const { view } = await setup();
    await choose(view, 'Otro motivo');
    setOnline(false);
    await view
      .findAll('[role="dialog"] button')
      .find((b) => b.text() === 'Enviar')
      ?.trigger('click');
    await flushPromises();
    expect(view.get('[role="dialog"] [role="alert"]').text()).toBe('Sin conexión.');
    expect(reportCalls(calls)).toEqual([]);
  });

  it('closes with "Cancelar" or the close button, sending nothing, and the button stays', async () => {
    const calls = stubApi();
    const { view } = await setup();
    await choose(view, 'Spam o publicidad');
    await view
      .findAll('[role="dialog"] button')
      .find((b) => b.text() === 'Cancelar')
      ?.trigger('click');
    await flushPromises();
    expect(sheet(view).exists()).toBe(false);
    await button(view, 'Reportar ruta')?.trigger('click');
    await flushPromises();
    // A new sheet starts with no reason chosen.
    expect(view.findAll('[role="dialog"] input[type="radio"]:checked')).toHaveLength(0);
    await view.get('[role="dialog"] [aria-label="Cerrar"]').trigger('click');
    await flushPromises();
    expect(sheet(view).exists()).toBe(false);
    expect(button(view, 'Reportar ruta')).toBeDefined();
    expect(reportCalls(calls)).toEqual([]);
  });
});
