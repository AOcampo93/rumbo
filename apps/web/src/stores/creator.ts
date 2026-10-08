import {
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
import { track } from '../services/analytics.ts';
import { getMyRoute, MyRoutesError, saveMyRoute } from '../services/myRoutes.ts';
import { db, KEYS } from '../services/storage.ts';
import { useCatalogStore } from './catalog.ts';
import { useUiStore } from './ui.ts';

// The route creator's state (C1-C5, phase 6): one draft, kept in IndexedDB as
// the user goes (a reload or a closed tab never loses it), validated step by
// step with route-builder, built into a RouteSpec and saved as one of the
// user's routes (services/myRoutes.ts).

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
  /** Kept from the edited route (phase 7 asks for them). */
  interests?: string[];
  /** Kept from the edited route. */
  settingsOverrides?: RouteSettingsInput;
  updatedAt: string;
}

export type CreatorStep = 'details' | 'places' | 'review';
export const CREATOR_STEPS: readonly CreatorStep[] = ['details', 'places', 'review'];

export type DraftPatch = Partial<
  Pick<
    CreatorDraft,
    'name' | 'mode' | 'activity' | 'timeLimitMinutes' | 'area' | 'interests' | 'settingsOverrides'
  >
>;
/** A place to add; `tempId` is made when missing (pass one to refer to the place right away). */
export type NewPlace = Omit<DraftPlace, 'tempId' | 'pointId'> & { tempId?: string };
export type PlacePatch = Partial<Omit<DraftPlace, 'tempId' | 'pointId'>>;

/** build(): the route ready to save and run, or what keeps it from being one. */
export type BuildResult =
  | { ok: true; spec: RouteSpec; normalized: NormalizedRouteSpec; warnings: Issue[] }
  /** `issues`: the draft's (validateDraft); `errors`: the built route's (rare: a broken place). */
  | { ok: false; issues: DraftIssue[]; errors: Issue[] };

const AUTOSAVE_MS = 300;

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
  contentRef: z.string().optional(),
});

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
          const place: DraftPlace = parsed.data;
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
      .catch(fallback(() => undefined)),
    settingsOverrides: RouteSettingsInputSchema.optional().catch(fallback(() => undefined)),
    updatedAt: z.string().catch(fallback(() => new Date().toISOString())),
  });
  const result = schema.safeParse(raw);
  return result.success ? { draft: result.data, repaired } : null;
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

/** Cuts a name to the limit without trimming it (the user may be typing a space). */
const capName = (name: string): string =>
  [...name].length > DRAFT_LIMITS.nameMax
    ? [...name].slice(0, DRAFT_LIMITS.nameMax).join('')
    : name;

const isDraftFor = (stored: unknown, id: string): boolean =>
  typeof stored === 'object' &&
  stored !== null &&
  (stored as { editingId?: unknown }).editingId === id;

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
    return {
      name: current.name,
      locale: current.locale,
      mode: current.mode,
      activity: current.activity,
      timeLimit: current.timeLimitMinutes === null ? null : current.timeLimitMinutes * 60,
      places: current.places.map(plainPlace),
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

  /** What blocks a step: details (name, time limit), places (the list), review (everything). */
  function stepIssues(step: CreatorStep): DraftIssue[] {
    if (step === 'details')
      return issues.value.filter((issue) => issue.field === 'name' || issue.field === 'timeLimit');
    if (step === 'places')
      return issues.value.filter(
        (issue) => issue.field === 'places' || issue.field.startsWith('places.'),
      );
    return issues.value;
  }

  /** Where a resumed draft opens: the first step with something missing. */
  const resumeStep = computed<CreatorStep>(() => {
    if (stepIssues('details').length > 0) return 'details';
    if (stepIssues('places').length > 0) return 'places';
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
    globalThis.document?.removeEventListener('visibilitychange', onVisibility);
    globalThis.removeEventListener?.('pagehide', onPageHide);
  });

  /** No more autosaving (until a new draft starts), e.g. before "Delete my local data". */
  function stopAutosave(): void {
    cancelAutosave();
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
      updatedAt: new Date().toISOString(),
    };
  }

  /** A new, empty draft in place of the current one. */
  async function startNew(): Promise<void> {
    await ready;
    cancelAutosave();
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
    let found = false;
    try {
      const record = await getMyRoute(id);
      found = record !== undefined;
      if (record && validateRouteBundle(record.bundle).ok) spec = record.bundle.spec;
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
    draft.value = {
      ...freshDraft(),
      editingId: id,
      locale: base.locale,
      name: base.name,
      mode: base.mode,
      activity: base.activity,
      timeLimitMinutes: base.timeLimit ? Math.max(1, Math.round(base.timeLimit / 60)) : null,
      places: base.places.map((place) => ({ ...place, tempId: randomId() })),
      ...(base.interests ? { interests: base.interests } : {}),
      ...(base.settingsOverrides ? { settingsOverrides: base.settingsOverrides } : {}),
    };
    savedId.value = null;
    recovered.value = false;
    autosaveOn = true;
    return true;
  }

  async function update(patch: DraftPatch): Promise<void> {
    await ready;
    if (draft.value) Object.assign(draft.value, patch);
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
    places.push(place);
    return true;
  }

  async function updatePlace(tempId: string, patch: PlacePatch): Promise<boolean> {
    await ready;
    const place = draft.value?.places.find((item) => item.tempId === tempId);
    if (!place) return false;
    Object.assign(
      place,
      patch.name === undefined ? patch : { ...patch, name: capName(patch.name) },
    );
    return true;
  }

  /** Removes a place; returns it and where it was, for "Deshacer". */
  async function removePlace(tempId: string): Promise<{ place: DraftPlace; index: number } | null> {
    await ready;
    const places = draft.value?.places;
    const index = places?.findIndex((place) => place.tempId === tempId) ?? -1;
    if (!places || index < 0) return null;
    const [removed] = places.splice(index, 1);
    return removed ? { place: plainPlace(removed), index } : null;
  }

  /** Puts a removed place back where it was ("Deshacer"); false if it can't go back. */
  async function restorePlace(place: DraftPlace, index: number): Promise<boolean> {
    await ready;
    const places = draft.value?.places;
    if (!places || places.length >= DRAFT_LIMITS.maxPlaces) return false;
    if (
      places.some(
        (item) =>
          item.tempId === place.tempId ||
          (place.externalId !== undefined && item.externalId === place.externalId),
      )
    )
      return false;
    places.splice(Math.max(0, Math.min(index, places.length)), 0, plainPlace(place));
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
      let built = build();
      if (!built.ok) throw new Error('creator: the draft is not a valid route yet');
      let record;
      try {
        record = await saveMyRoute(built.spec, {}, { editing });
      } catch (error) {
        if (editing || !(error instanceof MyRoutesError) || error.code !== 'id_taken') throw error;
        // A new route whose id is taken (practically never): a new suffix, once.
        current.idSuffix = newIdSuffix();
        built = build();
        if (!built.ok) throw error;
        record = await saveMyRoute(built.spec, {}, { editing });
      }
      // PROJECT_PLAN §13 (only with consent; never a position).
      if (!editing) {
        const { points, mode, activity } = built.spec;
        track('route_created', { points: points.length, mode, activity });
      }
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
