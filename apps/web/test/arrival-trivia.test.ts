import { aiTemplateHandler, CARD_QUIZ_POINTS, type HandlerContext } from '@rumbo/event-system';
import type { Locale, LocalizedContent, LocalizedText, PointContent } from '@rumbo/route-spec';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OverlayHost from '../src/components/OverlayHost.vue';
import ContentSheet from '../src/handlers/ContentSheet.vue';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { useUiStore } from '../src/stores/ui.ts';

// The arrival card (S06) with a trivia question: one answer, right or wrong
// with a shape cue and a polite announcement, and the answer reported with
// the language of the card when the sheet closes. `preview` is the creator's
// "Ver ficha": the same card with a single Close and nothing reported.

/** The same place asked in each language; the right option sits at a different index. */
const QUIZ: Record<Locale, NonNullable<PointContent['quiz']>> = {
  es: {
    question: '¿Quién conquistó el castillo?',
    options: ['Don Dinis', 'Afonso Henriques', 'Don Manuel'],
    correctIndex: 1,
    explanation: 'Lo tomó a los musulmanes en 1135.',
  },
  en: {
    question: 'Who took the castle?',
    options: ['King Manuel', 'King Dinis', 'Afonso Henriques'],
    correctIndex: 2,
    explanation: 'He took it from the Moors in 1135.',
  },
  pt: {
    question: 'Quem conquistou o castelo?',
    options: ['D. Afonso Henriques', 'D. Dinis', 'D. Manuel'],
    correctIndex: 0,
    explanation: 'Tomou-o aos mouros em 1135.',
  },
};

function card(locale: Locale, patch: Partial<PointContent> = {}): PointContent {
  return {
    id: 'castelo',
    locale,
    title: `Castelo ${locale}`,
    summary: 'A medieval castle above the city.',
    facts: ['Built in the 12th century.'],
    images: [],
    tip: 'Climb the tower at sunset.',
    quiz: QUIZ[locale],
    sources: [{ title: 'Wikipedia', url: 'https://es.wikipedia.org/wiki/Castillo_de_Leiria' }],
    generated: {
      by: 'ai',
      model: 'test-model',
      promptVersion: 'card-1',
      at: '2026-10-08T10:00:00Z',
    },
    status: 'approved',
    ...patch,
  };
}

/** Every sheet a test mounted: all are unmounted after it, so none leaks into the next. */
const mounted: VueWrapper[] = [];

function mountSheet(
  props: {
    content?: LocalizedContent | null;
    preview?: boolean;
    sourceLocale?: Locale;
    title?: LocalizedText;
    body?: LocalizedText;
  } = {},
) {
  const view = mount(ContentSheet, {
    props: { sourceLocale: 'es', order: 2, total: 4, content: { es: card('es') }, ...props },
    global: { plugins: [createPinia(), i18n] },
  });
  mounted.push(view);
  return view;
}

const options = (view: VueWrapper) => view.findAll('.trivia__option');
const region = (view: VueWrapper) => view.get('[role="status"]');
const button = (view: VueWrapper, name: string) =>
  view.findAll('button').find((candidate) => candidate.text() === name);
/** The only `close` the sheet emitted, or undefined while it is open. */
const closed = (view: VueWrapper) => view.emitted('close');

beforeEach(() => applyLocale('es'));

afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
  vi.restoreAllMocks();
});

describe('the trivia question', () => {
  it('comes after the tip and before the sources, with one button per option', () => {
    const view = mountSheet();
    const text = view.text();
    expect(text.indexOf('Consejo')).toBeLessThan(text.indexOf('Pregunta rápida'));
    expect(text.indexOf('Pregunta rápida')).toBeLessThan(text.indexOf('Fuentes'));

    expect(view.get('.trivia h2').text()).toBe('Pregunta rápida');
    const question = view.get('.trivia__question');
    expect(question.text()).toBe('¿Quién conquistó el castillo?');
    const group = view.get('.trivia__options');
    expect(group.attributes('role')).toBe('group');
    expect(group.attributes('aria-labelledby')).toBe(question.attributes('id'));
    expect(options(view).map((option) => option.text())).toEqual([
      'Don Dinis',
      'Afonso Henriques',
      'Don Manuel',
    ]);
    for (const option of options(view)) {
      expect(option.element.tagName).toBe('BUTTON');
      expect(option.attributes('type')).toBe('button');
      expect(option.attributes('disabled')).toBeUndefined();
    }
  });

  it('has its live region in the page before anyone answers, empty', () => {
    const view = mountSheet();
    expect(region(view).attributes('aria-live')).toBe('polite');
    expect(region(view).text()).toBe('');
  });

  it('marks a right answer with a check, locks the options and announces it with the points', async () => {
    const view = mountSheet();
    const live = region(view);
    await options(view)[1]?.trigger('click');

    expect(options(view).map((option) => option.classes())).toEqual([
      expect.arrayContaining(['is-dim']),
      expect.arrayContaining(['is-right']),
      expect.arrayContaining(['is-dim']),
    ]);
    expect(options(view)[1]?.find('svg.lucide-circle-check').exists()).toBe(true);
    expect(options(view).filter((option) => option.find('svg').exists())).toHaveLength(1);
    for (const option of options(view)) expect(option.attributes('disabled')).toBeDefined();

    // The very element that was in the page announces it (a region added with its content isn't read).
    expect(region(view).element).toBe(live.element);
    expect(live.text()).toContain(`¡Correcto! +${CARD_QUIZ_POINTS} pts`);
    expect(live.text()).toContain('Lo tomó a los musulmanes en 1135.');
    // Nothing is reported until the visitor leaves the card.
    expect(closed(view)).toBeUndefined();
  });

  it('marks a wrong answer with a cross, shows the right one and explains', async () => {
    const view = mountSheet();
    await options(view)[0]?.trigger('click');

    expect(options(view).map((option) => option.classes())).toEqual([
      expect.arrayContaining(['is-wrong']),
      expect.arrayContaining(['is-right']),
      expect.arrayContaining(['is-dim']),
    ]);
    expect(options(view)[0]?.find('svg.lucide-circle-x').exists()).toBe(true);
    expect(options(view)[1]?.find('svg.lucide-circle-check').exists()).toBe(true);
    expect(options(view)[2]?.find('svg').exists()).toBe(false);
    expect(region(view).text()).toContain('No es esa. La correcta: Afonso Henriques');
    expect(region(view).text()).toContain('Lo tomó a los musulmanes en 1135.');
    expect(region(view).text()).not.toContain('pts');
  });

  it('brings the verdict into view, since it grows the card below the fold', async () => {
    const scroll = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scroll);
    const view = mountSheet();
    expect(scroll).not.toHaveBeenCalled();
    await options(view)[0]?.trigger('click');
    await flushPromises();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(scroll.mock.contexts[0]).toBe(region(view).element);
    // A second tap is refused: no second scroll.
    await options(view)[1]?.trigger('click');
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('leaves out the explanation when the card has none', async () => {
    const view = mountSheet({
      content: { es: card('es', { quiz: { ...QUIZ.es, explanation: undefined } }) },
    });
    await options(view)[1]?.trigger('click');
    expect(
      region(view)
        .findAll('p')
        .map((p) => p.text()),
    ).toEqual([`¡Correcto! +${CARD_QUIZ_POINTS} pts`]);
  });

  it('takes one answer only', async () => {
    const view = mountSheet();
    await options(view)[0]?.trigger('click');
    await options(view)[1]?.trigger('click');
    (options(view)[1]?.element as HTMLButtonElement).click();
    await flushPromises();

    expect(region(view).text()).toContain('No es esa');
    expect(options(view)[1]?.classes()).toContain('is-right');
    await button(view, 'Continuar ruta')?.trigger('click');
    expect(closed(view)).toEqual([[{ status: 'done', data: { answerIndex: 0, locale: 'es' } }]]);
  });
});

describe('closing the card', () => {
  it('reports the answer with the language of the card', async () => {
    const view = mountSheet();
    await options(view)[1]?.trigger('click');
    await button(view, 'Continuar ruta')?.trigger('click');
    expect(closed(view)).toEqual([[{ status: 'done', data: { answerIndex: 1, locale: 'es' } }]]);
  });

  it('keeps the decision of the ⋯ menu next to the answer', async () => {
    for (const [item, decision] of [
      ['Pausar recorrido', 'pause'],
      ['Terminar recorrido', 'cancel'],
    ] as const) {
      const view = mountSheet();
      await options(view)[2]?.trigger('click');
      await view.get('.footer__more').trigger('click');
      await button(view, item)?.trigger('click');
      expect(closed(view)).toEqual([
        [{ status: 'done', decision, data: { answerIndex: 2, locale: 'es' } }],
      ]);
    }
  });

  it('reports no answer when the question was left alone', async () => {
    const view = mountSheet();
    await button(view, 'Continuar ruta')?.trigger('click');
    expect(closed(view)).toEqual([[{ status: 'done' }]]);

    const other = mountSheet();
    await other.get('.footer__more').trigger('click');
    await button(other, 'Pausar recorrido')?.trigger('click');
    expect(closed(other)).toEqual([[{ status: 'done', decision: 'pause' }]]);
  });

  it('reports the language of the card shown, not the interface language', async () => {
    const view = mountSheet({ content: { pt: card('pt') }, sourceLocale: 'pt' });
    expect(view.text()).toContain('Contenido disponible en Portugués');
    expect(view.get('.trivia__question').text()).toBe('Quem conquistou o castelo?');
    await options(view)[0]?.trigger('click');
    await button(view, 'Continuar ruta')?.trigger('click');
    expect(closed(view)).toEqual([[{ status: 'done', data: { answerIndex: 0, locale: 'pt' } }]]);
  });
});

describe('cards without a question', () => {
  it('have no trivia and close as before', async () => {
    const view = mountSheet({ content: { es: card('es', { quiz: undefined }) } });
    expect(view.find('.trivia').exists()).toBe(false);
    expect(view.text()).not.toContain('Pregunta rápida');
    expect(view.find('[role="status"]').exists()).toBe(false);
    await button(view, 'Continuar ruta')?.trigger('click');
    expect(closed(view)).toEqual([[{ status: 'done' }]]);
  });

  it('include the plain info sheet, which has no card at all', async () => {
    const view = mountSheet({ content: null, title: 'Praça Rodrigues Lobo', body: 'Una plaza.' });
    expect(view.get('h1').text()).toBe('Praça Rodrigues Lobo');
    expect(view.text()).toContain('Una plaza.');
    expect(view.find('.trivia').exists()).toBe(false);
    await button(view, 'Continuar ruta')?.trigger('click');
    expect(closed(view)).toEqual([[{ status: 'done' }]]);
  });
});

describe('the language', () => {
  it('speaks the interface language around the question', async () => {
    const content = { es: card('es'), en: card('en'), pt: card('pt') };
    const expected = {
      es: ['Pregunta rápida', `¡Correcto! +${CARD_QUIZ_POINTS} pts`, 'No es esa. La correcta: '],
      en: ['Quick question', `Correct! +${CARD_QUIZ_POINTS} pts`, 'Not quite. The right one: '],
      pt: ['Pergunta rápida', `Certo! +${CARD_QUIZ_POINTS} pts`, 'Não é essa. A certa: '],
    } as const;
    for (const locale of ['es', 'en', 'pt'] as const) {
      applyLocale(locale);
      const [title, right, wrong] = expected[locale];
      const quiz = QUIZ[locale];

      const view = mountSheet({ content });
      expect(view.get('.trivia h2').text()).toBe(title);
      await options(view)[quiz.correctIndex]?.trigger('click');
      expect(region(view).text()).toContain(right);

      const other = mountSheet({ content });
      await options(other)[(quiz.correctIndex + 1) % quiz.options.length]?.trigger('click');
      expect(region(other).text()).toContain(`${wrong}${quiz.options[quiz.correctIndex]}`);
    }
  });

  it('starts over when the switch brings a card with its own question', async () => {
    const view = mountSheet({ content: { es: card('es'), en: card('en') } });
    await options(view)[0]?.trigger('click');
    expect(region(view).text()).toContain('No es esa');

    applyLocale('en');
    await flushPromises();
    expect(view.get('.trivia__question').text()).toBe('Who took the castle?');
    expect(region(view).text()).toBe('');
    for (const option of options(view)) expect(option.attributes('disabled')).toBeUndefined();

    // The answer reported is the one given to the question that is on screen.
    await options(view)[2]?.trigger('click');
    expect(region(view).text()).toContain('Correct! +');
    await button(view, 'Continue route')?.trigger('click');
    expect(closed(view)).toEqual([[{ status: 'done', data: { answerIndex: 2, locale: 'en' } }]]);
  });

  it('keeps the answer when the switch leaves the same card on screen', async () => {
    const view = mountSheet();
    await options(view)[1]?.trigger('click');

    applyLocale('en');
    await flushPromises();
    expect(view.get('.trivia__question').text()).toBe('¿Quién conquistó el castillo?');
    expect(region(view).text()).toContain(`Correct! +${CARD_QUIZ_POINTS} pts`);
    for (const option of options(view)) expect(option.attributes('disabled')).toBeDefined();
    await button(view, 'Continue route')?.trigger('click');
    expect(closed(view)).toEqual([[{ status: 'done', data: { answerIndex: 1, locale: 'es' } }]]);
  });
});

describe('the preview ("Ver ficha" in the creator)', () => {
  it('has no arrival kicker, and a single Close in the footer', () => {
    const arrival = mountSheet();
    expect(arrival.find('.kicker').exists()).toBe(true);
    expect(arrival.text()).toContain('Llegaste · Punto 2 de 4');

    const view = mountSheet({ preview: true });
    expect(view.find('.kicker').exists()).toBe(false);
    expect(view.text()).not.toContain('Llegaste');
    expect(view.get('h1').text()).toBe('Castelo es');
    expect(view.findAll('footer button').map((candidate) => candidate.text())).toEqual(['Cerrar']);
    expect(button(view, 'Continuar ruta')).toBeUndefined();
    expect(view.find('[aria-label="Más opciones"]').exists()).toBe(false);
  });

  it('keeps the trivia working but reports nothing', async () => {
    const view = mountSheet({ preview: true });
    await options(view)[1]?.trigger('click');
    expect(region(view).text()).toContain(`¡Correcto! +${CARD_QUIZ_POINTS} pts`);
    expect(closed(view)).toBeUndefined();

    await button(view, 'Cerrar')?.trigger('click');
    // `close` with no outcome: nothing to score, nothing to decide.
    expect(closed(view)).toEqual([[]]);
  });

  it('closes the same way without an answer, and in the interface language', async () => {
    applyLocale('en');
    const view = mountSheet({ preview: true, content: { en: card('en') }, sourceLocale: 'en' });
    expect(view.findAll('footer button').map((candidate) => candidate.text())).toEqual(['Close']);
    await button(view, 'Close')?.trigger('click');
    expect(closed(view)).toEqual([[]]);
  });
});

describe('the ai_template handler on the overlay stack', () => {
  let host: VueWrapper | null = null;

  /** The run's real wiring: the handler presents the card through the ui store. */
  function run(content: LocalizedContent) {
    const pinia = createPinia();
    setActivePinia(pinia);
    host = mount(OverlayHost, { global: { plugins: [pinia, i18n] }, attachTo: document.body });
    const ui = useUiStore();
    const context = {
      route: { locale: 'es', points: [{}, {}, {}, {}] },
      point: { id: 'castelo', name: 'Castelo', order: 2, category: 'monument' },
      content: async () => content,
      ui: {
        present: (view: string, props: Record<string, unknown>, options?: object) =>
          ui.present(view, props, { ...options, sourceLocale: 'es' }),
      },
      signal: new AbortController().signal,
    } as unknown as HandlerContext;
    return aiTemplateHandler.run({ contentRef: 'castelo' }, context);
  }

  const pick = async (index: number) => {
    await vi.waitFor(() => expect(document.querySelector('.trivia')).not.toBeNull());
    document.querySelectorAll<HTMLButtonElement>('.trivia__option')[index]?.click();
    await flushPromises();
  };
  const proceed = (name: string) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)?.click();

  afterEach(() => {
    host?.unmount();
    host = null;
  });

  it('scores the right answer', async () => {
    const result = run({ es: card('es') });
    await pick(1);
    proceed('Continuar ruta');
    expect(await result).toEqual({
      status: 'done',
      score: CARD_QUIZ_POINTS,
      data: { answerIndex: 1, correct: true },
    });
  });

  it('scores a wrong one nothing, even with the language switched to another card', async () => {
    const result = run({ es: card('es'), en: card('en') });
    await pick(0);
    proceed('Continuar ruta');
    expect(await result).toEqual({
      status: 'done',
      score: 0,
      data: { answerIndex: 0, correct: false },
    });
  });

  it('gives no score when the question was left alone', async () => {
    const result = run({ es: card('es') });
    await vi.waitFor(() => expect(document.querySelector('.trivia')).not.toBeNull());
    proceed('Continuar ruta');
    expect(await result).toEqual({ status: 'done' });
  });

  it('keeps the pause decision together with the score', async () => {
    const result = run({ es: card('es') });
    await pick(1);
    document.querySelector<HTMLButtonElement>('.footer__more')?.click();
    await flushPromises();
    proceed('Pausar recorrido');
    expect(await result).toEqual({
      status: 'done',
      decision: 'pause',
      score: CARD_QUIZ_POINTS,
      data: { answerIndex: 1, correct: true },
    });
  });
});
