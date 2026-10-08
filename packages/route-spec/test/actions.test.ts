import { describe, expect, it } from 'vitest';
import {
  AiTemplateParamsSchema,
  DecisionParamsSchema,
  InfoSheetParamsSchema,
  INTERRUPTIONS,
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
