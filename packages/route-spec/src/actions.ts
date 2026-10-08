import { z } from 'zod';
import { HttpUrlSchema, localizedText, MediaRefSchema } from './schema.ts';

// Params of the actions a user route is built from. They live next to the
// contract so the event system (which runs them) and the API (which stores
// user routes) check them with one definition. The other action types
// (`three_scene`) keep their schemas in their handlers.

/** Events that interrupt the run with a Continue · Pause · End sheet. */
export const INTERRUPTIONS = ['deviation', 'idle', 'out_of_order', 'timeout'] as const;
export type Interruption = (typeof INTERRUPTIONS)[number];

/** Limits of the texts in the params below, in code points. */
export const ACTION_LIMITS = {
  quiz: {
    question: 300,
    option: 120,
    explanation: 500,
    options: { min: 2, max: 4 },
    pointsMax: 1000,
  },
  videoTitle: 120,
  redirectLabel: 120,
  toastMessage: 200,
  /** The longest link the creator takes (curated routes may have longer ones). */
  userLinkUrl: 2048,
} as const;

/** Points of the quiz the creator writes: the same as a card's trivia question. */
export const USER_QUIZ_POINTS = 10;

/** A YouTube video id: 11 characters. */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * A link a user adds to a route: https only and written out in full, with no
 * spaces and no credentials (`https://visitleiria.pt@elsewhere.com` would show
 * a host that isn't the one that opens), and not endless.
 */
export const UserLinkSchema = z
  .string()
  .max(ACTION_LIMITS.userLinkUrl)
  .regex(
    /^https:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/i,
    'Use a full https:// link without spaces or credentials',
  )
  .pipe(z.url({ protocol: /^https$/ }));

/** `info_sheet`: the universal static sheet. */
export const InfoSheetParamsSchema = z.strictObject({
  /** A card in the bundle; its title and texts win over the fields below. */
  contentRef: z.string().min(1).max(64).optional(),
  title: localizedText({ max: 120 }).optional(),
  body: localizedText({ max: 4000 }).optional(),
  image: MediaRefSchema.optional(),
});

/** `ai_template`: the generated card of a user route. */
export const AiTemplateParamsSchema = z.strictObject({ contentRef: z.string().min(1).max(64) });

/** `decision`: an interruption's preset sheet, or the route's own question. */
export const DecisionParamsSchema = z.union([
  z.strictObject({ preset: z.enum(INTERRUPTIONS) }),
  z.strictObject({
    title: localizedText({ max: 120 }),
    body: localizedText({ max: 500 }).optional(),
    primaryLabel: localizedText({ max: 60 }).optional(),
  }),
]);

/** `quiz`: a question with points; only a right answer scores. */
export const QuizParamsSchema = z
  .strictObject({
    question: localizedText({ max: ACTION_LIMITS.quiz.question }),
    options: z
      .array(localizedText({ max: ACTION_LIMITS.quiz.option }))
      .min(ACTION_LIMITS.quiz.options.min)
      .max(ACTION_LIMITS.quiz.options.max),
    correctIndex: z.number().int().min(0),
    points: z.number().int().min(0).max(ACTION_LIMITS.quiz.pointsMax),
    explanation: localizedText({ max: ACTION_LIMITS.quiz.explanation }).optional(),
  })
  .refine((quiz) => quiz.correctIndex < quiz.options.length, {
    message: 'correctIndex must point to one of the options',
    path: ['correctIndex'],
  });

/** `video`: a video of the place, from YouTube or a file. */
export const VideoParamsSchema = z
  .strictObject({
    provider: z.enum(['youtube', 'file']),
    /** YouTube video id (11 characters). */
    id: z.string().regex(YOUTUBE_ID).optional(),
    url: HttpUrlSchema.optional(),
    title: localizedText({ max: ACTION_LIMITS.videoTitle }).optional(),
  })
  .refine((video) => (video.provider === 'youtube' ? Boolean(video.id) : Boolean(video.url)), {
    message: 'A YouTube video needs an id; a file needs a url',
  });

/** `redirect`: an external website, opened only after the user confirms. */
export const RedirectParamsSchema = z.strictObject({
  url: HttpUrlSchema,
  label: localizedText({ max: ACTION_LIMITS.redirectLabel }),
});

/** `toast`: a short notice that never blocks the run. */
export const ToastParamsSchema = z
  .strictObject({
    /** i18n key; receives the point's `name` as a parameter. */
    messageKey: z.string().min(1).max(80).optional(),
    /** Or the route's own text, in up to three languages. */
    message: localizedText({ max: ACTION_LIMITS.toastMessage }).optional(),
    icon: z.string().max(40).optional(),
    durationMs: z.number().int().min(1000).max(15_000).optional(),
  })
  .refine((toast) => Boolean(toast.messageKey) !== Boolean(toast.message), {
    message: 'Give either messageKey or message',
  });

export type InfoSheetParams = z.infer<typeof InfoSheetParamsSchema>;
export type AiTemplateParams = z.infer<typeof AiTemplateParamsSchema>;
export type DecisionParams = z.infer<typeof DecisionParamsSchema>;
export type QuizParams = z.infer<typeof QuizParamsSchema>;
export type VideoParams = z.infer<typeof VideoParamsSchema>;
export type RedirectParams = z.infer<typeof RedirectParamsSchema>;
export type ToastParams = z.infer<typeof ToastParamsSchema>;
