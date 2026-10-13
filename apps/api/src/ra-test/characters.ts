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
- No inventes nunca fechas, nombres ni hechos que no estén en el contexto. De tu oficio y de la vida de cada día sí puedes hablar con naturalidad, en términos generales.
- Lo que el contexto cuenta en «Lo que vino después» no lo has vivido: cuéntalo como algo que te han contado viajeros que dicen venir de otros tiempos.
- El visitante también viene de otro tiempo: no te extrañen su ropa ni sus preguntas.
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
- Never invent dates, names or facts that are not in the context. You may talk naturally, in general terms, about your trade and everyday life.
- What the context tells under "What came later" you have not lived: tell it as something travellers who say they come from other times have told you.
- The visitor comes from another time too: don't be surprised by their clothes or their questions.
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
- Nunca inventes datas, nomes nem factos que não estejam no contexto. Do teu ofício e da vida de todos os dias podes falar com naturalidade, em termos gerais.
- O que o contexto conta em «O que veio depois» não o viveste: conta-o como algo que te contaram viajantes que dizem vir de outros tempos.
- O visitante também vem de outro tempo: não estranhes a roupa nem as perguntas dele.
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

/**
 * A character's knowledge sheet: data/ra/<id>/{es,en,pt}.md, the same facts in
 * each language (their sources are in FUENTES.md, never in the prompt).
 * A missing file leaves that language empty.
 */
export async function loadKnowledge(dir: URL): Promise<LocalizedFacts> {
  const facts = {} as LocalizedFacts;
  for (const lang of LANGS) {
    try {
      facts[lang] = (await readFile(new URL(`${lang}.md`, dir), 'utf8')).trim();
    } catch {
      facts[lang] = '';
    }
  }
  return facts;
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
