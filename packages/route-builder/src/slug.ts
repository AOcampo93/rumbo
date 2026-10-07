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
 * `maxLength`. The same input always gives the same ids.
 */
export function uniqueIds(ids: readonly string[], maxLength = 64): string[] {
  const used = new Set<string>();
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
