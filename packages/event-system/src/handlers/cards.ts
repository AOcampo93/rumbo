import {
  type AiTemplateParams,
  AiTemplateParamsSchema,
  type InfoSheetParams,
  InfoSheetParamsSchema,
  LOCALES,
} from '@rumbo/route-spec';
import type { ActionHandler, ViewOutcome } from '../types.ts';
import { fromOutcome, pointProps } from './shared.ts';

// The params schemas live in route-spec: the API checks user routes with them.

/**
 * The universal static sheet: a point's card, or the fallback when another
 * action fails. Always works, even with nothing but the point's name.
 */
export const infoSheetHandler: ActionHandler<InfoSheetParams> = {
  type: 'info_sheet',
  paramsSchema: InfoSheetParamsSchema,
  async run(params, context) {
    const content = params.contentRef ? await context.content(params.contentRef) : null;
    const outcome = await context.ui.present<ViewOutcome>(
      'info_sheet',
      {
        ...pointProps(context),
        title: params.title ?? context.point?.name ?? null,
        body: params.body ?? null,
        image: params.image ?? null,
        content,
      },
      { variant: 'sheet', signal: context.signal },
    );
    return fromOutcome(outcome);
  },
};

/** Points for a card's trivia question answered right. */
export const CARD_QUIZ_POINTS = 10;

/**
 * The generated card of a user route (§12). Without its content it fails, so
 * the dispatcher shows the basic sheet instead and the route goes on. When
 * the card shown has a trivia question, the view reports the answer and the
 * card's language (`data.answerIndex`, `data.locale`) and a right one scores.
 */
export const aiTemplateHandler: ActionHandler<AiTemplateParams> = {
  type: 'ai_template',
  paramsSchema: AiTemplateParamsSchema,
  async run(params, context) {
    const content = await context.content(params.contentRef);
    if (!content || Object.keys(content).length === 0) return { status: 'failed' };
    const outcome = await context.ui.present<ViewOutcome>(
      'ai_template',
      { ...pointProps(context), content },
      { variant: 'sheet', signal: context.signal },
    );
    const result = fromOutcome(outcome);
    const answer = outcome?.data as { answerIndex?: unknown; locale?: unknown } | undefined;
    const locale = LOCALES.find((candidate) => candidate === answer?.locale);
    const quiz = locale ? content[locale]?.quiz : undefined;
    if (!quiz || typeof answer?.answerIndex !== 'number') return result;
    const correct = answer.answerIndex === quiz.correctIndex;
    return {
      ...result,
      score: correct ? CARD_QUIZ_POINTS : 0,
      data: { answerIndex: answer.answerIndex, correct },
    };
  },
};
