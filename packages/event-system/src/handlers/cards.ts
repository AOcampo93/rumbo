import {
  type AiTemplateParams,
  AiTemplateParamsSchema,
  type InfoSheetParams,
  InfoSheetParamsSchema,
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

/**
 * The generated card of a user route (§12). Without its content it fails, so
 * the dispatcher shows the basic sheet instead and the route goes on.
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
    return fromOutcome(outcome);
  },
};
