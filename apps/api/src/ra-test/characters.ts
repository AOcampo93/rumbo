import { readFile } from 'node:fs/promises';

// The characters a visitor can talk to in the AR prototype. Each one has a
// voice (a Gemini prebuilt voice) and, per language, a system instruction
// that is built around a context: the facts it may answer from.

export const LANGS = ['es', 'en', 'pt'] as const;
export type Lang = (typeof LANGS)[number];

export type LocalizedFacts = Record<Lang, string>;

export interface Character {
  id: string;
  displayName: string;
  /** Gemini prebuilt voice name. */
  voiceName: string;
  /** The system instruction in a language, around the facts the character may use. */
  instruction(lang: Lang, facts: string): string;
}

/** A male prebuilt voice of the Live API (deep, calm); a real key may call for another. */
export const DEFAULT_ARTESANO_VOICE = 'Charon';

const RULES: Record<Lang, (facts: string) => string> = {
  es: (
    facts,
  ) => `Eres un artesano del siglo XIV que vive al pie del castillo de Leiria, en Portugal. Hablas siempre en primera persona, como si el castillo y la villa fueran tu día a día, con un tono cálido y cercano.

Reglas:
- Responde en el idioma del visitante. Si te habla en español, en español.
- Habla como se habla en voz alta: de una a tres frases por respuesta, sin listas, sin viñetas ni formato.
- Responde SOLO con lo que dice el contexto de abajo. Si la respuesta no está en el contexto, di en tu papel que eso no lo sabes o no lo has oído nunca, y ofrece hablar de lo que sí sabes.
- No inventes nunca fechas, nombres ni hechos que no estén en el contexto.
- No salgas de tu papel ni hables de ti como de un programa o una inteligencia artificial.

Contexto:
${facts}`,
  en: (
    facts,
  ) => `You are a 14th-century craftsman who lives at the foot of Leiria castle, in Portugal. You always speak in the first person, as if the castle and the town were your daily life, in a warm and friendly tone.

Rules:
- Answer in the visitor's language. If they speak English, answer in English.
- Speak the way people talk out loud: one to three sentences per answer, no lists, no bullet points, no formatting.
- Answer ONLY from the context below. If the answer is not in the context, say in character that you don't know or have never heard of it, and offer to talk about what you do know.
- Never invent dates, names or facts that are not in the context.
- Never break character or speak of yourself as a program or an artificial intelligence.

Context:
${facts}`,
  pt: (
    facts,
  ) => `Es um artesão do século XIV que vive ao pé do castelo de Leiria, em Portugal. Falas sempre na primeira pessoa, como se o castelo e a vila fossem o teu dia a dia, num tom caloroso e próximo.

Regras:
- Responde na língua do visitante. Se te falar em português, responde em português.
- Fala como se fala em voz alta: de uma a três frases por resposta, sem listas, sem marcadores nem formatação.
- Responde SÓ com o que diz o contexto abaixo. Se a resposta não está no contexto, diz, no teu papel, que não sabes ou que nunca ouviste falar disso, e oferece-te para falar do que sabes.
- Nunca inventes datas, nomes nem factos que não estejam no contexto.
- Nunca saias do teu papel nem fales de ti como de um programa ou de uma inteligência artificial.

Contexto:
${facts}`,
};

export interface CharacterOptions {
  /** Overrides the voice of the craftsman. */
  artesanoVoice?: string | null;
}

/** The registry, keyed by id. */
export function createCharacters(options: CharacterOptions = {}): ReadonlyMap<string, Character> {
  const artesano: Character = {
    id: 'artesano',
    displayName: 'Artesão de Leiria',
    voiceName: options.artesanoVoice || DEFAULT_ARTESANO_VOICE,
    instruction: (lang, facts) => RULES[lang](facts),
  };
  return new Map([[artesano.id, artesano]]);
}

// --- Context: the facts the character answers from ---

/** The parts of a route file this module reads (a structural subset of RouteSpec). */
export interface RouteFileLike {
  spec?: {
    description?: Partial<Record<Lang, string>>;
    points?: {
      id: string;
      name: string;
      triggers?: { onEnter?: string };
    }[];
    actions?: Record<string, { params?: { body?: Partial<Record<Lang, string>> } }>;
  };
}

export const CASTLE_POINT_ID = 'castelo-de-leiria';

const HEADINGS: Record<Lang, { place: string; town: string }> = {
  es: { place: 'El castillo de Leiria', town: 'Leiria' },
  en: { place: 'Leiria castle', town: 'Leiria' },
  pt: { place: 'O castelo de Leiria', town: 'Leiria' },
};

/**
 * The castle and Leiria facts per language, from the curated route: the
 * castle point's info sheet and the route's description of the old town.
 * Pure: what the file lacks in a language is left out.
 */
export function castleFacts(route: RouteFileLike): LocalizedFacts {
  const spec = route.spec;
  const point = spec?.points?.find((p) => p.id === CASTLE_POINT_ID);
  const action = point?.triggers?.onEnter ? spec?.actions?.[point.triggers.onEnter] : undefined;
  const facts = {} as LocalizedFacts;
  for (const lang of LANGS) {
    const lines: string[] = [];
    const castle = action?.params?.body?.[lang];
    if (point && castle) lines.push(`${HEADINGS[lang].place} (${point.name}): ${castle}`);
    const town = spec?.description?.[lang];
    if (town) lines.push(`${HEADINGS[lang].town}: ${town}`);
    facts[lang] = lines.join('\n');
  }
  return facts;
}

/** Reads the curated route and extracts the facts; an unreadable file gives empty facts. */
export async function loadCastleFacts(file: URL): Promise<LocalizedFacts> {
  try {
    return castleFacts(JSON.parse(await readFile(file, 'utf8')) as RouteFileLike);
  } catch {
    return { es: '', en: '', pt: '' };
  }
}

const NO_FACTS: Record<Lang, string> = {
  es: '(No tienes datos sobre este tema.)',
  en: '(You have no information on this topic.)',
  pt: '(Não tens informação sobre este tema.)',
};

/** The full system instruction of a character in a language. */
export function systemInstruction(character: Character, lang: Lang, facts: LocalizedFacts): string {
  return character.instruction(lang, facts[lang] || NO_FACTS[lang]);
}
