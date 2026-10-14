import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adoptArCodeFromUrl,
  AR_CODE_KEY,
  appClipUrl,
  arPageUrl,
  isIos,
  readArCode,
} from '../src/ar/access.ts';
import ArCharacterSheet from '../src/handlers/ArCharacterSheet.vue';
import { sheetComponent } from '../src/handlers/registry.ts';
import { applyLocale, i18n } from '../src/i18n/index.ts';

// The AR guide (version 2 prototype) as a route's arrival: who may use it, the links to the AR
// page and the App Clip, and the sheet that explains the activity before opening it.

beforeEach(() => setActivePinia(createPinia()));

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(AR_CODE_KEY);
  applyLocale('es');
});

describe('access to the AR guide', () => {
  it('takes the code from a link once, keeps it and cleans the address', () => {
    expect(adoptArCodeFromUrl('https://rumbo.test/explore?x=1')).toBeNull();
    expect(adoptArCodeFromUrl('https://rumbo.test/explore?ra_code=%20abc%20&x=1#map')).toBe(
      '/explore?x=1#map',
    );
    expect(readArCode()).toBe('abc');
    // An empty code cleans the address without forgetting the one there was.
    expect(adoptArCodeFromUrl('https://rumbo.test/?ra_code=')).toBe('/');
    expect(readArCode()).toBe('abc');
  });

  it('builds the AR page and App Clip links', () => {
    const page = arPageUrl('https://rumbo.test', {
      scene: 'artesano',
      lang: 'pt',
      fromRoute: true,
      code: 'a&b',
    });
    expect(page).toBe('https://rumbo.test/ra_test/?scene=artesano&lang=pt&from=route&code=a%26b');
    expect(appClipUrl(page)).toBe(
      `https://appclip.needle.tools/ar?url=${encodeURIComponent(page)}`,
    );
    expect(arPageUrl('https://rumbo.test', { scene: 'asalto_1140', lang: 'es' })).toBe(
      'https://rumbo.test/ra_test/?scene=asalto_1140&lang=es',
    );
  });

  it('tells an iPhone or an iPad from the rest', () => {
    const nav = (userAgent: string, platform = '', maxTouchPoints = 0) => ({
      userAgent,
      platform,
      maxTouchPoints,
    });
    expect(isIos(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'))).toBe(true);
    expect(isIos(nav('Mozilla/5.0 (Macintosh)', 'MacIntel', 5))).toBe(true);
    expect(isIos(nav('Mozilla/5.0 (Macintosh)', 'MacIntel', 0))).toBe(false);
    expect(isIos(nav('Mozilla/5.0 (Linux; Android 15)'))).toBe(false);
  });
});

describe('the AR guide arrival sheet', () => {
  const mountSheet = (scene = 'artesano') =>
    mount(ArCharacterSheet, {
      props: { sourceLocale: 'es', name: 'Parque', order: 1, total: 1, scene },
      global: { plugins: [i18n] },
    });
  const press = (view: ReturnType<typeof mountSheet>, label: string) =>
    view
      .findAll('button')
      .find((button) => button.text() === label)!
      .trigger('click');

  it('is the view the event system asks for', () => {
    expect(sheetComponent('ar_character')).not.toBe(sheetComponent('info_sheet'));
  });

  it('explains the activity in four steps and can be left for later', async () => {
    const view = mountSheet();
    expect(view.get('h2').text()).toBe('Habla con el artesano');
    expect(view.findAll('ol li').map((step) => step.get('.t-body-strong').text())).toEqual([
      'Se abre la cámara',
      'Toca para colocarlo',
      'Mantén pulsado para hablar',
      'Vuelve a la ruta',
    ]);
    await press(view, 'Ahora no');
    expect(view.emitted('close')).toEqual([[{ status: 'dismissed' }]]);
  });

  it('tells the assault scene with its own texts and opens it with ?scene=asalto_1140', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = mountSheet('asalto_1140');
    expect(view.get('h2').text()).toBe('Interrumpe la batalla');
    expect(view.text()).toContain('Un defensor portugués y un guerrero almorávide');
    expect(view.findAll('ol li').map((step) => step.get('.t-body-strong').text())).toEqual([
      'Se abre la cámara',
      'Toca para colocar la escena',
      'Acércate a uno y toca «Hablar»',
      'Vuelve a la ruta',
    ]);
    await press(view, 'Empezar');
    expect(open).toHaveBeenCalledWith(
      `${location.origin}/ra_test/?scene=asalto_1140&lang=es&from=route`,
      '_blank',
      'noopener',
    );
    expect(view.text()).toContain('Los soldados te esperan en otra ventana');
  });

  it('opens the AR page in another window, in the app language, then offers to go on', async () => {
    applyLocale('en');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = mountSheet();
    await press(view, 'Start');
    expect(open).toHaveBeenCalledWith(
      `${location.origin}/ra_test/?scene=artesano&lang=en&from=route`,
      '_blank',
      'noopener',
    );
    expect(view.text()).toContain('The craftsman is waiting in another window');
    await press(view, 'Open again');
    expect(open).toHaveBeenCalledTimes(2);
    await press(view, 'Continue route');
    expect(view.emitted('close')).toEqual([[{ status: 'done' }]]);
  });

  it('on an iPhone goes through the App Clip, handing it the code', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    );
    localStorage.setItem(AR_CODE_KEY, 'abc');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = mountSheet();
    expect(view.text()).toContain('En iPhone se abre con un App Clip');
    await press(view, 'Empezar');
    const page = `${location.origin}/ra_test/?scene=artesano&lang=es&from=route&code=abc`;
    expect(open).toHaveBeenCalledWith(appClipUrl(page), '_blank', 'noopener');
    expect(view.text()).toContain('cierra el App Clip');
  });
});
