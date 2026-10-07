import { localizedText, MediaRefSchema } from '@rumbo/route-spec';
import { z } from 'zod';
import type { ActionHandler, ViewOutcome } from '../types.ts';
import { fromOutcome, pointProps } from './shared.ts';

const InfoSheetParams = z.strictObject({
  /** A card in the bundle; its title and texts win over the fields below. */
  contentRef: z.string().min(1).max(64).optional(),
  title: localizedText({ max: 120 }).optional(),
  body: localizedText({ max: 4000 }).optional(),
  image: MediaRefSchema.optional(),
});

/**
 * The universal static sheet: a point's card, or the fallback when another
 * action fails. Always works, even with nothing but the point's name.
 */
export const infoSheetHandler: ActionHandler<z.infer<typeof InfoSheetParams>> = {
  type: 'info_sheet',
  paramsSchema: InfoSheetParams,
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

const AiTemplateParams = z.strictObject({ contentRef: z.string().min(1).max(64) });

/**
 * The generated card of a user route (§12). Without its content it fails, so
 * the dispatcher shows the basic sheet instead and the route goes on.
 */
export const aiTemplateHandler: ActionHandler<z.infer<typeof AiTemplateParams>> = {
  type: 'ai_template',
  paramsSchema: AiTemplateParams,
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
