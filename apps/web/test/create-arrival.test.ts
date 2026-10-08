import 'fake-indexeddb/auto';
import { checkUserRoute } from '@rumbo/api-contract';
import { validateActionParams } from '@rumbo/event-system';
import type { ArrivalChoice } from '@rumbo/route-builder';
import { validateRouteBundle } from '@rumbo/route-spec';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import PlaceEditorSheet, { type PlaceEditorValue } from '../src/components/PlaceEditorSheet.vue';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { getMyRoute, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { type CreatorDraft, useCreatorStore } from '../src/stores/creator.ts';
import ContentStep from '../src/views/create/ContentStep.vue';
import ReviewStep from '../src/views/create/ReviewStep.vue';
import { castle, cathedral, generated, json, river } from './create-fixtures.ts';

// What each place shows on arrival, in the creator: the draft keeps the choice
// (and a card only for the places that use one), the editor offers the six
// ways to greet the user and their fields, and steps 3 and 4 say what the
// places show.

// The map SDK isn't needed (RouteMap has its own test).
vi.mock('../src/map/RouteMap.vue', async () => {
  const { h } = await import('vue');
  return { __esModule: true, default: { name: 'RouteMap', render: () => h('div') } };
});

const Empty = { render: () => null };

const QUIZ: ArrivalChoice = {
  type: 'quiz',
  question: '¿Quién conquistó el castillo?',
  options: ['Afonso Henriques', 'Dinis I', 'Joana I'],
  correctIndex: 0,
  explanation: 'Lo tomó a los musulmanes en 1135.',
};
const VIDEO: ArrivalChoice = { type: 'video', youtubeId: 'dQw4w9WgXcQ', title: 'El castillo' };
const LINK: ArrivalChoice = {
  type: 'link',
  url: 'https://www.visitleiria.pt/agenda',
  label: 'Agenda de Leiria',
};
const CHECK: ArrivalChoice = { type: 'check' };

// ---------------------------------------------------------------- the draft

let creator: ReturnType<typeof useCreatorStore> | null = null;
let asked: string[] = [];
let wrapper: VueWrapper | null = null;

/** The AI makes a card for every place it is asked about. */
function serve(respond?: (name: string, signal: AbortSignal | undefined) => Promise<Response>) {
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/content/generate')) return new Response(null, { status: 503 });
      const { name } = JSON.parse(init?.body as string) as { name: string };
      asked.push(name);
      return respond
        ? respond(name, init?.signal ?? undefined)
        : json(generated({ title: `Ficha de ${name}` }));
    }),
  );
}

async function open(): Promise<ReturnType<typeof useCreatorStore>> {
  creator?.$dispose();
  setActivePinia(createPinia());
  creator = useCreatorStore();
  await creator.ready;
  return creator;
}

/** A named draft with the castle and the cathedral (both with the default arrival). */
async function started() {
  const store = await open();
  await store.ensureDraft();
  await store.update({ name: 'Leiria numa manhã', interests: ['history'] });
  await store.addPlace({ ...castle, tempId: 'castle' });
  await store.addPlace({ ...cathedral, tempId: 'cathedral' });
  return store;
}

const arrivals = (store: ReturnType<typeof useCreatorStore>) =>
  store.draft?.places.map((place) => place.arrival?.type ?? 'card');

beforeEach(async () => {
  applyLocale('es');
  serve();
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
  creator?.$dispose();
  creator = null;
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the arrival of a place in the draft', () => {
  it('keeps the choice as given, and the card (the default) as no choice at all', async () => {
    const store = await started();
    expect(await store.updatePlace('castle', { arrival: QUIZ })).toBe(true);
    expect(store.draft?.places[0]?.arrival).toEqual(QUIZ);
    // A copy: the draft doesn't share the editor's object.
    expect(store.draft?.places[0]?.arrival).not.toBe(QUIZ);

    await store.updatePlace('castle', { arrival: { type: 'card' } });
    expect(store.draft?.places[0]).not.toHaveProperty('arrival');
    await store.updatePlace('cathedral', { arrival: CHECK });
    await store.updatePlace('cathedral', { arrival: undefined });
    expect(store.draft?.places[1]).not.toHaveProperty('arrival');
    // Other changes leave it alone.
    await store.updatePlace('castle', { arrival: VIDEO });
    await store.updatePlace('castle', { radius: 60 });
    expect(store.draft?.places[0]).toMatchObject({ arrival: VIDEO, radius: 60 });

    await store.addPlace({ ...river, tempId: 'river', arrival: { type: 'card' } });
    expect(store.draft?.places[2]).not.toHaveProperty('arrival');
    await store.addPlace({
      name: 'Museu',
      position: river.position,
      tempId: 'museum',
      arrival: LINK,
    });
    expect(store.draft?.places[3]?.arrival).toEqual(LINK);
  });

  it('counts the places that use the card apart from the ones that show something else', async () => {
    const store = await started();
    await store.addPlace({ ...river, tempId: 'river' });
    await store.updatePlace('castle', { arrival: QUIZ });
    await store.updatePlace('river', { arrival: { type: 'basic' } });
    expect(store.cardStats).toMatchObject({
      total: 1,
      pending: 1,
      arrivals: { quiz: 1, basic: 1, video: 0, link: 0, check: 0 },
    });
    expect(store.cardsToPrepare.map((place) => place.tempId)).toEqual(['cathedral']);
    await store.updatePlace('cathedral', { arrival: CHECK });
    expect(store.cardStats).toMatchObject({ total: 0, arrivals: { check: 1 } });
    // Nothing left to prepare: the draft goes straight to the review.
    expect(store.cardsToPrepare).toEqual([]);
    expect(store.resumeStep).toBe('review');
  });

  it('sends only the places that use the card to the AI', async () => {
    const store = await started();
    await store.addPlace({ ...river, tempId: 'river' });
    await store.updatePlace('castle', { arrival: QUIZ });
    await store.updatePlace('river', { arrival: VIDEO });
    await store.generateMissing();
    expect(asked).toEqual(['Sé de Leiria']);
    expect(Object.keys(store.draft?.cards ?? {})).toEqual(['cathedral']);

    // Asking for, or giving up, a card of a place that has none does nothing.
    await store.regenerateCard('castle');
    await store.setBasicCard('river');
    await store.cardsIdle();
    expect(asked).toEqual(['Sé de Leiria']);
    expect(Object.keys(store.draft?.cards ?? {})).toEqual(['cathedral']);
    expect(await store.setBasicForFailed()).toBe(0);
  });

  it('drops the card of a place that stops using it, and asks again when it comes back', async () => {
    const store = await started();
    await store.generateMissing();
    expect(store.cardStats).toMatchObject({ total: 2, ready: 2 });
    expect(store.draft?.places[0]?.contentRef).toMatch(/^card-/);

    await store.updatePlace('castle', { arrival: QUIZ });
    expect(store.draft?.cards['castle']).toBeUndefined();
    expect(store.draft?.places[0]).not.toHaveProperty('contentRef');
    expect(store.cardStats).toMatchObject({ total: 1, ready: 1, arrivals: { quiz: 1 } });
    const built = store.build();
    expect(built.ok && Object.keys(built.contents)).toHaveLength(1);

    await store.generateMissing();
    expect(asked).toEqual(['Castelo de Leiria', 'Sé de Leiria']);

    await store.updatePlace('castle', { arrival: { type: 'card' } });
    expect(store.cardsToPrepare.map((place) => place.tempId)).toEqual(['castle']);
    await store.generateMissing();
    expect(asked).toEqual(['Castelo de Leiria', 'Sé de Leiria', 'Castelo de Leiria']);
    expect(store.cardStats).toMatchObject({ total: 2, ready: 2 });
  });

  it('gives up the card on its way when the place stops using it', async () => {
    let aborted: boolean | undefined;
    serve(
      (_name, signal) =>
        new Promise<Response>((resolve) => {
          signal?.addEventListener('abort', () => {
            aborted = true;
            resolve(new Response(null, { status: 503 }));
          });
        }),
    );
    const store = await started();
    void store.generateMissing();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    await store.updatePlace('castle', { arrival: CHECK });
    expect(aborted).toBe(true);
    expect(store.draft?.cards['castle']).toBeUndefined();
    store.stopAutosave();
  });

  it('brings the choice back with the place when a removal is undone', async () => {
    const store = await started();
    await store.updatePlace('castle', { arrival: QUIZ });
    const removed = await store.removePlace('castle');
    expect(removed?.place.arrival).toEqual(QUIZ);
    expect(await store.restorePlace(removed!.place, removed!.index, removed!.card)).toBe(true);
    expect(store.draft?.places[0]?.arrival).toEqual(QUIZ);
    expect(store.cardStats).toMatchObject({ total: 1, arrivals: { quiz: 1 } });
  });
});

describe('building a route whose places show different things', () => {
  async function mixed() {
    const store = await started();
    await store.addPlace({ ...river, tempId: 'river' });
    await store.addPlace({ name: 'Museu', position: { lat: 39.7488, lng: -8.8012 }, tempId: 'm' });
    await store.generateMissing();
    await store.updatePlace('cathedral', { arrival: QUIZ });
    await store.updatePlace('river', { arrival: VIDEO });
    await store.updatePlace('m', { arrival: LINK });
    return store;
  }

  it('makes each place its own action, and ships a card only for the places that use one', async () => {
    const store = await mixed();
    const built = store.build();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const onEnter = built.spec.points.map((point) => built.spec.actions[point.triggers!.onEnter!]);
    expect(onEnter.map((action) => action?.type)).toEqual([
      'ai_template',
      'quiz',
      'video',
      'redirect',
    ]);
    expect(Object.keys(built.contents)).toEqual([built.spec.points[0]?.contentRef]);
    expect(built.spec.points.slice(1).map((point) => point.contentRef)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    // What the app checks before saving, and what the API checks when it uploads.
    const bundle = { spec: built.spec, contents: built.contents };
    expect(validateRouteBundle(bundle).errors).toEqual([]);
    expect(validateActionParams(built.spec)).toEqual([]);
    expect(checkUserRoute(JSON.parse(JSON.stringify(bundle)))).toEqual([]);
  });

  it('saves it, and editing it brings every choice back without asking the AI for anything', async () => {
    const store = await mixed();
    await store.updatePlace('river', { arrival: CHECK });
    const id = await store.save();
    const saved = await getMyRoute(id);
    expect(
      saved?.bundle.spec.points.map(
        (point) => saved.bundle.spec.actions[point.triggers?.onEnter ?? '']?.type,
      ),
    ).toEqual(['ai_template', 'quiz', 'toast', 'redirect']);
    const calls = asked.length;

    const again = await open();
    expect(await again.loadForEdit(id)).toBe(true);
    expect(arrivals(again)).toEqual(['card', 'quiz', 'check', 'link']);
    expect(again.draft?.places[1]?.arrival).toEqual(QUIZ);
    expect(again.draft?.places[3]?.arrival).toEqual(LINK);
    // Only the place that used the card has one; the others have nothing to prepare.
    expect(Object.keys(again.draft?.cards ?? {})).toHaveLength(1);
    expect(again.cardStats).toMatchObject({
      total: 1,
      ready: 1,
      arrivals: { quiz: 1, check: 1, link: 1 },
    });
    expect(again.resumeStep).toBe('review');
    expect(await again.save()).toBe(id);
    expect((await getMyRoute(id))?.bundle.spec).toEqual(saved?.bundle.spec);
    expect(asked).toHaveLength(calls);
  });

  it('does not build while an arrival is incomplete, and says which place', async () => {
    const store = await started();
    await store.updatePlace('cathedral', {
      arrival: { type: 'quiz', question: '', options: ['', 'x'], correctIndex: 0 },
    });
    const built = store.build();
    expect(built.ok).toBe(false);
    expect(!built.ok && built.issues.map((issue) => `${issue.code}@${issue.field}`)).toEqual([
      'arrival_question_required@places.1',
      'arrival_option_required@places.1',
    ]);
    // It blocks the places step (and the review), never the cards.
    expect(store.stepIssues('places')).toHaveLength(2);
    expect(store.stepIssues('content')).toEqual([]);
    await expect(store.save()).rejects.toThrow();
  });
});

describe('the draft stored on the device', () => {
  it('keeps the choices across a reload, and no card for the places that have none', async () => {
    let store = await started();
    await store.generateMissing();
    await store.updatePlace('castle', { arrival: QUIZ });
    await store.updatePlace('cathedral', { arrival: { type: 'basic' } });
    await store.flush();
    const stored = (await db.get<CreatorDraft>(KEYS.creatorDraft))!;
    expect(stored.places.map((place) => place.arrival)).toEqual([QUIZ, { type: 'basic' }]);
    expect(stored.cards).toEqual({});

    store = await open();
    expect(arrivals(store)).toEqual(['quiz', 'basic']);
    expect(store.draft?.places[0]?.arrival).toEqual(QUIZ);
    expect(await db.get(KEYS.creatorDraftBackup)).toBeUndefined();
  });

  it('reads the card as no choice, and drops a card stored for a place that shows something else', async () => {
    const store = await started();
    await store.generateMissing();
    await store.flush();
    const raw = (await db.get<CreatorDraft>(KEYS.creatorDraft))!;
    await db.set(KEYS.creatorDraft, {
      ...raw,
      places: [
        { ...raw.places[0], arrival: { type: 'card' } },
        { ...raw.places[1], arrival: CHECK },
      ],
    });
    const reopened = await open();
    expect(reopened.draft?.places[0]).not.toHaveProperty('arrival');
    expect(reopened.draft?.places[1]?.arrival).toEqual(CHECK);
    expect(reopened.cardOf('castle').status).toBe('ready');
    expect(reopened.draft?.cards['cathedral']).toBeUndefined();
    expect(await db.get(KEYS.creatorDraftBackup)).toBeUndefined();
  });

  it('keeps the place and its card when the stored choice cannot be read, and keeps the original aside', async () => {
    const store = await started();
    await store.generateMissing();
    await store.flush();
    const raw = (await db.get<CreatorDraft>(KEYS.creatorDraft))!;
    const broken = {
      ...raw,
      places: [
        { ...raw.places[0], arrival: { type: 'quiz', question: 7 } },
        { ...raw.places[1], arrival: { type: 'teleport' } },
      ],
    };
    await db.set(KEYS.creatorDraft, broken);
    const reopened = await open();
    expect(reopened.draft?.places.map((place) => place.name)).toEqual([
      'Castelo de Leiria',
      'Sé de Leiria',
    ]);
    expect(arrivals(reopened)).toEqual(['card', 'card']);
    expect(reopened.cardStats).toMatchObject({ total: 2, ready: 2 });
    expect(await db.get(KEYS.creatorDraftBackup)).toEqual(broken);
  });
});

// ---------------------------------------------------------------- the editor

describe('PlaceEditorSheet · Al llegar', () => {
  function mountEditor(arrival: ArrivalChoice = { type: 'card' }) {
    const value: PlaceEditorValue = {
      name: 'Castelo de Leiria',
      category: 'monument',
      radius: 40,
      required: true,
      arrival,
    };
    const view = mount(PlaceEditorSheet, {
      props: {
        modelValue: value,
        'onUpdate:modelValue': (next: PlaceEditorValue) => view.setProps({ modelValue: next }),
        mode: 'edit' as const,
        categoryEditable: false,
        categories: ['other' as const],
        overlap: false,
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    wrapper = view as unknown as VueWrapper;
    return view;
  }
  type Editor = ReturnType<typeof mountEditor>;

  const current = (view: Editor) => (view.props('modelValue') as PlaceEditorValue).arrival;
  const field = (view: Editor, label: string) => {
    const labelNode = view.findAll('label').find((node) => node.text() === label);
    if (!labelNode) throw new Error(`No field "${label}"`);
    return view.get(`[id="${labelNode.attributes('for')}"]`);
  };
  const choose = (view: Editor, title: string) =>
    view
      .findAll('.choice')
      .find((choice) => choice.find('.choice__title').text() === title)!
      .get('input')
      .setValue(true);
  const press = (view: Editor, label: string) =>
    view
      .findAll('button')
      .find((button) => button.text() === label)!
      .trigger('click');
  const submit = async (view: Editor) => {
    await view.get('form').trigger('submit');
    await flushPromises();
  };

  it('lists the six ways to greet the user, each with its help, and checks the current one', () => {
    const view = mountEditor({ type: 'video', youtubeId: 'dQw4w9WgXcQ' });
    expect(view.get('legend').text()).toBe('Al llegar');
    const choices = view.findAll('.choice');
    expect(choices.map((choice) => choice.get('.choice__title').text())).toEqual([
      'Ficha del lugar',
      'Nombre y dirección',
      'Tu propia pregunta',
      'Un video de YouTube',
      'Un enlace web',
      'Solo un aviso',
    ]);
    expect(choices[0]?.get('.choice__help').text()).toBe(
      'La ficha con IA si está lista; si no, el nombre y la dirección.',
    );
    const radios = view.findAll<HTMLInputElement>('.choice input');
    expect(radios.map((radio) => radio.element.checked)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
    // Each radio is named and described by its row.
    expect(radios[2]?.attributes('aria-labelledby')).toMatch(/-quiz-title$/);
    expect(view.get(`[id="${radios[2]?.attributes('aria-describedby')}"]`).text()).toContain(
      'Una pregunta con respuestas y puntos',
    );
  });

  it('shows no fields for the card, the plain sheet or a notice, and saves them as they are', async () => {
    const view = mountEditor();
    expect(view.find('.arrival__fields').exists()).toBe(false);
    for (const title of ['Nombre y dirección', 'Solo un aviso', 'Ficha del lugar']) {
      await choose(view, title);
      expect(view.find('.arrival__fields').exists()).toBe(false);
    }
    expect(current(view)).toEqual({ type: 'card' });
    await choose(view, 'Solo un aviso');
    expect(current(view)).toEqual({ type: 'check' });
    await submit(view);
    expect(view.emitted('save')).toHaveLength(1);
  });

  it('writes a question with 2 to 4 answers, one of them right', async () => {
    const view = mountEditor();
    await choose(view, 'Tu propia pregunta');
    expect(current(view)).toEqual({
      type: 'quiz',
      question: '',
      options: ['', ''],
      correctIndex: 0,
    });
    expect(view.text()).toContain('Una respuesta correcta suma 10 puntos.');

    await field(view, 'Pregunta').setValue('¿Quién lo conquistó?');
    await field(view, 'Respuesta 1').setValue('Afonso');
    await field(view, 'Respuesta 2').setValue('Dinis');
    await press(view, 'Añadir respuesta');
    await field(view, 'Respuesta 3').setValue('Joana');
    await press(view, 'Añadir respuesta');
    expect(view.findAll('.option')).toHaveLength(4);
    // Four is the most: the button goes.
    expect(view.findAll('button').some((button) => button.text() === 'Añadir respuesta')).toBe(
      false,
    );

    await view.get('input[aria-label="Marcar la respuesta 3 como correcta"]').setValue(true);
    await field(view, 'Explicación (opcional)').setValue('Lo tomó en 1135.');
    expect(current(view)).toEqual({
      type: 'quiz',
      question: '¿Quién lo conquistó?',
      options: ['Afonso', 'Dinis', 'Joana', ''],
      correctIndex: 2,
      explanation: 'Lo tomó en 1135.',
    });

    // Removing an answer before the right one keeps the right one right.
    await view.get('button[aria-label="Quitar la respuesta 4"]').trigger('click');
    await view.get('button[aria-label="Quitar la respuesta 1"]').trigger('click');
    expect(current(view)).toMatchObject({ options: ['Dinis', 'Joana'], correctIndex: 1 });
    // Two is the least: nothing left to remove.
    expect(view.findAll('button[aria-label^="Quitar la respuesta"]')).toHaveLength(0);
    // An emptied explanation is no explanation.
    await field(view, 'Explicación (opcional)').setValue('');
    expect(current(view)).not.toHaveProperty('explanation');
    // Removing the right answer itself makes the first one right.
    await press(view, 'Añadir respuesta');
    await view.get('button[aria-label="Quitar la respuesta 2"]').trigger('click');
    expect(current(view)).toMatchObject({ options: ['Dinis', ''], correctIndex: 0 });
  });

  it('does not save a question that is not finished, and says what is missing', async () => {
    const view = mountEditor();
    await choose(view, 'Tu propia pregunta');
    await field(view, 'Respuesta 1').setValue('Afonso');
    expect(view.text()).not.toContain('Escribe la pregunta.');

    await submit(view);
    expect(view.emitted('save')).toBeUndefined();
    expect(view.text()).toContain('Escribe la pregunta.');
    expect(view.text()).toContain('Escribe la respuesta o quita esta opción.');
    expect(document.activeElement).toBe(field(view, 'Pregunta').element);

    await field(view, 'Pregunta').setValue('¿Quién?');
    await submit(view);
    expect(view.emitted('save')).toBeUndefined();
    expect(document.activeElement).toBe(field(view, 'Respuesta 2').element);
    await field(view, 'Respuesta 2').setValue('Dinis');
    expect(view.text()).not.toContain('Escribe');
    await submit(view);
    expect(view.emitted('save')).toHaveLength(1);
  });

  it('does not save a place without a name, whatever it shows', async () => {
    const view = mountEditor({ type: 'check' });
    await field(view, 'Nombre del lugar').setValue('  ');
    await submit(view);
    expect(view.emitted('save')).toBeUndefined();
    expect(view.text()).toContain('Ponle un nombre al lugar.');
  });

  it('takes a YouTube link or id and keeps only the id', async () => {
    const view = mountEditor();
    await choose(view, 'Un video de YouTube');
    expect(current(view)).toEqual({ type: 'video', youtubeId: '' });
    const link = field(view, 'Enlace o ID de YouTube');
    expect(view.text()).toContain('Pega el enlace del video o su ID de 11 caracteres.');

    await link.setValue('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s');
    expect(current(view)).toEqual({ type: 'video', youtubeId: 'dQw4w9WgXcQ' });
    expect(view.text()).toContain('Video encontrado: dQw4w9WgXcQ');
    await link.setValue('https://youtu.be/a_b-c123456?si=x');
    expect(current(view)).toMatchObject({ youtubeId: 'a_b-c123456' });
    await field(view, 'Título (opcional)').setValue('El castillo');
    expect(current(view)).toEqual({
      type: 'video',
      youtubeId: 'a_b-c123456',
      title: 'El castillo',
    });
    await field(view, 'Título (opcional)').setValue('');
    expect(current(view)).not.toHaveProperty('title');

    // Not a video: no complaint while it is typed, one when the field is left.
    await link.setValue('https://example.org/video');
    expect(current(view)).toEqual({ type: 'video', youtubeId: '' });
    expect(view.text()).not.toContain('No reconocemos ese enlace');
    await link.trigger('blur');
    expect(view.text()).toContain('No reconocemos ese enlace de YouTube.');
    await submit(view);
    expect(view.emitted('save')).toBeUndefined();
    expect(document.activeElement).toBe(link.element);

    await link.setValue('dQw4w9WgXcQ');
    expect(view.text()).not.toContain('No reconocemos');
    await submit(view);
    expect(view.emitted('save')).toHaveLength(1);
  });

  it('asks for a full https address and a text for the link', async () => {
    const view = mountEditor();
    await choose(view, 'Un enlace web');
    expect(current(view)).toEqual({ type: 'link', url: '', label: '' });
    const url = field(view, 'Dirección web');
    await url.setValue('http://www.visitleiria.pt');
    await url.trigger('blur');
    expect(view.text()).toContain('Escribe una dirección completa que empiece por https://');
    await submit(view);
    expect(view.emitted('save')).toBeUndefined();
    expect(view.text()).toContain('Dile a quien llegue adónde lleva el enlace.');

    await url.setValue('https://www.visitleiria.pt/agenda');
    expect(view.text()).not.toContain('Escribe una dirección completa');
    await field(view, 'Texto del enlace').setValue('Agenda de Leiria');
    expect(current(view)).toEqual(LINK);
    await submit(view);
    expect(view.emitted('save')).toHaveLength(1);
  });

  it('finds again what was typed when the user goes back to a choice', async () => {
    const view = mountEditor();
    await choose(view, 'Tu propia pregunta');
    await field(view, 'Pregunta').setValue('¿Quién?');
    await choose(view, 'Un video de YouTube');
    await field(view, 'Enlace o ID de YouTube').setValue('dQw4w9WgXcQ');
    await choose(view, 'Solo un aviso');
    await choose(view, 'Tu propia pregunta');
    expect(current(view)).toMatchObject({ type: 'quiz', question: '¿Quién?' });
    await choose(view, 'Un video de YouTube');
    expect(current(view)).toEqual({ type: 'video', youtubeId: 'dQw4w9WgXcQ' });
    expect((field(view, 'Enlace o ID de YouTube').element as HTMLInputElement).value).toBe(
      'dQw4w9WgXcQ',
    );
  });

  it('opens a place that already has a question with it filled in', () => {
    const view = mountEditor(QUIZ);
    expect(
      view.findAll('.choice input').map((radio) => (radio.element as HTMLInputElement).checked),
    ).toEqual([false, false, true, false, false, false]);
    expect((field(view, 'Pregunta').element as HTMLInputElement).value).toBe(
      QUIZ.type === 'quiz' ? QUIZ.question : '',
    );
    expect(view.findAll('.option')).toHaveLength(3);
    expect(
      view
        .findAll<HTMLInputElement>('.option__correct input')
        .map((radio) => radio.element.checked),
    ).toEqual([true, false, false]);
  });
});

// ---------------------------------------------------------------- the steps

async function mountStep(component: typeof ContentStep | typeof ReviewStep) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/create/places', name: 'create-places', component: Empty },
      { path: '/create/content', name: 'create-content', component: Empty },
      { path: '/create/review', name: 'create-review', component: Empty },
      { path: '/create/done', name: 'create-done', component: Empty },
      { path: '/run', name: 'run', component: Empty },
    ],
  });
  await router.push('/create/content');
  creator?.$dispose();
  creator = useCreatorStore();
  await creator.ensureDraft();
  await creator.update({ name: 'Leiria numa manhã' });
  await creator.addPlace({ ...castle, tempId: 'castle' });
  await creator.addPlace({ ...cathedral, tempId: 'cathedral', arrival: QUIZ });
  await creator.addPlace({ ...river, tempId: 'river', arrival: LINK });
  await creator.addPlace({
    name: 'Museu de Leiria',
    position: { lat: 39.7488, lng: -8.8012 },
    tempId: 'museum',
    arrival: CHECK,
  });
  wrapper = mount(component, {
    global: { plugins: [pinia, router, i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return { view: wrapper, store: creator };
}

describe('C3 · Fichas with places that show something else', () => {
  it('lists them with what they show instead of a card state, and asks the AI only for the others', async () => {
    const { view, store } = await mountStep(ContentStep);
    await vi.waitFor(() => expect(view.text()).toContain('1 de 1 fichas listas'));
    expect(asked).toEqual(['Castelo de Leiria']);

    const rows = view.findAll('.row');
    expect(rows.map((row) => row.get('.row__name').text())).toEqual([
      'Castelo de Leiria',
      'Sé de Leiria',
      'Rio Lis',
      'Museu de Leiria',
    ]);
    expect(rows.map((row) => row.get('.row__status').text())).toEqual([
      'Ficha lista · 2 fuentes',
      'Tu pregunta: «¿Quién conquistó el castillo?»',
      'Enlace: Agenda de Leiria · www.visitleiria.pt',
      'Solo un aviso al llegar',
    ]);
    // Only a card can be seen, regenerated or swapped for the basic one.
    expect(rows[0]?.findAll('button').length).toBeGreaterThan(0);
    for (const row of rows.slice(1)) expect(row.findAll('button')).toHaveLength(0);
    expect(view.text()).toContain(
      'Los lugares con otra opción en «Al llegar» no llevan ficha con IA.',
    );
    // The progress counts the places that use a card.
    expect(view.get('[role="progressbar"]').attributes('aria-label')).toBe('1 de 1 fichas listas');
    expect(store.cardStats.total).toBe(1);
  });

  it('names a video by its title, and a place with the plain sheet by what it shows', async () => {
    const { view, store } = await mountStep(ContentStep);
    await store.updatePlace('river', { arrival: VIDEO });
    await store.updatePlace('museum', { arrival: { type: 'video', youtubeId: 'dQw4w9WgXcQ' } });
    await store.updatePlace('castle', { arrival: { type: 'basic' } });
    await flushPromises();
    expect(view.findAll('.row__status').map((status) => status.text())).toEqual([
      'Nombre y dirección, sin IA',
      'Tu pregunta: «¿Quién conquistó el castillo?»',
      'Video de YouTube: «El castillo»',
      'Video de YouTube',
    ]);
  });

  it('has nothing to prepare when no place uses a card', async () => {
    const { view, store } = await mountStep(ContentStep);
    await store.updatePlace('castle', { arrival: VIDEO });
    await flushPromises();
    expect(view.text()).toContain(
      'Ningún lugar usa ficha con IA, así que no hay nada que preparar.',
    );
    expect(view.find('[role="progressbar"]').exists()).toBe(false);
    expect(view.find('.content__status').exists()).toBe(false);
    expect(view.text()).not.toContain('fichas listas');
    // The step never blocks.
    expect(view.findAll('button').some((button) => button.text() === 'Siguiente')).toBe(true);
  });
});

describe('C4 · Revisar with places that show something else', () => {
  const lines = (view: VueWrapper) => view.findAll('.check__text').map((line) => line.text());

  it('counts the cards and says what the other places show', async () => {
    const { view } = await mountStep(ReviewStep);
    await vi.waitFor(() => expect(asked).toEqual([]));
    // The card of the first place is still on its way (step 3 asks for it).
    await creator?.generateMissing();
    await flushPromises();
    expect(lines(view)).toContain('1 ficha con IA');
    expect(lines(view)).toContain('Al llegar: 1 pregunta propia · 1 enlace · 1 aviso');
    // The only address missing would be on a basic sheet; the others don't show it.
    expect(lines(view).some((line) => line.includes('sin dirección'))).toBe(false);
    expect(lines(view).some((line) => line.startsWith('Sin fichas con IA'))).toBe(false);
    expect(
      view
        .findAll('button')
        .find((button) => button.text() === 'Guardar ruta')
        ?.attributes('disabled'),
    ).toBeUndefined();
  });

  it('keeps its own line for the plain sheet, and drops the card line when no place has a card', async () => {
    const { view, store } = await mountStep(ReviewStep);
    await store.updatePlace('castle', { arrival: { type: 'basic' } });
    await flushPromises();
    expect(lines(view)).toContain(
      'Al llegar: 1 con nombre y dirección · 1 pregunta propia · 1 enlace · 1 aviso',
    );
    expect(lines(view).some((line) => /ficha/.test(line) && /IA/.test(line))).toBe(false);
    // The basic sheet shows the address: this place has one, and the others (a question, a
    // link, a notice) never show theirs, so their missing addresses are not counted.
    expect(lines(view)).toContain('Cada lugar muestra su ficha con nombre y dirección');
    await store.updatePlace('castle', { address: '' });
    await flushPromises();
    expect(lines(view)).toContain('1 lugar sin dirección: su ficha mostrará solo el nombre');
    expect(lines(view)).not.toContain('Cada lugar muestra su ficha con nombre y dirección');
  });

  it('refuses to save a route whose question is not finished', async () => {
    const { view, store } = await mountStep(ReviewStep);
    await store.updatePlace('cathedral', {
      arrival: { type: 'quiz', question: '', options: ['a', 'b'], correctIndex: 0 },
    });
    await flushPromises();
    expect(lines(view)).toContain('La ruta tiene errores: revisa los pasos anteriores.');
    expect(
      view
        .findAll('button')
        .find((button) => button.text() === 'Guardar ruta')
        ?.attributes('disabled'),
    ).toBeDefined();
  });
});
