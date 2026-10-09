import { clear, createStore, del, get, promisifyRequest, set, type UseStore } from 'idb-keyval';

// Two kinds of local storage:
// - localStorage for small settings read synchronously before the app mounts
//   (no flash of the wrong language or theme);
// - IndexedDB (idb-keyval) for bigger things: run snapshots, downloaded route
//   bundles, the analytics queue, the user's own routes and the creator's draft.
// Both can be missing (private windows, blocked storage): the plain calls fail
// soft. The "checked" ones reject instead, for data whose loss must be noticed
// (the routes the user created, the draft).

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Like `get`, but rejects when the read fails (undefined means "not there"). */
  getChecked<T>(key: string): Promise<T | undefined>;
  /** Like `set`, but rejects when the write fails. */
  setChecked(key: string, value: unknown): Promise<void>;
  /**
   * Reads and writes `key` in one readwrite transaction, so it is atomic
   * across tabs. `updater` must be pure and synchronous: it gets the stored
   * value and returns the new one; returning the same value writes nothing
   * and returning undefined deletes the key. Rejects on any failure, and a
   * failed read or a throwing updater never writes.
   */
  update<T>(key: string, updater: (old: T | undefined) => T | undefined): Promise<void>;
}

let idbStore: UseStore | null = null;
function store(): UseStore {
  idbStore ??= createStore('rumbo', 'kv');
  return idbStore;
}

/** IndexedDB through idb-keyval. */
export const db: KeyValueStore = {
  async get<T>(key: string) {
    try {
      return await get<T>(key, store());
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    try {
      await set(key, value, store());
    } catch {
      // Storage full or unavailable: the app keeps working without persistence.
    }
  },
  async del(key) {
    try {
      await del(key, store());
    } catch {
      // Nothing to delete.
    }
  },
  async clear() {
    try {
      await clear(store());
    } catch {
      // Nothing to clear.
    }
  },
  async getChecked<T>(key: string) {
    return get<T>(key, store());
  },
  async setChecked(key, value) {
    await set(key, value, store());
  },
  async update<T>(key: string, updater: (old: T | undefined) => T | undefined) {
    // idb-keyval's update() always puts the result; this one can also skip or delete.
    await store()('readwrite', (objects) => {
      const transaction = objects.transaction;
      return new Promise<void>((resolve, reject) => {
        const request = objects.get(key);
        request.onsuccess = () => {
          try {
            const old = request.result as T | undefined;
            const next = updater(old);
            if (next !== old) {
              if (next === undefined) objects.delete(key);
              else objects.put(next, key);
            }
          } catch (error) {
            // Nothing was written: undo the transaction so it never commits half a change.
            transaction.abort();
            reject(error);
            return;
          }
          resolve(promisifyRequest(transaction));
        };
        request.onerror = () => reject(request.error);
      });
    });
  },
};

/** Keys used in IndexedDB. */
export const KEYS = {
  activeRun: 'run:active',
  lastSummary: 'run:last',
  bundle: (routeId: string) => `bundle:${routeId}`,
  analyticsQueue: 'analytics:queue',
  /** Run ends the API hasn't received yet (offline). */
  runOutbox: 'runs:outbox',
  deviceId: 'device:id',
  /** The routes made with the creator: { v: 1, records } (services/myRoutes.ts). */
  myRoutes: 'routes:mine',
  /** The creator's work in progress (stores/creator.ts). */
  creatorDraft: 'create:draft',
  /** A stored draft that couldn't be read back as it was, kept just in case. */
  creatorDraftBackup: 'create:draft:backup',
  /** The community routes this device reported (ids): "Reportar ruta" isn't offered again for them. */
  reportedRoutes: 'routes:reported',
} as const;

/** localStorage that never throws. */
export const local = {
  read(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  write(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Private mode or quota: settings live in memory for this session.
    }
  },
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Nothing to remove.
    }
  },
};
