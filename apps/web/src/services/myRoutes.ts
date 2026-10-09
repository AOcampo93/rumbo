import {
  type ApiErrorCode,
  EDIT_TOKEN_HEADER,
  type RouteVisibility,
  RouteWriteResponseSchema,
} from '@rumbo/api-contract';
import { type RouteBundle, type RouteSpec, validateRouteBundle } from '@rumbo/route-spec';
import { z } from 'zod';
import { api, apiErrorCode } from './api.ts';
import { db, KEYS } from './storage.ts';

// The routes made with the creator (phase 6). Each one lives in IndexedDB
// with its authored bundle and its edit token, works before the API has it,
// and a sync loop uploads it: POST the first time, PUT after an edit, DELETE
// when the user deletes it. Every change is one atomic update of the registry
// (`routes:mine`), and an answer only counts for the revision it was sent for,
// so a late answer never overwrites a newer change, in this tab or another.
// Publishing a route for the community (phase 7.2) is one more change of the
// same kind: it rides along in the POST and PUT bodies as `visibility`.
// This module never imports stores: the catalog listens with onMyRoutesChange.

export type SyncState = 'synced' | 'pending' | 'error';

export interface MyRouteRecord {
  id: string;
  /** Proof of ownership for PUT/DELETE: 32 random bytes, base64url. Only this device has it. */
  editToken: string;
  /** As authored (buildRouteSpec's spec): what the API stores. */
  bundle: { spec: RouteSpec; contents: RouteBundle['contents'] };
  /** +1 on every local change (save, delete, retry). */
  rev: number;
  sync: SyncState;
  /** ApiErrorCode when sync = 'error'. */
  error?: string;
  /** Whether the API has a copy; 'maybe' is stored before the first POST leaves the device. */
  remote: 'no' | 'maybe' | 'yes';
  /**
   * Who sees the route (phase 7.2): only this device ('private') or the
   * community ('public'). Records stored before it have none and read as
   * 'private': listMyRoutes and getMyRoute always return it. Changing it is
   * an edit like any other.
   */
  visibility?: RouteVisibility;
  /** Tombstone: hidden, and removed once the API confirms the DELETE. */
  deleted?: boolean;
  /** Consecutive failed attempts; the record turns to 'error' after MAX_FAILURES. */
  failures: number;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
}

/** Why a registry operation was refused. */
export class MyRoutesError extends Error {
  readonly code: 'id_taken' | 'unknown_format';

  constructor(code: MyRoutesError['code'], message: string) {
    super(message);
    this.name = 'MyRoutesError';
    this.code = code;
  }
}

interface Registry {
  v: 1;
  records: Record<string, MyRouteRecord>;
}

const MAX_FAILURES = 5;
/** A 30-place route takes a while to upload on a slow link. */
const WRITE_TIMEOUT_MS = 30_000;
const RETRY_EVERY_MS = 60_000;
const SYNC_LOCK = 'rumbo-routes-sync';

// The sync loop's state, for this tab.
/** A pass was asked for while another ran: run one more. */
let requested = false;
let running: Promise<void> | null = null;
/** Records with a request on its way. */
const inFlight = new Set<string>();
/** startRouteSync() listens to the triggers; stopRouteSync() stops everything. */
let started = false;
let stopped = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Enough to read a record safely; the bundle itself is checked by validateRouteBundle. */
const RecordSchema = z.looseObject({
  id: z.string().min(1),
  editToken: z.string().min(1),
  bundle: z.looseObject({
    spec: z.looseObject({ id: z.string() }),
    contents: z.record(z.string(), z.unknown()),
  }),
  rev: z.number().int().nonnegative(),
  sync: z.enum(['synced', 'pending', 'error']),
  remote: z.enum(['no', 'maybe', 'yes']),
  deleted: z.boolean().optional(),
  failures: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const isUsable = (record: unknown, id: string): record is MyRouteRecord =>
  RecordSchema.safeParse(record).success && (record as MyRouteRecord).id === id;

/** Nothing but an explicit 'public' publishes a route: a record without a (readable) visibility is private. */
const visibilityOf = (record: { visibility?: unknown }): RouteVisibility =>
  record.visibility === 'public' ? 'public' : 'private';

/** The record as the rest of the app reads it: always with its visibility (the registry itself is rewritten only by changes). */
const withVisibility = (record: MyRouteRecord): MyRouteRecord =>
  record.visibility === visibilityOf(record)
    ? record
    : { ...record, visibility: visibilityOf(record) };

/**
 * The stored registry, or an empty one when there is none. Anything else
 * (another format, e.g. from a newer app) throws: it is never overwritten.
 */
function toRegistry(raw: unknown): Registry {
  if (raw === undefined) return { v: 1, records: {} };
  const registry = raw as Partial<Registry> | null;
  if (
    typeof registry !== 'object' ||
    registry === null ||
    registry.v !== 1 ||
    typeof registry.records !== 'object' ||
    registry.records === null
  ) {
    throw new MyRoutesError('unknown_format', 'The routes registry has an unknown format');
  }
  return registry as Registry;
}

/** The visible records (no tombstones), newest first. */
function listFrom(registry: Registry): MyRouteRecord[] {
  return Object.entries(registry.records)
    .filter((entry): entry is [string, MyRouteRecord] => isUsable(entry[1], entry[0]))
    .map(([, record]) => withVisibility(record))
    .filter((record) => !record.deleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

function recordOf(registry: Registry, id: string): MyRouteRecord | undefined {
  const record = Object.hasOwn(registry.records, id) ? registry.records[id] : undefined;
  return isUsable(record, id) ? withVisibility(record) : undefined;
}

/** A record with `patch` applied, keeping its invariants: `error` only in 'error', `deleted` only when true. */
function patched(record: MyRouteRecord, patch: Partial<MyRouteRecord>): MyRouteRecord {
  const next = { ...record, ...patch };
  if (next.sync !== 'error') delete next.error;
  if (!next.deleted) delete next.deleted;
  return next;
}

const withRecord = (registry: Registry, record: MyRouteRecord): Registry => ({
  ...registry,
  records: { ...registry.records, [record.id]: record },
});

function withoutRecord(registry: Registry, id: string): Registry {
  const records = { ...registry.records };
  delete records[id];
  return { ...registry, records };
}

// ------------------------------------------------------------------ changes

type ChangeListener = (records: MyRouteRecord[]) => void;
const listeners = new Set<ChangeListener>();

/** Called after every change with the visible records; returns the unsubscribe function. */
export function onMyRoutesChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(registry: Registry): void {
  const records = listFrom(registry);
  for (const listener of listeners) {
    try {
      listener(records);
    } catch (error) {
      console.warn('myRoutes: a change listener failed', error);
    }
  }
}

const UNCHANGED = Symbol('unchanged');

/**
 * One atomic change of the registry (a single IndexedDB transaction). `change`
 * is pure: it returns the new registry or UNCHANGED. Without `create`, a
 * missing registry stays missing. Rejects when storage fails or the stored
 * registry has an unknown format; listeners hear about every change made.
 */
async function mutate(
  change: (registry: Registry) => Registry | typeof UNCHANGED,
  options: { create?: boolean } = {},
): Promise<void> {
  const result: { registry: Registry | null } = { registry: null };
  await db.update<unknown>(KEYS.myRoutes, (raw) => {
    if (raw === undefined && !options.create) return raw;
    const next = change(toRegistry(raw));
    if (next === UNCHANGED) return raw;
    result.registry = next;
    return next;
  });
  if (result.registry) notify(result.registry);
}

// ------------------------------------------------------------------ reading

/**
 * The user's routes (no tombstones), newest first. `unreadable`: the registry
 * couldn't be read (storage error or a newer format), so `records` says nothing.
 */
export async function listMyRoutes(): Promise<{ records: MyRouteRecord[]; unreadable: boolean }> {
  try {
    return { records: listFrom(toRegistry(await db.getChecked(KEYS.myRoutes))), unreadable: false };
  } catch (error) {
    console.warn('myRoutes: the registry could not be read', error);
    return { records: [], unreadable: true };
  }
}

/** One route, unless it is deleted or being deleted. Rejects when storage fails. */
export async function getMyRoute(id: string): Promise<MyRouteRecord | undefined> {
  const record = recordOf(toRegistry(await db.getChecked(KEYS.myRoutes)), id);
  return record && !record.deleted ? record : undefined;
}

/** The record's bundle ready to run, or null if it no longer passes validation. */
export function myRouteBundle(record: MyRouteRecord): RouteBundle | null {
  return validateRouteBundle(record.bundle).bundle ?? null;
}

// ------------------------------------------------------------------ local changes

/** 32 random bytes in base64url (43 characters), EditTokenSchema's format. */
function newEditToken(): string {
  let binary = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(32)))
    binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

let persistAsked = false;

/** The registry holds the only copy of unsent routes and of every token: ask the browser to keep it. */
function askPersistentStorage(): void {
  if (persistAsked) return;
  persistAsked = true;
  void globalThis.navigator?.storage?.persist?.().catch(() => false);
}

/**
 * Saves a route on this device and starts uploading it (fire and forget).
 * Resolves after the local write, with the record; rejects when it failed.
 * A new id gets a new edit token. An existing id is only overwritten when
 * `editing` (a new route never replaces another one): then it gets rev + 1
 * and goes back to 'pending', deleting it is undone, and its token stays.
 * `visibility` is the creator's publish choice: a new route is private
 * without it, and an edited one keeps the one it has.
 */
export async function saveMyRoute(
  spec: RouteSpec,
  contents: RouteBundle['contents'] = {},
  options: { editing?: boolean; visibility?: RouteVisibility } = {},
): Promise<MyRouteRecord> {
  const now = new Date().toISOString();
  // A plain copy: nothing stored is shared with the caller (or is a reactive proxy).
  const bundle = JSON.parse(JSON.stringify({ spec, contents })) as MyRouteRecord['bundle'];
  const saved: { record: MyRouteRecord | null } = { record: null };
  await mutate(
    (registry) => {
      const existing = Object.hasOwn(registry.records, spec.id)
        ? registry.records[spec.id]
        : undefined;
      if (existing !== undefined && !options.editing) {
        throw new MyRoutesError('id_taken', `A route with id ${spec.id} already exists`);
      }
      const record = isUsable(existing, spec.id)
        ? patched(withVisibility(existing), {
            bundle,
            rev: existing.rev + 1,
            sync: 'pending',
            deleted: false,
            failures: 0,
            updatedAt: now,
            ...(options.visibility ? { visibility: options.visibility } : {}),
          })
        : {
            id: spec.id,
            editToken: newEditToken(),
            bundle,
            rev: 1,
            sync: 'pending' as const,
            remote: 'no' as const,
            visibility: options.visibility ?? ('private' as const),
            failures: 0,
            createdAt: now,
            updatedAt: now,
          };
      saved.record = record;
      return withRecord(registry, record);
    },
    { create: true },
  );
  askPersistentStorage();
  void syncMyRoutes();
  return saved.record as MyRouteRecord;
}

/**
 * Publishes a route for the community, or takes it back (phase 7.2). It is an
 * edit like any other: rev + 1, 'pending', and the upload loop sends a PUT
 * with the new visibility, offline included (it waits and retries). Resolves
 * true when something changed; false for an unknown or deleted route, or one
 * that already is so. Rejects when storage fails.
 */
export async function setMyRouteVisibility(
  id: string,
  visibility: RouteVisibility,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = { changed: false };
  await mutate((registry) => {
    const record = recordOf(registry, id);
    if (!record || record.deleted || record.visibility === visibility) return UNCHANGED;
    result.changed = true;
    return withRecord(
      registry,
      patched(record, {
        visibility,
        rev: record.rev + 1,
        sync: 'pending',
        failures: 0,
        updatedAt: now,
      }),
    );
  });
  if (result.changed) void syncMyRoutes();
  return result.changed;
}

/** Also forgets what the device keeps about the route: its offline bundle, and its run in progress or last summary. */
async function forgetLocalCopies(id: string): Promise<void> {
  const forgetRun = (key: string) =>
    db
      .update<{ routeId?: unknown }>(key, (old) => (old?.routeId === id ? undefined : old))
      .catch(() => undefined);
  await Promise.all([
    db.del(KEYS.bundle(id)),
    forgetRun(KEYS.activeRun),
    forgetRun(KEYS.lastSummary),
  ]);
}

/**
 * Deletes a route. Never uploaded and not being uploaded: gone at once.
 * Otherwise it becomes a tombstone until the API confirms the DELETE.
 * Rejects when storage fails.
 */
export async function deleteMyRoute(id: string): Promise<void> {
  const now = new Date().toISOString();
  await mutate((registry) => {
    const record = recordOf(registry, id);
    if (!record || record.deleted) return UNCHANGED;
    if (record.remote === 'no' && !inFlight.has(id)) return withoutRecord(registry, id);
    return withRecord(
      registry,
      patched(record, {
        deleted: true,
        sync: 'pending',
        failures: 0,
        rev: record.rev + 1,
        updatedAt: now,
      }),
    );
  });
  await forgetLocalCopies(id);
  void syncMyRoutes();
}

/** "Retry" on a route in 'error': back to 'pending', and uploads it now. */
export async function retryMyRoute(id: string): Promise<void> {
  await mutate((registry) => {
    const record = recordOf(registry, id);
    if (!record || record.sync !== 'error') return UNCHANGED;
    return withRecord(
      registry,
      patched(record, { sync: 'pending', failures: 0, rev: record.rev + 1 }),
    );
  });
  void syncMyRoutes();
}

// ------------------------------------------------------------------ talking to the API

interface Attempt {
  id: string;
  /** The record's revision when the request was built. */
  rev: number;
  kind: 'post' | 'put' | 'delete';
  token: string;
  bundle?: MyRouteRecord['bundle'];
  /** Goes with the bundle: who sees the route, as the record had it when the request was built. */
  visibility?: RouteVisibility;
}

type Outcome =
  /** POST/PUT 200/201 with a valid body, DELETE 204. */
  | { kind: 'ok' }
  /** The API says it has no such route (`route_not_found`). */
  | { kind: 'gone' }
  /** Another ApiError 4xx: retrying the same request can't help. */
  | { kind: 'rejected'; code: ApiErrorCode }
  /** Not a final answer from the API: offline, timeout, 5xx, 429, a proxy's page… */
  | { kind: 'transient'; code: ApiErrorCode | null };

async function send(attempt: Attempt, timeoutMs = WRITE_TIMEOUT_MS): Promise<Outcome> {
  const path = attempt.kind === 'post' ? '/routes' : `/routes/${encodeURIComponent(attempt.id)}`;
  let response: Response;
  try {
    response = await api(path, {
      method: attempt.kind === 'post' ? 'POST' : attempt.kind === 'put' ? 'PUT' : 'DELETE',
      // The device that creates a route owns it.
      device: attempt.kind === 'post',
      headers: { [EDIT_TOKEN_HEADER]: attempt.token },
      ...(attempt.bundle
        ? { body: { ...attempt.bundle, visibility: attempt.visibility ?? 'private' } }
        : {}),
      timeoutMs,
    });
  } catch {
    return { kind: 'transient', code: null };
  }
  return classify(response, attempt);
}

/**
 * Only the API's own answers count: an ApiError body, or the expected success
 * with a valid body. Anything else (nginx's HTML while the API restarts, a 404
 * or 405 without ApiError, 408, 425, 429, 5xx) is transient.
 */
async function classify(response: Response, attempt: Attempt): Promise<Outcome> {
  if (attempt.kind === 'delete' && response.status === 204) return { kind: 'ok' };
  if (attempt.kind !== 'delete' && (response.status === 200 || response.status === 201)) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON: not our API.
    }
    const parsed = RouteWriteResponseSchema.safeParse(body);
    return parsed.success && parsed.data.id === attempt.id
      ? { kind: 'ok' }
      : { kind: 'transient', code: null };
  }
  const code = response.ok ? null : await apiErrorCode(response);
  // `not_found`: an API without these endpoints yet (deploys aren't atomic).
  if (code === null || code === 'rate_limited' || code === 'not_found' || response.status >= 500) {
    return { kind: 'transient', code };
  }
  if (code === 'route_not_found') return { kind: 'gone' };
  return { kind: 'rejected', code };
}

/**
 * Decides the next request for one record, in the same atomic update that
 * stores remote 'maybe' before a first POST. Null: nothing to send.
 */
async function plan(id: string): Promise<Attempt | null> {
  const planned: { attempt: Attempt | null } = { attempt: null };
  await mutate((registry) => {
    const record = recordOf(registry, id);
    if (!record) return UNCHANGED;
    const base = { id, rev: record.rev, token: record.editToken };
    if (record.deleted) {
      // The API never had it: nothing to delete there.
      if (record.remote === 'no') return withoutRecord(registry, id);
      planned.attempt = { ...base, kind: 'delete' };
      return UNCHANGED;
    }
    if (record.sync !== 'pending') return UNCHANGED;
    const upload = { bundle: record.bundle, visibility: record.visibility };
    if (record.remote === 'yes') {
      planned.attempt = { ...base, kind: 'put', ...upload };
      return UNCHANGED;
    }
    // POST is idempotent for the owner, so 'maybe' (a lost answer) posts again.
    planned.attempt = { ...base, kind: 'post', ...upload };
    return record.remote === 'no'
      ? withRecord(registry, patched(record, { remote: 'maybe' }))
      : UNCHANGED;
  });
  return planned.attempt;
}

/**
 * Applies an answer. The full outcome only applies to the revision that was
 * sent; a record changed meanwhile only takes what the answer proves (the API
 * has a copy, or has none) and stays pending. A removed record stays removed.
 * Returns true when the record must be sent again right away (PUT → POST).
 */
async function apply(attempt: Attempt, outcome: Outcome): Promise<boolean> {
  const now = new Date().toISOString();
  const result = { again: false, changedMeanwhile: false };
  await mutate((registry) => {
    const record = recordOf(registry, attempt.id);
    if (!record) return UNCHANGED;
    const same = record.rev === attempt.rev;
    result.changedMeanwhile = !same;
    const update = (patch: Partial<MyRouteRecord>) => withRecord(registry, patched(record, patch));

    if (outcome.kind === 'transient') {
      const failures = record.failures + 1;
      return failures >= MAX_FAILURES && same
        ? update({ failures, sync: 'error', error: outcome.code ?? 'unavailable' })
        : update({ failures });
    }

    if (attempt.kind === 'delete') {
      // Done (204, already gone) or never possible (403 and the like): forget it.
      if (record.deleted) return withoutRecord(registry, attempt.id);
      // Saved again while the DELETE was on its way: upload it again.
      return outcome.kind === 'ok' || outcome.kind === 'gone'
        ? update({ remote: 'no' })
        : UNCHANGED;
    }

    if (outcome.kind === 'ok') {
      return same
        ? update({ remote: 'yes', sync: 'synced', failures: 0, syncedAt: now })
        : update({ remote: 'yes' });
    }
    if (outcome.kind === 'gone' && attempt.kind === 'put') {
      // The API lost it: nothing to delete, or create it again with a POST.
      if (record.deleted) return withoutRecord(registry, attempt.id);
      result.again = true;
      return update({ remote: 'no' });
    }
    const code = outcome.kind === 'gone' ? 'route_not_found' : outcome.code;
    return same ? update({ sync: 'error', error: code, failures: 0 }) : UNCHANGED;
  });
  // The newer revision needs its own request: one more pass.
  if (result.changedMeanwhile) requested = true;
  return result.again;
}

async function syncRecord(id: string): Promise<void> {
  // At most one PUT that answers route_not_found, then its POST.
  for (let round = 0; round < 2; round++) {
    const attempt = await plan(id);
    if (!attempt) return;
    inFlight.add(id);
    let outcome: Outcome;
    try {
      outcome = await send(attempt);
    } finally {
      inFlight.delete(id);
    }
    if (!(await apply(attempt, outcome))) return;
  }
}

async function syncPass(): Promise<void> {
  // Offline: nothing to try (and no failures to count); the online event comes back.
  if (globalThis.navigator?.onLine === false) return;
  const registry = toRegistry(await db.getChecked(KEYS.myRoutes));
  for (const id of Object.keys(registry.records)) {
    if (stopped) return;
    await syncRecord(id);
  }
}

// ------------------------------------------------------------------ the sync loop

/** Passes run one at a time across tabs, so two tabs never send the same route at once. */
function withSyncLock(pass: () => Promise<void>): Promise<void> {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(SYNC_LOCK, pass) : pass();
}

/**
 * Uploads whatever is waiting. Requests coalesce: while a pass runs, a new
 * request makes the loop run one more pass when it ends. Resolves when the
 * loop is idle again.
 */
export function syncMyRoutes(): Promise<void> {
  if (stopped) return running ?? Promise.resolve();
  requested = true;
  running ??= (async () => {
    try {
      while (requested && !stopped) {
        requested = false;
        try {
          await withSyncLock(syncPass);
        } catch (error) {
          console.warn('myRoutes: sync pass failed', error);
        }
      }
    } finally {
      running = null;
      void armRetryTimer();
    }
  })();
  return running;
}

/** Resolves once no sync pass is running (without asking for one). */
export function routeSyncIdle(): Promise<void> {
  return running ?? Promise.resolve();
}

/** While any record is still waiting, another pass in a minute. */
async function armRetryTimer(): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (!started || stopped) return;
  let waiting: boolean;
  try {
    const { records } = toRegistry(await db.getChecked(KEYS.myRoutes));
    waiting = Object.entries(records).some(
      ([id, record]) => isUsable(record, id) && record.sync === 'pending',
    );
  } catch {
    waiting = false;
  }
  if (!waiting || !started || stopped || running || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncMyRoutes();
  }, RETRY_EVERY_MS);
}

function onTrigger(): void {
  void syncMyRoutes();
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') void syncMyRoutes();
}

/** Syncs now, and again when the device comes back online or the app back to the foreground. */
export function startRouteSync(): void {
  stopped = false;
  if (!started) {
    started = true;
    globalThis.addEventListener?.('online', onTrigger);
    globalThis.addEventListener?.('pageshow', onTrigger);
    globalThis.document?.addEventListener('visibilitychange', onVisibility);
  }
  void syncMyRoutes();
}

/** Stops syncing (before "Delete my local data"); a request in flight still finishes. */
export function stopRouteSync(): void {
  stopped = true;
  if (started) {
    started = false;
    globalThis.removeEventListener?.('online', onTrigger);
    globalThis.removeEventListener?.('pageshow', onTrigger);
    globalThis.document?.removeEventListener('visibilitychange', onVisibility);
  }
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

/**
 * Best effort before "Delete my local data": a DELETE for every route the API
 * may have, each limited to `timeoutMs`. `failed`: how many may still be there.
 */
export async function deleteAllMyRoutesRemote(timeoutMs = 3000): Promise<{ failed: number }> {
  // An upload in flight could otherwise create a route right after its DELETE.
  if (running) {
    await Promise.race([running, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }
  let records: MyRouteRecord[];
  try {
    const registry = toRegistry(await db.getChecked(KEYS.myRoutes));
    records = Object.entries(registry.records)
      .filter((entry): entry is [string, MyRouteRecord] => isUsable(entry[1], entry[0]))
      .map(([, record]) => record);
  } catch {
    return { failed: 0 };
  }
  const results = await Promise.allSettled(
    records
      .filter((record) => record.remote !== 'no')
      .map((record) =>
        send(
          { id: record.id, rev: record.rev, kind: 'delete', token: record.editToken },
          timeoutMs,
        ),
      ),
  );
  return {
    failed: results.filter(
      (result) => result.status === 'rejected' || result.value.kind === 'transient',
    ).length,
  };
}
