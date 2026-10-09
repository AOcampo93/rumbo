import {
  CONTENT_GROUNDINGS,
  type ContentGenerateBody,
  type ContentGrounding,
  type GeneratedCard,
  GeneratedCardSchema,
  INTERESTS,
  type Interest,
} from '@rumbo/api-contract';
import {
  type ArrivalChoice,
  type ArrivalType,
  arrivalTypeOf,
  buildRouteSpec,
  DRAFT_LIMITS,
  type DraftIssue,
  type DraftPlace,
  draftFromSpec,
  type DraftSummary,
  findOverlaps,
  newIdSuffix,
  type Overlap,
  RouteBuildError,
  type RouteDraft,
  summarizeDraft,
  truncateText,
  validateDraft,
} from '@rumbo/route-builder';
import {
  type Activity,
  ActivitySchema,
  type Issue,
  type LatLng,
  LatLngSchema,
  type Locale,
  LocaleSchema,
  type NormalizedRouteSpec,
  PointCategorySchema,
  type PointContent,
  type RouteBundle,
  type RouteMode,
  RouteModeSchema,
  type RouteSettingsInput,
  RouteSettingsInputSchema,
  type RouteSpec,
  validateRouteBundle,
} from '@rumbo/route-spec';
import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { z } from 'zod';
import { currentLocale } from '../i18n/index.ts';
import { AiError, type AiErrorCode, BLOCKING_AI_ERRORS } from '../services/ai.ts';
import { track } from '../services/analytics.ts';
import { generateCard } from '../services/content.ts';
import { getMyRoute, MyRoutesError, saveMyRoute } from '../services/myRoutes.ts';
import { db, KEYS } from '../services/storage.ts';
import { useCatalogStore } from './catalog.ts';
import { useUiStore } from './ui.ts';

// The route creator's state (C1-C5, phases 6 and 7): one draft, kept in
// IndexedDB as the user goes (a reload or a closed tab never loses it),
// validated step by step with route-builder, built into a RouteSpec and saved
// as one of the user's routes (services/myRoutes.ts). Phase 7 adds the AI
// guide: the draft keeps the card of each place (generated while the user
// moves through the steps, two at a time) and ships the ready ones with the
// route; a place without one gets the basic sheet. Each place also picks what
// it shows on arrival (`arrival`): only the ones that use the AI card get one.

/** What the creator keeps between sessions (`create:draft`). */
export interface CreatorDraft {
  v: 1;
  /** Grows with every stored version; with tabId, tells another tab's newer draft apart. */
  rev: number;
  /** The tab that stored this version. */
  tabId: string;
  /** The saved route being edited, or null for a new one. */
  editingId: string | null;
  /** The new route id's suffix (newIdSuffix()), fixed for the whole draft. */
  idSuffix: string;
  /** The app's language when the draft started; the route's own when editing (ADR 0001). */
  locale: Locale;
  name: string;
  mode: RouteMode;
  activity: Activity;
  /** Challenges only. */
  timeLimitMinutes: number | null;
  /** The city or area of step 1: centres the map and the search; not saved in the route. */
  area: { name: string; position: LatLng } | null;
  /** In route order; tempId is a random UUID, pointId is kept when editing. */
  places: DraftPlace[];
  /** What the AI adapts suggestions and cards to, in INTERESTS order. */
  interests?: Interest[];
  /** A line about the route (the AI suggests one with its places); at most 280 characters. */
  summary?: string;
  /**
   * The switch of the review step: save the route as public, for the
   * community (phase 7.2). Off for a new route; an edited one starts with
   * the route's visibility. Drafts from before it have none and read as off.
   */
  publish: boolean;
  /**
   * The card of each place by tempId (step 3). A place without an entry has
   * not been looked at yet; a `ready` one ships with the route.
   */
  cards: Record<string, CardState>;
  /** Kept from the edited route. */
  settingsOverrides?: RouteSettingsInput;
  updatedAt: string;
}

export type CardStatus = 'pending' | 'generating' | 'ready' | 'error' | 'basic';

/** A place's card while the user prepares the route. */
export interface CardState {
  status: CardStatus;
  /** The card exactly as the API made it, without an id (`ready`). */
  content?: GeneratedCard;
  grounding?: ContentGrounding;
  /** Why it failed (`error`). */
  error?: AiErrorCode;
}

export type CreatorStep = 'details' | 'places' | 'content' | 'review';
export const CREATOR_STEPS: readonly CreatorStep[] = ['details', 'places', 'content', 'review'];

export type DraftPatch = Partial<
  Pick<
    CreatorDraft,
    | 'name'
    | 'summary'
    | 'mode'
    | 'activity'
    | 'timeLimitMinutes'
    | 'area'
    | 'interests'
    | 'settingsOverrides'
    | 'publish'
  >
>;
/** A place to add; `tempId` is made when missing (pass one to refer to the place right away). */
export type NewPlace = Omit<DraftPlace, 'tempId' | 'pointId'> & { tempId?: string };
export type PlacePatch = Partial<Omit<DraftPlace, 'tempId' | 'pointId'>>;

/** build(): the route ready to save and run, or what keeps it from being one. */
export type BuildResult =
  | {
      ok: true;
      spec: RouteSpec;
      normalized: NormalizedRouteSpec;
      warnings: Issue[];
      /** The ready cards by contentRef, in the route's language. */
      contents: RouteBundle['contents'];
    }
  /** `issues`: the draft's (validateDraft); `errors`: the built route's (rare: a broken place). */
  | { ok: false; issues: DraftIssue[]; errors: Issue[] };

/** What a place that doesn't use the AI card shows on arrival. */
export type OtherArrival = Exclude<ArrivalType, 'card'>;

/** How the cards of the places are going, for the screens of step 3 and 4. */
export interface CardStats {
  /** The places that use the AI card; the numbers below split them. */
  total: number;
  /** Ready to ship with the route. */
  ready: number;
  basic: number;
  /** Waiting for a free slot. */
  pending: number;
  generating: number;
  error: number;
  /** The other places, by what they show on arrival. */
  arrivals: Record<OtherArrival, number>;
}

const AUTOSAVE_MS = 300;
/** A route's summary, in code points (the route schema's limit). */
const SUMMARY_MAX = 280;
/** Cards asked for at once. */
const CARD_CONCURRENCY = 2;
/** The API's pattern for a Wikidata id; other ids (a geocoder's) are researched like custom points. */
const QID = /^Q\d{1,12}$/;

/** A random UUID, also where crypto.randomUUID is missing (older browsers). */
function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const PlaceSchema = z.object({
  tempId: z.string().min(1),
  pointId: z.string().optional(),
  name: z.string(),
  position: LatLngSchema,
  address: z.string().optional(),
  externalId: z.string().optional(),
  category: PointCategorySchema.optional(),
  radius: z.number().optional(),
  required: z.boolean().optional(),
  /** Read apart (cleanArrival): a broken choice must not cost the place. */
  arrival: z.unknown().optional(),
  contentRef: z.string().optional(),
});

/** A stored choice, loosely: validateDraft decides what an incomplete one is worth. */
const StoredArrivalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('card') }),
  z.object({ type: z.literal('basic') }),
  z.object({
    type: z.literal('quiz'),
    question: z.string(),
    options: z.array(z.string()),
    correctIndex: z.number(),
    explanation: z.string().optional(),
  }),
  z.object({ type: z.literal('video'), youtubeId: z.string(), title: z.string().optional() }),
  z.object({ type: z.literal('link'), url: z.string(), label: z.string() }),
  z.object({ type: z.literal('check') }),
]);

/**
 * The choice of a stored place. The default (the card) is stored as no choice,
 * and one that can't be read is dropped, with `broken` told, so the place keeps
 * working with the card.
 */
function cleanArrival(raw: unknown, broken: () => void): ArrivalChoice | undefined {
  if (raw === undefined) return undefined;
  const parsed = StoredArrivalSchema.safeParse(raw);
  if (!parsed.success) {
    broken();
    return undefined;
  }
  return parsed.data.type === 'card' ? undefined : parsed.data;
}

const AiErrorCodeSchema = z.enum([
  'offline',
  'ai_unavailable',
  'ai_budget_exceeded',
  'ai_device_limit',
  'failed',
]);

/** Stored cards, loosely: cleanCards decides what each one is worth. */
const StoredCardSchema = z.object({
  status: z.enum(['pending', 'generating', 'ready', 'error', 'basic']),
  content: GeneratedCardSchema.optional(),
  grounding: z.enum(CONTENT_GROUNDINGS).optional(),
  error: AiErrorCodeSchema.optional(),
});

/** The place shows the AI card (or the basic sheet when none is ready): the default arrival. */
const usesCard = (place: DraftPlace): boolean => arrivalTypeOf(place) === 'card';

/** The interests in INTERESTS order, once each; whatever else a stored route had is dropped. */
const knownInterests = (values: readonly string[]): Interest[] =>
  INTERESTS.filter((interest) => values.includes(interest));

/** Where a card's text came from, as far as its sources tell (cards read back from a saved route). */
function groundingOf(card: GeneratedCard): ContentGrounding {
  if (card.sources.length === 0) return 'none';
  return card.sources.some((source) => /(^|\.)wikipedia\.org$/.test(new URL(source.url).hostname))
    ? 'wikipedia'
    : 'web';
}

/** A saved card without the id its contentRef gave it: the form the API produced and recognises. */
function withoutId(card: PointContent): GeneratedCard {
  const copy: Record<string, unknown> = { ...card };
  delete copy['id'];
  return copy as GeneratedCard;
}

/**
 * What stored cards are worth after a reload: a request that was under way
 * died with the page and an error is not worth remembering, so both are
 * pending again; a ready card needs its content and its place's contentRef;
 * a card of a place that is gone is dropped. `broken` says when something
 * could not be made sense of.
 */
function cleanCards(
  raw: unknown,
  places: readonly DraftPlace[],
  broken: () => void,
): Record<string, CardState> {
  const cards: Record<string, CardState> = {};
  if (raw === undefined || raw === null) return cards;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    broken();
    return cards;
  }
  for (const place of places) {
    // A place with its own arrival has no card: whatever is stored for it is dropped.
    if (!usesCard(place) || !Object.hasOwn(raw, place.tempId)) continue;
    const parsed = StoredCardSchema.safeParse((raw as Record<string, unknown>)[place.tempId]);
    if (!parsed.success) {
      broken();
      continue;
    }
    const { status, content, grounding } = parsed.data;
    if (status === 'basic') cards[place.tempId] = { status };
    else if (status === 'ready') {
      if (content && place.contentRef) {
        cards[place.tempId] = {
          status,
          content,
          grounding: grounding ?? groundingOf(content),
        };
      } else {
        broken();
        cards[place.tempId] = { status: 'pending' };
      }
    } else cards[place.tempId] = { status: 'pending' };
  }
  return cards;
}

/**
 * A stored draft, field by field: a broken field gets its default and the
 * draft says it was `repaired`. Null when it isn't a version 1 draft at all.
 */
function parseDraft(
  raw: unknown,
  tabId: string,
): { draft: CreatorDraft; repaired: boolean } | null {
  let repaired = false;
  const fallback =
    <T>(value: () => T) =>
    (): T => {
      repaired = true;
      return value();
    };
  const schema = z.object({
    v: z.literal(1),
    rev: z
      .number()
      .int()
      .nonnegative()
      .catch(fallback(() => 0)),
    tabId: z.string().catch(fallback(() => tabId)),
    editingId: z
      .string()
      .regex(/^[a-z0-9-]{3,64}$/)
      .nullable()
      .catch(fallback(() => null)),
    idSuffix: z
      .string()
      .regex(/^[a-z0-9]{10}$/)
      .catch(fallback(newIdSuffix)),
    locale: LocaleSchema.catch(fallback(currentLocale)),
    name: z.string().catch(fallback(() => '')),
    mode: RouteModeSchema.catch(fallback((): RouteMode => 'free')),
    activity: ActivitySchema.catch(fallback((): Activity => 'walk')),
    timeLimitMinutes: z
      .number()
      .int()
      .positive()
      .nullable()
      .catch(fallback(() => null)),
    area: z
      .object({ name: z.string(), position: LatLngSchema })
      .nullable()
      .catch(fallback(() => null)),
    places: z
      .array(z.unknown())
      .catch(fallback((): unknown[] => []))
      .transform((items) => {
        const places: DraftPlace[] = [];
        const seen = new Set<string>();
        for (const item of items) {
          const parsed = PlaceSchema.safeParse(item);
          if (!parsed.success) {
            repaired = true;
            continue;
          }
          const { arrival, ...rest } = parsed.data;
          const place: DraftPlace = rest;
          const choice = cleanArrival(arrival, () => {
            repaired = true;
          });
          if (choice) place.arrival = choice;
          if (seen.has(place.tempId)) {
            repaired = true;
            place.tempId = randomId();
          }
          seen.add(place.tempId);
          places.push(place);
        }
        return places;
      }),
    interests: z
      .array(z.string())
      .optional()
      .catch(fallback(() => undefined))
      .transform((list) => (list === undefined ? undefined : knownInterests(list))),
    summary: z
      .string()
      .optional()
      .catch(fallback(() => undefined)),
    // A draft from before phase 7.2 has none: nothing to repair, it just isn't published.
    publish: z
      .boolean()
      .optional()
      .catch(fallback(() => undefined))
      .transform((value) => value ?? false),
    cards: z.unknown().optional(),
    settingsOverrides: RouteSettingsInputSchema.optional().catch(fallback(() => undefined)),
    updatedAt: z.string().catch(fallback(() => new Date().toISOString())),
  });
  const result = schema.safeParse(raw);
  if (!result.success) return null;
  const { cards, ...rest } = result.data;
  // A draft from before phase 7 has no cards: nothing to repair.
  const draft: CreatorDraft = {
    ...rest,
    cards: cleanCards(cards, rest.places, () => {
      repaired = true;
    }),
  };
  return { draft, repaired };
}

/** Everything but the version bookkeeping: what autosave compares and stores. */
function contentJson(draft: CreatorDraft): string {
  return JSON.stringify({ ...draft, rev: 0, tabId: '', updatedAt: '' });
}

const hasContentIn = (draft: CreatorDraft | null): boolean =>
  draft !== null && (draft.name.trim() !== '' || draft.places.length > 0);

/** A place as stored: plain data, never a reactive proxy. */
const plainPlace = (place: DraftPlace): DraftPlace =>
  JSON.parse(JSON.stringify(place)) as DraftPlace;

/** The card that ships with the route for this place, if it has one. */
const shippedCard = (place: DraftPlace, card: CardState | undefined): GeneratedCard | null =>
  usesCard(place) && card?.status === 'ready' && card.content && place.contentRef
    ? card.content
    : null;

/** A place as route-builder sees it: it points to its card only when there is one to ship. */
function placeForRoute(place: DraftPlace, card: CardState | undefined): DraftPlace {
  const copy = plainPlace(place);
  if (!shippedCard(place, card)) delete copy.contentRef;
  return copy;
}

/** A card step 3 still has to ask for: never looked at, waiting, or waiting for a connection. */
const needsCard = (card: CardState | undefined): boolean =>
  !card || card.status === 'pending' || (card.status === 'error' && card.error === 'offline');

/**
 * The cards of a saved route's places, read back from its bundle for editing.
 * A place whose bundle has no card for it used the basic sheet and stays so
 * until the user asks for a card (this never spends the AI budget by itself).
 * Mutates `places`: a place without a card loses its contentRef.
 */
function cardsFromBundle(
  places: DraftPlace[],
  contents: RouteBundle['contents'],
  locale: Locale,
): Record<string, CardState> {
  const cards: Record<string, CardState> = {};
  for (const place of places) {
    if (!usesCard(place)) continue;
    const ref = place.contentRef;
    const saved = ref && Object.hasOwn(contents, ref) ? contents[ref]?.[locale] : undefined;
    if (!saved) {
      delete place.contentRef;
      cards[place.tempId] = { status: 'basic' };
      continue;
    }
    const content = withoutId(saved);
    cards[place.tempId] = { status: 'ready', content, grounding: groundingOf(content) };
  }
  return cards;
}

/** The cards to ship, by contentRef, in the draft's language (the form the bundle stores). */
function contentsFor(draft: CreatorDraft): RouteBundle['contents'] {
  const contents: RouteBundle['contents'] = {};
  for (const place of draft.places) {
    const card = shippedCard(place, draft.cards[place.tempId]);
    if (!card || !place.contentRef) continue;
    const content = JSON.parse(JSON.stringify({ ...card, id: place.contentRef })) as PointContent;
    contents[place.contentRef] = { [draft.locale]: content };
  }
  return contents;
}

/** Cuts a name to the limit without trimming it (the user may be typing a space). */
const capName = (name: string): string =>
  [...name].length > DRAFT_LIMITS.nameMax
    ? [...name].slice(0, DRAFT_LIMITS.nameMax).join('')
    : name;

const isDraftFor = (stored: unknown, id: string): boolean =>
  typeof stored === 'object' &&
  stored !== null &&
  (stored as { editingId?: unknown }).editingId === id;

/** What the API needs to write a place's card (POST /content/generate). */
function requestFor(place: DraftPlace, draft: CreatorDraft): ContentGenerateBody {
  const externalId = place.externalId && QID.test(place.externalId) ? place.externalId : undefined;
  return {
    name: truncateText(place.name, DRAFT_LIMITS.nameMax),
    position: { lat: place.position.lat, lng: place.position.lng },
    // The route's language, not whatever the app speaks now: the card must match the bundle.
    locale: draft.locale,
    ...(place.category ? { category: place.category } : {}),
    ...(externalId ? { externalId } : {}),
    interests: [...(draft.interests ?? [])],
    // No Wikidata item: the API looks for one by name, and the web if Wikipedia has nothing.
    custom: externalId === undefined,
  };
}

export const useCreatorStore = defineStore('creator', () => {
  const catalog = useCatalogStore();
  const ui = useUiStore();
  /** This tab, for telling its stored drafts from other tabs'. */
  const tabId = randomId();

  const draft = ref<CreatorDraft | null>(null);
  /** The route saved last, for C5 (the draft is gone by then). */
  const savedId = ref<string | null>(null);
  const saving = ref(false);
  /** The draft could not be stored on this device (shown once as a banner). */
  const storageOff = ref(false);
  /** The draft came back from storage (a reload, another tab) with something in it. */
  const recovered = ref(false);

  let autosaveOn = true;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The content stored last (contentJson), so unchanged drafts are never written. */
  let lastStoredJson: string | null = null;

  /** Loads the stored draft once. Never rejects: a broken draft is kept aside and the creator starts fresh. */
  const ready: Promise<void> = (async () => {
    try {
      const raw = await db.getChecked<unknown>(KEYS.creatorDraft);
      if (raw === undefined) return;
      const parsed = parseDraft(raw, tabId);
      if (!parsed || parsed.repaired) await db.set(KEYS.creatorDraftBackup, raw);
      if (!parsed) return;
      draft.value = parsed.draft;
      lastStoredJson = contentJson(parsed.draft);
      recovered.value = hasContentIn(parsed.draft);
    } catch (error) {
      console.warn('creator: the draft could not be read', error);
    }
  })();

  // ------------------------------------------------------------ getters

  /** The draft in route-builder's terms: a plain deep copy. */
  const routeDraft = computed<RouteDraft | null>(() => {
    const current = draft.value;
    if (!current) return null;
    const summaryText = truncateText(current.summary ?? '', SUMMARY_MAX);
    return {
      name: current.name,
      ...(summaryText ? { summary: summaryText } : {}),
      locale: current.locale,
      mode: current.mode,
      activity: current.activity,
      timeLimit: current.timeLimitMinutes === null ? null : current.timeLimitMinutes * 60,
      places: current.places.map((place) => placeForRoute(place, current.cards[place.tempId])),
      ...(current.interests ? { interests: [...current.interests] } : {}),
      ...(current.settingsOverrides
        ? {
            settingsOverrides: JSON.parse(
              JSON.stringify(current.settingsOverrides),
            ) as RouteSettingsInput,
          }
        : {}),
    };
  });

  const hasContent = computed(() => hasContentIn(draft.value));
  const summary = computed<DraftSummary | null>(() =>
    routeDraft.value ? summarizeDraft(routeDraft.value) : null,
  );
  const overlaps = computed<Overlap[]>(() =>
    routeDraft.value
      ? findOverlaps(
          routeDraft.value.places,
          routeDraft.value.settingsOverrides?.defaultRadius ?? DRAFT_LIMITS.radius.default,
        )
      : [],
  );
  /** tempIds of the places whose zone overlaps another one. */
  const overlapIds = computed(
    () => new Set(overlaps.value.flatMap((overlap) => [overlap.a, overlap.b])),
  );
  const issues = computed<DraftIssue[]>(() =>
    routeDraft.value ? validateDraft(routeDraft.value) : [],
  );

  /**
   * What blocks a step: details (name, time limit), places (the list), review
   * (everything). The cards never block: a place without one gets the basic sheet.
   */
  function stepIssues(step: CreatorStep): DraftIssue[] {
    if (step === 'details')
      return issues.value.filter((issue) => issue.field === 'name' || issue.field === 'timeLimit');
    if (step === 'places')
      return issues.value.filter(
        (issue) => issue.field === 'places' || issue.field.startsWith('places.'),
      );
    if (step === 'content') return [];
    return issues.value;
  }

  /** How the cards are going: ready ones ship, the rest of the places use the basic sheet. */
  const cardStats = computed<CardStats>(() => {
    const stats: CardStats = {
      total: 0,
      ready: 0,
      basic: 0,
      pending: 0,
      generating: 0,
      error: 0,
      arrivals: { basic: 0, quiz: 0, video: 0, link: 0, check: 0 },
    };
    const current = draft.value;
    if (!current) return stats;
    for (const place of current.places) {
      const type = arrivalTypeOf(place);
      if (type !== 'card') {
        stats.arrivals[type] += 1;
        continue;
      }
      stats.total += 1;
      const card = current.cards[place.tempId];
      const status = card?.status;
      if (shippedCard(place, card)) stats.ready += 1;
      // A ready card with nothing to ship (never stored that way) is asked for again.
      else if (status === undefined || status === 'ready') stats.pending += 1;
      else stats[status] += 1;
    }
    return stats;
  });

  /** Places whose card step 3 still has to prepare (never looked at, waiting, or waiting for a connection). */
  const cardsToPrepare = computed(() => {
    const current = draft.value;
    return current
      ? current.places.filter((place) => usesCard(place) && needsCard(current.cards[place.tempId]))
      : [];
  });

  /** Where a resumed draft opens: the first step with something missing. */
  const resumeStep = computed<CreatorStep>(() => {
    if (stepIssues('details').length > 0) return 'details';
    if (stepIssues('places').length > 0) return 'places';
    if (cardsToPrepare.value.length > 0) return 'content';
    return 'review';
  });

  /** The route as it would be saved, or why it can't be yet. */
  function build(): BuildResult {
    const current = draft.value;
    const input = routeDraft.value;
    if (!current || !input) return { ok: false, issues: [], errors: [] };
    const problems = validateDraft(input);
    if (problems.length > 0) return { ok: false, issues: problems, errors: [] };
    try {
      return {
        ok: true,
        ...buildRouteSpec(input, {
          source: 'user',
          ...(current.editingId ? { id: current.editingId } : {}),
          idFactory: () => current.idSuffix,
        }),
        contents: contentsFor(current),
      };
    } catch (error) {
      if (error instanceof RouteBuildError) return { ok: false, issues: [], errors: error.issues };
      throw error;
    }
  }

  // ------------------------------------------------------------ autosave

  function cancelAutosave(): void {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  /** Stores the draft now if it changed since it was stored last. */
  async function flush(): Promise<void> {
    cancelAutosave();
    const current = draft.value;
    if (!current || !autosaveOn) return;
    const json = contentJson(current);
    if (json === lastStoredJson) return;
    // Never smaller than the clock, so a newer draft from any tab has a bigger rev.
    const rev = Math.max(current.rev + 1, Date.now());
    const updatedAt = new Date().toISOString();
    try {
      await db.setChecked(KEYS.creatorDraft, {
        ...(JSON.parse(json) as CreatorDraft),
        rev,
        tabId,
        updatedAt,
      });
    } catch (error) {
      console.warn('creator: the draft could not be stored', error);
      storageOff.value = true;
      return;
    }
    if (draft.value !== current) return;
    lastStoredJson = json;
    // Bookkeeping only: contentJson ignores these, so this doesn't store again.
    current.rev = rev;
    current.tabId = tabId;
    current.updatedAt = updatedAt;
  }

  watch(
    () => (draft.value ? contentJson(draft.value) : null),
    (json) => {
      if (json === null || json === lastStoredJson || !autosaveOn) return;
      cancelAutosave();
      autosaveTimer = setTimeout(() => {
        autosaveTimer = null;
        void flush();
      }, AUTOSAVE_MS);
    },
  );

  /** Back from another tab: if it stored a newer draft meanwhile, continue with that one. */
  async function adoptNewer(): Promise<void> {
    await ready;
    if (!autosaveOn || saving.value) return;
    let raw: unknown;
    try {
      raw = await db.getChecked<unknown>(KEYS.creatorDraft);
    } catch {
      return;
    }
    const parsed = raw === undefined ? null : parseDraft(raw, tabId);
    if (!parsed || parsed.draft.tabId === tabId) return;
    const current = draft.value;
    if (current && parsed.draft.rev <= current.rev) return;
    cancelAutosave();
    stopCards();
    draft.value = parsed.draft;
    lastStoredJson = contentJson(parsed.draft);
    recovered.value = hasContentIn(parsed.draft);
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void flush();
    else void adoptNewer();
  };
  const onPageHide = () => void flush();
  globalThis.document?.addEventListener('visibilitychange', onVisibility);
  globalThis.addEventListener?.('pagehide', onPageHide);
  onScopeDispose(() => {
    cancelAutosave();
    stopCards();
    globalThis.document?.removeEventListener('visibilitychange', onVisibility);
    globalThis.removeEventListener?.('pagehide', onPageHide);
  });

  /**
   * No more autosaving (until a new draft starts), e.g. before "Delete my local
   * data". Cards on their way are given up too: nothing may spend the AI budget
   * for a draft that is going away.
   */
  function stopAutosave(): void {
    cancelAutosave();
    stopCards();
    autosaveOn = false;
  }

  // ------------------------------------------------------------ the draft

  function freshDraft(): CreatorDraft {
    return {
      v: 1,
      rev: 0,
      tabId,
      editingId: null,
      idSuffix: newIdSuffix(),
      locale: currentLocale(),
      name: '',
      mode: 'free',
      activity: 'walk',
      timeLimitMinutes: null,
      area: null,
      places: [],
      publish: false,
      cards: {},
      updatedAt: new Date().toISOString(),
    };
  }

  /** A new, empty draft in place of the current one. */
  async function startNew(): Promise<void> {
    await ready;
    cancelAutosave();
    stopCards();
    draft.value = freshDraft();
    savedId.value = null;
    recovered.value = false;
    autosaveOn = true;
  }

  async function ensureDraft(): Promise<void> {
    await ready;
    if (!draft.value) await startNew();
  }

  /**
   * Edits a saved route: its draft when one is already open for it, else a
   * draft made from the stored route. An unknown, deleted or unreadable route
   * gets a toast and a new draft instead (false).
   */
  async function loadForEdit(id: string): Promise<boolean> {
    await ready;
    if (draft.value?.editingId === id) {
      savedId.value = null;
      autosaveOn = true;
      return true;
    }
    let spec: RouteSpec | null = null;
    let contents: RouteBundle['contents'] = {};
    let published = false;
    let found = false;
    try {
      const record = await getMyRoute(id);
      found = record !== undefined;
      if (record && validateRouteBundle(record.bundle).ok) {
        spec = record.bundle.spec;
        contents = record.bundle.contents;
        published = record.visibility === 'public';
      }
    } catch (error) {
      console.warn('creator: the route could not be read', error);
    }
    if (!spec) {
      ui.toast({ key: found ? 'myRoutes.unreadable' : 'route.notFound' }, { tone: 'warning' });
      await startNew();
      return false;
    }
    const base = draftFromSpec(spec);
    cancelAutosave();
    stopCards();
    const places = base.places.map((place) => ({ ...place, tempId: randomId() }));
    draft.value = {
      ...freshDraft(),
      editingId: id,
      locale: base.locale,
      name: base.name,
      mode: base.mode,
      activity: base.activity,
      timeLimitMinutes: base.timeLimit ? Math.max(1, Math.round(base.timeLimit / 60)) : null,
      places,
      publish: published,
      cards: cardsFromBundle(places, contents, base.locale),
      ...(base.summary ? { summary: base.summary } : {}),
      ...(base.interests ? { interests: knownInterests(base.interests) } : {}),
      ...(base.settingsOverrides ? { settingsOverrides: base.settingsOverrides } : {}),
    };
    savedId.value = null;
    recovered.value = false;
    autosaveOn = true;
    return true;
  }

  async function update(patch: DraftPatch): Promise<void> {
    await ready;
    if (!draft.value) return;
    // The summary is a line the AI wrote: cleaned and cut to what a route may have.
    Object.assign(
      draft.value,
      patch.summary === undefined
        ? patch
        : { ...patch, summary: truncateText(patch.summary, SUMMARY_MAX) },
    );
  }

  /** Adds a place at the end. False when the list is full or the same place (externalId) is there. */
  async function addPlace(input: NewPlace): Promise<boolean> {
    await ready;
    const places = draft.value?.places;
    if (!places || places.length >= DRAFT_LIMITS.maxPlaces) return false;
    if (input.externalId && places.some((place) => place.externalId === input.externalId))
      return false;
    const tempId = input.tempId ?? randomId();
    if (places.some((place) => place.tempId === tempId)) return false;
    const address = input.address ? truncateText(input.address, DRAFT_LIMITS.addressMax) : '';
    const place: DraftPlace = {
      ...plainPlace({ ...input, tempId }),
      name: truncateText(input.name, DRAFT_LIMITS.nameMax),
    };
    delete place.address;
    if (address) place.address = address;
    // The card is the default: only another choice is stored.
    if (place.arrival?.type === 'card') delete place.arrival;
    places.push(place);
    return true;
  }

  /**
   * Changes a place. A new `arrival` is stored as given (the card, the default,
   * as no choice at all); a place that stops using the AI card loses it.
   */
  async function updatePlace(tempId: string, patch: PlacePatch): Promise<boolean> {
    await ready;
    const place = draft.value?.places.find((item) => item.tempId === tempId);
    if (!place) return false;
    const renamed = patch.name !== undefined && patch.name.trim() !== place.name.trim();
    const { arrival, ...rest } = patch;
    Object.assign(place, rest.name === undefined ? rest : { ...rest, name: capName(rest.name) });
    if ('arrival' in patch) {
      if (arrival === undefined || arrival.type === 'card') delete place.arrival;
      else place.arrival = JSON.parse(JSON.stringify(arrival)) as ArrivalChoice;
      // No card for a place that shows something else: not asked for, not shipped.
      if (!usesCard(place)) dropCard(tempId);
    }
    // A point of the user's own is researched by its name: a new name needs a new card.
    if (renamed && !place.externalId) dropCard(tempId);
    return true;
  }

  /**
   * Removes a place (and its card, which comes back with it); returns them and
   * where it was, for "Deshacer".
   */
  async function removePlace(
    tempId: string,
  ): Promise<{ place: DraftPlace; index: number; card?: CardState } | null> {
    await ready;
    const current = draft.value;
    const places = current?.places;
    const index = places?.findIndex((place) => place.tempId === tempId) ?? -1;
    if (!current || !places || index < 0) return null;
    const [removed] = places.splice(index, 1);
    if (!removed) return null;
    const card = current.cards[tempId];
    // Kept as it was (with its contentRef): "Deshacer" brings the card back to it.
    const place = plainPlace(removed);
    dropCard(tempId, removed);
    return {
      place,
      index,
      ...(card?.status === 'ready' || card?.status === 'basic'
        ? { card: JSON.parse(JSON.stringify(card)) as CardState }
        : {}),
    };
  }

  /** Puts a removed place (and its card) back where it was ("Deshacer"); false if it can't go back. */
  async function restorePlace(
    place: DraftPlace,
    index: number,
    card?: CardState,
  ): Promise<boolean> {
    await ready;
    const current = draft.value;
    const places = current?.places;
    if (!current || !places || places.length >= DRAFT_LIMITS.maxPlaces) return false;
    if (
      places.some(
        (item) =>
          item.tempId === place.tempId ||
          (place.externalId !== undefined && item.externalId === place.externalId),
      )
    )
      return false;
    places.splice(Math.max(0, Math.min(index, places.length)), 0, plainPlace(place));
    if (card) current.cards[place.tempId] = JSON.parse(JSON.stringify(card)) as CardState;
    return true;
  }

  /** Moves the place at `from` to `to` (list indexes). */
  async function movePlace(from: number, to: number): Promise<boolean> {
    await ready;
    const places = draft.value?.places;
    if (!places || from === to) return false;
    if (from < 0 || to < 0 || from >= places.length || to >= places.length) return false;
    const [moved] = places.splice(from, 1);
    if (moved) places.splice(to, 0, moved);
    return true;
  }

  // ------------------------------------------------------------ the cards (step 3)

  // Cards are asked for two at a time, in list order. Nothing here is stored
  // (the draft keeps the results): a reload forgets the queue, and step 3
  // asks again for the cards still missing.

  /** Places waiting for a free slot. */
  let cardQueue: string[] = [];
  /** Requests under way, by place. */
  const cardJobs = new Map<string, AbortController>();
  /** Ready cards being asked for again: the old one ships until the new one arrives. */
  const refreshing = ref<Record<string, true>>({});
  let idleWaiters: Array<() => void> = [];

  const isRefreshing = (tempId: string): boolean => refreshing.value[tempId] === true;

  /** The place's card; a place nobody has looked at yet is `pending`. */
  function cardOf(tempId: string): CardState {
    return draft.value?.cards[tempId] ?? { status: 'pending' };
  }

  /** Resolves when no card is being asked for or waiting its turn. */
  function cardsIdle(): Promise<void> {
    if (cardJobs.size === 0 && cardQueue.length === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function wakeIdleWaiters(): void {
    if (cardJobs.size > 0 || cardQueue.length > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const wake of waiters) wake();
  }

  /** Forgets a place's request, queued or under way. */
  function cancelCard(tempId: string): void {
    cardJobs.get(tempId)?.abort();
    cardJobs.delete(tempId);
    cardQueue = cardQueue.filter((id) => id !== tempId);
    delete refreshing.value[tempId];
  }

  /** Forgets the card of a place (it is being removed, or its name changed). */
  function dropCard(tempId: string, place?: DraftPlace): void {
    cancelCard(tempId);
    const current = draft.value;
    if (!current) return;
    delete current.cards[tempId];
    const target = place ?? current.places.find((item) => item.tempId === tempId);
    if (target) delete target.contentRef;
    wakeIdleWaiters();
  }

  /** Cancels every request (the draft is being replaced or closed). */
  function stopCards(): void {
    for (const controller of cardJobs.values()) controller.abort();
    cardJobs.clear();
    cardQueue = [];
    refreshing.value = {};
    wakeIdleWaiters();
  }

  function pumpCards(): void {
    const current = draft.value;
    while (current && cardJobs.size < CARD_CONCURRENCY) {
      const tempId = cardQueue.shift();
      if (tempId === undefined) break;
      // Removed while it waited.
      if (current.places.some((place) => place.tempId === tempId)) void runCard(current, tempId);
    }
    wakeIdleWaiters();
  }

  /** The queued places can't be tried either: they fail the same way, without a request. */
  function failQueued(current: CreatorDraft, code: AiErrorCode): void {
    const waiting = cardQueue;
    cardQueue = [];
    for (const tempId of waiting) {
      if (isRefreshing(tempId)) delete refreshing.value[tempId];
      else current.cards[tempId] = { status: 'error', error: code };
    }
  }

  async function runCard(current: CreatorDraft, tempId: string): Promise<void> {
    const place = current.places.find((item) => item.tempId === tempId);
    if (!place) return;
    // Registered before the first await, so the pump counts it.
    const controller = new AbortController();
    cardJobs.set(tempId, controller);
    const refresh = isRefreshing(tempId);
    if (!refresh) current.cards[tempId] = { status: 'generating' };
    const started = Date.now();
    const stale = () => cardJobs.get(tempId) !== controller || draft.value !== current;
    try {
      // "Regenerar" on a ready card asks for a new one; a retry may come from the cache.
      const body = { ...requestFor(place, current), ...(refresh ? { fresh: true } : {}) };
      const result = await generateCard(body, controller.signal);
      if (stale()) return;
      const target = current.places.find((item) => item.tempId === tempId);
      if (!target) return;
      target.contentRef ??= `card-${newIdSuffix()}`;
      current.cards[tempId] = {
        status: 'ready',
        content: JSON.parse(JSON.stringify(result.content)) as GeneratedCard,
        grounding: result.grounding,
      };
      track('content_generated', { ok: true, ms: Date.now() - started });
    } catch (error) {
      if (controller.signal.aborted || stale()) return;
      const code: AiErrorCode = error instanceof AiError ? error.code : 'failed';
      if (!(error instanceof AiError)) console.warn('creator: a card failed unexpectedly', error);
      track('content_generated', { ok: false, ms: Date.now() - started });
      if (refresh) ui.toast({ key: 'create.content.refreshFailed' }, { tone: 'warning' });
      else current.cards[tempId] = { status: 'error', error: code };
      if (code === 'offline' || BLOCKING_AI_ERRORS.has(code)) failQueued(current, code);
    } finally {
      if (cardJobs.get(tempId) === controller) {
        cardJobs.delete(tempId);
        delete refreshing.value[tempId];
      }
      pumpCards();
    }
  }

  /**
   * Prepares the cards step 3 still lacks (places nobody looked at, waiting
   * ones and those that waited for a connection), two at a time. Offline it
   * just says so. Resolves when nothing is being prepared any more.
   */
  async function generateMissing(): Promise<void> {
    await ready;
    const current = draft.value;
    if (!current) return;
    const offline = globalThis.navigator?.onLine === false;
    for (const place of current.places) {
      const id = place.tempId;
      // Only the places that show the AI card are sent to the AI.
      if (!usesCard(place)) continue;
      if (!needsCard(current.cards[id]) || cardJobs.has(id) || cardQueue.includes(id)) continue;
      if (offline) current.cards[id] = { status: 'error', error: 'offline' };
      else {
        current.cards[id] = { status: 'pending' };
        cardQueue.push(id);
      }
    }
    pumpCards();
    await cardsIdle();
  }

  /**
   * Asks for a place's card again: a retry after an error, "Generar con IA"
   * on a basic one, or "Regenerar" (a ready card: the API writes a new one,
   * `fresh`). A ready card keeps shipping until the new one arrives, and
   * stays if the new one fails.
   */
  async function regenerateCard(tempId: string): Promise<void> {
    await ready;
    const current = draft.value;
    const place = current?.places.find((item) => item.tempId === tempId);
    if (!current || !place || !usesCard(place)) return;
    cancelCard(tempId);
    const shipping = shippedCard(place, current.cards[tempId]) !== null;
    if (globalThis.navigator?.onLine === false) {
      if (shipping) ui.toast({ key: 'errors.ai.offline' }, { tone: 'warning' });
      else current.cards[tempId] = { status: 'error', error: 'offline' };
      return;
    }
    if (shipping) refreshing.value[tempId] = true;
    else current.cards[tempId] = { status: 'pending' };
    cardQueue.push(tempId);
    pumpCards();
  }

  /** "Usar ficha básica": the place keeps its name and address sheet and drops any AI card. */
  async function setBasicCard(tempId: string): Promise<void> {
    await ready;
    const current = draft.value;
    const place = current?.places.find((item) => item.tempId === tempId);
    if (!current || !place || !usesCard(place)) return;
    cancelCard(tempId);
    current.cards[tempId] = { status: 'basic' };
    delete place.contentRef;
    pumpCards();
  }

  /** The basic sheet for every place whose card failed (no AI today, limits…). Returns how many. */
  async function setBasicForFailed(): Promise<number> {
    await ready;
    const current = draft.value;
    if (!current) return 0;
    let changed = 0;
    for (const place of current.places) {
      if (current.cards[place.tempId]?.status !== 'error') continue;
      await setBasicCard(place.tempId);
      changed += 1;
    }
    return changed;
  }

  /**
   * Saves the route on this device (the upload follows on its own) and closes
   * the draft. Rejects when the draft can't be built or the local write
   * failed (create.review.saveError); the draft then stays as it was.
   */
  async function save(): Promise<string> {
    await ready;
    const current = draft.value;
    if (!current) throw new Error('creator: there is no draft to save');
    if (saving.value) throw new Error('creator: already saving');
    saving.value = true;
    try {
      const editing = current.editingId !== null;
      const visibility = current.publish ? 'public' : 'private';
      let built = build();
      if (!built.ok) throw new Error('creator: the draft is not a valid route yet');
      // What the route was before this save, to tell publishing or taking it back from an edit.
      const before = current.editingId
        ? ((await getMyRoute(current.editingId).catch(() => undefined))?.visibility ?? 'private')
        : 'private';
      let record;
      try {
        record = await saveMyRoute(built.spec, built.contents, { editing, visibility });
      } catch (error) {
        if (editing || !(error instanceof MyRoutesError) || error.code !== 'id_taken') throw error;
        // A new route whose id is taken (practically never): a new suffix, once.
        current.idSuffix = newIdSuffix();
        built = build();
        if (!built.ok) throw error;
        record = await saveMyRoute(built.spec, built.contents, { editing, visibility });
      }
      // PROJECT_PLAN §13 (only with consent; never a position).
      if (!editing) {
        const { points, mode, activity } = built.spec;
        track('route_created', { points: points.length, mode, activity });
      }
      if (visibility !== before) track(current.publish ? 'route_published' : 'route_unpublished');
      // The catalog has the route once it listens (it may not have loaded yet).
      await catalog.loadMine();
      // In this order: nothing may store the draft again once it is saved.
      stopAutosave();
      savedId.value = record.id;
      draft.value = null;
      recovered.value = false;
      lastStoredJson = null;
      await db.del(KEYS.creatorDraft);
      return record.id;
    } finally {
      saving.value = false;
    }
  }

  /** Throws the draft away ("Empezar de cero", or before editing another route). */
  async function discard(): Promise<void> {
    await ready;
    cancelAutosave();
    stopCards();
    draft.value = null;
    recovered.value = false;
    lastStoredJson = null;
    await db.del(KEYS.creatorDraft);
  }

  /** After deleting a route: a draft that edits it (here or stored by another tab) goes too. */
  async function discardIfEditing(id: string): Promise<void> {
    await ready;
    if (draft.value?.editingId === id) {
      await discard();
      return;
    }
    try {
      await db.update<unknown>(KEYS.creatorDraft, (stored) =>
        isDraftFor(stored, id) ? undefined : stored,
      );
    } catch {
      // Storage unavailable: nothing stored to discard either.
    }
  }

  return {
    ready,
    draft,
    savedId,
    saving,
    storageOff,
    recovered,
    hasContent,
    routeDraft,
    summary,
    overlaps,
    overlapIds,
    issues,
    resumeStep,
    stepIssues,
    cardStats,
    cardsToPrepare,
    cardOf,
    isRefreshing,
    cardsIdle,
    generateMissing,
    regenerateCard,
    setBasicCard,
    setBasicForFailed,
    build,
    flush,
    stopAutosave,
    startNew,
    ensureDraft,
    loadForEdit,
    update,
    addPlace,
    updatePlace,
    removePlace,
    restorePlace,
    movePlace,
    save,
    discard,
    discardIfEditing,
  };
});
