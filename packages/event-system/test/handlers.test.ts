import type { AnyEngineEvent, EngineState } from '@rumbo/geo-engine';
import type { LocalizedContent, PointContent } from '@rumbo/route-spec';
import { describe, expect, it, vi } from 'vitest';
import {
  type ActionHandler,
  aiTemplateHandler,
  BUILTIN_ACTION_TYPES,
  decisionHandler,
  type HandlerContext,
  infoSheetHandler,
  quizHandler,
  redirectHandler,
  threeSceneHandler,
  toastHandler,
  validateActionParams,
  videoHandler,
  type ViewOutcome,
} from '../src/index.ts';
import {
  abortController,
  ARRIVAL,
  baseState,
  createFakeFeedback,
  createFakeUi,
  route,
} from './harness.ts';

const CARD: PointContent = {
  id: 'castelo',
  locale: 'pt',
  title: 'Castelo de Leiria',
  summary: 'Um castelo sobre a cidade.',
  facts: [],
  images: [],
  sources: [],
  status: 'approved',
};

function event(type: string, data: unknown, state: EngineState = baseState()): AnyEngineEvent {
  return {
    id: 'e1',
    type,
    trigger: null,
    pointId: type === 'enter' ? 'p1' : null,
    timestamp: 0,
    data,
    state,
  } as AnyEngineEvent;
}

interface ContextOptions {
  /** What every view resolves with; undefined is a swipe away. */
  outcome?: ViewOutcome;
  event?: AnyEngineEvent;
  contents?: Record<string, LocalizedContent>;
  confirm?: boolean;
}

/** A handler context for p1 of the test route, with a UI that answers right away. */
function setup(options: ContextOptions = {}) {
  const spec = route();
  const fake = createFakeUi(() => options.outcome);
  fake.setConfirm(options.confirm ?? true);
  const controller = abortController();
  const ev = options.event ?? event('enter', ARRIVAL);
  const toast = vi.spyOn(fake.ui, 'toast');
  const context: HandlerContext = {
    event: ev,
    route: spec,
    point: spec.points.find((p) => p.id === ev.pointId) ?? null,
    action: { id: 'a1', type: 'test' },
    content: async (ref) => options.contents?.[ref] ?? null,
    ui: fake.ui,
    feedback: createFakeFeedback(),
    analytics: vi.fn(),
    signal: controller.signal,
  };
  return { ...fake, context, controller, toast };
}

/** Params as the dispatcher passes them: after the handler's own schema. */
function parse<P>(handler: ActionHandler<P>, raw: unknown): P {
  if (!handler.paramsSchema) throw new Error(`${handler.type} has no schema`);
  return handler.paramsSchema.parse(raw);
}

const accepts = <P>(handler: ActionHandler<P>, raw: unknown) =>
  handler.paramsSchema?.safeParse(raw).success;

describe('info_sheet', () => {
  it("shows the point's card, titled with its name by default", async () => {
    const t = setup({ outcome: { decision: 'pause' }, contents: { castelo: { pt: CARD } } });
    const result = await infoSheetHandler.run(
      parse(infoSheetHandler, { contentRef: 'castelo' }),
      t.context,
    );
    expect(t.opened[0]).toMatchObject({
      view: 'info_sheet',
      variant: 'sheet',
      props: {
        pointId: 'p1',
        name: 'P1',
        order: 1,
        total: 2,
        locale: 'es',
        title: 'P1',
        body: null,
        content: { pt: CARD },
      },
    });
    expect(t.opened[0]?.signal).toBe(t.context.signal);
    expect(result).toEqual({ status: 'done', decision: 'pause' });
  });

  it('uses its own texts, in every language given', async () => {
    const title = { es: 'El castillo', en: 'The castle', pt: 'O castelo' };
    const t = setup({ outcome: { status: 'dismissed' } });
    const params = parse(infoSheetHandler, { title, body: { es: 'Texto', en: 'Text' } });
    expect(await infoSheetHandler.run(params, t.context)).toEqual({ status: 'dismissed' });
    expect(t.opened[0]?.props).toMatchObject({ title, body: { es: 'Texto', en: 'Text' } });
  });

  it('a swipe away is dismissed', async () => {
    const t = setup({ outcome: undefined });
    expect(await infoSheetHandler.run({}, t.context)).toEqual({ status: 'dismissed' });
  });

  it('rejects unknown params', () => {
    expect(accepts(infoSheetHandler, { titel: 'typo' })).toBe(false);
  });
});

describe('ai_template', () => {
  it('shows the generated card in every language it has', async () => {
    const t = setup({ outcome: { data: { liked: true } }, contents: { castelo: { pt: CARD } } });
    const result = await aiTemplateHandler.run({ contentRef: 'castelo' }, t.context);
    expect(t.opened[0]).toMatchObject({ view: 'ai_template', props: { content: { pt: CARD } } });
    expect(result).toEqual({ status: 'done', data: { liked: true } });
  });

  it('fails without its content, so the dispatcher falls back', async () => {
    const t = setup({ contents: { empty: {} } });
    expect(await aiTemplateHandler.run({ contentRef: 'missing' }, t.context)).toEqual({
      status: 'failed',
    });
    expect(await aiTemplateHandler.run({ contentRef: 'empty' }, t.context)).toEqual({
      status: 'failed',
    });
    expect(t.opened).toEqual([]);
  });

  it('needs a contentRef', () => {
    expect(accepts(aiTemplateHandler, {})).toBe(false);
  });
});

describe('quiz', () => {
  const quiz = {
    question: { es: '¿En qué siglo?', en: 'Which century?', pt: 'Em que século?' },
    options: ['XII', 'XV', 'XVIII'],
    correctIndex: 0,
    points: 50,
  };

  it('scores only the right answer', async () => {
    const right = setup({ outcome: { data: { answerIndex: 0 } } });
    expect(await quizHandler.run(parse(quizHandler, quiz), right.context)).toEqual({
      status: 'done',
      score: 50,
      data: { answerIndex: 0, correct: true },
    });
    expect(right.opened[0]?.props).toMatchObject({
      question: quiz.question,
      options: quiz.options,
    });

    const wrong = setup({ outcome: { data: { answerIndex: 2 }, decision: 'pause' } });
    expect(await quizHandler.run(parse(quizHandler, quiz), wrong.context)).toEqual({
      status: 'done',
      score: 0,
      data: { answerIndex: 2, correct: false },
      decision: 'pause',
    });
  });

  it('is dismissed without an answer', async () => {
    for (const outcome of [undefined, { status: 'dismissed' as const }, { data: {} }]) {
      const t = setup({ ...(outcome ? { outcome } : {}) });
      expect(await quizHandler.run(parse(quizHandler, quiz), t.context)).toEqual({
        status: 'dismissed',
      });
    }
    const t = setup({ outcome: { decision: 'cancel' } });
    expect(await quizHandler.run(parse(quizHandler, quiz), t.context)).toEqual({
      status: 'dismissed',
      decision: 'cancel',
    });
  });

  it('rejects a correctIndex outside the options, and one option alone', () => {
    expect(accepts(quizHandler, { ...quiz, correctIndex: 3 })).toBe(false);
    expect(accepts(quizHandler, { ...quiz, options: ['only'] })).toBe(false);
    expect(accepts(quizHandler, quiz)).toBe(true);
  });
});

describe('video', () => {
  it('passes the video to its view', async () => {
    const t = setup({ outcome: {} });
    const params = parse(videoHandler, { provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(await videoHandler.run(params, t.context)).toEqual({ status: 'done' });
    expect(t.opened[0]).toMatchObject({
      view: 'video',
      props: { provider: 'youtube', id: 'dQw4w9WgXcQ' },
    });
  });

  it('needs an id for YouTube and an http(s) url for a file', () => {
    expect(accepts(videoHandler, { provider: 'youtube' })).toBe(false);
    expect(accepts(videoHandler, { provider: 'youtube', id: 'short' })).toBe(false);
    expect(accepts(videoHandler, { provider: 'file' })).toBe(false);
    expect(accepts(videoHandler, { provider: 'file', url: 'javascript:alert(1)' })).toBe(false);
    expect(accepts(videoHandler, { provider: 'file', url: 'https://example.org/v.mp4' })).toBe(
      true,
    );
  });
});

describe('redirect', () => {
  const params = {
    url: 'https://www.visitleiria.pt/agenda?x=1',
    label: { es: 'Agenda', pt: 'Agenda' },
  };

  it('opens the site only after the user confirms', async () => {
    const t = setup({ confirm: true });
    expect(await redirectHandler.run(parse(redirectHandler, params), t.context)).toEqual({
      status: 'done',
    });
    expect(t.confirms[0]).toEqual({
      title: { key: 'redirect.title' },
      body: { key: 'redirect.body', params: { host: 'www.visitleiria.pt', label: params.label } },
      confirmLabel: { key: 'redirect.open' },
      cancelLabel: { key: 'redirect.later' },
    });
    expect(t.external).toEqual([params.url]);
  });

  it('opens nothing when declined or when the run was cancelled meanwhile', async () => {
    const declined = setup({ confirm: false });
    expect(await redirectHandler.run(parse(redirectHandler, params), declined.context)).toEqual({
      status: 'dismissed',
    });
    const cancelled = setup({ confirm: true });
    cancelled.controller.abort();
    expect(await redirectHandler.run(parse(redirectHandler, params), cancelled.context)).toEqual({
      status: 'dismissed',
    });
    expect([...declined.external, ...cancelled.external]).toEqual([]);
  });

  it('only accepts http(s) links', () => {
    expect(accepts(redirectHandler, { ...params, url: 'javascript:alert(1)' })).toBe(false);
  });
});

describe('three_scene', () => {
  it('shows "coming soon" for now and counts as done', async () => {
    const t = setup({ outcome: undefined });
    await threeSceneHandler.load?.();
    expect(await threeSceneHandler.run({}, t.context)).toEqual({ status: 'done' });
    expect(t.opened[0]).toMatchObject({ view: 'coming_soon', variant: 'fullscreen' });
  });
});

describe('toast', () => {
  it("names the point in an i18n key's params", async () => {
    const t = setup();
    const params = parse(toastHandler, {
      messageKey: 'run.approaching',
      icon: 'map-pin',
      durationMs: 3000,
    });
    expect(await toastHandler.run(params, t.context)).toEqual({ status: 'done' });
    expect(t.toast).toHaveBeenCalledWith(
      { key: 'run.approaching', params: { name: 'P1' } },
      { icon: 'map-pin', durationMs: 3000 },
    );
  });

  it("passes the route's own text as it is, and no name without a point", async () => {
    const message = { es: 'Mira arriba', pt: 'Olhe para cima' };
    const t = setup();
    await toastHandler.run(parse(toastHandler, { message }), t.context);
    expect(t.toast).toHaveBeenLastCalledWith(message, {});

    const away = setup({ event: event('back_on_track', { distanceToRoute: 90 }) });
    await toastHandler.run(parse(toastHandler, { messageKey: 'run.backOnTrack' }), away.context);
    expect(away.toast).toHaveBeenCalledWith({ key: 'run.backOnTrack', params: {} }, {});
  });

  it('needs exactly one of messageKey and message', () => {
    expect(accepts(toastHandler, {})).toBe(false);
    expect(accepts(toastHandler, { messageKey: 'a', message: 'b' })).toBe(false);
    expect(accepts(toastHandler, { messageKey: 'run.approaching', durationMs: 50 })).toBe(false);
  });
});

describe('decision', () => {
  const heading = baseState({
    target: {
      pointId: 'p2',
      order: 2,
      distance: 300,
      bearing: 90,
      etaSeconds: 230,
      inZone: false,
      dwellProgress: 0,
    },
  });

  it('fills the deviation preset with the distance and the target', async () => {
    const t = setup({
      outcome: { decision: 'continue' },
      event: event('deviation', { distanceToRoute: 212, sinceMs: 31_000 }, heading),
    });
    const result = await decisionHandler.run({ preset: 'deviation' }, t.context);
    expect(result).toEqual({ status: 'done', decision: 'continue' });
    expect(t.opened[0]).toMatchObject({
      view: 'decision',
      variant: 'sheet',
      props: {
        preset: 'deviation',
        icon: 'route-off',
        title: { key: 'decision.deviation.title' },
        body: { key: 'decision.deviation.body', params: { distance: 212, name: 'P2' } },
        primary: { key: 'decision.deviation.primary' },
      },
    });
  });

  it('rounds idle time to minutes', async () => {
    const t = setup({ event: event('idle', { idleSeconds: 629 }) });
    await decisionHandler.run({ preset: 'idle' }, t.context);
    expect(t.opened[0]?.props).toMatchObject({
      body: { key: 'decision.idle.body', params: { minutes: 10 } },
    });
  });

  it('names the expected point when out of order', async () => {
    const t = setup({
      event: event('out_of_order', { expectedPointId: 'p1', actualPointId: 'p2' }),
    });
    await decisionHandler.run({ preset: 'out_of_order' }, t.context);
    expect(t.opened[0]?.props).toMatchObject({
      body: { key: 'decision.outOfOrder.body', params: { name: 'P1' } },
      primary: { key: 'decision.outOfOrder.primary', params: { name: 'P1' } },
    });
  });

  it('has a timeout preset', async () => {
    const t = setup({ event: event('timeout', { elapsedMs: 1, timeLimit: 1 }) });
    await decisionHandler.run({ preset: 'timeout' }, t.context);
    expect(t.opened[0]?.props).toMatchObject({
      icon: 'timer-off',
      body: { key: 'decision.timeout.body' },
    });
  });

  it('keeps preset texts harmless when fired by another event', async () => {
    const t = setup({ event: event('started', {}) });
    for (const preset of ['deviation', 'idle', 'out_of_order'] as const) {
      await decisionHandler.run({ preset }, t.context);
    }
    expect(t.opened.map((v) => (v.props.body as { params?: unknown }).params)).toEqual([
      { distance: 0, name: '' },
      { minutes: 0 },
      { name: '' },
    ]);
  });

  it('takes custom texts, with "Continue" as the default primary label', async () => {
    const title = { es: '¿Seguimos?', en: 'Shall we go on?', pt: 'Continuamos?' };
    const t = setup();
    await decisionHandler.run(parse(decisionHandler, { title }), t.context);
    expect(t.opened[0]?.props).toMatchObject({
      preset: null,
      icon: null,
      title,
      body: null,
      primary: { key: 'decision.continue' },
    });
    expect(accepts(decisionHandler, { preset: 'boredom' })).toBe(false);
  });
});

describe('validateActionParams', () => {
  it('reports broken params with their path, so CI catches them', () => {
    const spec = route({
      actions: {
        card: { type: 'info_sheet' },
        q1: {
          type: 'quiz',
          params: { question: '?', options: ['a', 'b'], correctIndex: 2, points: 5 },
        },
        custom: { type: 'hologram', params: { anything: true } },
      },
    });
    expect(validateActionParams(spec)).toEqual([
      expect.objectContaining({ path: 'actions.q1.params.correctIndex', code: 'schema' }),
    ]);
  });

  it('accepts every action of a sound route', () => {
    expect(validateActionParams(route())).toEqual([]);
  });

  it('lists the built-in types', () => {
    expect(BUILTIN_ACTION_TYPES).toEqual([
      'info_sheet',
      'ai_template',
      'video',
      'quiz',
      'redirect',
      'toast',
      'decision',
      'three_scene',
    ]);
  });
});
