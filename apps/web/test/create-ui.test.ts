import 'fake-indexeddb/auto';
import type { Interest } from '@rumbo/api-contract';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import InterestChips from '../src/components/InterestChips.vue';
import SuggestSheet from '../src/components/SuggestSheet.vue';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCreatorStore } from '../src/stores/creator.ts';
import { useUiStore } from '../src/stores/ui.ts';
import ContentStep from '../src/views/create/ContentStep.vue';
import DetailsStep from '../src/views/create/DetailsStep.vue';
import { apiError, castle, cathedral, generated, json, suggestion } from './create-fixtures.ts';

// The screens of the AI guide in the creator (design §4): the interests, the
// cards step that never shows a card, and the suggestions sheet.

// The map SDK isn't needed (RouteMap has its own test).
vi.mock('../src/map/RouteMap.vue', async () => {
  const { h } = await import('vue');
  return { __esModule: true, default: { name: 'RouteMap', render: () => h('div') } };
});

const Empty = { render: () => null };

let wrapper: VueWrapper | null = null;

function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

/** The AI endpoints answer with `respond`; the route upload is unavailable. */
function serve(
  respond: (url: string, body: Record<string, unknown>) => Response | Promise<Response>,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!/\/(content\/generate|suggest\/places)$/.test(url)) {
        return new Response(null, { status: 503 });
      }
      return respond(url, JSON.parse(init?.body as string) as Record<string, unknown>);
    }),
  );
}

const cardOf = (body: Record<string, unknown>) =>
  json(generated({ title: `Ficha de ${String(body['name'])}` }));

async function mountStep(component: typeof ContentStep | typeof DetailsStep) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/create/places', name: 'create-places', component: Empty },
      { path: '/create/content', name: 'create-content', component: Empty },
      { path: '/create/review', name: 'create-review', component: Empty },
    ],
  });
  await router.push('/create/content');
  const creator = useCreatorStore();
  await creator.ensureDraft();
  await creator.update({ name: 'Leiria numa manhã' });
  await creator.addPlace({ ...castle, tempId: 'castle' });
  await creator.addPlace({ ...cathedral, tempId: 'cathedral' });
  wrapper = mount(component, {
    global: { plugins: [pinia, router, i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return { view: wrapper, creator, router, ui: useUiStore() };
}

/** The browser's geolocation (happy-dom has none): `locate` answers every request. */
function stubGeolocation(locate: (ok: PositionCallback, fail: PositionErrorCallback) => void) {
  const getCurrentPosition = vi.fn(locate);
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

const buttons = (view: VueWrapper, label: string | RegExp) =>
  view
    .findAll('button')
    .filter((button) =>
      typeof label === 'string' ? button.text() === label : label.test(button.text()),
    );

beforeEach(async () => {
  applyLocale('es');
  serve((_url, body) => cardOf(body));
  await Promise.all([
    db.del(KEYS.creatorDraft),
    db.del(KEYS.creatorDraftBackup),
    db.del(KEYS.myRoutes),
  ]);
});

afterEach(async () => {
  Reflect.deleteProperty(navigator, 'geolocation');
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('InterestChips', () => {
  it('toggles each interest and keeps them in the same order whatever the user taps first', async () => {
    const view = mount(InterestChips, {
      props: {
        modelValue: [],
        label: 'Intereses',
        'onUpdate:modelValue': (v: Interest[]) => view.setProps({ modelValue: v }),
      },
      global: { plugins: [i18n] },
    });
    wrapper = view as unknown as VueWrapper;
    const chips = view.findAll('button');
    expect(chips.map((chip) => chip.text())).toEqual([
      'Historia',
      'Arte',
      'Arquitectura',
      'Gastronomía',
      'Naturaleza',
      'Religión',
      'Curiosidades',
    ]);
    expect(chips.every((chip) => chip.attributes('aria-pressed') === 'false')).toBe(true);

    await chips[4]?.trigger('click');
    await chips[0]?.trigger('click');
    expect(view.props('modelValue')).toEqual(['history', 'nature']);
    expect(view.findAll('button')[0]?.attributes('aria-pressed')).toBe('true');
    await view.findAll('button')[4]?.trigger('click');
    expect(view.props('modelValue')).toEqual(['history']);
    expect(view.get('[role="group"]').attributes('aria-label')).toBe('Intereses');
  });
});

describe('C1 interests and language', () => {
  it('stores the interests and says which language the cards will be in', async () => {
    const { view, creator } = await mountStep(DetailsStep);
    expect(view.text()).toContain('Las fichas se generarán en español.');
    await buttons(view, 'Gastronomía')[0]?.trigger('click');
    await buttons(view, 'Historia')[0]?.trigger('click');
    expect(creator.draft?.interests).toEqual(['history', 'food']);

    // The route's language is the one the draft started with, not the app's now.
    applyLocale('en');
    await flushPromises();
    expect(view.text()).toContain('Cards will be written in Spanish.');
  });

  it('takes the area from the device on request, once', async () => {
    const getCurrentPosition = stubGeolocation((ok) =>
      ok({ coords: { latitude: 39.74362, longitude: -8.80711 } } as GeolocationPosition),
    );
    const { view, creator } = await mountStep(DetailsStep);
    expect(creator.draft?.area).toBeNull();
    await buttons(view, 'Usar mi ubicación')[0]?.trigger('click');
    await flushPromises();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(creator.draft?.area).toEqual({
      name: 'Tu ubicación',
      position: { lat: 39.744, lng: -8.807 },
    });
    expect(buttons(view, 'Usar mi ubicación')).toHaveLength(0);
  });

  it('explains a refused permission and offers the search instead', async () => {
    stubGeolocation((_ok, fail) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    const { view, creator } = await mountStep(DetailsStep);
    await buttons(view, 'Usar mi ubicación')[0]?.trigger('click');
    await flushPromises();
    expect(view.text()).toContain('No podemos ver tu ubicación');
    expect(creator.draft?.area).toBeNull();
    expect(buttons(view, 'Usar mi ubicación')).toHaveLength(1);
  });
});

describe('C3 · Fichas', () => {
  it('shows each card as ready with its sources, and never the card', async () => {
    const { view } = await mountStep(ContentStep);
    await vi.waitFor(() => expect(view.text()).toContain('2 de 2 fichas listas'));
    const rows = view.findAll('.row');
    expect(rows.map((row) => row.get('.row__name').text())).toEqual([
      'Castelo de Leiria',
      'Sé de Leiria',
    ]);
    expect(rows.map((row) => row.get('.row__status').text())).toEqual([
      'Ficha lista · 2 fuentes',
      'Ficha lista · 2 fuentes',
    ]);
    // Nothing of what the cards say: no title, summary, fact, tip, quiz or source name.
    const shown = view.text();
    for (const secret of [
      'Ficha de',
      'Fundado en el siglo XII',
      'residencia de reyes',
      'atardecer',
      'conquistó',
      'Alfonso Henriques',
      'Visite Leiria',
    ]) {
      expect(shown).not.toContain(secret);
    }
  });

  it('shows the progress while the cards are made, and who is waiting', async () => {
    const releases: Array<() => void> = [];
    serve(
      (_url, body) =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(cardOf(body)));
        }),
    );
    const { view } = await mountStep(ContentStep);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(view.text()).toContain('Preparando fichas 0 de 2');
    expect(view.findAll('.row__status').map((status) => status.text())).toEqual([
      'Preparando la ficha…',
      'Preparando la ficha…',
    ]);
    expect(view.get('[role="progressbar"]').attributes('aria-label')).toBe(
      'Preparando fichas 0 de 2',
    );
    // "Siguiente" is never blocked, and says what happens to the unfinished ones.
    expect(view.text()).toContain('Los lugares sin ficha lista usarán la ficha básica.');
    releases.forEach((release) => release());
    await vi.waitFor(() => expect(view.text()).toContain('2 de 2 fichas listas'));
    expect(view.text()).not.toContain('Los lugares sin ficha lista');
  });

  it('asks before showing a card, and then shows it like the arrival does', async () => {
    const { view, creator, ui } = await mountStep(ContentStep);
    await vi.waitFor(() => expect(view.text()).toContain('2 de 2 fichas listas'));
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValueOnce(false);
    const present = vi.spyOn(ui, 'present').mockResolvedValue(undefined);

    await buttons(view, 'Ver ficha')[0]?.trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: { key: 'create.content.spoilerTitle' },
        body: { key: 'create.content.spoilerBody' },
      }),
    );
    expect(present).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    await buttons(view, 'Ver ficha')[1]?.trigger('click');
    await flushPromises();
    const ref = creator.draft?.places[1]?.contentRef;
    expect(present).toHaveBeenCalledWith(
      'ai_template',
      {
        name: 'Sé de Leiria',
        content: {
          es: expect.objectContaining({ id: ref, locale: 'es', title: 'Ficha de Sé de Leiria' }),
        },
        preview: true,
      },
      { sourceLocale: 'es' },
    );
  });

  it('offers the basic card or a retry when a card fails, and goes on', async () => {
    serve((_url, body) =>
      body['name'] === 'Sé de Leiria' ? apiError('generation_failed', 502) : cardOf(body),
    );
    const { view, creator } = await mountStep(ContentStep);
    await vi.waitFor(() => expect(view.text()).toContain('No pudimos preparar esta ficha.'));
    expect(view.text()).toContain('1 de 2 fichas listas');
    expect(view.find('.content__blocked').exists()).toBe(false);

    serve((_url, body) => cardOf(body));
    await buttons(view, 'Reintentar')[0]?.trigger('click');
    await vi.waitFor(() => expect(view.text()).toContain('2 de 2 fichas listas'));
    expect(creator.cardStats.ready).toBe(2);

    // The menu of a ready card: back to the basic sheet.
    await creator.setBasicCard('cathedral');
    await flushPromises();
    expect(view.findAll('.row__status')[1]?.text()).toBe('Ficha básica: nombre y dirección');
    expect(buttons(view, 'Generar con IA')).toHaveLength(1);
  });

  it('with the budget spent it says so once and offers the basic cards for all', async () => {
    serve(() => apiError('ai_budget_exceeded', 429));
    const { view, creator } = await mountStep(ContentStep);
    await vi.waitFor(() => expect(view.find('.content__blocked').exists()).toBe(true));
    expect(view.get('.content__blocked').text()).toContain(
      'Hoy hemos llegado al límite de uso de la IA',
    );
    // Retrying would only meet the same wall: only the basic card is offered.
    expect(buttons(view, 'Reintentar')).toHaveLength(0);
    await buttons(view, 'Usar fichas básicas')[0]?.trigger('click');
    await flushPromises();
    expect(creator.cardStats).toMatchObject({ basic: 2, error: 0 });
    expect(view.find('.content__blocked').exists()).toBe(false);
  });

  it('waits for the connection and starts when it is back', async () => {
    setOnline(false);
    const { view, creator } = await mountStep(ContentStep);
    await flushPromises();
    expect(view.findAll('.row__status').map((status) => status.text())).toEqual([
      'Se preparará cuando tengas conexión.',
      'Se preparará cuando tengas conexión.',
    ]);
    expect(creator.cardStats.ready).toBe(0);
    setOnline(true);
    await vi.waitFor(() => expect(view.text()).toContain('2 de 2 fichas listas'));
  });

  it('goes on to the review whenever the user wants', async () => {
    const { view, router } = await mountStep(ContentStep);
    await buttons(view, 'Siguiente')[0]?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('create-review');
  });
});

describe('the suggestions sheet', () => {
  function mountSheet(props: Partial<InstanceType<typeof SuggestSheet>['$props']> = {}) {
    const view = mount(SuggestSheet, {
      props: {
        near: { lat: 39.7436, lng: -8.8071 },
        locale: 'es',
        activity: 'walk',
        interests: ['history'],
        exclude: ['Q1'],
        room: 10,
        ...props,
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    wrapper = view as unknown as VueWrapper;
    return view;
  }

  const suggestBodies: Array<Record<string, unknown>> = [];
  function serveSuggestions(response: () => Response | Promise<Response>) {
    suggestBodies.length = 0;
    serve((_url, body) => {
      suggestBodies.push(body);
      return response();
    });
  }

  it('asks with the time and the interests chosen, then lists the places with their teasers', async () => {
    serveSuggestions(() => json(suggestion));
    const view = mountSheet();
    expect(view.get('h2').text()).toBe('Sugerir lugares');
    // 2 h and the route's interest are already chosen.
    expect(view.get('[role="radio"][aria-checked="true"]').text()).toBe('2 h');
    await view.findAll('[role="radio"]')[3]?.trigger('click');
    await buttons(view, 'Gastronomía')[0]?.trigger('click');
    await buttons(view, 'Sugerir')[0]?.trigger('click');
    await vi.waitFor(() => expect(view.find('.suggest__list').exists()).toBe(true));

    expect(suggestBodies[0]).toEqual({
      near: { lat: 39.744, lng: -8.807 },
      locale: 'es',
      interests: ['history', 'food'],
      minutes: 180,
      activity: 'walk',
      exclude: ['Q1'],
    });
    expect(view.emitted('interests')).toEqual([[['history', 'food']]]);
    const items = view.findAll('.suggest__list li');
    expect(items.map((item) => item.get('.pick__name').text())).toEqual([
      'Castelo de Leiria',
      'Sé de Leiria',
      'Museu de Leiria',
    ]);
    expect(items[0]?.text()).toContain('Las mejores vistas de la ciudad.');
    expect(items[0]?.text()).toContain('a 320 m');
    expect(items[2]?.find('.pick__distance').exists()).toBe(false);
    expect(view.text()).toContain('Leiria en una mañana');
  });

  it('adds the places that stay checked, in the suggested order', async () => {
    serveSuggestions(() => json(suggestion));
    const view = mountSheet();
    await buttons(view, 'Sugerir')[0]?.trigger('click');
    await vi.waitFor(() => expect(view.find('.suggest__list').exists()).toBe(true));
    const boxes = view.findAll('input[type="checkbox"]');
    expect(boxes.every((box) => (box.element as HTMLInputElement).checked)).toBe(true);
    expect(buttons(view, 'Añadir 3 lugares')).toHaveLength(1);

    await boxes[1]?.setValue(false);
    expect(buttons(view, 'Añadir 2 lugares')).toHaveLength(1);
    await buttons(view, 'Añadir 2 lugares')[0]?.trigger('click');
    const added = view.emitted('add')?.[0]?.[0] as Array<{ externalId: string }>;
    expect(added.map((place) => place.externalId)).toEqual(['Q1023767', 'Q10331797']);

    await boxes[0]?.setValue(false);
    await boxes[2]?.setValue(false);
    expect(
      view
        .findAll('button')
        .find((b) => b.text().startsWith('Añadir'))
        ?.attributes('disabled'),
    ).toBeDefined();
  });

  it('offers the suggested title once, and lets the screen rename the route', async () => {
    serveSuggestions(() => json(suggestion));
    const view = mountSheet();
    await buttons(view, 'Sugerir')[0]?.trigger('click');
    await vi.waitFor(() => expect(view.find('.suggest__list').exists()).toBe(true));
    await buttons(view, 'Usar el título sugerido')[0]?.trigger('click');
    expect(view.emitted('useTitle')).toEqual([
      [{ title: 'Leiria en una mañana', summary: 'Del castillo al río, pasando por la catedral.' }],
    ]);
    const applied = buttons(view, 'Título aplicado')[0];
    expect(applied?.attributes('disabled')).toBeDefined();
    await applied?.trigger('click');
    expect(view.emitted('useTitle')).toHaveLength(1);
  });

  it('only checks as many places as the route has room for', async () => {
    serveSuggestions(() => json(suggestion));
    const view = mountSheet({ room: 2 });
    await buttons(view, 'Sugerir')[0]?.trigger('click');
    await vi.waitFor(() => expect(view.find('.suggest__list').exists()).toBe(true));
    const boxes = view.findAll('input[type="checkbox"]');
    expect(boxes.map((box) => (box.element as HTMLInputElement).checked)).toEqual([
      true,
      true,
      false,
    ]);
    expect(boxes[2]?.attributes('disabled')).toBeDefined();
    expect(view.text()).toContain('La ruta solo admite 2 lugares más.');
    await boxes[0]?.setValue(false);
    expect(boxes[2]?.attributes('disabled')).toBeUndefined();
  });

  it('says why when it cannot suggest, and lets the user try again', async () => {
    serveSuggestions(() => apiError('ai_budget_exceeded', 429));
    const view = mountSheet();
    await buttons(view, 'Sugerir')[0]?.trigger('click');
    await vi.waitFor(() => expect(view.find('[role="alert"]').exists()).toBe(true));
    expect(view.get('[role="alert"]').text()).toBe(
      'Hoy hemos llegado al límite de uso de la IA. Vuelve mañana.',
    );

    serveSuggestions(() => json({ title: 'Nada', summary: 'Sin ideas.', places: [] }));
    await buttons(view, 'Reintentar')[0]?.trigger('click');
    await vi.waitFor(() =>
      expect(view.text()).toContain('No encontramos lugares que sugerir por aquí'),
    );
    expect(buttons(view, /Añadir/)[0]?.attributes('disabled')).toBeDefined();

    setOnline(false);
    await buttons(view, 'Cambiar')[0]?.trigger('click');
    await buttons(view, 'Sugerir')[0]?.trigger('click');
    await flushPromises();
    expect(view.get('[role="alert"]').text()).toBe('Sin conexión: no podemos usar la IA ahora.');
    // Offline nothing leaves the device: only the retry before it asked.
    expect(suggestBodies).toHaveLength(1);
  });

  it('cancels the request when it is closed', async () => {
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(init.signal?.reason);
            });
          }),
      ),
    );
    const view = mountSheet();
    await buttons(view, 'Sugerir')[0]?.trigger('click');
    await vi.waitFor(() => expect(view.text()).toContain('Buscando ideas…'));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    view.unmount();
    expect(aborted).toBe(true);
    wrapper = null;
  });
});
