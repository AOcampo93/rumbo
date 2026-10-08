// What a search box sends becomes a query a provider can't misread
// (security review: CirrusSearch has its own syntax, such as insource:/…/,
// -word or nearcoord:, and NFKC can lengthen a text past the schema's limit).

/** Longest query, in code points, after NFKC. */
export const MAX_QUERY_LENGTH = 80;
/** Words of a place search. */
export const MAX_TOKENS = 6;

const CONTROLS = /\p{Cc}+/gu;
/** Format characters (bidi controls, zero-width…) and lone surrogates. */
const INVISIBLE = /[\p{Cf}\p{Cs}]/gu;
/** A place search keeps letters (with their marks), digits, apostrophes, hyphens and dots. */
const NOT_KEPT = /[^\p{L}\p{M}\p{N}'.-]+/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

/** Both kinds: NFKC, no controls or invisible characters, single spaces, at most 80 code points. */
export function normalizeQuery(q: string): string {
  const clean = q
    .normalize('NFKC')
    .replace(CONTROLS, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(clean).slice(0, MAX_QUERY_LENGTH).join('').trimEnd();
}

/** Lowercase without accents: "Sé" and "se" are the same word. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

const lettersAndDigits = (text: string) => text.match(LETTER_OR_DIGIT)?.length ?? 0;

/** True when some word has 2 letters or digits: anything shorter is not worth a search. */
export function isSearchable(tokens: readonly string[]): boolean {
  return tokens.some((token) => lettersAndDigits(token) >= 2);
}

/**
 * The words of a place search, folded: words that look like search syntax
 * (`keyword:value`, `-word`, `!word`) are dropped whole, every other
 * character but letters, digits, apostrophes, hyphens and dots becomes a
 * space, and at most 6 words remain.
 */
export function placeTokens(normalized: string): string[] {
  return normalized
    .replace(/[‘’]/gu, "'")
    .split(' ')
    .filter((word) => !word.includes(':') && !/^[-!]/u.test(word))
    .flatMap((word) => word.replace(NOT_KEPT, ' ').split(' '))
    .filter((token) => lettersAndDigits(token) > 0 && !token.startsWith('-'))
    .slice(0, MAX_TOKENS)
    .map(fold);
}
