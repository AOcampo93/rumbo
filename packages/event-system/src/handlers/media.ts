import {
  type QuizParams,
  QuizParamsSchema,
  type RedirectParams,
  RedirectParamsSchema,
  type VideoParams,
  VideoParamsSchema,
} from '@rumbo/route-spec';
import { z } from 'zod';
import type { ActionHandler, ViewOutcome } from '../types.ts';
import { fromOutcome, pointProps } from './shared.ts';

// The params schemas live in route-spec: the API checks user routes with them.

/**
 * A question with points. The view shows right/wrong and the explanation; it
 * resolves with `data.answerIndex`. Only a right answer scores.
 */
export const quizHandler: ActionHandler<QuizParams> = {
  type: 'quiz',
  paramsSchema: QuizParamsSchema,
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

/** A video of the place; the view handles playback and "Video not available". */
export const videoHandler: ActionHandler<VideoParams> = {
  type: 'video',
  paramsSchema: VideoParamsSchema,
  async run(params, context) {
    const outcome = await context.ui.present<ViewOutcome>(
      'video',
      { ...pointProps(context), ...params },
      { variant: 'sheet', signal: context.signal },
    );
    return fromOutcome(outcome);
  },
};

/** Host of an http(s) URL, for "You're about to open visitleiria.pt". */
function hostOf(url: string): string {
  return /^https?:\/\/([^/?#:]+)/i.exec(url)?.[1] ?? url;
}

/** Opens an external website, always after the user confirms (S06d). */
export const redirectHandler: ActionHandler<RedirectParams> = {
  type: 'redirect',
  paramsSchema: RedirectParamsSchema,
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
