/** Tabs and line breaks (NEL included): they become a single space. */
const BREAKS = /[\t\n\v\f\r\u0085]+/g;

/**
 * Removed outright: the other C0/C1 controls (U+0000 included), lone
 * surrogates (Postgres rejects both in jsonb) and the bidi overrides and
 * isolates that can make a name read differently from what it stores.
 */
const UNSAFE = /[\p{Cc}\p{Cs}‪-‮⁦-⁩]/gu;

/** A text the way routes store it: one line, nothing invisible or unsafe, trimmed. */
export function cleanText(text: string): string {
  return text.replace(BREAKS, ' ').replace(UNSAFE, '').trim();
}

/**
 * Cleans a text (see cleanText) and cuts it to `max` code points, the unit
 * the route schemas count in, so a surrogate pair is never split. Used for
 * names (80) and descriptions or addresses (200) that come from Wikidata.
 */
export function truncateText(text: string, max: number): string {
  const clean = cleanText(text);
  let end = 0;
  for (let count = 0; count < max && end < clean.length; count++) {
    // cleanText left no lone surrogates: a high one always starts a pair.
    const code = clean.charCodeAt(end);
    end += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
  }
  return end >= clean.length ? clean : clean.slice(0, end).trimEnd();
}
