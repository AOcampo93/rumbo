/**
 * Lowercase ASCII slug: "Sé de Leiria" → "se-de-leiria". Accents are removed
 * rather than dropped with their letter, so names stay recognizable in ids.
 */
export function slugify(text: string, maxLength = 64): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * Makes every id unique by appending -2, -3… to repeats, staying within
 * `maxLength`. Ids in `taken` count as already used. The same input always
 * gives the same ids.
 */
export function uniqueIds(
  ids: readonly string[],
  maxLength = 64,
  taken: Iterable<string> = [],
): string[] {
  const used = new Set(taken);
  return ids.map((id) => {
    let candidate = id;
    for (let n = 2; used.has(candidate); n++) {
      const suffix = `-${n}`;
      candidate = `${id.slice(0, maxLength - suffix.length)}${suffix}`;
    }
    used.add(candidate);
    return candidate;
  });
}

/** WebCrypto, in browsers and Node ≥ 19 (this package has no DOM or Node types). */
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_LENGTH = 10;

/**
 * Ten random characters [a-z0-9] (about 52 bits) for a new route id, from the
 * system's cryptographic generator: ids can't be guessed from earlier ones.
 */
export function newIdSuffix(): string {
  let suffix = '';
  while (suffix.length < SUFFIX_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH * 2))) {
      // 252 = 7 × 36: skipping the bytes above it keeps every character equally likely.
      if (byte < 252 && suffix.length < SUFFIX_LENGTH) {
        suffix += SUFFIX_ALPHABET.charAt(byte % SUFFIX_ALPHABET.length);
      }
    }
  }
  return suffix;
}
