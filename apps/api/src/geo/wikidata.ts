import type { GeoSuggestion, ResolvedPlace } from '@rumbo/api-contract';
import { distance, isValidLatLng, type LatLng } from '@rumbo/geo-utils';
import { truncateText } from '@rumbo/route-builder';
import type { Locale, PointCategory } from '@rumbo/route-spec';
import { TtlCache } from './cache.js';
import { GeocodingError, type GeocodingProvider, type SuggestInput } from './provider.js';
import { fold, isSearchable, normalizeQuery, placeTokens } from './query.js';

// Place search on Wikidata (CC0: its coordinates may be stored in a route,
// PROJECT_PLAN §12.3). Places: CirrusSearch full-text search of items with
// coordinates near the map (list=search with haswbstatement:P625 and
// nearcoord:), then their labels and statements (wbgetentities). Cities and
// areas: the label search (wbsearchentities) plus their coordinates
// (prop=coordinates). Every URL is built with URLSearchParams.

const ENDPOINT = 'https://www.wikidata.org/w/api.php';

/** Hits per full-text search. */
const SEARCH_LIMIT = 20;
/** Radius of a place search, and of its last try when nothing is near. */
const NEAR_KM = 20;
const WIDE_KM = 100;
/** Fewer hits than this and the search tries again with the next fallback. */
const ENOUGH_HITS = 3;
/** Items fetched beyond `limit`: some have no name or position. */
const EXTRA_ITEMS = 6;
const EXTRA_AREAS = 3;
/** Administrative areas joined into an address when there is no street address. */
const ADDRESS_AREAS = 2;
/** Requests a batch of items may take in all when it must be split (see entities). */
const ITEM_REQUESTS = 7;

const NAME_MAX = 80;
const TEXT_MAX = 200;

/** Answers kept in memory. */
const CACHE_ENTRIES = 500;
const CACHE_TTL_MS = 24 * 3_600_000;
/** Pause after a 429/5xx without Retry-After, and the longest one honoured. */
const DEFAULT_PAUSE_S = 60;
const MAX_PAUSE_S = 3600;

const EARTH = 'http://www.wikidata.org/entity/Q2';
const QID = /^Q\d{1,12}$/;
const KEY = /^wikidata:(Q\d{1,12})$/;

/**
 * Category from an item's direct "instance of" (P31), first match in claim
 * order. Q210272 (cultural heritage), which most monuments carry next to
 * their real type, is not in the table and so never decides.
 */
const CATEGORY_OF = new Map<string, PointCategory>(
  Object.entries({
    church: 'Q16970 Q2977 Q108325 Q44613 Q1128397',
    museum: 'Q33506 Q207694 Q1007870',
    monument:
      'Q4989906 Q179700 Q5003624 Q23413 Q57821 Q16560 Q12518 Q483453 Q12280 Q1463776 Q1802963',
    viewpoint: 'Q6017969',
    nature: 'Q22698 Q22746 Q1107656',
    food: 'Q11707 Q30022 Q330284',
    culture: 'Q24354 Q7075 Q2326815 Q483110',
  }).flatMap(([category, ids]) =>
    ids.split(' ').map((id): [string, PointCategory] => [id, category as PointCategory]),
  ),
);

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface WikidataOptions {
  /** Wikimedia requires a descriptive User-Agent with contact details. */
  userAgent: string;
  fetch?: Fetch;
  /** Upstream requests in flight at once, across all users. */
  maxConcurrency?: number;
  /** Larger upstream bodies are refused. */
  maxBodyBytes?: number;
  /** The clock of the cache and of the pause; tests move it. */
  now?: () => number;
}

interface Term {
  language: string;
  value: string;
}

interface Entity {
  id: string;
  labels?: Record<string, unknown>;
  descriptions?: Record<string, unknown>;
  claims?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isQid = (value: unknown): value is string => typeof value === 'string' && QID.test(value);

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor || 0;
};

/** The position everything is measured from: `near`, rounded to 3 decimals (about 110 m). */
const center = (near: LatLng | undefined): LatLng | undefined =>
  near && { lat: round(near.lat, 3), lng: round(near.lng, 3) };

/** A position with 6 decimals (about 0.1 m), or undefined when it isn't one. */
function toPosition(lat: unknown, lng: unknown): LatLng | undefined {
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  const position = { lat: round(lat, 6), lng: round(lng, 6) };
  return isValidLatLng(position) ? position : undefined;
}

/** The user's language, then Portuguese (the places' own), English, Spanish, multilingual. */
const languagesFor = (locale: Locale) => [...new Set([locale, 'pt', 'en', 'es', 'mul'])];

/**
 * The first text in `languages` order. With languagefallback a missing
 * language is filled from another one (`language` says which); such a text
 * waits for its own language's turn, so a Portuguese name beats an English
 * one standing in for Spanish.
 */
function pickText(terms: unknown, languages: readonly string[]): string | undefined {
  if (!isRecord(terms)) return undefined;
  for (const language of languages) {
    const term = terms[language] as Partial<Term> | undefined;
    if (
      typeof term?.value === 'string' &&
      typeof term.language === 'string' &&
      (term.language === language || term.language.startsWith(`${language}-`))
    ) {
      return term.value;
    }
  }
  return undefined;
}

/** A cleaned text cut to `max` code points; undefined when nothing is left. */
const cut = (text: string | undefined, max: number) =>
  (text === undefined ? '' : truncateText(text, max)) || undefined;

/** Values of an item's statements for `property`: preferred rank first, deprecated never. */
function statements(entity: Entity, property: string): unknown[] {
  const claims = entity.claims?.[property];
  if (!Array.isArray(claims)) return [];
  const usable = claims.filter(
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

/** Coordinates (P625) on Earth. */
function positionOf(entity: Entity): LatLng | undefined {
  for (const value of statements(entity, 'P625')) {
    if (!isRecord(value) || (value['globe'] !== undefined && value['globe'] !== EARTH)) continue;
    const position = toPosition(value['latitude'], value['longitude']);
    if (position) return position;
  }
  return undefined;
}

/** Ids of the items a statement points to (P31, P131). */
const itemIds = (entity: Entity, property: string) =>
  statements(entity, property)
    .map((value) => (isRecord(value) ? value['id'] : undefined))
    .filter(isQid);

function categoryOf(entity: Entity): PointCategory {
  for (const type of itemIds(entity, 'P31')) {
    const category = CATEGORY_OF.get(type);
    if (category) return category;
  }
  return 'other';
}

/**
 * Search order is relevance, not what the user expects while typing: a name
 * starting with the query first, then names with a word starting with each
 * word typed, then the rest. Every name the item has in the languages
 * fetched counts: "castelo" typed in a Spanish app matches "Castelo de
 * Leiria" although the app shows "Castillo de Leiria".
 */
function rankOf(names: readonly string[], query: string, tokens: readonly string[]): number {
  let best = 2;
  for (const name of names) {
    const folded = fold(name);
    if (folded.startsWith(query)) return 0;
    const words = [...folded.split(' '), ...folded.split(/[^\p{L}\p{N}]+/u)];
    if (tokens.every((token) => words.some((word) => word.startsWith(token)))) best = 1;
  }
  return best;
}

/** The item's names in the languages fetched, its own or standing in for another. */
const labelsOf = (entity: Entity): string[] =>
  Object.values(entity.labels ?? {}).flatMap((term) =>
    isRecord(term) && typeof term['value'] === 'string' ? [term['value']] : [],
  );

/**
 * How long to pause after the provider asked us to slow down: its
 * Retry-After (seconds or a date), else a minute; never more than an hour.
 */
function pauseSeconds(retryAfter: string | null, now: number): number {
  const value = retryAfter?.trim();
  if (value) {
    const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, MAX_PAUSE_S);
  }
  return DEFAULT_PAUSE_S;
}

/** Reads a body, refusing it as soon as it grows past `max` bytes. */
async function readBody(response: Response, max: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > max) {
    await response.body?.cancel().catch(() => {});
    throw new GeocodingError(502, 'too_large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new GeocodingError(502, 'too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** At most `max` tasks at once; the others wait in line (and leave it if they're aborted). */
class Slots {
  private active = 0;
  private readonly waiting = new Set<() => void>();

  constructor(private readonly max: number) {}

  async acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new GeocodingError(502, 'aborted');
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.waiting.delete(grant);
        reject(new GeocodingError(502, 'aborted'));
      };
      // release() hands its slot over: `active` doesn't change.
      const grant = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      this.waiting.add(grant);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  release(): void {
    const next = this.waiting.values().next();
    if (next.done) {
      this.active--;
      return;
    }
    this.waiting.delete(next.value);
    next.value();
  }
}

/** The promise, or the signal's reason as soon as the signal aborts. */
function whileWaiting<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

interface Flight<T> {
  promise: Promise<T>;
  controller: AbortController;
  waiting: number;
  settled: boolean;
}

export function createWikidataGeocoder(options: WikidataOptions): GeocodingProvider {
  const fetchJson = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const now = options.now ?? Date.now;
  const slots = new Slots(options.maxConcurrency ?? 4);
  const cache = new TtlCache<GeoSuggestion[] | ResolvedPlace>(CACHE_ENTRIES, CACHE_TTL_MS, now);
  const flights = new Map<string, Flight<unknown>>();
  /** Breaker: no upstream request before this time (epoch ms). */
  let pausedUntil = 0;

  const pause = (response: Response) => {
    const seconds = pauseSeconds(response.headers.get('retry-after'), now());
    pausedUntil = Math.max(pausedUntil, now() + seconds * 1000);
  };

  /** One GET to the Wikidata API: every limit and every failure mode in one place. */
  async function api(params: Record<string, string>, signal: AbortSignal): Promise<unknown> {
    if (now() < pausedUntil) throw new GeocodingError(503, 'paused');
    const url = `${ENDPOINT}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' })}`;
    await slots.acquire(signal);
    try {
      let response: Response;
      try {
        response = await fetchJson(url, {
          headers: { 'User-Agent': options.userAgent, Accept: 'application/json' },
          redirect: 'error',
          signal,
        });
      } catch {
        throw new GeocodingError(502, signal.aborted ? 'aborted' : 'network');
      }
      if (response.status === 429 || response.status >= 500) {
        pause(response);
        await response.body?.cancel().catch(() => {});
        throw new GeocodingError(503, response.status === 429 ? 'rate_limited' : 'upstream_down');
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new GeocodingError(502, 'upstream_status');
      }
      let data: unknown;
      try {
        data = JSON.parse(await readBody(response, maxBodyBytes));
      } catch (error) {
        if (error instanceof GeocodingError) throw error;
        throw new GeocodingError(502, signal.aborted ? 'aborted' : 'bad_response');
      }
      if (isRecord(data) && data['error'] !== undefined) {
        const code = isRecord(data['error']) ? data['error']['code'] : undefined;
        if (code === 'maxlag' || code === 'ratelimited') {
          pause(response);
          throw new GeocodingError(503, 'rate_limited');
        }
        throw new GeocodingError(502, 'upstream_error');
      }
      return data;
    } finally {
      slots.release();
    }
  }

  /**
   * Cached answers, and one upstream job per key at a time: identical
   * requests in flight share it. The job stops when nobody waits for it any
   * more; each caller stops waiting at its own deadline.
   */
  function shared<T extends GeoSuggestion[] | ResolvedPlace | null>(
    key: string,
    signal: AbortSignal,
    load: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const hit = cache.get(key);
    if (hit !== undefined) return Promise.resolve(hit as T);
    let flight = flights.get(key) as Flight<T> | undefined;
    if (!flight) {
      const controller = new AbortController();
      const created: Flight<T> = {
        controller,
        waiting: 0,
        settled: false,
        promise: load(controller.signal)
          .then((value) => {
            // Only answers are cached: never errors, never "no such place".
            if (value !== null) cache.set(key, value);
            return value;
          })
          .finally(() => {
            created.settled = true;
            if (flights.get(key) === created) flights.delete(key);
          }),
      };
      flights.set(key, created);
      flight = created;
    }
    const joined = flight;
    joined.waiting++;
    return whileWaiting(joined.promise, signal).finally(() => {
      joined.waiting--;
      if (joined.waiting === 0 && !joined.settled) {
        joined.controller.abort();
        if (flights.get(key) === joined) flights.delete(key);
      }
    });
  }

  /** Errors a caller can get: GeocodingError, with its own deadline told apart from leaving. */
  function asGeocodingError(error: unknown, signal: AbortSignal): unknown {
    if (error instanceof GeocodingError || !signal.aborted || error !== signal.reason) return error;
    const timedOut = (signal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError';
    return new GeocodingError(502, timedOut ? 'timeout' : 'aborted');
  }

  /** QIDs of a full-text search for items with coordinates. */
  async function search(
    terms: readonly string[],
    near: LatLng | undefined,
    km: number,
    signal: AbortSignal,
  ): Promise<string[]> {
    const where = near ? ` nearcoord:${km}km,${near.lat.toFixed(3)},${near.lng.toFixed(3)}` : '';
    const data = await api(
      {
        action: 'query',
        list: 'search',
        srsearch: `${terms.join(' ')} haswbstatement:P625${where}`,
        srnamespace: '0',
        srlimit: String(SEARCH_LIMIT),
        srprop: '',
      },
      signal,
    );
    const hits = isRecord(data) && isRecord(data['query']) ? data['query']['search'] : undefined;
    return Array.isArray(hits)
      ? hits.map((hit) => (isRecord(hit) ? hit['title'] : undefined)).filter(isQid)
      : [];
  }

  /**
   * Items by id. A batch over the body limit (a country's statements alone
   * weigh over 500 KB) goes again in halves, within ITEM_REQUESTS requests in
   * all; what still doesn't fit is left out, so a few huge hits never sink
   * the whole search nor multiply its cost.
   */
  async function entities(
    ids: readonly string[],
    props: string,
    locale: Locale,
    signal: AbortSignal,
    budget = { left: ITEM_REQUESTS },
  ): Promise<Map<string, Entity>> {
    if (budget.left <= 0) return new Map();
    budget.left--;
    let data: unknown;
    try {
      data = await api(
        {
          action: 'wbgetentities',
          ids: ids.join('|'),
          props,
          languages: languagesFor(locale).join('|'),
          languagefallback: '1',
        },
        signal,
      );
    } catch (error) {
      if (!(error instanceof GeocodingError && error.reason === 'too_large')) throw error;
      if (ids.length === 1) return new Map();
      const half = Math.ceil(ids.length / 2);
      const parts = await Promise.all([
        entities(ids.slice(0, half), props, locale, signal, budget),
        entities(ids.slice(half), props, locale, signal, budget),
      ]);
      return new Map(parts.flatMap((part) => [...part]));
    }
    const found = new Map<string, Entity>();
    const all = isRecord(data) && isRecord(data['entities']) ? data['entities'] : {};
    for (const [requested, entity] of Object.entries(all)) {
      if (!isRecord(entity) || !isQid(entity['id']) || entity['missing'] !== undefined) continue;
      // A redirected id answers with its target: findable by both.
      found.set(requested, entity as unknown as Entity);
      found.set(entity['id'], entity as unknown as Entity);
    }
    return found;
  }

  const nameOf = (entity: Entity, locale: Locale) =>
    cut(pickText(entity.labels, languagesFor(locale)), NAME_MAX);

  function toSuggestion(
    entity: Entity,
    locale: Locale,
    near: LatLng | undefined,
  ): GeoSuggestion | undefined {
    const name = nameOf(entity, locale);
    const position = positionOf(entity);
    if (!name || !position) return undefined;
    const description = cut(pickText(entity.descriptions, languagesFor(locale)), TEXT_MAX);
    return {
      key: `wikidata:${entity.id}`,
      name,
      ...(description ? { description } : {}),
      position,
      category: categoryOf(entity),
      externalId: entity.id,
      ...(near ? { distanceMeters: Math.round(distance(near, position)) } : {}),
      storable: true,
    };
  }

  /**
   * Strategy for a place, measured near Leiria: prefix searches work on
   * whole words ("mosteiro bat*") but not always ("espirito sant*" finds
   * nothing while "espirito santo" does), so with fewer than 3 hits it tries
   * (b) the last word complete, then (c) without it; (d) with a position and
   * still nothing, the prefix search 100 km around.
   */
  async function searchPlaces(
    tokens: readonly string[],
    near: LatLng | undefined,
    signal: AbortSignal,
  ): Promise<string[]> {
    const found = new Set<string>();
    const run = async (terms: readonly string[], km: number) => {
      for (const id of await search(terms, near, km, signal)) found.add(id);
    };
    const last = tokens.at(-1) ?? '';
    const prefix = Array.from(last).length >= 2 ? [...tokens.slice(0, -1), `${last}*`] : tokens;
    await run(prefix, NEAR_KM);
    if (found.size < ENOUGH_HITS && prefix !== tokens) await run(tokens, NEAR_KM);
    const shorter = tokens.slice(0, -1);
    if (found.size < ENOUGH_HITS && isSearchable(shorter)) await run(shorter, NEAR_KM);
    if (found.size === 0 && near) await run(prefix, WIDE_KM);
    return [...found];
  }

  async function suggestPlaces(
    tokens: readonly string[],
    near: LatLng | undefined,
    locale: Locale,
    limit: number,
    signal: AbortSignal,
  ): Promise<GeoSuggestion[]> {
    const ids = (await searchPlaces(tokens, near, signal)).slice(0, limit + EXTRA_ITEMS);
    if (ids.length === 0) return [];
    const items = await entities(ids, 'labels|descriptions|claims', locale, signal);
    const query = tokens.join(' ');
    return ids
      .flatMap((id) => {
        const entity = items.get(id);
        const place = entity && toSuggestion(entity, locale, near);
        return entity && place ? [{ entity, place }] : [];
      })
      .map(({ entity, place }, index) => ({
        place,
        index,
        rank: rankOf([place.name, ...labelsOf(entity)], query, tokens),
      }))
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          (a.place.distanceMeters ?? 0) - (b.place.distanceMeters ?? 0) ||
          a.index - b.index,
      )
      .slice(0, limit)
      .map(({ place }) => place);
  }

  /** Coordinates of items, by id (prop=coordinates: far lighter than their statements). */
  async function coordinatesOf(
    ids: readonly string[],
    signal: AbortSignal,
  ): Promise<Map<string, LatLng>> {
    const data = await api(
      { action: 'query', prop: 'coordinates', titles: ids.join('|'), colimit: 'max' },
      signal,
    );
    const pages = isRecord(data) && isRecord(data['query']) ? data['query']['pages'] : undefined;
    const found = new Map<string, LatLng>();
    for (const page of Array.isArray(pages) ? pages : []) {
      if (!isRecord(page) || !isQid(page['title']) || !Array.isArray(page['coordinates'])) continue;
      for (const point of page['coordinates']) {
        if (!isRecord(point) || (point['globe'] !== undefined && point['globe'] !== 'earth')) {
          continue;
        }
        const position = toPosition(point['lat'], point['lon']);
        if (position) {
          found.set(page['title'], position);
          break;
        }
      }
    }
    return found;
  }

  async function suggestAreas(
    query: string,
    locale: Locale,
    limit: number,
    signal: AbortSignal,
  ): Promise<GeoSuggestion[]> {
    const data = await api(
      {
        action: 'wbsearchentities',
        search: query,
        language: locale,
        uselang: locale,
        type: 'item',
        limit: String(limit + EXTRA_AREAS),
      },
      signal,
    );
    const hits = (isRecord(data) && Array.isArray(data['search']) ? data['search'] : [])
      .filter(isRecord)
      .filter((hit) => isQid(hit['id']));
    if (hits.length === 0) return [];
    const positions = await coordinatesOf(
      hits.map((hit) => hit['id'] as string),
      signal,
    );
    const display = (hit: Record<string, unknown>, field: 'label' | 'description') => {
      const shown = isRecord(hit['display']) ? hit['display'][field] : undefined;
      const value = isRecord(shown) ? shown['value'] : hit[field];
      return typeof value === 'string' ? value : undefined;
    };
    const areas: GeoSuggestion[] = [];
    for (const hit of hits) {
      const id = hit['id'] as string;
      const position = positions.get(id);
      const name = cut(display(hit, 'label'), NAME_MAX);
      if (!position || !name) continue;
      const description = cut(display(hit, 'description'), TEXT_MAX);
      areas.push({
        key: `wikidata:${id}`,
        name,
        ...(description ? { description } : {}),
        position,
        externalId: id,
        storable: true,
      });
    }
    return areas.slice(0, limit);
  }

  /** The street address (P6375), else the names of the administrative areas it is in (P131). */
  async function addressOf(
    entity: Entity,
    locale: Locale,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    for (const value of statements(entity, 'P6375')) {
      const street = isRecord(value) && typeof value['text'] === 'string' ? value['text'] : '';
      const address = cut(street, TEXT_MAX);
      if (address) return address;
    }
    const areaIds = [...new Set(itemIds(entity, 'P131'))].slice(0, ADDRESS_AREAS);
    if (areaIds.length === 0) return undefined;
    const areas = await entities(areaIds, 'labels', locale, signal);
    const names = areaIds
      .map((id) => areas.get(id))
      .map((area) => area && nameOf(area, locale))
      .filter((name): name is string => name !== undefined);
    return cut(names.join(', '), TEXT_MAX);
  }

  async function resolvePlace(
    id: string,
    locale: Locale,
    signal: AbortSignal,
  ): Promise<ResolvedPlace | null> {
    const entity = (await entities([id], 'labels|claims', locale, signal)).get(id);
    if (!entity) return null;
    const name = nameOf(entity, locale);
    const position = positionOf(entity);
    if (!name || !position) return null;
    const address = await addressOf(entity, locale, signal);
    return {
      key: `wikidata:${entity.id}`,
      name,
      ...(address ? { address } : {}),
      position,
      category: categoryOf(entity),
      externalId: entity.id,
      storable: true,
    };
  }

  return {
    async suggest(input: SuggestInput, signal: AbortSignal): Promise<GeoSuggestion[]> {
      try {
        signal.throwIfAborted();
        const normalized = normalizeQuery(input.q);
        if (input.kind === 'area') {
          const query = fold(normalized);
          // Nothing worth a search: no upstream request, nothing cached.
          if (!isSearchable(query.split(' '))) return [];
          const key = `area|${input.locale}|${query}|-|${input.limit}`;
          return await shared(key, signal, (job) =>
            suggestAreas(query, input.locale, input.limit, job),
          );
        }
        const tokens = placeTokens(normalized);
        if (!isSearchable(tokens)) return [];
        const near = center(input.near);
        const where = near ? `${near.lat.toFixed(3)},${near.lng.toFixed(3)}` : '-';
        const key = `place|${input.locale}|${tokens.join(' ')}|${where}|${input.limit}`;
        return await shared(key, signal, (job) =>
          suggestPlaces(tokens, near, input.locale, input.limit, job),
        );
      } catch (error) {
        throw asGeocodingError(error, signal);
      }
    },

    async resolve(key: string, locale: Locale, signal: AbortSignal): Promise<ResolvedPlace | null> {
      try {
        signal.throwIfAborted();
        const id = KEY.exec(key)?.[1];
        if (!id) return null;
        return await shared(`resolve|${locale}|${key}`, signal, (job) =>
          resolvePlace(id, locale, job),
        );
      } catch (error) {
        throw asGeocodingError(error, signal);
      }
    },
  };
}
