import 'fake-indexeddb/auto';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { getMyRoute, routeSyncIdle, syncMyRoutes } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCatalogStore } from '../src/stores/catalog.ts';
import { useCreatorStore } from '../src/stores/creator.ts';
import DoneStep from '../src/views/create/DoneStep.vue';
import ReviewStep from '../src/views/create/ReviewStep.vue';
import { castle, cathedral, json } from './create-fixtures.ts';

// Publishing for the community in the creator (phase 7.2, ADR 0004): the
// switch of the review step (C4), off by default and with its warning when it
// is on, what saving writes, and what the last screen (C5) says about it.

// The map SDK isn't needed (RouteMap has its own test).
vi.mock('../src/map/RouteMap.vue', async () => {
  const { h } = await import('vue');
  return { __esModule: true, default: { name: 'RouteMap', render: () => h('div') } };
});

const Empty = { render: () => null };
const HELP = 'Quien use Rumbo cerca podrá verla y recorrerla, sin saber quién la creó.';
const WARNING = 'Lo verán desconocidos: no incluyas tu casa ni datos personales.';

interface Write {
  method: string;
  body: { spec: { id: string }; visibility: string };
}

/** The route uploads: the API is away (503) until `up()` says it answers every write. */
function stubUploads() {
  const writes: Write[] = [];
  let answering = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' || !answering) return new Response(null, { status: 503 });
      const body = JSON.parse(String(init?.body)) as Write['body'];
      writes.push({ method, body });
      return json(
        { id: body.spec.id, updatedAt: '2026-10-09T10:00:00.000Z' },
        method === 'POST' ? 201 : 200,
      );
    }),
  );
  return {
    writes,
    up: () => {
      answering = true;
    },
  };
}

let wrapper: VueWrapper | null = null;

/** The creator with a route ready to save: two places, a name, and the app around it. */
async function prepare() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/my-routes', name: 'my-routes', component: Empty },
      { path: '/create/places', name: 'create-places', component: Empty },
      { path: '/create/content', name: 'create-content', component: Empty },
      { path: '/create/review', name: 'create-review', component: Empty },
      { path: '/create/done', name: 'create-done', component: Empty },
      { path: '/routes/:routeId', name: 'route', component: Empty },
      { path: '/routes/:routeId/prepare', name: 'prepare', component: Empty },
      { path: '/run', name: 'run', component: Empty },
      { path: '/run/summary', name: 'summary', component: Empty },
    ],
  });
  await router.push('/create/review');
  const creator = useCreatorStore();
  await creator.ensureDraft();
  await creator.update({ name: 'Leiria numa manhã' });
  await creator.addPlace({ ...castle, tempId: 'castle' });
  await creator.addPlace({ ...cathedral, tempId: 'cathedral' });
  return { pinia, router, creator, catalog: useCatalogStore() };
}

async function show(component: Component, env: Awaited<ReturnType<typeof prepare>>) {
  wrapper = mount(component, {
    global: { plugins: [env.pinia, env.router, i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const publishSwitch = (view: VueWrapper) =>
  view.find('[role="switch"][aria-label="Publicar para la comunidad"]');
const button = (view: VueWrapper, label: string) =>
  view.findAll('button').find((candidate) => candidate.text() === label);

beforeEach(async () => {
  applyLocale('es');
  stubUploads();
  await Promise.all([
    db.del(KEYS.creatorDraft),
    db.del(KEYS.creatorDraftBackup),
    db.del(KEYS.myRoutes),
  ]);
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('C4 · Revisar: "Publicar para la comunidad"', () => {
  it('is a switch that starts off, with what publishing means and no warning yet', async () => {
    const view = await show(ReviewStep, await prepare());
    const toggle = publishSwitch(view);
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes('aria-checked')).toBe('false');
    expect(view.text()).toContain(HELP);
    expect(view.text()).not.toContain(WARNING);
    // The switch is described by the help line.
    const described = toggle.attributes('aria-describedby') ?? '';
    expect(view.get(`#${described}`).text()).toBe(HELP);
  });

  it('warns that strangers will see the route when it is on, and keeps the choice in the draft', async () => {
    const env = await prepare();
    const view = await show(ReviewStep, env);
    await publishSwitch(view).trigger('click');
    await flushPromises();
    expect(publishSwitch(view).attributes('aria-checked')).toBe('true');
    expect(view.text()).toContain(WARNING);
    expect(env.creator.draft?.publish).toBe(true);
    // The warning sits in a live region that is always there, so it is read when it appears.
    expect(view.get('[role="status"]').text()).toContain(WARNING);

    await publishSwitch(view).trigger('click');
    await flushPromises();
    expect(view.text()).not.toContain(WARNING);
    expect(env.creator.draft?.publish).toBe(false);
  });

  it('follows the language', async () => {
    const view = await show(ReviewStep, await prepare());
    applyLocale('en');
    await flushPromises();
    const toggle = view.get('[role="switch"][aria-label="Publish for the community"]');
    await toggle.trigger('click');
    await flushPromises();
    expect(toggle.attributes('aria-checked')).toBe('true');
    expect(view.text()).toContain(
      'Anyone using Rumbo nearby will be able to see it and walk it, without knowing who made it.',
    );
    expect(view.text()).toContain(
      "Strangers will see it: don't include your home or personal details.",
    );
    applyLocale('pt');
    await flushPromises();
    expect(view.text()).toContain('Publicar para a comunidade');
    expect(view.text()).toContain('Vai ser vista por desconhecidos');
  });

  it('saves the route private when the switch is off', async () => {
    const uploads = stubUploads();
    uploads.up();
    const env = await prepare();
    const view = await show(ReviewStep, env);
    await button(view, 'Guardar ruta')?.trigger('click');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('create-done'));
    expect(await getMyRoute(env.creator.savedId ?? '')).toMatchObject({ visibility: 'private' });
    await routeSyncIdle();
    expect(uploads.writes[0]).toMatchObject({ method: 'POST', body: { visibility: 'private' } });
  });

  it('saves the route public when the switch is on, and the POST says so', async () => {
    const uploads = stubUploads();
    uploads.up();
    const env = await prepare();
    const view = await show(ReviewStep, env);
    await publishSwitch(view).trigger('click');
    await flushPromises();
    await button(view, 'Guardar ruta')?.trigger('click');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('create-done'));
    expect(await getMyRoute(env.creator.savedId ?? '')).toMatchObject({ visibility: 'public' });
    await routeSyncIdle();
    expect(uploads.writes[0]).toMatchObject({ method: 'POST', body: { visibility: 'public' } });
  });

  it('starts, when editing a route, with the choice that route has', async () => {
    const first = await prepare();
    await first.creator.update({ publish: true });
    const id = await first.creator.save();

    const env = await prepare();
    expect(await env.creator.loadForEdit(id)).toBe(true);
    const view = await show(ReviewStep, env);
    expect(publishSwitch(view).attributes('aria-checked')).toBe('true');
    expect(view.text()).toContain(WARNING);
  });
});

describe('C5 · Lista, for a route published for the community', () => {
  /** The route saved, and the last screen showing it. */
  async function saved(publish: boolean) {
    const env = await prepare();
    await env.creator.update({ publish });
    await env.creator.save();
    return { ...env, view: await show(DoneStep, env) };
  }

  it('says nothing about it for a private route', async () => {
    const { view } = await saved(false);
    expect(view.text()).toContain('Guardada en este dispositivo.');
    expect(view.text()).not.toContain('comunidad');
    expect(view.text()).not.toContain('Publicada');
  });

  it('says it will be published once online while the route is still on the device, and that it is when it is up', async () => {
    const uploads = stubUploads();
    const env = await prepare();
    await env.creator.update({ publish: true });
    const id = await env.creator.save();
    const view = await show(DoneStep, env);
    expect(env.catalog.byId(id)?.mine).toMatchObject({ published: true, sync: 'pending' });
    expect(view.text()).toContain('Se publicará para la comunidad cuando vuelva la conexión.');
    expect(view.text()).not.toContain('Publicada para la comunidad.');

    // The upload finishes: the line changes by itself.
    uploads.up();
    await syncMyRoutes();
    await vi.waitFor(() => expect(view.text()).toContain('Publicada para la comunidad.'));
    expect(view.text()).not.toContain('Se publicará para la comunidad');
    expect(view.text()).toContain('Guardada. Puedes recorrerla cuando quieras.');
  });

  it('follows the language', async () => {
    const { view } = await saved(true);
    applyLocale('en');
    await flushPromises();
    expect(view.text()).toContain(
      "It will be published for the community when you're back online.",
    );
    applyLocale('pt');
    await flushPromises();
    expect(view.text()).toContain(
      'Vai ser publicada para a comunidade quando voltares a ter ligação.',
    );
  });
});
