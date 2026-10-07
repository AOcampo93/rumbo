import { z } from 'zod';
import { fallbackChain, type Locale } from './locale.ts';
import { HttpUrlSchema, LocaleSchema, MediaRefSchema } from './schema.ts';

/** Markdown only: raw HTML in a card could inject markup, so it is rejected. */
const MarkdownSchema = z
  .string()
  .max(10_000)
  .refine((text) => !/<\/?[a-z][^>]*>/i.test(text), 'HTML is not allowed; use Markdown');

/**
 * A place's card (docs/PROJECT_PLAN.md §6.4), in a single language. The AI
 * generates only data in this shape, never UI.
 */
export const PointContentSchema = z.strictObject({
  /** Equals the contentRef that points to it. */
  id: z.string().min(1).max(64),
  locale: LocaleSchema,
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(120).optional(),
  /** Two to four sentences. */
  summary: z.string().trim().min(1).max(800),
  body: MarkdownSchema.optional(),
  /** Up to six short facts. */
  facts: z.array(z.string().trim().min(1).max(160)).max(6),
  /** Real photos (Wikimedia Commons) with author and licence; never generated. */
  images: z.array(MediaRefSchema).max(10),
  video: z
    .strictObject({
      provider: z.enum(['youtube', 'file']),
      id: z.string().max(64).optional(),
      url: HttpUrlSchema.optional(),
      title: z.string().max(120).optional(),
    })
    .optional(),
  tip: z.string().trim().max(200).optional(),
  /** Sources the text was grounded on. */
  sources: z.array(
    z.strictObject({ title: z.string().trim().min(1).max(200), url: HttpUrlSchema }),
  ),
  generated: z
    .strictObject({
      by: z.enum(['ai', 'human']),
      model: z.string().max(100).optional(),
      promptVersion: z.string().max(40).optional(),
      at: z.iso.datetime(),
    })
    .optional(),
  status: z.enum(['draft', 'approved']),
});

export type PointContent = z.infer<typeof PointContentSchema>;

/** One card per language, keyed by locale. */
export type LocalizedContent = Partial<Record<Locale, PointContent>>;

export interface ResolvedContent {
  content: PointContent;
  locale: Locale;
  /** True when the card is not in the requested language; the UI says so. */
  isFallback: boolean;
}

/** Picks the card for `locale`, falling back like resolveText. Null when there is none. */
export function resolveContent(
  entry: LocalizedContent | undefined,
  locale: Locale,
  sourceLocale: Locale,
): ResolvedContent | null {
  if (!entry) return null;
  for (const candidate of fallbackChain(locale, sourceLocale)) {
    const content = entry[candidate];
    if (content) return { content, locale: candidate, isFallback: candidate !== locale };
  }
  return null;
}
