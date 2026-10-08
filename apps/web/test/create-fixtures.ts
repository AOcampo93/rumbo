import type {
  ContentGenerateResponse,
  GeneratedCard,
  SuggestPlacesResponse,
} from '@rumbo/api-contract';

// Shared by the phase 7 creator tests: a card the way POST /content/generate
// returns it, the answers of the two AI endpoints and the places they talk about.

export const castle = {
  name: 'Castelo de Leiria',
  position: { lat: 39.7473, lng: -8.8077 },
  address: 'Rua do Castelo, Leiria',
  externalId: 'Q1023767',
  category: 'monument' as const,
};
export const cathedral = {
  name: 'Sé de Leiria',
  position: { lat: 39.7436, lng: -8.8072 },
  externalId: 'Q2422093',
  category: 'church' as const,
};
export const river = {
  name: 'Rio Lis',
  position: { lat: 39.7408, lng: -8.8061 },
  category: 'nature' as const,
};

export function card(overrides: Partial<GeneratedCard> = {}): GeneratedCard {
  return {
    locale: 'es',
    title: 'Castillo de Leiria',
    subtitle: 'Una fortaleza sobre la ciudad',
    summary: 'Fundado en el siglo XII, domina Leiria desde lo alto de la colina.',
    facts: ['Fue residencia de reyes portugueses'],
    images: [],
    tip: 'Sube al atardecer para ver el río.',
    quiz: {
      question: '¿Quién conquistó el castillo en 1135?',
      options: ['Alfonso Henriques', 'Dinis I', 'Juan II'],
      correctIndex: 0,
      explanation: 'Alfonso Henriques lo tomó a los musulmanes.',
    },
    sources: [
      {
        title: 'Castillo de Leiria – Wikipedia',
        url: 'https://es.wikipedia.org/wiki/Castillo_de_Leiria',
      },
      { title: 'Visite Leiria', url: 'https://www.visiteleiria.pt/castelo' },
    ],
    generated: {
      by: 'ai',
      model: 'claude-sonnet-5-5',
      promptVersion: 'card-1',
      at: '2026-10-08T10:00:00.000Z',
    },
    status: 'approved',
    ...overrides,
  };
}

export const generated = (
  overrides: Partial<GeneratedCard> = {},
  grounding: ContentGenerateResponse['grounding'] = 'wikipedia',
): ContentGenerateResponse => ({ content: card(overrides), grounding, cached: false });

export const suggestion: SuggestPlacesResponse = {
  title: 'Leiria en una mañana',
  summary: 'Del castillo al río, pasando por la catedral.',
  places: [
    {
      key: 'wikidata:Q1023767',
      name: 'Castelo de Leiria',
      description: 'castillo medieval',
      position: { lat: 39.7473, lng: -8.8077 },
      category: 'monument',
      externalId: 'Q1023767',
      distanceMeters: 320,
      storable: true,
      teaser: 'Las mejores vistas de la ciudad.',
    },
    {
      key: 'wikidata:Q2422093',
      name: 'Sé de Leiria',
      description: 'catedral',
      position: { lat: 39.7436, lng: -8.8072 },
      category: 'church',
      externalId: 'Q2422093',
      distanceMeters: 640,
      storable: true,
      teaser: 'Una catedral austera con sorpresas.',
    },
    {
      key: 'wikidata:Q10331797',
      name: 'Museu de Leiria',
      description: 'museo',
      position: { lat: 39.7488, lng: -8.8012 },
      category: 'museum',
      externalId: 'Q10331797',
      storable: true,
      teaser: 'Para cuando el sol aprieta.',
    },
  ],
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const apiError = (code: string, status: number) => json({ code }, status);
