import { clear, createStore, del, get, set, type UseStore } from 'idb-keyval';

// Two kinds of local storage:
// - localStorage for small settings read synchronously before the app mounts
//   (no flash of the wrong language or theme);
// - IndexedDB (idb-keyval) for bigger things: run snapshots, downloaded route
//   bundles and the analytics queue.
// Both can be missing (private windows, blocked storage): every call fails soft.

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}

let idbStore: UseStore | null = null;
function store(): UseStore {
  idbStore ??= createStore('rumbo', 'kv');
  return idbStore;
}

/** IndexedDB through idb-keyval; resolves `undefined` instead of throwing. */
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
