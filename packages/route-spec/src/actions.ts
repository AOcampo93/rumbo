import { z } from 'zod';
import { localizedText, MediaRefSchema } from './schema.ts';

// Params of the actions a user route is built from. They live next to the
// contract so the event system (which runs them) and the API (which stores
// user routes) check them with one definition. Other action types keep their
// schemas in their handlers.

/** Events that interrupt the run with a Continue · Pause · End sheet. */
export const INTERRUPTIONS = ['deviation', 'idle', 'out_of_order', 'timeout'] as const;
export type Interruption = (typeof INTERRUPTIONS)[number];

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

export type InfoSheetParams = z.infer<typeof InfoSheetParamsSchema>;
export type AiTemplateParams = z.infer<typeof AiTemplateParamsSchema>;
export type DecisionParams = z.infer<typeof DecisionParamsSchema>;
