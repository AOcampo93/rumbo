import type { MediaRef } from '@rumbo/route-spec';
import { vi } from 'vitest';
import type { EntityFacts, Grounding, WikipediaText } from '../src/ai/grounding.js';
import type {
  AiProvider,
  AiStructuredRequest,
  AiStructuredResult,
  AiUsage,
} from '../src/ai/provider.js';

// Stand-ins for the model and for Wikimedia, shared by the tests of the card
// pipeline and of the route that serves it.

export const AT = new Date('2026-10-08T12:00:00.000Z');
export const FACTS: EntityFacts = {
  id: 'Q2969701',
  label: 'Castelo de Leiria',
  description: 'castelo medieval em Leiria',
  sitelinks: { pt: 'Castelo de Leiria' },
  images: ['Castelo.jpg', 'Outro.jpg'],
  types: ['Q23413'],
};
export const ARTICLE: WikipediaText = {
  title: 'Castelo de Leiria',
  url: 'https://pt.wikipedia.org/wiki/Castelo_de_Leiria',
  lang: 'pt',
  text: 'O Castelo de Leiria domina a cidade desde o século XII. Foi palácio de reis.\n== História ==\nD. Dinis iniciou a torre de menagem em 1324.',
  image: 'Pagina.jpg',
};
export const IMAGE: MediaRef = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Castelo.jpg',
  alt: 'Castelo de Leiria',
  credit: 'Ana',
  license: 'CC BY-SA 4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Castelo.jpg',
};

/** A Wikimedia that knows the castle; each method can be replaced (by another mock, if the test looks at its calls). */
export function wikimedia(overrides: Partial<Grounding> = {}) {
  const castle = {
    entityFacts: vi.fn<Grounding['entityFacts']>(async () => FACTS),
    wikipediaText: vi.fn<Grounding['wikipediaText']>(async () => ARTICLE),
    commonsImage: vi.fn<Grounding['commonsImage']>(async () => IMAGE),
    nearbyEntity: vi.fn<Grounding['nearbyEntity']>(async () => null),
  };
  return { ...castle, ...overrides } as typeof castle;
}

export const CARD = {
  title: 'Castelo de Leiria',
  subtitle: 'Castelo medieval',
  summary: 'O castelo domina a cidade desde o século XII. Foi palácio de reis.',
  facts: ['Classificado Monumento Nacional em 1910.', 'A torre de menagem começou em 1324.'],
  tip: 'Sobe à torre de menagem para ver o rio Lis.',
  quizQuestion: 'Quem iniciou a torre de menagem?',
  quizOptions: ['D. Dinis', 'D. Sancho I', 'D. João I'],
  quizCorrectIndex: 0,
  quizExplanation: 'Foi D. Dinis, em 1324.',
};

export const USED: AiUsage = { inputTokens: 1000, outputTokens: 200, webSearches: 0 };

/** A model that gives these answers in turn (a result, or the error to throw), then a valid card, and remembers what it was asked. */
export function scripted(...script: Array<Partial<AiStructuredResult> | Error>) {
  const requests: AiStructuredRequest[] = [];
  const structured = vi.fn(async (request: AiStructuredRequest): Promise<AiStructuredResult> => {
    requests.push(request);
    const next = script.shift() ?? {};
    if (next instanceof Error) throw next;
    return { input: CARD, citations: [], usage: USED, model: 'test-model', ...next };
  });
  const ai: AiProvider = { structured };
  return { ai, requests, structured };
}
