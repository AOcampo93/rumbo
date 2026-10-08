import { destination } from '@rumbo/geo-utils';
import {
  ACTION_LIMITS,
  QuizParamsSchema,
  RedirectParamsSchema,
  type RouteSpec,
  ToastParamsSchema,
  USER_QUIZ_POINTS,
  validateRouteSpec,
  VideoParamsSchema,
} from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_LIMITS,
  ARRIVAL_TYPES,
  type ArrivalChoice,
  arrivalTypeOf,
  buildRouteSpec,
  CHECK_MESSAGE_KEY,
  DRAFT_LIMITS,
  draftFromSpec,
  type DraftPlace,
  emptyArrival,
  parseYoutubeId,
  RouteBuildError,
  type RouteDraft,
  validateArrival,
  validateDraft,
} from '../src/index.ts';

const start = { lat: 39.7476, lng: -8.807 };

/** `count` places 300 m apart, heading east, with the arrivals given (default: the card). */
function places(count: number, arrivals: Array<ArrivalChoice | undefined> = []): DraftPlace[] {
  return Array.from({ length: count }, (_, i) => ({
    tempId: `t${i + 1}`,
    name: `Place ${i + 1}`,
    position: destination(start, 90, i * 300),
    ...(arrivals[i] ? { arrival: arrivals[i] } : {}),
  }));
}

function draft(
  arrivals: Array<ArrivalChoice | undefined>,
  extra: Partial<RouteDraft> = {},
): RouteDraft {
  return {
    name: 'Leiria con sorpresas',
    locale: 'es',
    mode: 'free',
    activity: 'walk',
    places: places(Math.max(arrivals.length, 2), arrivals),
    ...extra,
  };
}

/** The action a place shows on arrival. */
const actionOf = (spec: RouteSpec, i: number) =>
  spec.actions[spec.points[i]?.triggers?.onEnter as string];

const build = (d: RouteDraft) => buildRouteSpec(d, { source: 'user', idFactory: () => 'abc123' });

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
const ALL: ArrivalChoice[] = [{ type: 'card' }, { type: 'basic' }, QUIZ, VIDEO, LINK, CHECK];

describe('parseYoutubeId', () => {
  const ID = 'dQw4w9WgXcQ';

  it('takes the id itself, with the spaces a paste brings', () => {
    expect(parseYoutubeId(ID)).toBe(ID);
    expect(parseYoutubeId(`  ${ID}\n`)).toBe(ID);
    expect(parseYoutubeId('a_b-c123456')).toBe('a_b-c123456');
  });

  it('finds it in the links people copy', () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/watch?feature=share&v=${ID}&t=42s`,
      `http://youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}&list=RDAMVM${ID}`,
      `youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=AbCdEf`,
      `https://www.youtube.com/embed/${ID}?start=10`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}?feature=share`,
      `https://www.youtube.com/v/${ID}#t=5`,
      `HTTPS://WWW.YOUTUBE.COM/WATCH?v=${ID}`,
      `https://www.youtube.com:443/watch?v=${ID}`,
    ]) {
      expect(parseYoutubeId(link), link).toBe(ID);
    }
  });

  it('refuses everything that is not a video', () => {
    for (const text of [
      '',
      '   ',
      'dQw4w9WgXc', // 10 characters
      'dQw4w9WgXcQ1', // 12 characters
      'dQw4w9Wg XcQ',
      'https://www.youtube.com/watch',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/playlist?list=PL12345',
      'https://youtu.be/',
      'https://youtu.be/short',
      'https://www.youtube.com/embed/',
      `https://notyoutube.com/watch?v=${ID}`,
      `https://youtube.com.evil.example/watch?v=${ID}`,
      `https://vimeo.com/${ID}`,
      `javascript:alert('${ID}')`,
    ]) {
      expect(parseYoutubeId(text), text).toBeNull();
    }
  });
});

describe('emptyArrival and arrivalTypeOf', () => {
  it('makes a blank arrival of every type, which only the types with fields complain about', () => {
    expect(ARRIVAL_TYPES.map((type) => emptyArrival(type))).toEqual([
      { type: 'card' },
      { type: 'basic' },
      { type: 'quiz', question: '', options: ['', ''], correctIndex: 0 },
      { type: 'video', youtubeId: '' },
      { type: 'link', url: '', label: '' },
      { type: 'check' },
    ]);
    expect(ARRIVAL_TYPES.map((type) => validateArrival(emptyArrival(type)).length > 0)).toEqual([
      false,
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it("reads a place's type, the card when it has none", () => {
    expect(arrivalTypeOf({})).toBe('card');
    expect(arrivalTypeOf({ arrival: undefined })).toBe('card');
    expect(arrivalTypeOf({ arrival: QUIZ })).toBe('quiz');
  });

  it('shares its limits with the draft and with the action schemas', () => {
    expect(DRAFT_LIMITS.arrival).toBe(ARRIVAL_LIMITS);
    expect(ARRIVAL_LIMITS.question).toBe(ACTION_LIMITS.quiz.question);
    expect(ARRIVAL_LIMITS.linkLabel).toBe(ACTION_LIMITS.redirectLabel);
  });
});

describe('validateArrival', () => {
  it('accepts every complete arrival, and the ones that need nothing', () => {
    for (const arrival of ALL) expect(validateArrival(arrival)).toEqual([]);
    expect(validateArrival(undefined)).toEqual([]);
    const { question, option, explanation } = ARRIVAL_LIMITS;
    expect(
      validateArrival({
        type: 'quiz',
        question: 'q'.repeat(question),
        options: ['a'.repeat(option), '😀'.repeat(option), 'c', 'd'],
        correctIndex: 3,
        explanation: 'e'.repeat(explanation),
      }),
    ).toEqual([]);
  });

  it('asks a quiz for its question, 2 to 4 answers and a right one among them', () => {
    const quiz = (change: Partial<Extract<ArrivalChoice, { type: 'quiz' }>>): ArrivalChoice => ({
      ...(QUIZ as Extract<ArrivalChoice, { type: 'quiz' }>),
      ...change,
    });
    expect(validateArrival(quiz({ question: ' \t\u0000 ' }))).toEqual([
      'arrival_question_required',
    ]);
    expect(validateArrival(quiz({ question: 'q'.repeat(ARRIVAL_LIMITS.question + 1) }))).toEqual([
      'arrival_question_too_long',
    ]);
    expect(validateArrival(quiz({ options: ['solo'], correctIndex: 0 }))).toEqual([
      'arrival_options_count',
    ]);
    expect(validateArrival(quiz({ options: ['a', 'b', 'c', 'd', 'e'], correctIndex: 0 }))).toEqual([
      'arrival_options_count',
    ]);
    expect(validateArrival(quiz({ options: ['a', '  '] }))).toEqual(['arrival_option_required']);
    expect(
      validateArrival(quiz({ options: ['a'.repeat(ARRIVAL_LIMITS.option + 1), 'b'] })),
    ).toEqual(['arrival_option_too_long']);
    for (const correctIndex of [-1, 3, 0.5, Number.NaN]) {
      expect(validateArrival(quiz({ correctIndex })), String(correctIndex)).toEqual([
        'arrival_correct_invalid',
      ]);
    }
    expect(
      validateArrival(quiz({ explanation: 'e'.repeat(ARRIVAL_LIMITS.explanation + 1) })),
    ).toEqual(['arrival_explanation_too_long']);
  });

  it('counts a problem once, however many answers have it', () => {
    expect(
      validateArrival({
        type: 'quiz',
        question: '',
        options: ['', '', ''],
        correctIndex: 9,
      }),
    ).toEqual(['arrival_question_required', 'arrival_option_required', 'arrival_correct_invalid']);
  });

  it('asks a video for an 11-character id and a title that fits', () => {
    expect(validateArrival({ type: 'video', youtubeId: 'short' })).toEqual([
      'arrival_video_invalid',
    ]);
    expect(validateArrival({ type: 'video', youtubeId: 'https://youtu.be/dQw4w9WgXcQ' })).toEqual([
      'arrival_video_invalid',
    ]);
    expect(
      validateArrival({
        type: 'video',
        youtubeId: 'dQw4w9WgXcQ',
        title: 't'.repeat(ARRIVAL_LIMITS.videoTitle + 1),
      }),
    ).toEqual(['arrival_video_title_too_long']);
  });

  it('asks a link for a full https address and a label', () => {
    const link = (url: string, label = 'Agenda'): ArrivalChoice => ({ type: 'link', url, label });
    expect(validateArrival(link(' https://example.org/a?b=1#c '))).toEqual([]);
    for (const url of [
      '',
      'example.org',
      'http://example.org',
      'https:/example.org',
      'javascript:alert(1)',
      'https://user:pass@example.org',
      'https://visitleiria.pt@example.org/agenda',
      'https://example.org/a b',
      `https://example.org/${'x'.repeat(ARRIVAL_LIMITS.linkUrl)}`,
    ]) {
      expect(validateArrival(link(url)), url).toEqual(['arrival_link_invalid']);
    }
    expect(validateArrival(link('https://example.org', ' '))).toEqual([
      'arrival_link_label_required',
    ]);
    expect(
      validateArrival(link('https://example.org', 'l'.repeat(ARRIVAL_LIMITS.linkLabel + 1))),
    ).toEqual(['arrival_link_label_too_long']);
    expect(validateArrival(link('', ''))).toEqual([
      'arrival_link_invalid',
      'arrival_link_label_required',
    ]);
  });
});

describe('buildRouteSpec: what each arrival becomes', () => {
  it("a card, or nothing chosen, keeps today's behaviour: the AI card when there is one", () => {
    const withCards = (arrivals: Array<ArrivalChoice | undefined>) =>
      places(2, arrivals).map((place) => ({ ...place, contentRef: `card-${place.tempId}` }));
    const { spec } = build(draft([], { places: withCards([{ type: 'card' }, { type: 'card' }]) }));
    expect(spec.points.map((point) => point.contentRef)).toEqual(['card-t1', 'card-t2']);
    expect(actionOf(spec, 0)).toEqual({ type: 'ai_template', params: { contentRef: 'card-t1' } });
    // The default and the explicit card make the same route.
    expect(build(draft([], { places: withCards([]) })).spec).toStrictEqual(spec);
    // Without a card, the basic sheet.
    expect(actionOf(build(draft([{ type: 'card' }])).spec, 0)).toEqual({
      type: 'info_sheet',
      params: { title: 'Place 1' },
    });
  });

  it('"basic" is the sheet with the name and the address, without the card', () => {
    const basic = places(2, [{ type: 'basic' }]).map((place) => ({
      ...place,
      address: 'Largo da Sé',
      contentRef: 'card-t1',
    }));
    const { spec } = build(draft([], { places: basic }));
    expect(actionOf(spec, 0)).toEqual({
      type: 'info_sheet',
      params: { title: 'Place 1', body: 'Largo da Sé' },
    });
    expect(spec.points[0]).not.toHaveProperty('contentRef');
  });

  it('a quiz is worth 10 points and holds the texts cleaned', () => {
    const messy: ArrivalChoice = {
      type: 'quiz',
      question: '  ¿Quién\tlo\nconquistó? ',
      options: [' Afonso ', 'Dinis\u0000 I'],
      correctIndex: 1,
      explanation: '   ',
    };
    const { spec } = build(draft([messy]));
    expect(actionOf(spec, 0)).toEqual({
      type: 'quiz',
      params: {
        question: '¿Quién lo conquistó?',
        options: ['Afonso', 'Dinis I'],
        correctIndex: 1,
        points: USER_QUIZ_POINTS,
      },
    });
    expect(USER_QUIZ_POINTS).toBe(10);
    expect(actionOf(build(draft([QUIZ])).spec, 0)?.params).toMatchObject({
      explanation: 'Lo tomó a los musulmanes en 1135.',
    });
  });

  it('a video is a YouTube video with its title, if any', () => {
    expect(actionOf(build(draft([VIDEO])).spec, 0)).toEqual({
      type: 'video',
      params: { provider: 'youtube', id: 'dQw4w9WgXcQ', title: 'El castillo' },
    });
    expect(actionOf(build(draft([{ type: 'video', youtubeId: 'dQw4w9WgXcQ' }])).spec, 0)).toEqual({
      type: 'video',
      params: { provider: 'youtube', id: 'dQw4w9WgXcQ' },
    });
  });

  it('a link is a redirect, and a check is the arrival notice with the place name', () => {
    expect(actionOf(build(draft([{ ...LINK, url: ' https://example.org/x ' }])).spec, 0)).toEqual({
      type: 'redirect',
      params: { url: 'https://example.org/x', label: 'Agenda de Leiria' },
    });
    expect(actionOf(build(draft([CHECK])).spec, 0)).toEqual({
      type: 'toast',
      params: { messageKey: CHECK_MESSAGE_KEY },
    });
    expect(CHECK_MESSAGE_KEY).toBe('run.arrivedAt');
  });

  it('makes valid routes with one action per place plus the decisions, whatever the mix', () => {
    const { spec, normalized, warnings } = build(draft(ALL));
    expect(validateRouteSpec(spec).ok).toBe(true);
    expect(warnings).toEqual([]);
    expect(normalized.points.map((point) => point.triggers.onEnter)).toEqual(
      spec.points.map((point) => `content_${point.id}`),
    );
    expect(Object.keys(spec.actions)).toHaveLength(ALL.length + 4);
    expect(spec.points.map((_, i) => actionOf(spec, i)?.type)).toEqual([
      'info_sheet',
      'info_sheet',
      'quiz',
      'video',
      'redirect',
      'toast',
    ]);
  });

  it('writes params the event system accepts, which are the ones the API checks', () => {
    const { spec } = build(draft([QUIZ, VIDEO, LINK, CHECK]));
    const schemas = [QuizParamsSchema, VideoParamsSchema, RedirectParamsSchema, ToastParamsSchema];
    schemas.forEach((schema, i) => {
      expect(schema.safeParse(actionOf(spec, i)?.params).success).toBe(true);
    });
  });

  it('refuses an arrival that could not run, saying which place', () => {
    const broken = draft([undefined, { ...QUIZ, options: ['solo'] } as ArrivalChoice]);
    let caught: unknown;
    try {
      build(broken);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RouteBuildError);
    expect((caught as RouteBuildError).issues).toEqual([
      { path: 'places[1].arrival', code: 'schema', message: 'arrival_options_count' },
    ]);
    expect((caught as RouteBuildError).message).toContain('places[1].arrival');
    expect(() => build(draft([{ type: 'link', url: 'http://example.org', label: 'x' }]))).toThrow(
      RouteBuildError,
    );
  });

  it('shares no text array with the draft', () => {
    const source = draft([{ ...QUIZ, options: ['a', 'b'] } as ArrivalChoice]);
    const { spec } = build(source);
    (source.places[0]?.arrival as Extract<ArrivalChoice, { type: 'quiz' }>).options.push('c');
    expect((actionOf(spec, 0)?.params as { options: string[] }).options).toEqual(['a', 'b']);
  });
});

describe('draftFromSpec: what an arrival reads back as', () => {
  const rebuild = (d: RouteDraft, id: string) => buildRouteSpec(d, { source: 'user', id });

  it('gives back the route it came from, whatever each place picked', () => {
    const { spec } = build(draft(ALL));
    const again = rebuild(draftFromSpec(spec), spec.id).spec;
    expect(again).toStrictEqual(spec);
    expect(validateRouteSpec(again).ok).toBe(true);
  });

  it('brings the quiz, the video, the link and the check back as the choices', () => {
    const { spec } = build(draft(ALL));
    const result = draftFromSpec(spec);
    // A card and a basic sheet can't be told apart in a saved route: both read back as the default.
    expect(result.places.map((place) => place.arrival)).toEqual([
      undefined,
      undefined,
      QUIZ,
      VIDEO,
      LINK,
      CHECK,
    ]);
    expect(result.places[0]).not.toHaveProperty('arrival');
  });

  it('keeps the point and action ids when a place changes what it shows', () => {
    const { spec } = build(draft([undefined, undefined]));
    const edited = draftFromSpec(spec);
    edited.places[0] = { ...edited.places[0]!, arrival: QUIZ };
    edited.places[1] = { ...edited.places[1]!, arrival: CHECK };
    const changed = rebuild(edited, spec.id).spec;
    expect(changed.points.map((point) => point.id)).toEqual(spec.points.map((point) => point.id));
    expect(changed.points.map((point) => point.triggers?.onEnter)).toEqual(
      spec.points.map((point) => point.triggers?.onEnter),
    );
    expect(actionOf(changed, 0)?.type).toBe('quiz');
  });

  it("writes texts in the route's language when the actions came with several", () => {
    const { spec } = build(draft([QUIZ, VIDEO, LINK]));
    const [quiz, video, link] = spec.points.map((point) => spec.actions[point.triggers!.onEnter!]!);
    quiz!.params = {
      question: { en: 'Who conquered it?', es: '¿Quién lo conquistó?' },
      options: [{ en: 'Afonso', es: 'Alfonso' }, 'Dinis'],
      correctIndex: 0,
      points: 10,
      explanation: { pt: 'Em 1135.' },
    };
    video!.params = { provider: 'youtube', id: 'dQw4w9WgXcQ', title: { pt: 'O castelo' } };
    link!.params = { url: 'https://example.org', label: { en: 'Agenda', es: 'Agenda local' } };
    const [first, second, third] = draftFromSpec(spec).places.map((place) => place.arrival);
    expect(first).toEqual({
      type: 'quiz',
      question: '¿Quién lo conquistó?',
      options: ['Alfonso', 'Dinis'],
      correctIndex: 0,
      explanation: 'Em 1135.',
    });
    expect(second).toEqual({ type: 'video', youtubeId: 'dQw4w9WgXcQ', title: 'O castelo' });
    expect(third).toEqual({ type: 'link', url: 'https://example.org', label: 'Agenda local' });
  });

  it('leaves out an action it cannot edit: the place goes back to the default', () => {
    const { spec } = build(draft([QUIZ, VIDEO, LINK, CHECK, QUIZ, QUIZ, QUIZ]));
    const action = (i: number) => spec.actions[spec.points[i]!.triggers!.onEnter!]!;
    action(0).params = {
      question: 'Sin respuestas',
      options: ['solo'],
      correctIndex: 0,
      points: 10,
    };
    action(1).params = { provider: 'file', url: 'https://example.org/v.mp4' };
    action(2).params = { url: 'not a link', label: 'x' };
    action(3).params = { message: 'Otro aviso' };
    action(4).type = 'three_scene';
    spec.points[5]!.triggers = { onEnter: 'missing_action' };
    delete spec.points[6]!.triggers;
    expect(draftFromSpec(spec).places.map((place) => place.arrival)).toEqual(
      Array(7).fill(undefined),
    );
  });
});

describe('validateDraft: the arrival of each place', () => {
  const codes = (d: RouteDraft) => validateDraft(d).map((issue) => `${issue.code}@${issue.field}`);

  it('accepts a draft where every place picked something complete', () => {
    expect(validateDraft(draft(ALL))).toEqual([]);
  });

  it('points at the place whose arrival is incomplete', () => {
    expect(
      codes(
        draft([
          undefined,
          { type: 'quiz', question: '', options: ['', ''], correctIndex: 0 },
          { type: 'video', youtubeId: '' },
          { type: 'link', url: '', label: '' },
        ]),
      ),
    ).toEqual([
      'arrival_question_required@places.1',
      'arrival_option_required@places.1',
      'arrival_video_invalid@places.2',
      'arrival_link_invalid@places.3',
      'arrival_link_label_required@places.3',
    ]);
  });

  it('passes every draft whose arrivals are valid on to buildRouteSpec', () => {
    const full = draft(ALL);
    expect(validateDraft(full)).toEqual([]);
    expect(() => build(full)).not.toThrow();
  });
});
