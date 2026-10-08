import { describe, expect, it } from 'vitest';
import {
  ACTION_LIMITS,
  AiTemplateParamsSchema,
  DecisionParamsSchema,
  InfoSheetParamsSchema,
  INTERRUPTIONS,
  QuizParamsSchema,
  RedirectParamsSchema,
  ToastParamsSchema,
  USER_QUIZ_POINTS,
  VideoParamsSchema,
  YOUTUBE_ID,
} from '../src/index.ts';

// The event system runs these params and the API checks user routes with
// them; the handlers' own tests cover what each view gets.

describe('action params', () => {
  it('info_sheet: optional texts in any language, nothing unknown', () => {
    expect(InfoSheetParamsSchema.safeParse({}).success).toBe(true);
    expect(
      InfoSheetParamsSchema.safeParse({ title: { es: 'El castillo' }, body: 'Largo da Sé' })
        .success,
    ).toBe(true);
    expect(InfoSheetParamsSchema.safeParse({ titel: 'typo' }).success).toBe(false);
    expect(InfoSheetParamsSchema.safeParse({ title: 'x'.repeat(121) }).success).toBe(false);
    expect(
      InfoSheetParamsSchema.safeParse({ image: { url: 'javascript:alert(1)', alt: 'x' } }).success,
    ).toBe(false);
  });

  it('ai_template: needs the card it shows', () => {
    expect(AiTemplateParamsSchema.safeParse({ contentRef: 'c-castelo' }).success).toBe(true);
    expect(AiTemplateParamsSchema.safeParse({}).success).toBe(false);
  });

  it("decision: an interruption's preset or the route's own question", () => {
    for (const preset of INTERRUPTIONS) {
      expect(DecisionParamsSchema.safeParse({ preset }).success).toBe(true);
    }
    expect(DecisionParamsSchema.safeParse({ preset: 'lunch' }).success).toBe(false);
    expect(
      DecisionParamsSchema.safeParse({ title: '¿Seguimos?', primaryLabel: { es: 'Sí' } }).success,
    ).toBe(true);
    expect(DecisionParamsSchema.safeParse({ preset: 'idle', title: 'Both' }).success).toBe(false);
  });
});

describe('quiz params', () => {
  const quiz = {
    question: { es: '¿Quién conquistó el castillo?', pt: 'Quem conquistou o castelo?' },
    options: ['Afonso Henriques', { es: 'Dinis I' }, 'Joana I'],
    correctIndex: 0,
    points: 50,
    explanation: 'Lo tomó en 1135.',
  };

  it('takes 2 to 4 options in any language and a right answer among them', () => {
    expect(QuizParamsSchema.safeParse(quiz).success).toBe(true);
    expect(
      QuizParamsSchema.safeParse({ ...quiz, options: ['a', 'b'], correctIndex: 1 }).success,
    ).toBe(true);
    expect(
      QuizParamsSchema.safeParse({ ...quiz, options: ['solo'], correctIndex: 0 }).success,
    ).toBe(false);
    expect(
      QuizParamsSchema.safeParse({ ...quiz, options: ['a', 'b', 'c', 'd', 'e'] }).success,
    ).toBe(false);
    expect(QuizParamsSchema.safeParse({ ...quiz, correctIndex: 3 }).success).toBe(false);
    expect(QuizParamsSchema.safeParse({ ...quiz, correctIndex: -1 }).success).toBe(false);
  });

  it('keeps the texts and the points within the limits, and nothing unknown', () => {
    const { question, option, explanation, pointsMax } = ACTION_LIMITS.quiz;
    const limited = {
      question: 'q'.repeat(question),
      options: ['a'.repeat(option), 'b'],
      correctIndex: 1,
      points: pointsMax,
      explanation: 'e'.repeat(explanation),
    };
    expect(QuizParamsSchema.safeParse(limited).success).toBe(true);
    expect(
      QuizParamsSchema.safeParse({ ...limited, question: 'q'.repeat(question + 1) }).success,
    ).toBe(false);
    expect(
      QuizParamsSchema.safeParse({ ...limited, options: ['a'.repeat(option + 1), 'b'] }).success,
    ).toBe(false);
    expect(
      QuizParamsSchema.safeParse({ ...limited, explanation: 'e'.repeat(explanation + 1) }).success,
    ).toBe(false);
    expect(QuizParamsSchema.safeParse({ ...limited, points: pointsMax + 1 }).success).toBe(false);
    expect(QuizParamsSchema.safeParse({ ...limited, points: 2.5 }).success).toBe(false);
    expect(QuizParamsSchema.safeParse({ ...limited, hint: 'typo' }).success).toBe(false);
    expect(USER_QUIZ_POINTS).toBeLessThanOrEqual(pointsMax);
  });
});

describe('video params', () => {
  it('needs an 11-character id for YouTube and an http(s) url for a file', () => {
    expect(VideoParamsSchema.safeParse({ provider: 'youtube', id: 'dQw4w9WgXcQ' }).success).toBe(
      true,
    );
    expect(VideoParamsSchema.safeParse({ provider: 'youtube' }).success).toBe(false);
    expect(VideoParamsSchema.safeParse({ provider: 'youtube', id: 'short' }).success).toBe(false);
    expect(VideoParamsSchema.safeParse({ provider: 'file' }).success).toBe(false);
    expect(
      VideoParamsSchema.safeParse({ provider: 'file', url: 'https://example.org/v.mp4' }).success,
    ).toBe(true);
    expect(
      VideoParamsSchema.safeParse({ provider: 'file', url: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(VideoParamsSchema.safeParse({ provider: 'vimeo', id: 'dQw4w9WgXcQ' }).success).toBe(
      false,
    );
  });

  it('takes a title in any language', () => {
    const video = { provider: 'youtube', id: 'dQw4w9WgXcQ' } as const;
    expect(VideoParamsSchema.safeParse({ ...video, title: { es: 'El castillo' } }).success).toBe(
      true,
    );
    expect(VideoParamsSchema.safeParse({ ...video, title: 'x'.repeat(121) }).success).toBe(false);
  });

  it('exports the id pattern the creator parses links with', () => {
    expect(YOUTUBE_ID.test('dQw4w9WgXcQ')).toBe(true);
    expect(YOUTUBE_ID.test('dQw4w9WgXc')).toBe(false);
    expect(YOUTUBE_ID.test('dQw4w9WgXcQ1')).toBe(false);
    expect(YOUTUBE_ID.test('dQw4w9Wg XcQ')).toBe(false);
  });
});

describe('redirect params', () => {
  it('takes an http(s) url and a label in any language', () => {
    const link = {
      url: 'https://www.visitleiria.pt/agenda',
      label: { es: 'Agenda', pt: 'Agenda' },
    };
    expect(RedirectParamsSchema.safeParse(link).success).toBe(true);
    expect(RedirectParamsSchema.safeParse({ ...link, url: 'http://example.org' }).success).toBe(
      true,
    );
    expect(RedirectParamsSchema.safeParse({ ...link, url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(RedirectParamsSchema.safeParse({ ...link, url: 'not a url' }).success).toBe(false);
    expect(RedirectParamsSchema.safeParse({ url: link.url }).success).toBe(false);
    expect(RedirectParamsSchema.safeParse({ ...link, label: 'x'.repeat(121) }).success).toBe(false);
  });
});

describe('toast params', () => {
  it('needs exactly one of messageKey and message', () => {
    expect(ToastParamsSchema.safeParse({ messageKey: 'run.arrivedAt' }).success).toBe(true);
    expect(ToastParamsSchema.safeParse({ message: { es: 'Mira arriba' } }).success).toBe(true);
    expect(ToastParamsSchema.safeParse({}).success).toBe(false);
    expect(ToastParamsSchema.safeParse({ messageKey: 'a', message: 'b' }).success).toBe(false);
  });

  it('keeps the duration between 1 and 15 seconds, and the icon short', () => {
    const toast = { messageKey: 'run.approaching' };
    expect(
      ToastParamsSchema.safeParse({ ...toast, durationMs: 1000, icon: 'map-pin' }).success,
    ).toBe(true);
    expect(ToastParamsSchema.safeParse({ ...toast, durationMs: 50 }).success).toBe(false);
    expect(ToastParamsSchema.safeParse({ ...toast, durationMs: 15_001 }).success).toBe(false);
    expect(ToastParamsSchema.safeParse({ ...toast, icon: 'i'.repeat(41) }).success).toBe(false);
    expect(ToastParamsSchema.safeParse({ ...toast, sound: 'x' }).success).toBe(false);
  });
});
