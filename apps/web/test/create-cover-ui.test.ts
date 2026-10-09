import 'fake-indexeddb/auto';
import type { Interest } from '@rumbo/api-contract';
import type { MediaRef } from '@rumbo/route-spec';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { MediaError, scalePhoto } from '../src/services/media.ts';
import { getMyRoute, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCreatorStore } from '../src/stores/creator.ts';
import CoverCard from '../src/views/create/CoverCard.vue';
import ReviewStep from '../src/views/create/ReviewStep.vue';
import { apiError, castle, cathedral, generated, json } from './create-fixtures.ts';

// The "Portada" card of C4 · Revisar (DESIGN C4, phase 7.3, ADR 0005): the
// preview of the cover, "Subir una foto" (scaled on the device, uploaded at
// once), "Elegir de tus lugares" (the photos of the ready cards) and "Quitar
// portada", with what each failure says. happy-dom has no canvas, so the
// scaling is a fake; the upload itself goes through the real service and a
// stubbed fetch.

// The map SDK isn't needed (RouteMap has its own test).
vi.mock('../src/map/RouteMap.vue', async () => {
  const { h } = await import('vue');
  return { __esModule: true, default: { name: 'RouteMap', render: () => h('div') } };
});
vi.mock('../src/services/media.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/media.ts')>()),
  scalePhoto: vi.fn(),
}));

const Empty = { render: () => null };

const OWN = 'https://rumbo.test/api/v1/media/AAAAAAAAAAAAAAAAAAAAAA.jpg';
const OTHER_OWN = 'https://rumbo.test/api/v1/media/BBBBBBBBBBBBBBBBBBBBBB.jpg';
const STORED = { id: 'AAAAAAAAAAAAAAAAAAAAAA', url: OWN, width: 1600, height: 1200, bytes: 4 };
const CASTLE_PHOTO: MediaRef = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Castelo.jpg/800px-Castelo.jpg',
  alt: 'Fachada del castillo',
  credit: 'Autor del castillo',
  license: 'CC BY-SA 4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Castelo.jpg',
};
const CATHEDRAL_PHOTO: MediaRef = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Se.jpg/800px-Se.jpg',
  alt: 'La catedral al atardecer',
  credit: 'Autora de la catedral',
  license: 'CC0',
};
const PHOTOS: Record<string, MediaRef[]> = {
  'Castelo de Leiria': [CASTLE_PHOTO],
  'Sé de Leiria': [CATHEDRAL_PHOTO],
};

const SCALED = new Blob([new Uint8Array(32)], { type: 'image/jpeg' });
const picked = () => new File([new Uint8Array(64)], 'IMG_0001.JPG', { type: 'image/jpeg' });

let wrapper: VueWrapper | null = null;
/** The test's creator, disposed after it: a pending autosave or card request must not outlive the test. */
let creatorInUse: ReturnType<typeof useCreatorStore> | null = null;
let media: Mock<(init: RequestInit) => Response | Promise<Response>>;
let mediaBodies: Array<{ headers: Record<string, string>; body: unknown }> = [];

function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
}

/** POST /media answers with `respond`; the AI makes cards with photos; routes cannot be uploaded. */
function serve(
  respond: (init: RequestInit) => Response | Promise<Response> = () => json(STORED, 201),
) {
  mediaBodies = [];
  media = vi.fn(async (init: RequestInit) => {
    mediaBodies.push({ headers: init.headers as Record<string, string>, body: init.body });
    return respond(init);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/media')) return media(init as RequestInit);
      if (url.endsWith('/content/generate')) {
        const { name } = JSON.parse(init?.body as string) as { name: string };
        return json(generated({ images: PHOTOS[name] ?? [] }));
      }
      return new Response(null, { status: 503 });
    }),
  );
}

async function prepare(interests: Interest[] = ['history', 'food'], cards = true) {
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
      { path: '/run', name: 'run', component: Empty },
    ],
  });
  await router.push('/create/review');
  const creator = useCreatorStore();
  creatorInUse = creator;
  await creator.ensureDraft();
  await creator.update({ name: 'Leiria numa manhã', interests });
  await creator.addPlace({ ...castle, tempId: 'castle' });
  await creator.addPlace({ ...cathedral, tempId: 'cathedral' });
  if (cards) await creator.generateMissing();
  return { pinia, router, creator };
}

async function show(
  component: typeof CoverCard | typeof ReviewStep,
  env: Awaited<ReturnType<typeof prepare>>,
) {
  wrapper = mount(component, {
    global: { plugins: [env.pinia, env.router, i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const button = (view: VueWrapper, label: string) =>
  view.findAll('button').find((candidate) => candidate.text() === label);
const labels = (view: VueWrapper) => view.findAll('button').map((candidate) => candidate.text());
const alert = (view: VueWrapper) => view.find('[role="alert"]');
const live = (view: VueWrapper) => view.get('[aria-live="polite"]').text();
const previewOf = (view: VueWrapper) => view.get('.cover-card__preview');

/** The user picks `file` in the phone's picker: the input's `change` event. */
async function choosePhoto(view: VueWrapper, file = picked()) {
  const input = view.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
  await flushPromises();
}

beforeEach(async () => {
  applyLocale('es');
  setOnline(true);
  vi.mocked(scalePhoto).mockReset().mockResolvedValue(SCALED);
  serve();
  await Promise.all([
    db.del(KEYS.creatorDraft),
    db.del(KEYS.creatorDraftBackup),
    db.del(KEYS.myRoutes),
  ]);
});

afterEach(async () => {
  creatorInUse?.$dispose();
  creatorInUse = null;
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('C4 · Portada: the preview', () => {
  it('shows the illustration of the first interest, and says it is what a route without photo gets', async () => {
    const view = await show(CoverCard, await prepare(['history', 'food']));
    expect(view.get('h2').text()).toBe('Portada');
    const preview = previewOf(view);
    expect(preview.attributes('data-cover')).toBe('illustration');
    expect(preview.attributes('data-interest')).toBe('history');
    expect(view.text()).toContain('Sin foto, la ruta usa esta ilustración.');
    expect(labels(view)).toEqual(['Subir una foto', 'Elegir de tus lugares']);
  });

  it('shows the pattern of the brand when the route has no interests', async () => {
    const view = await show(CoverCard, await prepare([]));
    expect(previewOf(view).attributes('data-cover')).toBe('pattern');
    expect(view.text()).toContain('Sin foto, la ruta usa el patrón de azulejos de Rumbo.');
  });

  it('is a labelled card of the review step, above its checklist', async () => {
    const view = await show(ReviewStep, await prepare());
    const headings = view.findAll('h2').map((heading) => heading.text());
    expect(headings.indexOf('Portada')).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf('Portada')).toBeLessThan(headings.indexOf('Comprobaciones'));
    const card = view.get('section.cover-card');
    expect(view.get(`#${card.attributes('aria-labelledby')}`).text()).toBe('Portada');
  });

  it('has nothing to remove, and nothing to choose while the cards have no photos', async () => {
    const view = await show(CoverCard, await prepare(['history'], false));
    expect(button(view, 'Quitar portada')).toBeUndefined();
    const choose = button(view, 'Elegir de tus lugares');
    expect(choose?.attributes('disabled')).toBeDefined();
    const hint = view.get(`#${choose?.attributes('aria-describedby')}`);
    expect(hint.text()).toBe('Tus lugares aún no tienen fotos en sus fichas.');
  });
});

describe('C4 · Portada: "Subir una foto"', () => {
  it("opens the phone's picker (camera or library) on the button", async () => {
    const view = await show(CoverCard, await prepare());
    const input = view.get('input[type="file"]');
    expect(input.attributes('accept')).toBe('image/*');
    const open = vi.spyOn(input.element as HTMLInputElement, 'click');
    await button(view, 'Subir una foto')?.trigger('click');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('scales the photo on the device, uploads it as a JPEG and makes it the cover', async () => {
    const env = await prepare();
    const view = await show(CoverCard, env);
    const file = picked();
    await choosePhoto(view, file);

    expect(scalePhoto).toHaveBeenCalledWith(file);
    expect(media).toHaveBeenCalledTimes(1);
    const sent = mediaBodies[0];
    expect(sent?.body).toBe(SCALED);
    expect(sent?.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'x-device-id': expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    // The draft keeps the address only; the route's alt comes from its name.
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OWN });
    expect(env.creator.coverImage).toEqual({ url: OWN, alt: { es: 'Leiria numa manhã' } });
    const preview = previewOf(view);
    expect(preview.attributes('data-cover')).toBe('photo');
    expect(preview.get('img').attributes('src')).toBe(OWN);
    expect(preview.get('img').attributes('alt')).toBe('Leiria numa manhã');
    expect(view.find('.cover-card__note').exists()).toBe(false);
    expect(labels(view)).toEqual(['Subir una foto', 'Elegir de tus lugares', 'Quitar portada']);
    expect(alert(view).exists()).toBe(false);
    expect(live(view)).toBe('Portada actualizada.');
  });

  it('shows it is busy, and lets nothing else change the cover meanwhile', async () => {
    let finish: (response: Response) => void = () => undefined;
    serve(() => new Promise<Response>((resolve) => (finish = resolve)));
    const env = await prepare();
    await env.creator.setCover({ type: 'own', url: OTHER_OWN });
    const view = await show(CoverCard, env);
    await choosePhoto(view);

    const uploading = button(view, 'Subiendo la foto…');
    expect(uploading?.attributes('disabled')).toBeDefined();
    expect(uploading?.attributes('aria-busy')).toBe('true');
    expect(button(view, 'Elegir de tus lugares')?.attributes('disabled')).toBeDefined();
    expect(button(view, 'Quitar portada')?.attributes('disabled')).toBeDefined();
    // Still the old photo until the new one is stored.
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OTHER_OWN });

    finish(json(STORED, 201));
    await flushPromises();
    expect(button(view, 'Subir una foto')?.attributes('disabled')).toBeUndefined();
    expect(button(view, 'Subir una foto')?.attributes('aria-busy')).toBeUndefined();
    expect(button(view, 'Quitar portada')?.attributes('disabled')).toBeUndefined();
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OWN });
  });

  it('says it needs a connection before the picker opens, and sends nothing', async () => {
    const view = await show(CoverCard, await prepare());
    const open = vi.spyOn(view.get('input[type="file"]').element as HTMLInputElement, 'click');
    setOnline(false);
    await button(view, 'Subir una foto')?.trigger('click');
    expect(alert(view).text()).toBe('Necesitas conexión para subir una foto.');
    expect(open).not.toHaveBeenCalled();
    expect(scalePhoto).not.toHaveBeenCalled();
    expect(media).not.toHaveBeenCalled();

    // Back online: the same button works, and the message is gone.
    setOnline(true);
    await button(view, 'Subir una foto')?.trigger('click');
    expect(alert(view).exists()).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('says it too when the connection is lost after the photo was picked', async () => {
    const env = await prepare();
    const view = await show(CoverCard, env);
    setOnline(false);
    await choosePhoto(view);
    expect(alert(view).text()).toBe('Necesitas conexión para subir una foto.');
    expect(scalePhoto).not.toHaveBeenCalled();
    expect(env.creator.draft?.cover).toBeUndefined();
  });

  it('says it when the connection drops during the upload', async () => {
    serve(() => Promise.reject(new TypeError('Failed to fetch')));
    const env = await prepare();
    const view = await show(CoverCard, env);
    // Online when the photo was picked, offline when it could not be sent.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValueOnce(true).mockReturnValue(false);
    await choosePhoto(view);
    expect(media).toHaveBeenCalledTimes(1);
    expect(alert(view).text()).toBe('Necesitas conexión para subir una foto.');
    expect(env.creator.draft?.cover).toBeUndefined();
  });

  it('asks for another photo when this one cannot be read', async () => {
    vi.mocked(scalePhoto).mockRejectedValue(new MediaError('unsupported'));
    const env = await prepare();
    await env.creator.setCover({ type: 'own', url: OTHER_OWN });
    const view = await show(CoverCard, env);
    await choosePhoto(view);
    expect(alert(view).text()).toBe('No pudimos leer esa foto. Prueba con otra.');
    expect(media).not.toHaveBeenCalled();
    // The draft and its previous cover are as they were.
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OTHER_OWN });
    expect(env.creator.draft?.name).toBe('Leiria numa manhã');
    expect(button(view, 'Subir una foto')?.attributes('disabled')).toBeUndefined();
  });

  it('says the same when the server cannot read it (415 unsupported_media)', async () => {
    serve(() => apiError('unsupported_media', 415));
    const env = await prepare();
    const view = await show(CoverCard, env);
    await choosePhoto(view);
    expect(alert(view).text()).toBe('No pudimos leer esa foto. Prueba con otra.');
    expect(env.creator.draft?.cover).toBeUndefined();
  });

  it.each([
    ['too large', () => apiError('payload_too_large', 413)],
    ['too many uploads', () => apiError('rate_limited', 429)],
    ['no room for photos', () => apiError('unavailable', 503)],
    ['a server error', () => apiError('internal', 500)],
    ['a proxy error page', () => new Response('<html>502</html>', { status: 502 })],
    ['no answer', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an answer it cannot use', () => json({ url: 'nope' }, 201)],
  ])('says something short and general when the upload fails: %s', async (_name, answer) => {
    serve(answer);
    const env = await prepare();
    await env.creator.setCover({ type: 'own', url: OTHER_OWN });
    const view = await show(CoverCard, env);
    await choosePhoto(view);
    expect(alert(view).text()).toBe('No pudimos subir la foto. Inténtalo de nuevo en un rato.');
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OTHER_OWN });
    expect(env.creator.draft?.places).toHaveLength(2);
    expect(button(view, 'Subir una foto')?.attributes('disabled')).toBeUndefined();
  });

  it('clears the message with the next try', async () => {
    serve(() => apiError('unavailable', 503));
    const env = await prepare();
    const view = await show(CoverCard, env);
    await choosePhoto(view);
    expect(alert(view).exists()).toBe(true);

    serve();
    await choosePhoto(view);
    expect(alert(view).exists()).toBe(false);
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OWN });
  });

  it('gives up an upload on its way when the screen is left, and leaves the draft alone', async () => {
    const request: { signal?: AbortSignal | null } = {};
    serve((init) => {
      request.signal = init.signal;
      return new Promise<Response>(() => undefined);
    });
    const env = await prepare();
    const view = await show(CoverCard, env);
    await choosePhoto(view);
    await vi.waitFor(() => expect(request.signal).toBeTruthy());
    expect(request.signal?.aborted).toBe(false);
    view.unmount();
    wrapper = null;
    expect(request.signal?.aborted).toBe(true);
    await flushPromises();
    expect(env.creator.draft?.cover).toBeUndefined();
  });

  it("refuses a photo address that is not the server's, whatever the answer says", async () => {
    serve(() => json({ ...STORED, url: 'https://elsewhere.test/photo.jpg' }, 201));
    const env = await prepare();
    const view = await show(CoverCard, env);
    await choosePhoto(view);
    expect(alert(view).text()).toBe('No pudimos subir la foto. Inténtalo de nuevo en un rato.');
    expect(env.creator.draft?.cover).toBeUndefined();
  });
});

describe('C4 · Portada: a photo that does not load', () => {
  it('says so instead of "sin foto", keeps the cover in the draft and offers the way out', async () => {
    const env = await prepare();
    await env.creator.setCover({ type: 'own', url: OWN });
    const view = await show(CoverCard, env);
    expect(previewOf(view).attributes('data-cover')).toBe('photo');
    await previewOf(view).get('img').trigger('error');

    // The stand-in shows, but the route does have a cover: it is not dropped behind the user's back.
    expect(previewOf(view).attributes('data-cover')).toBe('illustration');
    expect(view.get('.cover-card__note').text()).toBe(
      'No pudimos cargar esta foto. Puedes subir otra o quitar la portada.',
    );
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OWN });
    expect(labels(view)).toContain('Quitar portada');

    // A new cover is a new try.
    serve(() => json({ ...STORED, id: 'BBBBBBBBBBBBBBBBBBBBBB', url: OTHER_OWN }, 201));
    await choosePhoto(view);
    expect(previewOf(view).attributes('data-cover')).toBe('photo');
    expect(view.find('.cover-card__note').exists()).toBe(false);
  });

  it('says it in every language', async () => {
    const env = await prepare();
    await env.creator.setCover({ type: 'own', url: OWN });
    const view = await show(CoverCard, env);
    await previewOf(view).get('img').trigger('error');
    applyLocale('en');
    await flushPromises();
    expect(view.get('.cover-card__note').text()).toBe(
      "We couldn't load this photo. You can upload another or remove the cover.",
    );
    applyLocale('pt');
    await flushPromises();
    expect(view.get('.cover-card__note').text()).toBe(
      'Não conseguimos carregar esta foto. Podes enviar outra ou remover a capa.',
    );
  });
});

describe('C4 · Portada: the route cannot be saved with a photo on its way', () => {
  it('keeps "Guardar ruta" and "Probar ruta" off until the photo is in', async () => {
    let finish: (response: Response) => void = () => undefined;
    serve(() => new Promise<Response>((resolve) => (finish = resolve)));
    const env = await prepare();
    const view = await show(ReviewStep, env);
    expect(button(view, 'Guardar ruta')?.attributes('disabled')).toBeUndefined();
    expect(button(view, 'Probar ruta')?.attributes('disabled')).toBeUndefined();

    await choosePhoto(view);
    expect(button(view, 'Guardar ruta')?.attributes('disabled')).toBeDefined();
    expect(button(view, 'Probar ruta')?.attributes('disabled')).toBeDefined();
    // Tapping it anyway saves nothing.
    await button(view, 'Guardar ruta')?.trigger('click');
    expect(env.router.currentRoute.value.name).toBe('create-review');

    finish(json(STORED, 201));
    await flushPromises();
    expect(button(view, 'Guardar ruta')?.attributes('disabled')).toBeUndefined();
    expect(button(view, 'Probar ruta')?.attributes('disabled')).toBeUndefined();
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OWN });
  });

  it('lets the route be saved again when the upload fails', async () => {
    serve(() => apiError('unavailable', 503));
    const env = await prepare();
    const view = await show(ReviewStep, env);
    await choosePhoto(view);
    expect(alert(view).exists()).toBe(true);
    expect(button(view, 'Guardar ruta')?.attributes('disabled')).toBeUndefined();
    expect(button(view, 'Probar ruta')?.attributes('disabled')).toBeUndefined();
  });
});

describe('C4 · Portada: "Elegir de tus lugares"', () => {
  async function openSheet(view: VueWrapper) {
    await button(view, 'Elegir de tus lugares')?.trigger('click');
    await flushPromises();
    return view.get('[role="dialog"]');
  }

  it('offers the photos of the ready cards with their place and credit', async () => {
    const view = await show(CoverCard, await prepare());
    const choose = button(view, 'Elegir de tus lugares');
    expect(choose?.attributes('disabled')).toBeUndefined();
    expect(view.text()).not.toContain('aún no tienen fotos');

    const sheet = await openSheet(view);
    expect(sheet.attributes('aria-label')).toBe('Fotos de tus lugares');
    expect(sheet.get('h2').text()).toBe('Fotos de tus lugares');
    const photos = sheet.findAll('li button.photo');
    expect(photos).toHaveLength(2);
    expect(photos.map((photo) => photo.get('img').attributes('src'))).toEqual([
      CASTLE_PHOTO.url,
      CATHEDRAL_PHOTO.url,
    ]);
    expect(photos.map((photo) => photo.get('img').attributes('alt'))).toEqual([
      'Fachada del castillo',
      'La catedral al atardecer',
    ]);
    expect(photos.map((photo) => photo.get('.photo__place').text())).toEqual([
      'Castelo de Leiria',
      'Sé de Leiria',
    ]);
    expect(photos.map((photo) => photo.get('.photo__credit').text())).toEqual([
      'Foto: Autor del castillo / CC BY-SA 4.0',
      'Foto: Autora de la catedral / CC0',
    ]);
    expect(photos.map((photo) => photo.attributes('aria-pressed'))).toEqual(['false', 'false']);
  });

  it('makes the chosen photo the cover, exactly as the card has it, and closes the sheet', async () => {
    const env = await prepare();
    const view = await show(CoverCard, env);
    const sheet = await openSheet(view);
    await sheet.findAll('li button.photo')[1]?.trigger('click');
    await flushPromises();

    expect(view.find('[role="dialog"]').exists()).toBe(false);
    expect(env.creator.draft?.cover).toEqual({ type: 'card', image: CATHEDRAL_PHOTO });
    // A copy: the card and the cover do not share the object.
    const choice = env.creator.coverChoices[1]?.image;
    const cover = env.creator.draft?.cover;
    expect(cover?.type === 'card' && cover.image).not.toBe(choice);
    expect(env.creator.coverImage).toEqual(CATHEDRAL_PHOTO);

    const preview = previewOf(view);
    expect(preview.attributes('data-cover')).toBe('photo');
    expect(preview.get('img').attributes('src')).toBe(CATHEDRAL_PHOTO.url);
    expect(preview.get('img').attributes('alt')).toBe('La catedral al atardecer');
    // The licence asks for the credit: it is under the preview.
    expect(view.get('.cover-card__note').text()).toBe('Foto: Autora de la catedral / CC0');
    expect(live(view)).toBe('Portada actualizada.');
    expect(labels(view)).toContain('Quitar portada');
  });

  it('marks the photo that is the cover now', async () => {
    const env = await prepare();
    await env.creator.setCover({ type: 'card', image: CASTLE_PHOTO });
    const view = await show(CoverCard, env);
    const sheet = await openSheet(view);
    expect(
      sheet.findAll('li button.photo').map((photo) => photo.attributes('aria-pressed')),
    ).toEqual(['true', 'false']);
    expect(sheet.findAll('.photo__check')).toHaveLength(1);
  });

  it('closes without changing the cover, with its close button and with Escape', async () => {
    const env = await prepare();
    await env.creator.setCover({ type: 'own', url: OWN });
    const view = await show(CoverCard, env);
    const first = await openSheet(view);
    await first.get('button[aria-label="Cerrar"]').trigger('click');
    expect(view.find('[role="dialog"]').exists()).toBe(false);

    await openSheet(view);
    await view.get('.frame').trigger('keydown', { key: 'Escape' });
    expect(view.find('[role="dialog"]').exists()).toBe(false);
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OWN });
  });

  it("replaces an uploaded photo, and an upload replaces a place's photo", async () => {
    const env = await prepare();
    const view = await show(CoverCard, env);
    await choosePhoto(view);
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OWN });
    const sheet = await openSheet(view);
    await sheet.findAll('li button.photo')[0]?.trigger('click');
    await flushPromises();
    expect(env.creator.draft?.cover).toEqual({ type: 'card', image: CASTLE_PHOTO });
    serve(() => json({ ...STORED, id: 'BBBBBBBBBBBBBBBBBBBBBB', url: OTHER_OWN }, 201));
    await choosePhoto(view);
    expect(env.creator.draft?.cover).toEqual({ type: 'own', url: OTHER_OWN });
  });

  it('goes back to the illustration when the card that had the photo is replaced by the basic one', async () => {
    const env = await prepare();
    await env.creator.setCover({ type: 'card', image: CASTLE_PHOTO });
    const view = await show(CoverCard, env);
    expect(previewOf(view).attributes('data-cover')).toBe('photo');
    await env.creator.setBasicCard('castle');
    await flushPromises();
    expect(previewOf(view).attributes('data-cover')).toBe('illustration');
    expect(labels(view)).not.toContain('Quitar portada');
    expect(view.text()).toContain('Sin foto, la ruta usa esta ilustración.');
  });
});

describe('C4 · Portada: "Quitar portada"', () => {
  it('removes the cover: back to the illustration, and a screen reader hears it', async () => {
    const env = await prepare();
    await env.creator.setCover({ type: 'own', url: OWN });
    const view = await show(CoverCard, env);
    expect(previewOf(view).attributes('data-cover')).toBe('photo');

    await button(view, 'Quitar portada')?.trigger('click');
    await flushPromises();
    expect(env.creator.draft?.cover).toBeUndefined();
    expect(previewOf(view).attributes('data-cover')).toBe('illustration');
    expect(view.text()).toContain('Sin foto, la ruta usa esta ilustración.');
    expect(button(view, 'Quitar portada')).toBeUndefined();
    expect(live(view)).toBe('Portada quitada.');
  });

  it('leaves the draft stored without the cover', async () => {
    const env = await prepare();
    await env.creator.setCover({ type: 'own', url: OWN });
    await env.creator.flush();
    const view = await show(CoverCard, env);
    await button(view, 'Quitar portada')?.trigger('click');
    await env.creator.flush();
    expect((await db.get<{ cover?: unknown }>(KEYS.creatorDraft))?.cover).toBeUndefined();
  });
});

describe('C4 · Portada: saving', () => {
  it('saves the route with the uploaded photo as its cover, the alt made from the name', async () => {
    const env = await prepare();
    const view = await show(ReviewStep, env);
    await choosePhoto(view);
    await button(view, 'Guardar ruta')?.trigger('click');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('create-done'));
    const record = await getMyRoute(env.creator.savedId ?? '');
    expect(record?.bundle.spec.coverImage).toEqual({ url: OWN, alt: { es: 'Leiria numa manhã' } });
  });

  it("saves a place's photo exactly as its card has it", async () => {
    const env = await prepare();
    const view = await show(ReviewStep, env);
    await button(view, 'Elegir de tus lugares')?.trigger('click');
    await flushPromises();
    await view.findAll('li button.photo')[0]?.trigger('click');
    await flushPromises();
    await button(view, 'Guardar ruta')?.trigger('click');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('create-done'));
    const record = await getMyRoute(env.creator.savedId ?? '');
    expect(record?.bundle.spec.coverImage).toEqual(CASTLE_PHOTO);
  });

  it('saves a route without a cover as before', async () => {
    const env = await prepare();
    const view = await show(ReviewStep, env);
    await button(view, 'Guardar ruta')?.trigger('click');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('create-done'));
    const record = await getMyRoute(env.creator.savedId ?? '');
    expect(record?.bundle.spec.coverImage).toBeUndefined();
  });
});

describe('C4 · Portada: the language', () => {
  it('follows it live, in English and Portuguese', async () => {
    const view = await show(CoverCard, await prepare(['history'], false));
    applyLocale('en');
    await flushPromises();
    expect(view.get('h2').text()).toBe('Cover');
    expect(labels(view)).toEqual(['Upload a photo', 'Choose from your places']);
    expect(view.text()).toContain('With no photo, the route uses this illustration.');
    expect(view.text()).toContain("Your places don't have photos in their cards yet.");
    setOnline(false);
    await button(view, 'Upload a photo')?.trigger('click');
    expect(alert(view).text()).toBe('You need a connection to upload a photo.');

    applyLocale('pt');
    await flushPromises();
    expect(view.get('h2').text()).toBe('Capa');
    expect(labels(view)).toEqual(['Enviar uma foto', 'Escolher dos teus lugares']);
    expect(alert(view).text()).toBe('Precisas de ligação para enviar uma foto.');
    setOnline(true);
  });

  it('has its own words in every language for the rest too', async () => {
    const env = await prepare();
    await env.creator.setCover({ type: 'own', url: OWN });
    const view = await show(CoverCard, env);
    applyLocale('en');
    await flushPromises();
    expect(labels(view)).toEqual(['Upload a photo', 'Choose from your places', 'Remove cover']);
    await button(view, 'Choose from your places')?.trigger('click');
    await flushPromises();
    expect(view.get('[role="dialog"]').get('h2').text()).toBe('Photos of your places');
    expect(view.get('[role="dialog"] .photo__credit').text()).toBe(
      'Photo: Autor del castillo / CC BY-SA 4.0',
    );
    applyLocale('pt');
    await flushPromises();
    expect(view.get('[role="dialog"]').get('h2').text()).toBe('Fotos dos teus lugares');
  });
});
