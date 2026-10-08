import { truncateText } from '@rumbo/route-builder';
import type { LatLng, Locale, MediaRef } from '@rumbo/route-spec';
import { fold, isSearchable, normalizeQuery, placeTokens } from '../geo/query.js';
import type { Fetch } from '../geo/wikidata.js';
import { isRecord, readCapped } from './http.js';

// What the AI writes a card from (PROJECT_PLAN §12): the place's Wikidata
// item, its Wikipedia article, its photo on Wikimedia Commons. All of it
// comes from Wikimedia's own APIs with the same hygiene as the place search
// (src/geo/wikidata.ts): a descriptive User-Agent, a deadline, a body cap, no
// redirects, URLs built with URLSearchParams, a few requests at a time and a
// pause when Wikimedia asks us to slow down.

const WIKIDATA = 'www.wikidata.org';
const COMMONS = 'commons.wikimedia.org';
const QID = /^Q\d{1,12}$/;

/** The longest article text handed to the model, in characters. */
export const MAX_ARTICLE_CHARS = 6000;
/** An article shorter than this is a stub: the same place's articles in other languages are compared. */
const STUB_CHARS = 1200;
/** A longer article in another language wins only if it is this many times longer. */
const OTHER_LANGUAGE_FACTOR = 1.5;
/** Radius around a custom place where an item of its name is looked for. */
const NEARBY_KM = 2;
const NEARBY_HITS = 10;
/**
 * Width of the thumbnails asked for: one of Wikimedia's standard sizes (it
 * rounds others up, 1024 to 1280), within the 1024 a card may use.
 */
const IMAGE_WIDTH = 960;
/** Smaller photos are not worth a card. */
const MIN_IMAGE_WIDTH = 300;
const IMAGE_HOST = 'https://upload.wikimedia.org/';
/** Hosts Commons gives thumbnails on: the same files are served from both. */
const THUMBNAIL_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);
const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);
const DEFAULT_PAUSE_S = 60;
const MAX_PAUSE_S = 3600;

/** Why a lookup failed, for the logs. */
export type GroundingReason =
  /** Wikimedia asked us to slow down and the pause isn't over: no request was made. */
  | 'paused'
  /** Wikidata has no item with that id. */
  | 'not_found'
  | 'rate_limited'
  | 'upstream_down'
  | 'upstream_status'
  /** HTTP 200 with an API error in the body. */
  | 'upstream_error'
  | 'bad_response'
  | 'too_large'
  | 'network'
  | 'timeout'
  | 'aborted';

/** A failed lookup: only a reason (never the URL, the name or what Wikimedia answered), safe to log. */
export class GroundingError extends Error {
  readonly reason: GroundingReason;

  constructor(reason: GroundingReason) {
    super(`Research failed: ${reason}`);
    this.name = 'GroundingError';
    this.reason = reason;
  }
}

export interface GroundingOptions {
  /** Wikimedia requires a descriptive User-Agent with contact details. */
  userAgent: string;
  fetch?: Fetch;
  /** Upstream requests in flight at once. */
  maxConcurrency?: number;
  /** Larger upstream bodies are refused. */
  maxBodyBytes?: number;
  /** The clock of the pause; tests move it. */
  now?: () => number;
}

/** What Wikidata knows of a place that the card needs. */
export interface EntityFacts {
  id: string;
  /** The place's name in the best language available. */
  label?: string;
  /** Wikidata's one-line description ("church building in Leiria"). */
  description?: string;
  /** The titles of its Wikipedia articles. */
  sitelinks: Partial<Record<Locale, string>>;
  /** Commons file names (P18), the preferred one first. */
  images: string[];
  /** What the item is an instance of (P31). */
  types: string[];
}

export interface WikipediaText {
  title: string;
  url: string;
  lang: Locale;
  /** The article without its back matter, cut to MAX_ARTICLE_CHARS. */
  text: string;
  /** The article's lead image (a Commons file name), when it has one. */
  image?: string;
}

export interface Grounding {
  /** The item's facts; null when there is no such item. */
  entityFacts(qid: string, locale: Locale, signal: AbortSignal): Promise<EntityFacts | null>;
  /**
   * The best Wikipedia article of the item: the user's language, unless it is
   * a stub and another language has a much longer one. Null when it has none.
   */
  wikipediaText(
    facts: EntityFacts,
    locale: Locale,
    signal: AbortSignal,
  ): Promise<WikipediaText | null>;
  /** A Commons file as a MediaRef; null when its licence is not an open one or it is no photo. */
  commonsImage(file: string, alt: string, signal: AbortSignal): Promise<MediaRef | null>;
  /** The QID of an item that is named like `name` within 2 km of `position`, or null. */
  nearbyEntity(
    name: string,
    position: LatLng,
    locale: Locale,
    signal: AbortSignal,
  ): Promise<string | null>;
}

const isQid = (value: unknown): value is string => typeof value === 'string' && QID.test(value);

/** The user's language, then Portuguese (the places' own), English, Spanish, multilingual. */
const languagesFor = (locale: Locale) => [...new Set([locale, 'pt', 'en', 'es', 'mul'])];

/** The first text of `languages` that really is in that language (not a fallback standing in). */
function pickText(terms: unknown, languages: readonly string[]): string | undefined {
  if (!isRecord(terms)) return undefined;
  for (const language of languages) {
    const term = terms[language];
    if (
      isRecord(term) &&
      typeof term['value'] === 'string' &&
      typeof term['language'] === 'string' &&
      (term['language'] === language || term['language'].startsWith(`${language}-`))
    ) {
      return term['value'];
    }
  }
  return undefined;
}

/** Values of an item's statements for one property: preferred rank first, deprecated never. */
function statementValues(claims: unknown, property: string): unknown[] {
  const list = isRecord(claims) ? claims[property] : undefined;
  if (!Array.isArray(list)) return [];
  const usable = list.filter(
    (claim): claim is { rank?: string; mainsnak: { datavalue: { value: unknown } } } =>
      isRecord(claim) &&
      claim['rank'] !== 'deprecated' &&
      isRecord(claim['mainsnak']) &&
      isRecord(claim['mainsnak']['datavalue']) &&
      claim['mainsnak']['datavalue']['value'] !== undefined,
  );
  return [
    ...usable.filter((claim) => claim.rank === 'preferred'),
    ...usable.filter((claim) => claim.rank !== 'preferred'),
  ].map((claim) => claim.mainsnak.datavalue.value);
}

// ------------------------------------------------------------------ article text

/** Headings after which an article has no more story to tell (folded, in the three languages). */
const BACK_MATTER = new Set(
  [
    'see also',
    'references',
    'external links',
    'further reading',
    'bibliography',
    'notes',
    'sources',
    'footnotes',
    'gallery',
    'vease tambien',
    'referencias',
    'enlaces externos',
    'bibliografia',
    'notas',
    'fuentes',
    'galeria',
    'ver tambem',
    'ligacoes externas',
    'fontes',
    'notas e referencias',
  ].map(fold),
);
const HEADING = /^(={2,6})\s*(.+?)\s*\1$/u;

const isHeading = (line: string) => HEADING.test(line);
const levelOf = (heading: string) => HEADING.exec(heading)?.[1]?.length ?? 0;

/**
 * An article extract (plain text with "== Heading ==" lines) ready for the
 * model: one cleaned line per paragraph, nothing from the first back-matter
 * heading on, no heading without text under it, cut to `max` characters at
 * the end of a paragraph or sentence when it can.
 */
export function prepareArticle(extract: string, max = MAX_ARTICLE_CHARS): string {
  const lines: string[] = [];
  for (const raw of extract.split(/\r\n|\r|\n/u)) {
    const line = truncateText(raw, raw.length);
    const heading = HEADING.exec(line);
    if (heading && BACK_MATTER.has(fold(heading[2] as string))) break;
    if (line) lines.push(line);
  }
  // A heading with nothing under it: last, or followed by a heading that isn't one of its sub-sections.
  const withText = lines.filter((line, i) => {
    if (!isHeading(line)) return true;
    const next = lines[i + 1];
    return next !== undefined && (!isHeading(next) || levelOf(next) > levelOf(line));
  });
  return cutText(withText.join('\n'), max);
}

/** `text` cut to `max` characters at a paragraph end, else a sentence end, else anywhere; never leaving a heading last. */
function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  // Not in the middle of a surrogate pair.
  if (/[\ud800-\udbff]$/u.test(cut)) cut = cut.slice(0, -1);
  const paragraph = cut.lastIndexOf('\n');
  const sentence = cut.lastIndexOf('. ');
  if (paragraph >= max * 0.6) cut = cut.slice(0, paragraph);
  else if (sentence >= max * 0.6) cut = cut.slice(0, sentence + 1);
  const rows = cut.trimEnd().split('\n');
  while (rows.length > 0 && isHeading(rows[rows.length - 1] as string)) rows.pop();
  return rows.join('\n');
}

// ------------------------------------------------------------------ images

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Commons metadata comes as HTML ("<a href=…>Author</a>"): its text, on one line, at most `max` characters. */
export function htmlText(html: string, max: number): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (match, entity: string) => {
      if (entity.startsWith('#')) {
        const code =
          entity[1]?.toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ');
  return truncateText(text, max);
}

/**
 * Open licences only (PROJECT_PLAN §12.1): CC0, public domain, CC BY and
 * CC BY-SA. Anything else, NonCommercial and NoDerivatives included, is out.
 */
export function isOpenLicense(shortName: string): boolean {
  const name = shortName.trim().toUpperCase().replace(/\s+/g, ' ');
  return (
    /^CC0( 1\.0)?( UNIVERSAL)?$/.test(name) ||
    /^(PUBLIC DOMAIN|PD)(\b|-)/.test(name) ||
    /^CC BY(-SA)? \d(\.\d)?( [A-Z]{2,3})?$/.test(name)
  );
}

// ------------------------------------------------------------------ names

/** Words that don't tell two names apart ("Sé de Leiria" and "Sé Leiria"). */
const FILLER = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'del',
  'la',
  'las',
  'los',
  'el',
  'the',
  'of',
  'e',
  'y',
  'a',
  'o',
]);

const significantWords = (name: string): string[] =>
  fold(normalizeQuery(name))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '' && !FILLER.has(word));

/** True when both names have the same significant words, whatever their order or accents. */
export function sameName(a: string, b: string): boolean {
  const left = significantWords(a);
  const right = significantWords(b);
  return (
    left.length > 0 && left.length === right.length && left.every((word) => right.includes(word))
  );
}

// ------------------------------------------------------------------ the service

/** At most `max` tasks at once; the others wait in line (and leave it if they're aborted). */
class Slots {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new GroundingError(whyStopped(signal));
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      // release() hands its slot over: `active` doesn't change.
      const grant = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const at = this.waiting.indexOf(grant);
        if (at >= 0) this.waiting.splice(at, 1);
        reject(new GroundingError(whyStopped(signal)));
      };
      this.waiting.push(grant);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
}

/** A lookup that stops because its deadline passed ('timeout') or because nobody waits for it ('aborted'). */
function whyStopped(signal: AbortSignal): 'timeout' | 'aborted' {
  return (signal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError'
    ? 'timeout'
    : 'aborted';
}

/** How long to pause after Wikimedia asked us to slow down: its Retry-After (seconds or a date), else a minute; never more than an hour. */
function pauseSeconds(retryAfter: string | null, now: number): number {
  const value = retryAfter?.trim();
  if (value) {
    const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, MAX_PAUSE_S);
  }
  return DEFAULT_PAUSE_S;
}

export function createGrounding(options: GroundingOptions): Grounding {
  const send = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const now = options.now ?? Date.now;
  const slots = new Slots(options.maxConcurrency ?? 4);
  /** Breaker: no upstream request before this time (epoch ms). */
  let pausedUntil = 0;

  const pause = (response: Response) => {
    const seconds = pauseSeconds(response.headers.get('retry-after'), now());
    pausedUntil = Math.max(pausedUntil, now() + seconds * 1000);
  };

  /** One GET to a Wikimedia API: every limit and every failure mode in one place. */
  async function api(
    host: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (now() < pausedUntil) throw new GroundingError('paused');
    const query = new URLSearchParams({ ...params, format: 'json', formatversion: '2' });
    const url = `https://${host}/w/api.php?${query}`;
    await slots.acquire(signal);
    try {
      let response: Response;
      try {
        response = await send(url, {
          headers: { 'User-Agent': options.userAgent, Accept: 'application/json' },
          redirect: 'error',
          signal,
        });
      } catch {
        throw new GroundingError(signal.aborted ? whyStopped(signal) : 'network');
      }
      if (response.status === 429 || response.status >= 500) {
        pause(response);
        await response.body?.cancel().catch(() => {});
        throw new GroundingError(response.status === 429 ? 'rate_limited' : 'upstream_down');
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new GroundingError('upstream_status');
      }
      let text: string | null;
      try {
        text = await readCapped(response, maxBodyBytes);
      } catch {
        throw new GroundingError(signal.aborted ? whyStopped(signal) : 'network');
      }
      if (text === null) throw new GroundingError('too_large');
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new GroundingError('bad_response');
      }
      if (isRecord(data) && data['error'] !== undefined) {
        const code = isRecord(data['error']) ? data['error']['code'] : undefined;
        if (code === 'maxlag' || code === 'ratelimited') {
          pause(response);
          throw new GroundingError('rate_limited');
        }
        // Ids past the last item are an error, not a "missing" entry.
        if (code === 'no-such-entity' || code === 'invalid-entity-id') {
          throw new GroundingError('not_found');
        }
        throw new GroundingError('upstream_error');
      }
      return data;
    } finally {
      slots.release();
    }
  }

  /** The values of one property of an item (wbgetclaims answers only that property: a few hundred bytes). */
  async function propertyValues(
    id: string,
    property: string,
    signal: AbortSignal,
  ): Promise<unknown[]> {
    const data = await api(WIKIDATA, { action: 'wbgetclaims', entity: id, property }, signal);
    return statementValues(isRecord(data) ? data['claims'] : undefined, property);
  }

  async function entityFacts(
    qid: string,
    locale: Locale,
    signal: AbortSignal,
  ): Promise<EntityFacts | null> {
    if (!isQid(qid)) return null;
    const languages = languagesFor(locale);
    let data: unknown;
    try {
      data = await api(
        WIKIDATA,
        {
          action: 'wbgetentities',
          ids: qid,
          props: 'sitelinks|labels|descriptions',
          sitefilter: 'eswiki|enwiki|ptwiki',
          languages: languages.join('|'),
          languagefallback: '1',
        },
        signal,
      );
    } catch (error) {
      if (error instanceof GroundingError && error.reason === 'not_found') return null;
      throw error;
    }
    const entities = isRecord(data) && isRecord(data['entities']) ? data['entities'] : {};
    // A redirected item answers under its target's id.
    const entity = entities[qid] ?? Object.values(entities)[0];
    if (!isRecord(entity) || entity['missing'] !== undefined || !isQid(entity['id'])) return null;
    const id = entity['id'];

    const [files, types] = await Promise.all([
      propertyValues(id, 'P18', signal),
      propertyValues(id, 'P31', signal),
    ]);
    const sitelinks: EntityFacts['sitelinks'] = {};
    for (const lang of ['es', 'en', 'pt'] as const) {
      const link = isRecord(entity['sitelinks']) ? entity['sitelinks'][`${lang}wiki`] : undefined;
      if (isRecord(link) && typeof link['title'] === 'string' && link['title']) {
        sitelinks[lang] = link['title'];
      }
    }
    const label = truncateText(pickText(entity['labels'], languages) ?? '', 80);
    const description = truncateText(pickText(entity['descriptions'], languages) ?? '', 200);
    return {
      id,
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      sitelinks,
      images: files.filter((file): file is string => typeof file === 'string' && file !== ''),
      types: types.flatMap((type) => (isRecord(type) && isQid(type['id']) ? [type['id']] : [])),
    };
  }

  /** One article of a Wikipedia; null when it is missing, a disambiguation page or empty. */
  async function article(
    lang: Locale,
    title: string,
    signal: AbortSignal,
  ): Promise<WikipediaText | null> {
    const ask = (intro: boolean) =>
      api(
        `${lang}.wikipedia.org`,
        {
          action: 'query',
          prop: 'extracts|info|pageprops|pageimages',
          explaintext: '1',
          exsectionformat: 'wiki',
          exlimit: '1',
          ...(intro ? { exintro: '1' } : {}),
          inprop: 'url',
          ppprop: 'disambiguation',
          piprop: 'name',
          titles: title,
          redirects: '1',
        },
        signal,
      );
    let data: unknown;
    try {
      data = await ask(false);
    } catch (error) {
      // A huge article: its lead alone is enough.
      if (!(error instanceof GroundingError && error.reason === 'too_large')) throw error;
      data = await ask(true);
    }
    const pages = isRecord(data) && isRecord(data['query']) ? data['query']['pages'] : undefined;
    const page = Array.isArray(pages) ? pages[0] : undefined;
    if (!isRecord(page) || page['missing'] !== undefined) return null;
    if (isRecord(page['pageprops']) && page['pageprops']['disambiguation'] !== undefined) {
      return null;
    }
    const extract = page['extract'];
    const pageTitle = page['title'];
    if (typeof extract !== 'string' || typeof pageTitle !== 'string') return null;
    const text = prepareArticle(extract);
    if (!text) return null;
    const home = `https://${lang}.wikipedia.org/wiki/`;
    const full = page['fullurl'];
    const image = page['pageimage'];
    return {
      title: truncateText(pageTitle, 200),
      url:
        typeof full === 'string' && full.startsWith(home)
          ? full
          : `${home}${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`,
      lang,
      text,
      ...(typeof image === 'string' && image ? { image } : {}),
    };
  }

  async function wikipediaText(
    facts: EntityFacts,
    locale: Locale,
    signal: AbortSignal,
  ): Promise<WikipediaText | null> {
    const order = [...new Set<Locale>([locale, 'en', 'es', 'pt'])].filter(
      (lang) => facts.sitelinks[lang] !== undefined,
    );
    const first = order[0];
    if (first === undefined) return null;
    const preferred = await article(first, facts.sitelinks[first] as string, signal);
    // Spanish articles on Portuguese places are often stubs: the longer one
    // in another language gives the model more to work with (the card is
    // written in the user's language all the same).
    if (preferred && preferred.text.length >= STUB_CHARS) return preferred;
    const others = await Promise.all(
      order.slice(1).map((lang) => article(lang, facts.sitelinks[lang] as string, signal)),
    );
    let best = preferred;
    for (const other of others) {
      if (!other) continue;
      if (!best || other.text.length > best.text.length * OTHER_LANGUAGE_FACTOR) best = other;
    }
    return best;
  }

  async function commonsImage(
    file: string,
    alt: string,
    signal: AbortSignal,
  ): Promise<MediaRef | null> {
    const data = await api(
      COMMONS,
      {
        action: 'query',
        titles: `File:${file}`,
        prop: 'imageinfo',
        iiprop: 'url|extmetadata|mime|size',
        iiurlwidth: String(IMAGE_WIDTH),
        iiextmetadatafilter: 'Artist|Credit|LicenseShortName',
      },
      signal,
    );
    const pages = isRecord(data) && isRecord(data['query']) ? data['query']['pages'] : undefined;
    const page = Array.isArray(pages) ? pages[0] : undefined;
    const info =
      isRecord(page) && Array.isArray(page['imageinfo']) ? page['imageinfo'][0] : undefined;
    if (!isRecord(page) || page['missing'] !== undefined || !isRecord(info)) return null;
    if (typeof info['mime'] !== 'string' || !IMAGE_TYPES.has(info['mime'])) return null;
    if (typeof info['width'] !== 'number' || info['width'] < MIN_IMAGE_WIDTH) return null;

    const meta = isRecord(info['extmetadata']) ? info['extmetadata'] : {};
    const field = (name: string): string => {
      const entry = meta[name];
      return isRecord(entry) && typeof entry['value'] === 'string' ? entry['value'] : '';
    };
    const license = htmlText(field('LicenseShortName'), 100);
    if (!isOpenLicense(license)) return null;

    // The thumbnail (or the original when it is smaller), without the tracking
    // query and always on upload.wikimedia.org, where a user route may use it.
    const thumb = info['thumburl'] ?? info['url'];
    if (typeof thumb !== 'string') return null;
    let url: URL;
    try {
      url = new URL(thumb);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !THUMBNAIL_HOSTS.has(url.hostname)) return null;
    url.hostname = 'upload.wikimedia.org';
    url.search = '';
    url.hash = '';
    if (!url.href.startsWith(IMAGE_HOST)) return null;

    const credit = htmlText(field('Artist') || field('Credit'), 200);
    const source = info['descriptionurl'];
    return {
      url: url.href,
      alt: truncateText(alt, 300),
      ...(credit ? { credit } : {}),
      license,
      ...(typeof source === 'string' && source.startsWith('https://commons.wikimedia.org/')
        ? { sourceUrl: source }
        : {}),
    };
  }

  async function nearbyEntity(
    name: string,
    position: LatLng,
    locale: Locale,
    signal: AbortSignal,
  ): Promise<string | null> {
    const tokens = placeTokens(normalizeQuery(name));
    if (!isSearchable(tokens) || significantWords(name).length === 0) return null;
    const near = `${position.lat.toFixed(3)},${position.lng.toFixed(3)}`;
    const found = await api(
      WIKIDATA,
      {
        action: 'query',
        list: 'search',
        srsearch: `${tokens.join(' ')} haswbstatement:P625 nearcoord:${NEARBY_KM}km,${near}`,
        srnamespace: '0',
        srlimit: String(NEARBY_HITS),
        srprop: '',
      },
      signal,
    );
    const hits = isRecord(found) && isRecord(found['query']) ? found['query']['search'] : undefined;
    const ids = (Array.isArray(hits) ? hits : [])
      .map((hit) => (isRecord(hit) ? hit['title'] : undefined))
      .filter(isQid);
    if (ids.length === 0) return null;

    const data = await api(
      WIKIDATA,
      {
        action: 'wbgetentities',
        ids: ids.join('|'),
        props: 'labels|aliases',
        languages: languagesFor(locale).join('|'),
      },
      signal,
    );
    const entities = isRecord(data) && isRecord(data['entities']) ? data['entities'] : {};
    for (const id of ids) {
      const entity = entities[id];
      if (!isRecord(entity)) continue;
      const names: string[] = [];
      for (const terms of [entity['labels'], entity['aliases']]) {
        for (const term of isRecord(terms) ? Object.values(terms) : []) {
          for (const item of Array.isArray(term) ? term : [term]) {
            if (isRecord(item) && typeof item['value'] === 'string') names.push(item['value']);
          }
        }
      }
      if (names.some((candidate) => sameName(candidate, name))) return id;
    }
    return null;
  }

  return { entityFacts, wikipediaText, commonsImage, nearbyEntity };
}
