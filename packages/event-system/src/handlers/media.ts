import { HttpUrlSchema, localizedText } from '@rumbo/route-spec';
import { z } from 'zod';
import type { ActionHandler, ViewOutcome } from '../types.ts';
import { fromOutcome, pointProps } from './shared.ts';

const QuizParams = z
  .strictObject({
    question: localizedText({ max: 300 }),
    options: z
      .array(localizedText({ max: 120 }))
      .min(2)
      .max(4),
    correctIndex: z.number().int().min(0),
    points: z.number().int().min(0).max(1000),
    explanation: localizedText({ max: 500 }).optional(),
  })
  .refine((quiz) => quiz.correctIndex < quiz.options.length, {
    message: 'correctIndex must point to one of the options',
    path: ['correctIndex'],
  });

/**
 * A question with points. The view shows right/wrong and the explanation; it
 * resolves with `data.answerIndex`. Only a right answer scores.
 */
export const quizHandler: ActionHandler<z.infer<typeof QuizParams>> = {
  type: 'quiz',
  paramsSchema: QuizParams,
  async run(params, context) {
    const outcome = await context.ui.present<ViewOutcome>(
      'quiz',
      { ...pointProps(context), ...params },
      { variant: 'sheet', signal: context.signal },
    );
    const answer = (outcome?.data as { answerIndex?: unknown } | undefined)?.answerIndex;
    if (!outcome || outcome.status === 'dismissed' || typeof answer !== 'number') {
      return { status: 'dismissed', ...(outcome?.decision ? { decision: outcome.decision } : {}) };
    }
    const correct = answer === params.correctIndex;
    return {
      status: 'done',
      score: correct ? params.points : 0,
      data: { answerIndex: answer, correct },
      ...(outcome.decision ? { decision: outcome.decision } : {}),
    };
  },
};

const VideoParams = z
  .strictObject({
    provider: z.enum(['youtube', 'file']),
    /** YouTube video id (11 characters). */
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{11}$/)
      .optional(),
    url: HttpUrlSchema.optional(),
    title: localizedText({ max: 120 }).optional(),
  })
  .refine((video) => (video.provider === 'youtube' ? Boolean(video.id) : Boolean(video.url)), {
    message: 'A YouTube video needs an id; a file needs a url',
  });

/** A video of the place; the view handles playback and "Video not available". */
export const videoHandler: ActionHandler<z.infer<typeof VideoParams>> = {
  type: 'video',
  paramsSchema: VideoParams,
  async run(params, context) {
    const outcome = await context.ui.present<ViewOutcome>(
      'video',
      { ...pointProps(context), ...params },
      { variant: 'sheet', signal: context.signal },
    );
    return fromOutcome(outcome);
  },
};

const RedirectParams = z.strictObject({
  url: HttpUrlSchema,
  label: localizedText({ max: 120 }),
});

/** Host of an http(s) URL, for "You're about to open visitleiria.pt". */
function hostOf(url: string): string {
  return /^https?:\/\/([^/?#:]+)/i.exec(url)?.[1] ?? url;
}

/** Opens an external website, always after the user confirms (S06d). */
export const redirectHandler: ActionHandler<z.infer<typeof RedirectParams>> = {
  type: 'redirect',
  paramsSchema: RedirectParams,
  async run(params, context) {
    const confirmed = await context.ui.confirm({
      title: { key: 'redirect.title' },
      body: { key: 'redirect.body', params: { host: hostOf(params.url), label: params.label } },
      confirmLabel: { key: 'redirect.open' },
      cancelLabel: { key: 'redirect.later' },
    });
    if (!confirmed || context.signal.aborted) return { status: 'dismissed' };
    context.ui.openExternal(params.url);
    return { status: 'done' };
  },
};

/** Placeholder until 3D scenes exist (S06f): a "coming soon" screen. */
export const threeSceneHandler: ActionHandler<Record<string, unknown>> = {
  type: 'three_scene',
  paramsSchema: z.record(z.string(), z.unknown()),
  async load() {
    // Three.js will be loaded here lazily; nothing to load for the placeholder.
  },
  async run(_params, context) {
    const outcome = await context.ui.present<ViewOutcome>('coming_soon', pointProps(context), {
      variant: 'fullscreen',
      signal: context.signal,
    });
    return { ...fromOutcome(outcome), status: 'done' };
  },
};
