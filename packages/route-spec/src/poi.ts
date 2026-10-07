import { z } from 'zod';
import {
  HttpUrlSchema,
  LatLngSchema,
  LocaleSchema,
  localizedText,
  MediaRefSchema,
  PointCategorySchema,
} from './schema.ts';

// Points of interest shown on the Explore map next to the curated routes'
// points (PROJECT_PLAN §10.4, §15). They come from Wikidata (CC0) through
// scripts/fetch-pois.ts; images come from Wikimedia Commons with their credit.

export const PoiSchema = z.strictObject({
  /** Wikidata QID, e.g. "Q10383715". */
  id: z.string().regex(/^Q\d+$/, 'Use a Wikidata QID'),
  name: localizedText({ max: 120 }),
  position: LatLngSchema,
  category: PointCategorySchema,
  image: MediaRefSchema.optional(),
  /** Wikipedia article per language, when there is one. */
  wikipedia: z.partialRecord(LocaleSchema, HttpUrlSchema).optional(),
});

export const PoiCollectionSchema = z.strictObject({
  /** Area slug: also the file name in data/pois. */
  id: z.string().regex(/^[a-z0-9-]{3,64}$/),
  name: localizedText({ max: 80 }),
  /** Language of the plain-string names (Wikidata's local labels). */
  locale: LocaleSchema,
  source: z.literal('wikidata'),
  /** Licence of the data itself; each image carries its own. */
  license: z.string().min(1).max(100),
  generatedAt: z.iso.datetime(),
  pois: z.array(PoiSchema).min(1).max(500),
});

export type Poi = z.infer<typeof PoiSchema>;
export type PoiCollection = z.infer<typeof PoiCollectionSchema>;
